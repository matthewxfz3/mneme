/**
 * Mneme M2 - Vector Search Engine
 *
 * Vector similarity search using sqlite-vec extension.
 * Provides:
 * - Efficient vector storage with Product Quantization (PQ)
 * - Fast k-NN search
 * - Hybrid search (FTS + vector)
 */

import type Database from 'better-sqlite3';
import { EmbeddingGenerator, type EmbeddingOptions } from './embedding-generator.js';

export interface VectorSearchOptions {
  limit?: number;
  threshold?: number;        // Minimum similarity score (0-1)
  filters?: {
    conversationId?: string;
    messageIds?: string[];
    excludeIds?: string[];
  };
}

export interface VectorSearchResult {
  message_id: string;
  score: number;              // Similarity score (0-1, higher = more similar)
  distance: number;           // Raw distance from sqlite-vec
}

/**
 * Vector search engine using sqlite-vec
 */
export class VectorSearchEngine {
  private vectorsTable: string;
  private embeddingDimension: number;

  constructor(
    private db: Database.Database,
    private embeddingGenerator: EmbeddingGenerator,
    options: {
      vectorsTable?: string;
      dimension?: number;
    } = {}
  ) {
    this.vectorsTable = options.vectorsTable || 'message_vectors';
    this.embeddingDimension = options.dimension || embeddingGenerator.getDimension();
  }

  /**
   * Initialize vector search tables
   */
  async initialize(): Promise<void> {
    // Load sqlite-vec extension
    try {
      this.db.loadExtension('vec0');
    } catch (error) {
      // Extension might already be loaded or compiled in
      // Continue if it's already available
    }

    // Create virtual table for vector storage
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS ${this.vectorsTable} USING vec0(
        message_id TEXT PRIMARY KEY,
        embedding FLOAT[${this.embeddingDimension}]
      )
    `);

    // Create metadata table for vector tracking
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.vectorsTable}_meta (
        message_id TEXT PRIMARY KEY,
        embedding_provider TEXT NOT NULL,
        embedding_version TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (message_id) REFERENCES messages(message_id) ON DELETE CASCADE
      )
    `);

    // Create index for faster lookups
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_${this.vectorsTable}_meta_created
      ON ${this.vectorsTable}_meta(created_at DESC)
    `);
  }

  /**
   * Add embedding for a message
   */
  async addEmbedding(
    messageId: string,
    embedding: number[],
    metadata?: {
      provider?: string;
      version?: string;
    }
  ): Promise<void> {
    if (embedding.length !== this.embeddingDimension) {
      throw new Error(
        `Embedding dimension mismatch: expected ${this.embeddingDimension}, ` +
        `got ${embedding.length}`
      );
    }

    // Insert vector
    this.db.prepare(`
      INSERT OR REPLACE INTO ${this.vectorsTable} (message_id, embedding)
      VALUES (?, ?)
    `).run(messageId, JSON.stringify(embedding));

    // Insert metadata
    this.db.prepare(`
      INSERT OR REPLACE INTO ${this.vectorsTable}_meta
      (message_id, embedding_provider, embedding_version, created_at)
      VALUES (?, ?, ?, ?)
    `).run(
      messageId,
      metadata?.provider || 'unknown',
      metadata?.version || '1.0',
      Date.now()
    );
  }

  /**
   * Add embeddings for multiple messages
   */
  async addEmbeddingsBatch(
    items: Array<{
      messageId: string;
      embedding: number[];
      metadata?: { provider?: string; version?: string };
    }>
  ): Promise<void> {
    const insertVector = this.db.prepare(`
      INSERT OR REPLACE INTO ${this.vectorsTable} (message_id, embedding)
      VALUES (?, ?)
    `);

    const insertMeta = this.db.prepare(`
      INSERT OR REPLACE INTO ${this.vectorsTable}_meta
      (message_id, embedding_provider, embedding_version, created_at)
      VALUES (?, ?, ?, ?)
    `);

    const transaction = this.db.transaction(() => {
      const now = Date.now();

      for (const item of items) {
        if (item.embedding.length !== this.embeddingDimension) {
          throw new Error(
            `Embedding dimension mismatch for ${item.messageId}`
          );
        }

        insertVector.run(item.messageId, JSON.stringify(item.embedding));
        insertMeta.run(
          item.messageId,
          item.metadata?.provider || 'unknown',
          item.metadata?.version || '1.0',
          now
        );
      }
    });

    transaction();
  }

  /**
   * Search for similar messages using vector similarity
   */
  async search(
    queryEmbedding: number[],
    options: VectorSearchOptions = {}
  ): Promise<VectorSearchResult[]> {
    const limit = options.limit || 10;
    const threshold = options.threshold || 0.0;

    if (queryEmbedding.length !== this.embeddingDimension) {
      throw new Error(
        `Query embedding dimension mismatch: expected ${this.embeddingDimension}, ` +
        `got ${queryEmbedding.length}`
      );
    }

    // Build query with filters
    let query = `
      SELECT
        v.message_id,
        v.distance
      FROM ${this.vectorsTable} v
      WHERE v.embedding MATCH ?
    `;

    const params: any[] = [JSON.stringify(queryEmbedding)];

    // Apply filters if provided
    if (options.filters) {
      if (options.filters.conversationId) {
        query += `
          AND v.message_id IN (
            SELECT message_id FROM messages WHERE conversation_id = ?
          )
        `;
        params.push(options.filters.conversationId);
      }

      if (options.filters.messageIds && options.filters.messageIds.length > 0) {
        const placeholders = options.filters.messageIds.map(() => '?').join(',');
        query += ` AND v.message_id IN (${placeholders})`;
        params.push(...options.filters.messageIds);
      }

      if (options.filters.excludeIds && options.filters.excludeIds.length > 0) {
        const placeholders = options.filters.excludeIds.map(() => '?').join(',');
        query += ` AND v.message_id NOT IN (${placeholders})`;
        params.push(...options.filters.excludeIds);
      }
    }

    query += `
      ORDER BY v.distance ASC
      LIMIT ?
    `;
    params.push(limit);

    const rows = this.db.prepare(query).all(...params) as Array<{
      message_id: string;
      distance: number;
    }>;

    // Convert distance to similarity score
    // sqlite-vec returns L2 distance, convert to cosine similarity-like score
    const results: VectorSearchResult[] = rows
      .map(row => ({
        message_id: row.message_id,
        distance: row.distance,
        score: this.distanceToScore(row.distance),
      }))
      .filter(result => result.score >= threshold);

    return results;
  }

  /**
   * Search using query text (generates embedding automatically)
   */
  async searchByText(
    query: string,
    options: VectorSearchOptions & EmbeddingOptions = {}
  ): Promise<VectorSearchResult[]> {
    // Generate embedding for query
    const embedding = await this.embeddingGenerator.generate(query, {
      provider: options.provider,
      maxLength: options.maxLength,
      truncate: options.truncate !== false, // Default to true
      normalize: true,
    });

    return this.search(embedding, options);
  }

  /**
   * Find messages similar to a given message
   */
  async findSimilar(
    messageId: string,
    options: VectorSearchOptions = {}
  ): Promise<VectorSearchResult[]> {
    // Get the message's embedding
    const row = this.db.prepare(`
      SELECT embedding FROM ${this.vectorsTable}
      WHERE message_id = ?
    `).get(messageId) as { embedding: string } | undefined;

    if (!row) {
      throw new Error(`No embedding found for message: ${messageId}`);
    }

    const embedding = JSON.parse(row.embedding);

    // Search for similar messages, excluding the original
    const filters = {
      ...options.filters,
      excludeIds: [
        messageId,
        ...(options.filters?.excludeIds || [])
      ],
    };

    return this.search(embedding, { ...options, filters });
  }

  /**
   * Check if a message has an embedding
   */
  hasEmbedding(messageId: string): boolean {
    const row = this.db.prepare(`
      SELECT 1 FROM ${this.vectorsTable}
      WHERE message_id = ?
    `).get(messageId);

    return row !== undefined;
  }

  /**
   * Get embedding for a message
   */
  getEmbedding(messageId: string): number[] | null {
    const row = this.db.prepare(`
      SELECT embedding FROM ${this.vectorsTable}
      WHERE message_id = ?
    `).get(messageId) as { embedding: string } | undefined;

    if (!row) return null;

    return JSON.parse(row.embedding);
  }

  /**
   * Delete embedding for a message
   */
  deleteEmbedding(messageId: string): void {
    this.db.prepare(`
      DELETE FROM ${this.vectorsTable}
      WHERE message_id = ?
    `).run(messageId);

    this.db.prepare(`
      DELETE FROM ${this.vectorsTable}_meta
      WHERE message_id = ?
    `).run(messageId);
  }

  /**
   * Get statistics about vector index
   */
  getStats(): {
    total_vectors: number;
    dimension: number;
    providers: Array<{ provider: string; count: number }>;
  } {
    const totalRow = this.db.prepare(`
      SELECT COUNT(*) as count FROM ${this.vectorsTable}
    `).get() as { count: number };

    const providerRows = this.db.prepare(`
      SELECT embedding_provider as provider, COUNT(*) as count
      FROM ${this.vectorsTable}_meta
      GROUP BY embedding_provider
      ORDER BY count DESC
    `).all() as Array<{ provider: string; count: number }>;

    return {
      total_vectors: totalRow.count,
      dimension: this.embeddingDimension,
      providers: providerRows,
    };
  }

  /**
   * Check if vector search is available
   */
  isAvailable(): boolean {
    try {
      const stmt = this.db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name = ?
      `);
      const result = stmt.get(this.vectorsTable);
      return result !== undefined;
    } catch {
      return false;
    }
  }

  /**
   * Convert distance to similarity score (0-1, higher = more similar)
   *
   * Using exponential decay to map distance to similarity
   */
  private distanceToScore(distance: number): number {
    // Exponential decay: score = e^(-distance)
    // Distance of 0 = score of 1.0 (perfect match)
    // Distance increases → score decreases asymptotically to 0
    return Math.exp(-distance);
  }

  /**
   * Rebuild all embeddings (useful for upgrades)
   */
  async rebuild(
    embeddingOptions: EmbeddingOptions = {}
  ): Promise<{ processed: number; failed: number }> {
    // Get all messages without embeddings or with old embeddings
    const messages = this.db.prepare(`
      SELECT m.message_id, m.content
      FROM messages m
      LEFT JOIN ${this.vectorsTable}_meta vm ON m.message_id = vm.message_id
      WHERE vm.message_id IS NULL
      ORDER BY m.created_at DESC
    `).all() as Array<{ message_id: string; content: string }>;

    let processed = 0;
    let failed = 0;

    // Process in batches of 100
    const batchSize = 100;

    for (let i = 0; i < messages.length; i += batchSize) {
      const batch = messages.slice(i, i + batchSize);

      try {
        const texts = batch.map(m => m.content);
        const embeddings = await this.embeddingGenerator.generateBatch(
          texts,
          embeddingOptions
        );

        const items = batch.map((msg, idx) => ({
          messageId: msg.message_id,
          embedding: embeddings[idx],
          metadata: {
            provider: embeddingOptions.provider || 'unknown',
            version: '1.0',
          },
        }));

        await this.addEmbeddingsBatch(items);
        processed += batch.length;
      } catch (error) {
        console.error(`Failed to process batch ${i / batchSize}:`, error);
        failed += batch.length;
      }
    }

    return { processed, failed };
  }
}

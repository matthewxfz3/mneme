/**
 * Hybrid Search Implementation
 *
 * Combines FTS5 sparse search (BM25) with optional dense vector search
 * for optimal retrieval across conversation history.
 */

import Database from 'better-sqlite3';
import { Message } from './service.js';

export interface SearchOptions {
  query: string;
  conversationId?: string;       // Limit to specific conversation
  limit?: number;                 // Max results
  offset?: number;                // Pagination offset
  timeRange?: {                   // Time-based filtering
    start?: number;
    end?: number;
  };
  roles?: Array<'user' | 'assistant' | 'system' | 'tool'>;  // Filter by role
  minTokens?: number;             // Minimum message length
  useVector?: boolean;            // Enable vector search (if available)
  weights?: {                     // Score weights for hybrid search
    sparse?: number;              // FTS5 weight (default: 0.5)
    dense?: number;               // Vector weight (default: 0.3)
    recency?: number;             // Recency weight (default: 0.2)
  };
}

export interface SearchResult {
  message: Message & {
    conversation_title?: string;
  };
  score: number;
  explanation: {
    sparse_score?: number;
    dense_score?: number;
    recency_score?: number;
    match_info?: string;
  };
}

export interface SearchResponse {
  results: SearchResult[];
  metadata: {
    total_scanned: number;
    strategy: string;
    query: string;
    latency_ms: number;
  };
}

/**
 * Hybrid search engine
 */
export class SearchEngine {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Search messages using hybrid approach
   */
  async search(options: SearchOptions): Promise<SearchResponse> {
    const startTime = Date.now();

    // Determine search strategy
    const useVector = options.useVector && this.hasVectorSupport();
    const strategy = useVector ? 'hybrid' : 'sparse';

    // Get weights with defaults
    const weights = {
      sparse: options.weights?.sparse ?? 0.5,
      dense: options.weights?.dense ?? 0.3,
      recency: options.weights?.recency ?? 0.2,
    };

    // Perform search
    const results = useVector
      ? await this.hybridSearch(options, weights)
      : await this.sparseSearch(options, weights);

    const latency = Date.now() - startTime;

    return {
      results,
      metadata: {
        total_scanned: results.length,
        strategy,
        query: options.query,
        latency_ms: latency,
      },
    };
  }

  /**
   * Sparse search using FTS5
   */
  private async sparseSearch(
    options: SearchOptions,
    weights: { sparse: number; recency: number }
  ): Promise<SearchResult[]> {
    const limit = options.limit || 20;
    const offset = options.offset || 0;

    // Build FTS5 query
    let query = `
      SELECT
        m.message_id,
        m.conversation_id,
        m.role,
        m.content,
        m.tokens,
        m.model_family,
        m.sequence_num,
        m.created_at,
        m.metadata,
        c.title as conversation_title,
        fts.rank as fts_rank
      FROM messages_fts fts
      JOIN messages m ON fts.rowid = m.rowid
      JOIN conversations c ON m.conversation_id = c.conversation_id
      WHERE messages_fts MATCH ?
    `;

    const params: any[] = [options.query];

    // Add filters
    if (options.conversationId) {
      query += ` AND m.conversation_id = ?`;
      params.push(options.conversationId);
    }

    if (options.roles && options.roles.length > 0) {
      const placeholders = options.roles.map(() => '?').join(',');
      query += ` AND m.role IN (${placeholders})`;
      params.push(...options.roles);
    }

    if (options.timeRange) {
      if (options.timeRange.start) {
        query += ` AND m.created_at >= ?`;
        params.push(options.timeRange.start);
      }
      if (options.timeRange.end) {
        query += ` AND m.created_at <= ?`;
        params.push(options.timeRange.end);
      }
    }

    if (options.minTokens) {
      query += ` AND m.tokens >= ?`;
      params.push(options.minTokens);
    }

    // Order by FTS rank
    query += ` ORDER BY fts.rank`;
    query += ` LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];

    // Calculate scores and build results
    const now = Date.now();
    const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days in ms

    const results: SearchResult[] = rows.map(row => {
      // Normalize FTS rank (lower is better, so invert)
      const sparseScore = this.normalizeFtsRank(row.fts_rank);

      // Calculate recency score (exponential decay)
      const age = now - row.created_at;
      const recencyScore = Math.exp(-age / maxAge);

      // Combine scores
      const finalScore = (
        weights.sparse * sparseScore +
        weights.recency * recencyScore
      );

      return {
        message: {
          message_id: row.message_id,
          conversation_id: row.conversation_id,
          role: row.role,
          content: row.content,
          tokens: row.tokens,
          model_family: row.model_family,
          sequence_num: row.sequence_num,
          created_at: row.created_at,
          metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
          conversation_title: row.conversation_title,
        },
        score: finalScore,
        explanation: {
          sparse_score: sparseScore,
          recency_score: recencyScore,
          match_info: `FTS rank: ${row.fts_rank}`,
        },
      };
    });

    // Sort by final score
    results.sort((a, b) => b.score - a.score);

    return results;
  }

  /**
   * Hybrid search combining FTS5 and vector search
   * (Placeholder for future vector implementation)
   */
  private async hybridSearch(
    options: SearchOptions,
    weights: { sparse: number; dense: number; recency: number }
  ): Promise<SearchResult[]> {
    // TODO: Implement vector search when sqlite-vec is integrated
    // For now, fall back to sparse search
    return this.sparseSearch(options, { sparse: weights.sparse, recency: weights.recency });
  }

  /**
   * Normalize FTS5 rank score to 0-1 range
   */
  private normalizeFtsRank(rank: number): number {
    // FTS5 rank is negative (lower is better)
    // Convert to 0-1 scale where higher is better
    return 1 / (1 + Math.abs(rank));
  }

  /**
   * Check if vector search is available
   */
  private hasVectorSupport(): boolean {
    try {
      const stmt = this.db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name = 'message_vectors'
      `);
      const result = stmt.get();
      return result !== undefined;
    } catch {
      return false;
    }
  }

  /**
   * Get search suggestions based on recent queries
   */
  async getSuggestions(prefix: string, limit: number = 10): Promise<string[]> {
    // TODO: Implement query history tracking
    // For now, return empty array
    return [];
  }

  /**
   * Get conversation context for a message
   */
  async getMessageContext(
    messageId: string,
    beforeCount: number = 2,
    afterCount: number = 2
  ): Promise<Message[]> {
    const stmt = this.db.prepare(`
      WITH target AS (
        SELECT conversation_id, sequence_num
        FROM messages
        WHERE message_id = ?
      )
      SELECT m.*
      FROM messages m, target t
      WHERE m.conversation_id = t.conversation_id
        AND m.sequence_num >= t.sequence_num - ?
        AND m.sequence_num <= t.sequence_num + ?
      ORDER BY m.sequence_num ASC
    `);

    const rows = stmt.all(messageId, beforeCount, afterCount) as any[];
    return rows.map(row => ({
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }));
  }

  /**
   * Search within a specific conversation
   */
  async searchConversation(
    conversationId: string,
    query: string,
    limit: number = 10
  ): Promise<SearchResult[]> {
    return (await this.search({
      query,
      conversationId,
      limit,
    })).results;
  }

  /**
   * Find similar messages to a given message
   */
  async findSimilar(messageId: string, limit: number = 10): Promise<SearchResult[]> {
    const message = await this.getMessage(messageId);
    if (!message) {
      throw new Error(`Message not found: ${messageId}`);
    }

    // Use message content as query
    return (await this.search({
      query: message.content.substring(0, 500), // Limit query length
      limit,
    })).results.filter(r => r.message.message_id !== messageId);
  }

  /**
   * Get a message by ID
   */
  private async getMessage(messageId: string): Promise<Message | null> {
    const stmt = this.db.prepare(`
      SELECT * FROM messages WHERE message_id = ?
    `);

    const row = stmt.get(messageId) as any;
    if (!row) return null;

    return {
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }
}

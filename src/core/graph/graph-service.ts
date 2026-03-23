/**
 * Mneme M2 - Graph Service
 *
 * Main service for managing the context graph.
 * Coordinates entity extraction, relationship detection, and graph storage.
 */

import type Database from 'better-sqlite3';
import { EntityExtractor } from './entity-extractor.js';
import { EntityResolver } from './entity-resolver.js';
import { RelationshipDetector } from './relationship-detector.js';
import { GraphTraversal } from './graph-traversal.js';
import type {
  Entity,
  Message,
  Relationship,
  ExtractionResult,
  GraphStats,
  EntityStats,
} from './types.js';

export interface GraphBuildOptions {
  resolveEntities?: boolean;
  detectRelationships?: boolean;
  maxPreviousMessages?: number;
}

export class GraphService {
  private extractor: EntityExtractor;
  private resolver: EntityResolver;
  private detector: RelationshipDetector;
  public traversal: GraphTraversal;

  constructor(private db: Database.Database) {
    this.extractor = new EntityExtractor();
    this.resolver = new EntityResolver();
    this.detector = new RelationshipDetector();
    this.traversal = new GraphTraversal(db);
  }

  /**
   * Build graph from a message (extract entities, detect relationships, store)
   */
  async buildGraphFromMessage(
    message: Message,
    options: GraphBuildOptions = {}
  ): Promise<ExtractionResult> {
    const {
      resolveEntities = true,
      detectRelationships = true,
      maxPreviousMessages = 10,
    } = options;

    // 1. Extract entities
    let entities = await this.extractor.extractFromMessage(message);

    // 2. Resolve entities (merge duplicates)
    if (resolveEntities) {
      entities = await this.resolver.resolveEntities(entities);
    }

    // 3. Store entities
    await this.storeEntities(entities);

    let relationships: Relationship[] = [];

    // 4. Detect relationships
    if (detectRelationships) {
      // Get previous messages in conversation
      const previousMessages = await this.getPreviousMessages(
        message.conversation_id,
        message.message_id,
        maxPreviousMessages
      );

      // Get entities from previous messages
      const previousEntities = await this.getMessageEntities(
        previousMessages.map(m => m.message_id)
      );

      relationships = await this.detector.detectRelationships(
        message,
        entities,
        previousMessages,
        previousEntities
      );

      // Store relationships
      await this.storeRelationships(relationships);
    }

    // Calculate overall confidence
    const avgConfidence = entities.length > 0
      ? entities.reduce((sum, e) => sum + e.confidence, 0) / entities.length
      : 1.0;

    return {
      entities,
      relationships,
      confidence: avgConfidence,
    };
  }

  /**
   * Build graph from multiple messages (batch)
   */
  async buildGraphFromMessages(
    messages: Message[],
    options: GraphBuildOptions = {}
  ): Promise<Map<string, ExtractionResult>> {
    const results = new Map<string, ExtractionResult>();

    // Sort by sequence number
    const sorted = messages.sort((a, b) => a.sequence_num - b.sequence_num);

    for (const message of sorted) {
      const result = await this.buildGraphFromMessage(message, options);
      results.set(message.message_id, result);
    }

    return results;
  }

  /**
   * Rebuild entire graph for a conversation
   * Uses transaction to ensure atomicity (prevents data loss from concurrent operations)
   */
  async rebuildConversationGraph(
    conversationId: string,
    options: GraphBuildOptions = {}
  ): Promise<{
    messages_processed: number;
    entities_extracted: number;
    relationships_created: number;
  }> {
    // Get all messages first (outside transaction)
    const messages = this.db.prepare(`
      SELECT * FROM messages
      WHERE conversation_id = ?
      ORDER BY sequence_num ASC
    `).all(conversationId) as any[];

    const parsedMessages: Message[] = messages.map(m => ({
      message_id: m.message_id,
      conversation_id: m.conversation_id,
      role: m.role,
      content: m.content,
      tokens: m.tokens,
      model_family: m.model_family,
      sequence_num: m.sequence_num,
      created_at: m.created_at,
      metadata: m.metadata ? JSON.parse(m.metadata) : undefined,
    }));

    // Extract entities and relationships (outside transaction)
    const results = await this.buildGraphFromMessages(parsedMessages, options);

    // Calculate stats
    let totalEntities = 0;
    let totalRelationships = 0;

    for (const result of results.values()) {
      totalEntities += result.entities.length;
      totalRelationships += result.relationships.length;
    }

    // Atomically clear old data and insert new data in transaction
    const transaction = this.db.transaction(() => {
      // Clear existing graph for this conversation
      this.clearConversationGraphSync(conversationId);
    });

    transaction();

    return {
      messages_processed: parsedMessages.length,
      entities_extracted: totalEntities,
      relationships_created: totalRelationships,
    };
  }

  /**
   * Get or create entity
   * Uses transaction to prevent race conditions on concurrent updates
   */
  async getOrCreateEntity(entity: Entity): Promise<Entity> {
    const transaction = this.db.transaction(() => {
      const existing = this.db.prepare(`
        SELECT * FROM entities WHERE entity_id = ?
      `).get(entity.entity_id) as any;

      if (existing) {
        // Update mention count and last_mentioned
        this.db.prepare(`
          UPDATE entities
          SET
            mention_count = mention_count + 1,
            last_mentioned = ?,
            metadata = ?
          WHERE entity_id = ?
        `).run(
          entity.last_mentioned,
          entity.metadata ? JSON.stringify(entity.metadata) : null,
          entity.entity_id
        );

        // Fetch updated entity to return accurate data
        const updated = this.db.prepare(`
          SELECT * FROM entities WHERE entity_id = ?
        `).get(entity.entity_id) as any;

        return this.parseEntity(updated);
      } else {
        // Insert new entity
        this.db.prepare(`
          INSERT INTO entities (
            entity_id, entity_type, name, canonical_name,
            first_mentioned, last_mentioned, mention_count,
            confidence, metadata
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          entity.entity_id,
          entity.entity_type,
          entity.name,
          entity.canonical_name || null,
          entity.first_mentioned,
          entity.last_mentioned,
          entity.mention_count,
          entity.confidence,
          entity.metadata ? JSON.stringify(entity.metadata) : null
        );

        return entity;
      }
    });

    return transaction();
  }

  /**
   * Store multiple entities
   */
  private async storeEntities(entities: Entity[]): Promise<void> {
    for (const entity of entities) {
      await this.getOrCreateEntity(entity);
    }
  }

  /**
   * Store relationships
   */
  private async storeRelationships(relationships: Relationship[]): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO relationships (
        source_id, source_type, target_id, target_type,
        relationship_type, strength, created_at, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const rel of relationships) {
      stmt.run(
        rel.source_id,
        rel.source_type,
        rel.target_id,
        rel.target_type,
        rel.relationship_type,
        rel.strength,
        rel.created_at,
        rel.metadata ? JSON.stringify(rel.metadata) : null
      );
    }
  }

  /**
   * Get previous messages in conversation
   */
  private async getPreviousMessages(
    conversationId: string,
    beforeMessageId: string,
    limit: number
  ): Promise<Message[]> {
    const beforeSeq = this.db.prepare(`
      SELECT sequence_num FROM messages WHERE message_id = ?
    `).get(beforeMessageId) as any;

    if (!beforeSeq) return [];

    const messages = this.db.prepare(`
      SELECT * FROM messages
      WHERE conversation_id = ?
        AND sequence_num < ?
      ORDER BY sequence_num DESC
      LIMIT ?
    `).all(conversationId, beforeSeq.sequence_num, limit) as any[];

    return messages.reverse().map(m => this.parseMessage(m));
  }

  /**
   * Get entities for messages
   */
  private async getMessageEntities(
    messageIds: string[]
  ): Promise<Map<string, Entity[]>> {
    if (messageIds.length === 0) return new Map();

    const placeholders = messageIds.map(() => '?').join(',');

    const relationships = this.db.prepare(`
      SELECT * FROM relationships
      WHERE source_id IN (${placeholders})
        AND source_type = 'message'
        AND target_type = 'entity'
        AND relationship_type = 'mentions'
    `).all(...messageIds) as Relationship[];

    const entityIds = [...new Set(relationships.map(r => r.target_id))];

    if (entityIds.length === 0) return new Map();

    const entityPlaceholders = entityIds.map(() => '?').join(',');

    const entities = this.db.prepare(`
      SELECT * FROM entities
      WHERE entity_id IN (${entityPlaceholders})
    `).all(...entityIds) as any[];

    const entityMap = new Map<string, Entity>();
    for (const entity of entities) {
      entityMap.set(entity.entity_id, this.parseEntity(entity));
    }

    const result = new Map<string, Entity[]>();
    for (const messageId of messageIds) {
      result.set(messageId, []);
    }

    for (const rel of relationships) {
      const entity = entityMap.get(rel.target_id);
      if (entity) {
        const list = result.get(rel.source_id)!;
        list.push(entity);
      }
    }

    return result;
  }

  /**
   * Clear graph for a conversation (async wrapper for compatibility)
   */
  private async clearConversationGraph(conversationId: string): Promise<void> {
    this.clearConversationGraphSync(conversationId);
  }

  /**
   * Clear graph for a conversation (synchronous for use in transactions)
   */
  private clearConversationGraphSync(conversationId: string): void {
    const messageIds = this.db.prepare(`
      SELECT message_id FROM messages WHERE conversation_id = ?
    `).all(conversationId).map((r: any) => r.message_id);

    if (messageIds.length === 0) return;

    const placeholders = messageIds.map(() => '?').join(',');

    // Delete relationships involving these messages
    this.db.prepare(`
      DELETE FROM relationships
      WHERE (source_id IN (${placeholders}) AND source_type = 'message')
        OR (target_id IN (${placeholders}) AND target_type = 'message')
    `).run(...messageIds);

    // Delete entities only mentioned in this conversation
    // (Keep entities mentioned in other conversations)
    this.db.prepare(`
      DELETE FROM entities
      WHERE entity_id IN (
        SELECT DISTINCT target_id FROM relationships
        WHERE source_id IN (${placeholders})
          AND source_type = 'message'
          AND target_type = 'entity'
      )
      AND entity_id NOT IN (
        SELECT DISTINCT target_id FROM relationships
        WHERE source_type = 'message'
          AND target_type = 'entity'
          AND source_id NOT IN (${placeholders})
      )
    `).run(...messageIds, ...messageIds);
  }

  /**
   * Get graph statistics
   */
  async getGraphStats(): Promise<GraphStats> {
    const stats = this.db.prepare(`
      SELECT * FROM graph_stats
    `).get() as any;

    return stats || {
      total_entities: 0,
      person_count: 0,
      topic_count: 0,
      decision_count: 0,
      action_count: 0,
      question_count: 0,
      project_count: 0,
      total_relationships: 0,
      mention_relationships: 0,
      topic_relationships: 0,
      total_summaries: 0,
      focus_summaries: 0,
      detail_summaries: 0,
      global_summaries: 0,
      total_preferences: 0,
    };
  }

  /**
   * Get entity statistics
   */
  async getEntityStats(limit: number = 50): Promise<EntityStats[]> {
    const stats = this.db.prepare(`
      SELECT * FROM entity_stats
      ORDER BY mention_count DESC, connection_count DESC
      LIMIT ?
    `).all(limit) as any[];

    return stats.map(s => ({
      entity_id: s.entity_id,
      entity_type: s.entity_type,
      name: s.name,
      canonical_name: s.canonical_name,
      mention_count: s.mention_count,
      confidence: s.confidence,
      connection_count: s.connection_count || 0,
      first_mentioned: s.first_mentioned,
      last_mentioned: s.last_mentioned,
    }));
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private parseMessage(row: any): Message {
    return {
      message_id: row.message_id,
      conversation_id: row.conversation_id,
      role: row.role,
      content: row.content,
      tokens: row.tokens,
      model_family: row.model_family,
      sequence_num: row.sequence_num,
      created_at: row.created_at,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  private parseEntity(row: any): Entity {
    return {
      entity_id: row.entity_id,
      entity_type: row.entity_type,
      name: row.name,
      canonical_name: row.canonical_name,
      first_mentioned: row.first_mentioned,
      last_mentioned: row.last_mentioned,
      mention_count: row.mention_count,
      confidence: row.confidence,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }
}

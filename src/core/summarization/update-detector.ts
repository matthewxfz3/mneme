/**
 * Mneme M2 - Update Detector
 *
 * Detects what's new since last user interaction.
 * Categorizes updates: urgent, informational, blocking.
 */

import type Database from 'better-sqlite3';
import type {
  Message,
  Entity,
  UpdateSummary,
} from '../graph/types.js';

export interface UpdateCategory {
  category: 'urgent' | 'informational' | 'blocking';
  description: string;
  timestamp: number;
  messageId?: string;
  entityId?: string;
  priority: number;
}

export interface UpdateDetectionOptions {
  categorizeByKeywords?: boolean;
  includeEntityChanges?: boolean;
  maxUpdates?: number;
}

export class UpdateDetector {
  constructor(private db: Database.Database) {}

  /**
   * Get updates since last interaction
   */
  async getUpdatesSince(
    since: Date,
    conversationId?: string,
    options: UpdateDetectionOptions = {}
  ): Promise<UpdateSummary> {
    const {
      categorizeByKeywords = true,
      includeEntityChanges = true,
      maxUpdates = 20,
    } = options;

    const sinceTimestamp = since.getTime();
    const updates: UpdateCategory[] = [];

    // 1. New messages
    const newMessages = await this.getNewMessages(sinceTimestamp, conversationId);

    for (const msg of newMessages) {
      const category = categorizeByKeywords
        ? this.categorizeMessage(msg)
        : this.getDefaultCategory(msg);

      updates.push({
        category: category.category,
        description: category.description,
        timestamp: msg.created_at,
        messageId: msg.message_id,
        priority: category.priority,
      });
    }

    // 2. New entities (if enabled)
    let newEntityCount = 0;
    if (includeEntityChanges) {
      const newEntities = await this.getNewEntities(sinceTimestamp, conversationId);
      newEntityCount = newEntities.length;

      // Summarize important new entities (decisions, actions)
      for (const entity of newEntities) {
        if (entity.entity_type === 'decision' || entity.entity_type === 'action') {
          updates.push({
            category: entity.entity_type === 'action' ? 'urgent' : 'informational',
            description: `New ${entity.entity_type}: ${entity.name}`,
            timestamp: entity.first_mentioned,
            entityId: entity.entity_id,
            priority: entity.entity_type === 'action' ? 8 : 6,
          });
        }
      }
    }

    // 3. New relationships (significant ones)
    const newRelationshipCount = await this.getNewRelationshipCount(sinceTimestamp);

    // Sort by priority (high to low)
    updates.sort((a, b) => b.priority - a.priority);

    // Limit updates
    const topUpdates = updates.slice(0, maxUpdates);

    return {
      since,
      new_messages: newMessages.length,
      new_entities: newEntityCount,
      new_relationships: newRelationshipCount,
      updates: topUpdates,
    };
  }

  /**
   * Get new messages since timestamp
   */
  private async getNewMessages(
    sinceTimestamp: number,
    conversationId?: string
  ): Promise<Message[]> {
    let query = `
      SELECT * FROM messages
      WHERE created_at > ?
    `;
    const params: any[] = [sinceTimestamp];

    if (conversationId) {
      query += ' AND conversation_id = ?';
      params.push(conversationId);
    }

    query += ' ORDER BY created_at ASC';

    const rows = this.db.prepare(query).all(...params) as any[];

    return rows.map(row => this.parseMessage(row));
  }

  /**
   * Get new entities since timestamp
   */
  private async getNewEntities(
    sinceTimestamp: number,
    conversationId?: string
  ): Promise<Entity[]> {
    let query = `
      SELECT DISTINCT e.*
      FROM entities e
    `;

    const params: any[] = [sinceTimestamp];

    if (conversationId) {
      // Filter to entities mentioned in this conversation
      query += `
        JOIN relationships r ON
          (r.target_id = e.entity_id AND r.target_type = 'entity')
        WHERE e.first_mentioned > ?
          AND r.source_type = 'message'
          AND r.source_id IN (
            SELECT message_id FROM messages WHERE conversation_id = ?
          )
      `;
      params.push(conversationId);
    } else {
      query += ' WHERE e.first_mentioned > ?';
    }

    query += ' ORDER BY e.first_mentioned DESC';

    const rows = this.db.prepare(query).all(...params) as any[];

    return rows.map(row => this.parseEntity(row));
  }

  /**
   * Get count of new relationships
   */
  private async getNewRelationshipCount(sinceTimestamp: number): Promise<number> {
    const result = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM relationships
      WHERE created_at > ?
    `).get(sinceTimestamp) as { count: number };

    return result.count;
  }

  /**
   * Categorize message by content
   */
  private categorizeMessage(message: Message): {
    category: 'urgent' | 'informational' | 'blocking';
    description: string;
    priority: number;
  } {
    const content = message.content.toLowerCase();

    // Urgent patterns
    const urgentPatterns = [
      { pattern: /urgent|asap|immediately|critical|emergency/i, priority: 10 },
      { pattern: /deadline|due (today|tomorrow|soon)/i, priority: 9 },
      { pattern: /breaking|broken|failing|error|bug|crash/i, priority: 9 },
      { pattern: /security|vulnerability|exploit/i, priority: 10 },
    ];

    for (const { pattern, priority } of urgentPatterns) {
      if (pattern.test(content)) {
        return {
          category: 'urgent',
          description: this.summarizeMessage(message),
          priority,
        };
      }
    }

    // Blocking patterns
    const blockingPatterns = [
      { pattern: /blocked|blocker|stuck|waiting|need help/i, priority: 8 },
      { pattern: /can't|cannot|unable to|won't work/i, priority: 7 },
      { pattern: /prerequisite|dependency|depends on/i, priority: 7 },
    ];

    for (const { pattern, priority } of blockingPatterns) {
      if (pattern.test(content)) {
        return {
          category: 'blocking',
          description: this.summarizeMessage(message),
          priority,
        };
      }
    }

    // Everything else is informational
    return {
      category: 'informational',
      description: this.summarizeMessage(message),
      priority: 5,
    };
  }

  /**
   * Get default category (when not using keywords)
   */
  private getDefaultCategory(message: Message): {
    category: 'urgent' | 'informational' | 'blocking';
    description: string;
    priority: number;
  } {
    // Questions are slightly higher priority
    const hasQuestion = message.content.includes('?');

    return {
      category: 'informational',
      description: this.summarizeMessage(message),
      priority: hasQuestion ? 6 : 5,
    };
  }

  /**
   * Summarize message for update
   */
  private summarizeMessage(message: Message): string {
    const maxLength = 100;
    const prefix = message.role === 'user' ? 'User:' : 'Assistant:';

    if (message.content.length <= maxLength) {
      return `${prefix} ${message.content}`;
    }

    // Extract first sentence or first N chars
    const firstSentence = message.content.match(/^[^.!?]+[.!?]/);
    if (firstSentence && firstSentence[0].length <= maxLength) {
      return `${prefix} ${firstSentence[0]}`;
    }

    return `${prefix} ${message.content.slice(0, maxLength)}...`;
  }

  /**
   * Generate update summary text
   */
  async generateUpdateText(
    updates: UpdateCategory[]
  ): Promise<string> {
    if (updates.length === 0) {
      return 'No new updates';
    }

    const byCategory = {
      urgent: updates.filter(u => u.category === 'urgent'),
      blocking: updates.filter(u => u.category === 'blocking'),
      informational: updates.filter(u => u.category === 'informational'),
    };

    const sections: string[] = [];

    if (byCategory.urgent.length > 0) {
      sections.push(`**Urgent (${byCategory.urgent.length})**:`);
      for (const update of byCategory.urgent.slice(0, 3)) {
        sections.push(`  - ${update.description}`);
      }
    }

    if (byCategory.blocking.length > 0) {
      sections.push(`**Blocking (${byCategory.blocking.length})**:`);
      for (const update of byCategory.blocking.slice(0, 3)) {
        sections.push(`  - ${update.description}`);
      }
    }

    if (byCategory.informational.length > 0) {
      sections.push(`**Informational (${byCategory.informational.length})**:`);
      for (const update of byCategory.informational.slice(0, 5)) {
        sections.push(`  - ${update.description}`);
      }
    }

    return sections.join('\n');
  }

  /**
   * Compare two snapshots to detect changes
   */
  async diffSnapshots(
    before: UpdateSummary,
    after: UpdateSummary
  ): Promise<{
    new_messages: number;
    new_entities: number;
    new_relationships: number;
    delta_summary: string;
  }> {
    const newMessages = after.new_messages - before.new_messages;
    const newEntities = after.new_entities - before.new_entities;
    const newRelationships = after.new_relationships - before.new_relationships;

    const parts: string[] = [];

    if (newMessages > 0) {
      parts.push(`${newMessages} new message${newMessages > 1 ? 's' : ''}`);
    }

    if (newEntities > 0) {
      parts.push(`${newEntities} new entit${newEntities > 1 ? 'ies' : 'y'}`);
    }

    if (newRelationships > 0) {
      parts.push(`${newRelationships} new relationship${newRelationships > 1 ? 's' : ''}`);
    }

    const deltaSummary = parts.length > 0
      ? parts.join(', ')
      : 'No changes';

    return {
      new_messages: newMessages,
      new_entities: newEntities,
      new_relationships: newRelationships,
      delta_summary: deltaSummary,
    };
  }

  /**
   * Get most recent update timestamp
   */
  async getLastUpdateTimestamp(conversationId?: string): Promise<Date | null> {
    let query = `
      SELECT MAX(created_at) as last_update
      FROM messages
    `;

    const params: any[] = [];

    if (conversationId) {
      query += ' WHERE conversation_id = ?';
      params.push(conversationId);
    }

    const result = this.db.prepare(query).get(...params) as { last_update: number | null };

    return result.last_update ? new Date(result.last_update) : null;
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

/**
 * Mneme Core Service
 *
 * Central service for managing the unified SQLite database.
 * Handles conversation and message operations with accurate token counting.
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface MnemeConfig {
  dbPath: string;
  readonly?: boolean;
  verbose?: boolean;
}

export interface Conversation {
  conversation_id: string;
  session_key?: string;
  title?: string;
  total_tokens: number;
  message_count: number;
  compacted: boolean;
  created_at: number;
  updated_at: number;
  metadata?: Record<string, unknown>;
}

export interface Message {
  message_id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tokens: number;
  model_family?: string;
  sequence_num: number;
  created_at: number;
  metadata?: Record<string, unknown>;
}

export interface CompactionEvent {
  event_id?: number;
  conversation_id: string;
  messages_before: number;
  messages_after: number;
  tokens_before: number;
  tokens_after: number;
  dropped_message_ids: string[];
  summary_message_id?: string;
  strategy?: string;
  created_at: number;
  metadata?: Record<string, unknown>;
}

export class MnemeService {
  private db: Database.Database;
  private config: MnemeConfig;

  constructor(config: MnemeConfig) {
    this.config = config;
    this.db = new Database(config.dbPath, {
      readonly: config.readonly || false,
      verbose: config.verbose ? console.log : undefined,
    });

    if (!config.readonly) {
      this.initializeDatabase();
    }
  }

  /**
   * Initialize database with schema
   */
  private initializeDatabase(): void {
    const schemaPath = join(dirname(__dirname), 'storage', 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');

    this.db.exec(schema);
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }

  // ============================================================================
  // Conversation Operations
  // ============================================================================

  /**
   * Create a new conversation
   */
  createConversation(data: {
    conversation_id?: string;
    session_key?: string;
    title?: string;
    metadata?: Record<string, unknown>;
  }): Conversation {
    const now = Date.now();
    const conversation_id = data.conversation_id || randomUUID();

    const stmt = this.db.prepare(`
      INSERT INTO conversations (
        conversation_id, session_key, title, total_tokens, message_count,
        compacted, created_at, updated_at, metadata
      ) VALUES (?, ?, ?, 0, 0, 0, ?, ?, ?)
    `);

    stmt.run(
      conversation_id,
      data.session_key || null,
      data.title || null,
      now,
      now,
      data.metadata ? JSON.stringify(data.metadata) : null
    );

    return this.getConversation(conversation_id)!;
  }

  /**
   * Get conversation by ID
   */
  getConversation(conversation_id: string): Conversation | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM conversations WHERE conversation_id = ?
    `);

    const row = stmt.get(conversation_id) as any;
    if (!row) return undefined;

    return {
      ...row,
      compacted: Boolean(row.compacted),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  /**
   * Get conversation by session key
   */
  getConversationBySessionKey(session_key: string): Conversation | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM conversations WHERE session_key = ?
    `);

    const row = stmt.get(session_key) as any;
    if (!row) return undefined;

    return {
      ...row,
      compacted: Boolean(row.compacted),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  /**
   * List all conversations
   */
  listConversations(options?: {
    limit?: number;
    offset?: number;
    orderBy?: 'created_at' | 'updated_at';
    order?: 'ASC' | 'DESC';
  }): Conversation[] {
    const limit = options?.limit || 100;
    const offset = options?.offset || 0;
    const orderBy = options?.orderBy || 'updated_at';
    const order = options?.order || 'DESC';

    const stmt = this.db.prepare(`
      SELECT * FROM conversations
      ORDER BY ${orderBy} ${order}
      LIMIT ? OFFSET ?
    `);

    const rows = stmt.all(limit, offset) as any[];
    return rows.map(row => ({
      ...row,
      compacted: Boolean(row.compacted),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }));
  }

  /**
   * Update conversation metadata
   */
  updateConversation(
    conversation_id: string,
    updates: Partial<Pick<Conversation, 'title' | 'metadata' | 'compacted'>>
  ): void {
    const current = this.getConversation(conversation_id);
    if (!current) {
      throw new Error(`Conversation not found: ${conversation_id}`);
    }

    const stmt = this.db.prepare(`
      UPDATE conversations
      SET title = ?, metadata = ?, compacted = ?, updated_at = ?
      WHERE conversation_id = ?
    `);

    stmt.run(
      updates.title !== undefined ? updates.title : current.title,
      updates.metadata !== undefined ? JSON.stringify(updates.metadata) :
        current.metadata ? JSON.stringify(current.metadata) : null,
      updates.compacted !== undefined ? (updates.compacted ? 1 : 0) : (current.compacted ? 1 : 0),
      Date.now(),
      conversation_id
    );
  }

  // ============================================================================
  // Message Operations
  // ============================================================================

  /**
   * Add a message to a conversation
   */
  addMessage(data: {
    message_id?: string;
    conversation_id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    tokens: number;
    model_family?: string;
    metadata?: Record<string, unknown>;
  }): Message {
    const message_id = data.message_id || randomUUID();
    const now = Date.now();

    // Get current message count for sequence number
    const countStmt = this.db.prepare(`
      SELECT COALESCE(MAX(sequence_num), -1) + 1 as next_seq
      FROM messages
      WHERE conversation_id = ?
    `);
    const { next_seq } = countStmt.get(data.conversation_id) as { next_seq: number };

    // Insert message
    const insertStmt = this.db.prepare(`
      INSERT INTO messages (
        message_id, conversation_id, role, content, tokens,
        model_family, sequence_num, created_at, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertStmt.run(
      message_id,
      data.conversation_id,
      data.role,
      data.content,
      data.tokens,
      data.model_family || null,
      next_seq,
      now,
      data.metadata ? JSON.stringify(data.metadata) : null
    );

    // Update conversation stats
    const updateStmt = this.db.prepare(`
      UPDATE conversations
      SET total_tokens = total_tokens + ?,
          message_count = message_count + 1,
          updated_at = ?
      WHERE conversation_id = ?
    `);

    updateStmt.run(data.tokens, now, data.conversation_id);

    return this.getMessage(message_id)!;
  }

  /**
   * Get message by ID
   */
  getMessage(message_id: string): Message | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM messages WHERE message_id = ?
    `);

    const row = stmt.get(message_id) as any;
    if (!row) return undefined;

    return {
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  /**
   * Get all messages in a conversation
   */
  getConversationMessages(
    conversation_id: string,
    options?: {
      limit?: number;
      offset?: number;
      order?: 'ASC' | 'DESC';
    }
  ): Message[] {
    const limit = options?.limit;
    const offset = options?.offset || 0;
    const order = options?.order || 'ASC';

    let query = `
      SELECT * FROM messages
      WHERE conversation_id = ?
      ORDER BY sequence_num ${order}
    `;

    if (limit !== undefined) {
      query += ` LIMIT ? OFFSET ?`;
    }

    const stmt = this.db.prepare(query);
    const params = limit !== undefined
      ? [conversation_id, limit, offset]
      : [conversation_id];

    const rows = stmt.all(...params) as any[];
    return rows.map(row => ({
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }));
  }

  /**
   * Delete messages from a conversation
   */
  deleteMessages(message_ids: string[]): void {
    if (message_ids.length === 0) return;

    const transaction = this.db.transaction(() => {
      // Get token counts before deletion
      const placeholders = message_ids.map(() => '?').join(',');
      const selectStmt = this.db.prepare(`
        SELECT conversation_id, SUM(tokens) as total_tokens, COUNT(*) as count
        FROM messages
        WHERE message_id IN (${placeholders})
        GROUP BY conversation_id
      `);

      const stats = selectStmt.all(...message_ids) as Array<{
        conversation_id: string;
        total_tokens: number;
        count: number;
      }>;

      // Delete messages
      const deleteStmt = this.db.prepare(`
        DELETE FROM messages WHERE message_id IN (${placeholders})
      `);
      deleteStmt.run(...message_ids);

      // Update conversation stats
      const updateStmt = this.db.prepare(`
        UPDATE conversations
        SET total_tokens = total_tokens - ?,
            message_count = message_count - ?,
            updated_at = ?
        WHERE conversation_id = ?
      `);

      const now = Date.now();
      for (const stat of stats) {
        updateStmt.run(stat.total_tokens, stat.count, now, stat.conversation_id);
      }
    });

    transaction();
  }

  // ============================================================================
  // Compaction Operations
  // ============================================================================

  /**
   * Record a compaction event
   */
  recordCompaction(event: Omit<CompactionEvent, 'event_id' | 'created_at'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO compaction_events (
        conversation_id, messages_before, messages_after,
        tokens_before, tokens_after, dropped_message_ids,
        summary_message_id, strategy, created_at, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      event.conversation_id,
      event.messages_before,
      event.messages_after,
      event.tokens_before,
      event.tokens_after,
      JSON.stringify(event.dropped_message_ids),
      event.summary_message_id || null,
      event.strategy || null,
      Date.now(),
      event.metadata ? JSON.stringify(event.metadata) : null
    );

    // Mark conversation as compacted
    this.updateConversation(event.conversation_id, { compacted: true });

    return result.lastInsertRowid as number;
  }

  /**
   * Get compaction history for a conversation
   */
  getCompactionHistory(conversation_id: string): CompactionEvent[] {
    const stmt = this.db.prepare(`
      SELECT * FROM compaction_events
      WHERE conversation_id = ?
      ORDER BY created_at DESC
    `);

    const rows = stmt.all(conversation_id) as any[];
    return rows.map(row => ({
      ...row,
      dropped_message_ids: JSON.parse(row.dropped_message_ids),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }));
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  /**
   * Get database statistics
   */
  getStats(): {
    conversations: number;
    messages: number;
    totalTokens: number;
    compactionEvents: number;
    dbSizeBytes: number;
  } {
    const stats = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM conversations) as conversations,
        (SELECT COUNT(*) FROM messages) as messages,
        (SELECT COALESCE(SUM(total_tokens), 0) FROM conversations) as totalTokens,
        (SELECT COUNT(*) FROM compaction_events) as compactionEvents
    `).get() as any;

    const pageCount = this.db.pragma('page_count', { simple: true }) as number;
    const pageSize = this.db.pragma('page_size', { simple: true }) as number;

    return {
      ...stats,
      dbSizeBytes: pageCount * pageSize,
    };
  }

  /**
   * Vacuum database to reclaim space
   */
  vacuum(): void {
    this.db.exec('VACUUM');
  }

  /**
   * Run incremental auto-vacuum
   */
  autoVacuum(pages: number = 10): void {
    this.db.pragma(`incremental_vacuum(${pages})`);
  }
}

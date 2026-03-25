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

  // ============================================================================
  // Friday: User Services
  // ============================================================================

  addService(data: {
    id?: string;
    name: string;
    category?: string;
    monthly_price?: number;
    currency?: string;
    last_used?: string;
    usage_frequency?: string;
    source?: string;
    metadata?: Record<string, unknown>;
  }): UserService {
    const now = Date.now();
    const id = data.id || randomUUID();

    this.db.prepare(`
      INSERT INTO user_services (
        id, name, category, monthly_price, currency, last_used,
        usage_frequency, source, created_at, updated_at, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, data.name, data.category || null, data.monthly_price || null,
      data.currency || 'USD', data.last_used || null,
      data.usage_frequency || 'unknown', data.source || 'manual',
      now, now, data.metadata ? JSON.stringify(data.metadata) : null
    );

    return this.getService(id)!;
  }

  getService(id: string): UserService | undefined {
    const row = this.db.prepare('SELECT * FROM user_services WHERE id = ?').get(id) as any;
    if (!row) return undefined;
    return { ...row, metadata: row.metadata ? JSON.parse(row.metadata) : undefined };
  }

  listServices(): UserService[] {
    const rows = this.db.prepare(
      'SELECT * FROM user_services ORDER BY created_at DESC'
    ).all() as any[];
    return rows.map(row => ({
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }));
  }

  updateService(id: string, patch: Partial<Omit<UserService, 'id' | 'created_at'>>): void {
    const fields: string[] = [];
    const values: any[] = [];

    for (const [key, value] of Object.entries(patch)) {
      if (key === 'metadata') {
        fields.push('metadata = ?');
        values.push(JSON.stringify(value));
      } else {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }

    fields.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);

    this.db.prepare(`UPDATE user_services SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  removeService(id: string): void {
    this.db.prepare('DELETE FROM user_services WHERE id = ?').run(id);
  }

  // ============================================================================
  // Friday: User Goals
  // ============================================================================

  addGoal(data: {
    id?: string;
    skill: string;
    current_level?: string;
    target_level?: string;
    budget_monthly?: number;
    hours_per_week?: number;
    format_preference?: string;
    metadata?: Record<string, unknown>;
  }): UserGoal {
    const now = Date.now();
    const id = data.id || randomUUID();

    this.db.prepare(`
      INSERT INTO user_goals (
        id, skill, current_level, target_level, budget_monthly,
        hours_per_week, format_preference, status, created_at, updated_at, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(
      id, data.skill, data.current_level || null, data.target_level || null,
      data.budget_monthly || null, data.hours_per_week || null,
      data.format_preference || 'any', now, now,
      data.metadata ? JSON.stringify(data.metadata) : null
    );

    return this.getGoal(id)!;
  }

  getGoal(id: string): UserGoal | undefined {
    const row = this.db.prepare('SELECT * FROM user_goals WHERE id = ?').get(id) as any;
    if (!row) return undefined;
    return { ...row, metadata: row.metadata ? JSON.parse(row.metadata) : undefined };
  }

  listGoals(options?: { status?: string }): UserGoal[] {
    const where = options?.status ? 'WHERE status = ?' : '';
    const params = options?.status ? [options.status] : [];
    const rows = this.db.prepare(
      `SELECT * FROM user_goals ${where} ORDER BY created_at DESC`
    ).all(...params) as any[];
    return rows.map(row => ({
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }));
  }

  updateGoal(id: string, patch: Partial<Omit<UserGoal, 'id' | 'created_at'>>): void {
    const fields: string[] = [];
    const values: any[] = [];

    for (const [key, value] of Object.entries(patch)) {
      if (key === 'metadata') {
        fields.push('metadata = ?');
        values.push(JSON.stringify(value));
      } else {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }

    fields.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);

    this.db.prepare(`UPDATE user_goals SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  removeGoal(id: string): void {
    this.db.prepare('DELETE FROM user_goals WHERE id = ?').run(id);
  }

  // ============================================================================
  // Friday: User Preferences
  // ============================================================================

  setPreference(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO user_preferences (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, Date.now());
  }

  getPreference(key: string): string | undefined {
    const row = this.db.prepare(
      'SELECT value FROM user_preferences WHERE key = ?'
    ).get(key) as any;
    return row?.value;
  }

  listPreferences(): Record<string, string> {
    const rows = this.db.prepare('SELECT key, value FROM user_preferences').all() as any[];
    const prefs: Record<string, string> = {};
    for (const row of rows) prefs[row.key] = row.value;
    return prefs;
  }

  removePreference(key: string): void {
    this.db.prepare('DELETE FROM user_preferences WHERE key = ?').run(key);
  }

  // ============================================================================
  // Friday: Research Findings
  // ============================================================================

  addFinding(data: {
    id?: string;
    domain: string;
    type: string;
    title: string;
    description: string;
    impact_annual?: number;
    impact_type?: string;
    confidence?: number;
    source_urls?: string[];
    action_options?: Array<{ label: string; description: string; action_type: string }>;
    related_service_id?: string;
    metadata?: Record<string, unknown>;
  }): ResearchFinding {
    const id = data.id || randomUUID();

    this.db.prepare(`
      INSERT INTO research_findings (
        id, domain, type, title, description, impact_annual, impact_type,
        confidence, status, source_urls, action_options, related_service_id,
        created_at, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
    `).run(
      id, data.domain, data.type, data.title, data.description,
      data.impact_annual || null, data.impact_type || null,
      data.confidence || null,
      data.source_urls ? JSON.stringify(data.source_urls) : null,
      data.action_options ? JSON.stringify(data.action_options) : null,
      data.related_service_id || null,
      Date.now(),
      data.metadata ? JSON.stringify(data.metadata) : null
    );

    return this.getFinding(id)!;
  }

  getFinding(id: string): ResearchFinding | undefined {
    const row = this.db.prepare('SELECT * FROM research_findings WHERE id = ?').get(id) as any;
    if (!row) return undefined;
    return parseFindingRow(row);
  }

  listFindings(options?: {
    domain?: string;
    status?: string;
    limit?: number;
  }): ResearchFinding[] {
    const conditions: string[] = [];
    const params: any[] = [];

    if (options?.domain) { conditions.push('domain = ?'); params.push(options.domain); }
    if (options?.status) { conditions.push('status = ?'); params.push(options.status); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options?.limit || 50;
    params.push(limit);

    const rows = this.db.prepare(
      `SELECT * FROM research_findings ${where} ORDER BY created_at DESC LIMIT ?`
    ).all(...params) as any[];

    return rows.map(parseFindingRow);
  }

  updateFindingStatus(id: string, status: string, response?: string): void {
    const now = Date.now();
    const timestampField =
      status === 'acted' ? 'acted_at' :
      status === 'dismissed' ? 'dismissed_at' :
      status === 'presented' ? 'presented_at' : null;

    if (timestampField) {
      this.db.prepare(
        `UPDATE research_findings SET status = ?, ${timestampField} = ?, user_response = ? WHERE id = ?`
      ).run(status, now, response || null, id);
    } else {
      this.db.prepare(
        'UPDATE research_findings SET status = ?, user_response = ? WHERE id = ?'
      ).run(status, response || null, id);
    }
  }

  // ============================================================================
  // Friday: Research History
  // ============================================================================

  logResearch(data: {
    id?: string;
    domain: string;
    target: string;
    target_id?: string;
    status: string;
    findings_count?: number;
    tokens_used?: number;
    duration_ms?: number;
    error?: string;
    metadata?: Record<string, unknown>;
  }): void {
    this.db.prepare(`
      INSERT INTO research_history (
        id, domain, target, target_id, status, findings_count,
        tokens_used, duration_ms, error, created_at, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.id || randomUUID(), data.domain, data.target,
      data.target_id || null, data.status,
      data.findings_count || 0, data.tokens_used || 0,
      data.duration_ms || null, data.error || null,
      Date.now(),
      data.metadata ? JSON.stringify(data.metadata) : null
    );
  }

  lastResearched(target: string): number | undefined {
    const row = this.db.prepare(
      'SELECT created_at FROM research_history WHERE target = ? ORDER BY created_at DESC LIMIT 1'
    ).get(target) as any;
    return row?.created_at;
  }

  getResearchHistory(options?: {
    domain?: string;
    limit?: number;
  }): ResearchEntry[] {
    const where = options?.domain ? 'WHERE domain = ?' : '';
    const params: any[] = options?.domain ? [options.domain] : [];
    params.push(options?.limit || 50);

    const rows = this.db.prepare(
      `SELECT * FROM research_history ${where} ORDER BY created_at DESC LIMIT ?`
    ).all(...params) as any[];

    return rows.map(row => ({
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }));
  }
}

// ============================================================================
// Friday Types
// ============================================================================

export interface UserService {
  id: string;
  name: string;
  category?: string;
  monthly_price?: number;
  currency: string;
  last_used?: string;
  usage_frequency?: string;
  source: string;
  created_at: number;
  updated_at: number;
  metadata?: Record<string, unknown>;
}

export interface UserGoal {
  id: string;
  skill: string;
  current_level?: string;
  target_level?: string;
  budget_monthly?: number;
  hours_per_week?: number;
  format_preference?: string;
  status: string;
  created_at: number;
  updated_at: number;
  metadata?: Record<string, unknown>;
}

export interface ResearchFinding {
  id: string;
  domain: string;
  type: string;
  title: string;
  description: string;
  impact_annual?: number;
  impact_type?: string;
  confidence?: number;
  status: string;
  source_urls?: string[];
  action_options?: Array<{ label: string; description: string; action_type: string }>;
  related_service_id?: string;
  presented_at?: number;
  acted_at?: number;
  dismissed_at?: number;
  user_response?: string;
  created_at: number;
  metadata?: Record<string, unknown>;
}

export interface ResearchEntry {
  id: string;
  domain: string;
  target: string;
  target_id?: string;
  status: string;
  findings_count: number;
  tokens_used: number;
  duration_ms?: number;
  error?: string;
  created_at: number;
  metadata?: Record<string, unknown>;
}

function parseFindingRow(row: any): ResearchFinding {
  return {
    ...row,
    source_urls: row.source_urls ? JSON.parse(row.source_urls) : undefined,
    action_options: row.action_options ? JSON.parse(row.action_options) : undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  };
}

/**
 * Mneme M2 - Summarization Service
 *
 * Orchestrates all summarization components:
 * - History summarization
 * - Personalization extraction
 * - Multi-view generation
 * - Update detection
 */

import type Database from 'better-sqlite3';
import { HistorySummarizer, type LLMProvider } from './history-summarizer.js';
import { PersonalizationExtractor } from './personalization-extractor.js';
import { MultiViewGenerator, type SearchEngine } from './multi-view-generator.js';
import { UpdateDetector } from './update-detector.js';
import type {
  Message,
  Summary,
  UserPreference,
  MultiViewSummary,
  UpdateSummary,
} from '../graph/types.js';

export interface SummarizationOptions {
  conversationId: string;
  query?: string;
  tokenBudget?: number;
  includeHistory?: boolean;
  includePersonalization?: boolean;
  includeUpdates?: boolean;
  updatesSince?: Date;
}

export interface CompleteSummary {
  history?: Summary;
  multiView?: MultiViewSummary;
  personalization?: UserPreference[];
  updates?: UpdateSummary;
  metadata: {
    total_tokens: number;
    generation_time_ms: number;
    components_included: string[];
  };
}

export class SummarizationService {
  private historySummarizer: HistorySummarizer;
  private personalizationExtractor: PersonalizationExtractor;
  private multiViewGenerator: MultiViewGenerator;
  private updateDetector: UpdateDetector;

  constructor(
    private db: Database.Database,
    llmProvider: LLMProvider,
    searchEngine: SearchEngine,
    private tokenCounter: { count(text: string): Promise<number> }
  ) {
    this.historySummarizer = new HistorySummarizer(llmProvider, tokenCounter);
    this.personalizationExtractor = new PersonalizationExtractor();
    this.multiViewGenerator = new MultiViewGenerator(db, searchEngine, tokenCounter);
    this.updateDetector = new UpdateDetector(db);
  }

  /**
   * Generate complete summary (all components)
   */
  async generateComplete(
    options: SummarizationOptions
  ): Promise<CompleteSummary> {
    const startTime = Date.now();
    const {
      conversationId,
      query,
      tokenBudget = 3000,
      includeHistory = true,
      includePersonalization = true,
      includeUpdates = true,
      updatesSince,
    } = options;

    const components: string[] = [];
    let totalTokens = 0;

    // Get conversation messages
    const messages = await this.getConversationMessages(conversationId);

    // Allocate token budget
    const budgetAllocation = this.allocateTokenBudget(tokenBudget, {
      includeHistory,
      includeMultiView: !!query,
      includePersonalization,
      includeUpdates,
    });

    // Generate components in parallel
    const [history, multiView, personalization, updates] = await Promise.all([
      // History summary
      includeHistory
        ? this.historySummarizer.summarize(messages, {
            conversationId,
            maxTokens: budgetAllocation.history,
            granularity: 'medium',
          })
        : Promise.resolve(undefined),

      // Multi-view summary (if query provided)
      query
        ? this.multiViewGenerator.generate(query, conversationId, {
            tokenBudget: budgetAllocation.multiView,
            includePersonalization,
          })
        : Promise.resolve(undefined),

      // Personalization
      includePersonalization
        ? this.personalizationExtractor.extractPreferences(messages)
        : Promise.resolve(undefined),

      // Updates
      includeUpdates && updatesSince
        ? this.updateDetector.getUpdatesSince(updatesSince, conversationId)
        : Promise.resolve(undefined),
    ]);

    // Calculate total tokens
    if (history) {
      totalTokens += history.token_count;
      components.push('history');
    }

    if (multiView) {
      const multiViewTokens = await this.calculateMultiViewTokens(multiView);
      totalTokens += multiViewTokens;
      components.push('multi_view');
    }

    if (personalization?.preferences && personalization.preferences.length > 0) {
      components.push('personalization');
    }

    if (updates && updates.updates.length > 0) {
      components.push('updates');
    }

    // Store summaries in database
    if (history) {
      await this.storeSummary(history);
    }

    if (personalization?.preferences) {
      await this.storePreferences(personalization.preferences);
    }

    const generationTime = Date.now() - startTime;

    return {
      history,
      multiView,
      personalization: personalization?.preferences,
      updates,
      metadata: {
        total_tokens: totalTokens,
        generation_time_ms: generationTime,
        components_included: components,
      },
    };
  }

  /**
   * Generate history summary only
   */
  async generateHistory(
    conversationId: string,
    options: {
      maxTokens?: number;
      granularity?: 'detailed' | 'medium' | 'brief';
    } = {}
  ): Promise<Summary> {
    const messages = await this.getConversationMessages(conversationId);

    const summary = await this.historySummarizer.summarize(messages, {
      conversationId,
      ...options,
    });

    await this.storeSummary(summary);

    return summary;
  }

  /**
   * Extract personalization only
   */
  async extractPersonalization(
    conversationId?: string
  ): Promise<UserPreference[]> {
    const messages = conversationId
      ? await this.getConversationMessages(conversationId)
      : await this.getAllMessages();

    const result = await this.personalizationExtractor.extractPreferences(messages);

    if (result.preferences.length > 0) {
      await this.storePreferences(result.preferences);
    }

    return result.preferences;
  }

  /**
   * Generate multi-view summary only
   */
  async generateMultiView(
    query: string,
    conversationId: string,
    options: {
      tokenBudget?: number;
      includePersonalization?: boolean;
    } = {}
  ): Promise<MultiViewSummary> {
    return this.multiViewGenerator.generate(query, conversationId, options);
  }

  /**
   * Get updates since timestamp
   */
  async getUpdates(
    since: Date,
    conversationId?: string
  ): Promise<UpdateSummary> {
    return this.updateDetector.getUpdatesSince(since, conversationId);
  }

  /**
   * Refresh all summaries for a conversation
   */
  async refreshConversationSummaries(
    conversationId: string
  ): Promise<{
    history: Summary;
    personalization: UserPreference[];
    invalidated_count: number;
  }> {
    // Invalidate old summaries
    const invalidatedCount = await this.invalidateSummaries(conversationId);

    // Generate new summaries
    const [history, personalization] = await Promise.all([
      this.generateHistory(conversationId),
      this.extractPersonalization(conversationId),
    ]);

    return {
      history,
      personalization,
      invalidated_count: invalidatedCount,
    };
  }

  /**
   * Get cached summary if valid
   */
  async getCachedSummary(
    conversationId: string,
    summaryType: 'history' | 'focus' | 'detail' | 'global'
  ): Promise<Summary | null> {
    const now = Date.now();

    const summary = this.db.prepare(`
      SELECT * FROM summaries
      WHERE scope_type = 'conversation'
        AND scope_id = ?
        AND summary_type = ?
        AND (valid_until IS NULL OR valid_until > ?)
      ORDER BY created_at DESC
      LIMIT 1
    `).get(conversationId, summaryType, now) as any;

    if (!summary) return null;

    return {
      summary_id: summary.summary_id,
      scope_type: summary.scope_type,
      scope_id: summary.scope_id,
      summary_type: summary.summary_type,
      content: summary.content,
      token_count: summary.token_count,
      source_message_ids: summary.source_message_ids
        ? JSON.parse(summary.source_message_ids)
        : undefined,
      source_entity_ids: summary.source_entity_ids
        ? JSON.parse(summary.source_entity_ids)
        : undefined,
      created_at: summary.created_at,
      valid_until: summary.valid_until,
      confidence: summary.confidence,
      metadata: summary.metadata ? JSON.parse(summary.metadata) : undefined,
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Allocate token budget across components
   */
  private allocateTokenBudget(
    totalBudget: number,
    components: {
      includeHistory: boolean;
      includeMultiView: boolean;
      includePersonalization: boolean;
      includeUpdates: boolean;
    }
  ): {
    history: number;
    multiView: number;
    personalization: number;
    updates: number;
  } {
    const activeCount = Object.values(components).filter(Boolean).length;

    if (activeCount === 0) {
      return { history: 0, multiView: 0, personalization: 0, updates: 0 };
    }

    // Default allocation ratios
    const ratios = {
      history: components.includeHistory ? 0.25 : 0,
      multiView: components.includeMultiView ? 0.50 : 0,
      personalization: components.includePersonalization ? 0.15 : 0,
      updates: components.includeUpdates ? 0.10 : 0,
    };

    // Normalize ratios
    const totalRatio = Object.values(ratios).reduce((sum, r) => sum + r, 0);

    return {
      history: Math.floor((ratios.history / totalRatio) * totalBudget),
      multiView: Math.floor((ratios.multiView / totalRatio) * totalBudget),
      personalization: Math.floor((ratios.personalization / totalRatio) * totalBudget),
      updates: Math.floor((ratios.updates / totalRatio) * totalBudget),
    };
  }

  /**
   * Calculate tokens in multi-view summary
   */
  private async calculateMultiViewTokens(
    multiView: MultiViewSummary
  ): Promise<number> {
    const [focusTokens, detailTokens, globalTokens] = await Promise.all([
      this.tokenCounter.count(multiView.focus.summary),
      this.tokenCounter.count(multiView.detail.summary),
      this.tokenCounter.count(multiView.global.summary),
    ]);

    return focusTokens + detailTokens + globalTokens;
  }

  /**
   * Get conversation messages with optional pagination
   */
  private async getConversationMessages(
    conversationId: string,
    options: {
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<Message[]> {
    const { limit, offset = 0 } = options;

    let query = `
      SELECT * FROM messages
      WHERE conversation_id = ?
      ORDER BY sequence_num ASC
    `;

    if (limit !== undefined) {
      query += ` LIMIT ? OFFSET ?`;
    }

    const stmt = this.db.prepare(query);
    const params = limit !== undefined
      ? [conversationId, limit, offset]
      : [conversationId];

    const rows = stmt.all(...params) as any[];

    return rows.map(row => this.parseMessage(row));
  }

  /**
   * Get all messages (for global personalization)
   * Limited to recent messages to prevent memory issues
   */
  private async getAllMessages(limit: number = 1000): Promise<Message[]> {
    const rows = this.db.prepare(`
      SELECT * FROM messages
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as any[];

    return rows.map(row => this.parseMessage(row));
  }

  /**
   * Store summary in database
   */
  private async storeSummary(summary: Summary): Promise<void> {
    this.db.prepare(`
      INSERT INTO summaries (
        summary_id, scope_type, scope_id, summary_type,
        content, token_count, source_message_ids, source_entity_ids,
        created_at, valid_until, confidence, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      summary.summary_id,
      summary.scope_type,
      summary.scope_id || null,
      summary.summary_type,
      summary.content,
      summary.token_count,
      summary.source_message_ids ? JSON.stringify(summary.source_message_ids) : null,
      summary.source_entity_ids ? JSON.stringify(summary.source_entity_ids) : null,
      summary.created_at,
      summary.valid_until || null,
      summary.confidence,
      summary.metadata ? JSON.stringify(summary.metadata) : null
    );
  }

  /**
   * Store user preferences in batch transaction
   * Reduces N+1 queries by batching all operations in single transaction
   */
  private async storePreferences(preferences: UserPreference[]): Promise<void> {
    if (preferences.length === 0) return;

    const transaction = this.db.transaction(() => {
      const selectStmt = this.db.prepare(`
        SELECT preference_id FROM user_preferences
        WHERE category = ? AND key = ? AND value = ?
      `);

      const updateStmt = this.db.prepare(`
        UPDATE user_preferences
        SET
          confidence = ?,
          evidence_count = ?,
          last_observed = ?,
          metadata = ?
        WHERE preference_id = ?
      `);

      const insertStmt = this.db.prepare(`
        INSERT INTO user_preferences (
          category, key, value, confidence, evidence_count,
          first_observed, last_observed, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const pref of preferences) {
        const existing = selectStmt.get(pref.category, pref.key, pref.value) as { preference_id: number } | undefined;

        if (existing) {
          updateStmt.run(
            pref.confidence,
            pref.evidence_count,
            pref.last_observed,
            pref.metadata ? JSON.stringify(pref.metadata) : null,
            existing.preference_id
          );
        } else {
          insertStmt.run(
            pref.category,
            pref.key,
            pref.value,
            pref.confidence,
            pref.evidence_count,
            pref.first_observed,
            pref.last_observed,
            pref.metadata ? JSON.stringify(pref.metadata) : null
          );
        }
      }
    });

    transaction();
  }

  /**
   * Invalidate summaries for conversation
   */
  private async invalidateSummaries(conversationId: string): Promise<number> {
    const result = this.db.prepare(`
      UPDATE summaries
      SET valid_until = ?
      WHERE scope_type = 'conversation'
        AND scope_id = ?
        AND summary_type IN ('history', 'update')
    `).run(Date.now(), conversationId);

    return result.changes;
  }

  /**
   * Parse message row
   */
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
}

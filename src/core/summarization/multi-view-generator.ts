/**
 * Mneme M2 - Multi-View Generator
 *
 * Generates three-view summaries: Focus, Detail, and Global.
 * This is the core of intelligent summarization.
 */

import type Database from 'better-sqlite3';
import type {
  MultiViewSummary,
  ViewContent,
  ContextItem,
  Message,
  Entity,
  UserPreference,
} from '../graph/types.js';
import { GraphTraversal } from '../graph/graph-traversal.js';

export interface MultiViewOptions {
  tokenBudget?: number;
  includePersonalization?: boolean;
  maxFocusItems?: number;
  maxDetailItems?: number;
  maxGlobalThemes?: number;
}

export interface SearchEngine {
  search(options: {
    query: string;
    filters?: any;
    limit?: number;
  }): Promise<{
    results: Array<{
      message_id: string;
      score: number;
      content?: string;
    }>;
  }>;
}

export class MultiViewGenerator {
  private traversal: GraphTraversal;

  constructor(
    private db: Database.Database,
    private searchEngine: SearchEngine,
    private tokenCounter: { count(text: string): Promise<number> }
  ) {
    this.traversal = new GraphTraversal(db);
  }

  /**
   * Generate multi-view summary (focus, detail, global)
   */
  async generate(
    query: string,
    conversationId: string,
    options: MultiViewOptions = {}
  ): Promise<MultiViewSummary> {
    const {
      tokenBudget = 2000,
      includePersonalization = true,
      maxFocusItems = 3,
      maxDetailItems = 10,
      maxGlobalThemes = 5,
    } = options;

    // Token allocation: 30% focus, 40% detail, 30% global
    const focusBudget = Math.floor(tokenBudget * 0.3);
    const detailBudget = Math.floor(tokenBudget * 0.4);
    const globalBudget = Math.floor(tokenBudget * 0.3);

    // Generate views in parallel
    const [focus, detail, global] = await Promise.all([
      this.generateFocusView(query, conversationId, focusBudget, maxFocusItems),
      this.generateDetailView(query, conversationId, detailBudget, maxDetailItems),
      this.generateGlobalView(query, conversationId, globalBudget, includePersonalization, maxGlobalThemes),
    ]);

    return { focus, detail, global };
  }

  /**
   * Generate Focus View: 1-3 most relevant items
   */
  private async generateFocusView(
    query: string,
    conversationId: string,
    tokenBudget: number,
    maxItems: number
  ): Promise<ViewContent> {
    // Search for most relevant messages
    const searchResults = await this.searchEngine.search({
      query,
      filters: { conversation_id: conversationId },
      limit: maxItems * 2, // Get extras, filter later
    });

    // Get full message details
    const messages = await this.getMessages(
      searchResults.results.slice(0, maxItems).map(r => r.message_id)
    );

    const items: ContextItem[] = messages.map((msg, i) => ({
      message_id: msg.message_id,
      type: 'message',
      content: msg.content,
      score: searchResults.results[i]?.score || 0,
    }));

    // Generate focus summary
    const summary = await this.summarizeFocus(items, query);

    const confidence = items.length > 0
      ? items.reduce((sum, item) => sum + (item.score || 0), 0) / items.length
      : 0;

    return {
      items,
      summary,
      confidence,
      metadata: {
        query,
        result_count: items.length,
        avg_score: confidence,
        view_type: 'focus',
      },
    };
  }

  /**
   * Generate Detail View: 5-10 supporting items
   */
  private async generateDetailView(
    query: string,
    conversationId: string,
    tokenBudget: number,
    maxItems: number
  ): Promise<ViewContent> {
    // Start from focus results
    const focusResults = await this.searchEngine.search({
      query,
      filters: { conversation_id: conversationId },
      limit: 3,
    });

    const relatedContext: ContextItem[] = [];
    const messageIds = new Set<string>();

    // Traverse graph from each focus result
    for (const result of focusResults.results) {
      const neighbors = await this.traversal.getRelatedContext(
        result.message_id,
        'message',
        { maxDepth: 2, maxResults: maxItems }
      );

      for (const neighbor of neighbors) {
        if (neighbor.type === 'message') {
          const msg = neighbor.data as Message;

          if (!messageIds.has(msg.message_id)) {
            messageIds.add(msg.message_id);
            relatedContext.push({
              message_id: msg.message_id,
              type: 'message',
              content: msg.content,
              score: 1.0 / (neighbor.depth + 1), // Decay by depth
            });
          }
        } else if (neighbor.type === 'entity') {
          const entity = neighbor.data as Entity;

          relatedContext.push({
            entity_id: entity.entity_id,
            type: entity.entity_type,
            name: entity.name,
            score: entity.confidence / (neighbor.depth + 1),
          });
        }
      }
    }

    // Rank and limit
    const rankedItems = this.rankByRelevance(relatedContext, query)
      .slice(0, maxItems);

    // Categorize items
    const categories = this.categorizeItems(rankedItems);

    // Generate detail summary
    const summary = await this.summarizeDetail(rankedItems, categories);

    return {
      items: rankedItems,
      summary,
      confidence: 0.75,
      metadata: {
        graph_depth: 2,
        unique_items: rankedItems.length,
        categories,
        view_type: 'detail',
      },
    };
  }

  /**
   * Generate Global View: High-level themes and context
   */
  private async generateGlobalView(
    query: string,
    conversationId: string,
    tokenBudget: number,
    includePersonalization: boolean,
    maxThemes: number
  ): Promise<ViewContent> {
    const components: string[] = [];
    const items: ContextItem[] = [];

    // 1. Conversation themes (top entities)
    const entities = await this.getTopEntities(conversationId, maxThemes);

    const themes = entities
      .filter(e => e.entity_type === 'topic' || e.entity_type === 'project')
      .map(e => e.name);

    if (themes.length > 0) {
      components.push(`**Main themes**: ${themes.join(', ')}`);
      items.push(...entities.map(e => ({
        entity_id: e.entity_id,
        type: e.entity_type,
        name: e.name,
        connection_count: 0, // Will be filled by query
      })));
    }

    // 2. Key decisions
    const decisions = entities
      .filter(e => e.entity_type === 'decision')
      .slice(0, 3)
      .map(e => e.name);

    if (decisions.length > 0) {
      components.push(`**Key decisions**: ${decisions.join('; ')}`);
    }

    // 3. Open action items
    const actions = entities
      .filter(e => e.entity_type === 'action')
      .slice(0, 3)
      .map(e => e.name);

    if (actions.length > 0) {
      components.push(`**Action items**: ${actions.join('; ')}`);
    }

    // 4. Important questions
    const questions = entities
      .filter(e => e.entity_type === 'question')
      .slice(0, 2)
      .map(e => e.name);

    if (questions.length > 0) {
      components.push(`**Questions raised**: ${questions.join('; ')}`);
    }

    // 5. Personalization context
    if (includePersonalization) {
      const prefs = await this.getTopPreferences(5);

      if (prefs.length > 0) {
        const prefSummary = prefs
          .map(p => this.formatPreference(p))
          .filter(p => p)
          .join(', ');

        if (prefSummary) {
          components.push(`**User context**: ${prefSummary}`);
        }
      }
    }

    // 6. Temporal context
    const timeSpan = await this.getConversationTimeSpan(conversationId);
    if (timeSpan) {
      components.push(`**Timeline**: ${timeSpan}`);
    }

    // 7. Relationship insights
    const relationships = await this.getKeyRelationships(conversationId);
    if (relationships.length > 0) {
      components.push(`**Key connections**: ${relationships.join(', ')}`);
    }

    const summary = components.join('\n\n');

    return {
      items,
      summary,
      confidence: 0.80,
      metadata: {
        theme_count: themes.length,
        decision_count: decisions.length,
        action_count: actions.length,
        question_count: questions.length,
        personalization_included: includePersonalization,
        view_type: 'global',
      },
    };
  }

  /**
   * Summarize focus view
   */
  private async summarizeFocus(
    items: ContextItem[],
    query: string
  ): Promise<string> {
    if (items.length === 0) {
      return `No directly relevant context found for: "${query}"`;
    }

    if (items.length === 1) {
      return `Most relevant: ${items[0].content?.slice(0, 200)}...`;
    }

    // Multiple items: create concise summary
    const snippets = items.map((item, i) =>
      `${i + 1}. ${item.content?.slice(0, 100)}...`
    ).join('\n');

    return `**Top ${items.length} most relevant**:\n${snippets}`;
  }

  /**
   * Summarize detail view
   */
  private async summarizeDetail(
    items: ContextItem[],
    categories: string[]
  ): Promise<string> {
    if (items.length === 0) {
      return 'No supporting context available';
    }

    const sections: string[] = [];

    // Group by type
    const byType = new Map<string, ContextItem[]>();
    for (const item of items) {
      const type = item.type || 'other';
      if (!byType.has(type)) {
        byType.set(type, []);
      }
      byType.get(type)!.push(item);
    }

    // Summarize each type
    for (const [type, typeItems] of byType.entries()) {
      if (type === 'message') {
        sections.push(`**Related discussions** (${typeItems.length} messages)`);
      } else {
        sections.push(`**${type}s mentioned**: ${typeItems.map(i => i.name).join(', ')}`);
      }
    }

    return sections.join('\n\n');
  }

  /**
   * Rank items by relevance to query
   */
  private rankByRelevance(items: ContextItem[], query: string): ContextItem[] {
    const queryTerms = query.toLowerCase().split(/\s+/);

    return items
      .map(item => {
        let relevance = item.score || 0;

        // Boost if query terms appear in content/name
        const text = (item.content || item.name || '').toLowerCase();
        for (const term of queryTerms) {
          if (text.includes(term)) {
            relevance += 0.2;
          }
        }

        return { ...item, score: relevance };
      })
      .sort((a, b) => (b.score || 0) - (a.score || 0));
  }

  /**
   * Categorize items by type
   */
  private categorizeItems(items: ContextItem[]): string[] {
    const types = new Set<string>();

    for (const item of items) {
      if (item.type) {
        types.add(item.type);
      }
    }

    return Array.from(types);
  }

  /**
   * Get top entities for conversation
   */
  private async getTopEntities(
    conversationId: string,
    limit: number
  ): Promise<Entity[]> {
    const entities = this.db.prepare(`
      SELECT DISTINCT e.*
      FROM entities e
      JOIN relationships r ON
        (r.target_id = e.entity_id AND r.target_type = 'entity')
      WHERE r.source_type = 'message'
        AND r.source_id IN (
          SELECT message_id FROM messages WHERE conversation_id = ?
        )
      ORDER BY e.mention_count DESC, e.confidence DESC
      LIMIT ?
    `).all(conversationId, limit) as any[];

    return entities.map(e => this.parseEntity(e));
  }

  /**
   * Get top user preferences
   */
  private async getTopPreferences(limit: number): Promise<UserPreference[]> {
    const prefs = this.db.prepare(`
      SELECT * FROM user_preferences
      WHERE confidence > 0.7
      ORDER BY confidence DESC, evidence_count DESC
      LIMIT ?
    `).all(limit) as any[];

    return prefs.map(p => ({
      preference_id: p.preference_id,
      category: p.category,
      key: p.key,
      value: p.value,
      confidence: p.confidence,
      evidence_count: p.evidence_count,
      first_observed: p.first_observed,
      last_observed: p.last_observed,
      metadata: p.metadata ? JSON.parse(p.metadata) : undefined,
    }));
  }

  /**
   * Format preference for display
   */
  private formatPreference(pref: UserPreference): string {
    const categoryLabels: Record<string, string> = {
      language: 'Lang',
      frontend_framework: 'Frontend',
      backend_framework: 'Backend',
      database: 'DB',
      tool: 'Tool',
      role: 'Role',
      work_pattern: 'Schedule',
      communication_style: 'Style',
      domain: 'Domain',
    };

    const label = categoryLabels[pref.category] || pref.category;
    return `${label}: ${pref.value}`;
  }

  /**
   * Get conversation time span
   */
  private async getConversationTimeSpan(conversationId: string): Promise<string | null> {
    const result = this.db.prepare(`
      SELECT
        MIN(created_at) as first,
        MAX(created_at) as last,
        COUNT(*) as count
      FROM messages
      WHERE conversation_id = ?
    `).get(conversationId) as any;

    if (!result || result.count === 0) return null;

    const first = new Date(result.first);
    const last = new Date(result.last);

    const duration = last.getTime() - first.getTime();
    const days = Math.floor(duration / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return `Today (${result.count} messages)`;
    } else if (days === 1) {
      return `Yesterday - Today (${result.count} messages)`;
    } else {
      return `${days} days ago - Today (${result.count} messages)`;
    }
  }

  /**
   * Get key relationship insights
   */
  private async getKeyRelationships(conversationId: string): Promise<string[]> {
    const insights: string[] = [];

    // Find strongly connected entities
    const strongPairs = this.db.prepare(`
      SELECT
        e1.name as source_name,
        e2.name as target_name,
        r.relationship_type,
        r.strength
      FROM relationships r
      JOIN entities e1 ON r.source_id = e1.entity_id
      JOIN entities e2 ON r.target_id = e2.entity_id
      WHERE r.source_type = 'entity'
        AND r.target_type = 'entity'
        AND r.strength > 0.7
      ORDER BY r.strength DESC
      LIMIT 3
    `).all() as any[];

    for (const pair of strongPairs) {
      const typeLabel = pair.relationship_type.replace(/_/g, ' ');
      insights.push(`${pair.source_name} ${typeLabel} ${pair.target_name}`);
    }

    return insights;
  }

  /**
   * Get messages by IDs
   */
  private async getMessages(messageIds: string[]): Promise<Message[]> {
    if (messageIds.length === 0) return [];

    const placeholders = messageIds.map(() => '?').join(',');
    const messages = this.db.prepare(`
      SELECT * FROM messages
      WHERE message_id IN (${placeholders})
    `).all(...messageIds) as any[];

    return messages.map(m => this.parseMessage(m));
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

  /**
   * Parse entity row
   */
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

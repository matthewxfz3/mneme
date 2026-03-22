/**
 * Context Assembly
 *
 * Assembles conversation context within token budgets using accurate counting.
 * Implements smart packing strategies and prioritization.
 */

import { MnemeService, Message } from './service.js';
import { SearchEngine } from './search.js';
import { ResultRanker } from './ranking.js';

export interface AssemblyOptions {
  conversationId: string;
  tokenBudget: number;
  strategy?: AssemblyStrategy;
  includeSystemMessages?: boolean;
  searchQuery?: string;           // Optional relevance-based retrieval
  minRelevanceScore?: number;     // Minimum score for search results
  preserveRecent?: number;        // Always include N most recent messages
}

export type AssemblyStrategy =
  | 'recent'                      // Most recent messages first
  | 'relevant'                    // Search-based relevance
  | 'hybrid'                      // Mix of recent + relevant
  | 'sliding-window'              // Fixed window of recent messages
  | 'full';                       // Include everything (may exceed budget)

export interface AssembledContext {
  messages: Message[];
  metadata: {
    total_tokens: number;
    budget_used: number;
    budget_remaining: number;
    messages_included: number;
    messages_total: number;
    strategy: AssemblyStrategy;
    truncated: boolean;
  };
}

/**
 * Context assembler
 */
export class ContextAssembler {
  private service: MnemeService;
  private searchEngine: SearchEngine;

  constructor(service: MnemeService, searchEngine: SearchEngine) {
    this.service = service;
    this.searchEngine = searchEngine;
  }

  /**
   * Assemble context within token budget
   */
  async assemble(options: AssemblyOptions): Promise<AssembledContext> {
    const strategy = options.strategy || 'hybrid';

    switch (strategy) {
      case 'recent':
        return this.assembleRecent(options);
      case 'relevant':
        return this.assembleRelevant(options);
      case 'hybrid':
        return this.assembleHybrid(options);
      case 'sliding-window':
        return this.assembleSlidingWindow(options);
      case 'full':
        return this.assembleFull(options);
      default:
        throw new Error(`Unknown assembly strategy: ${strategy}`);
    }
  }

  /**
   * Assemble most recent messages
   */
  private async assembleRecent(options: AssemblyOptions): Promise<AssembledContext> {
    const allMessages = this.service.getConversationMessages(
      options.conversationId,
      { order: 'DESC' }
    );

    const { messages, totalTokens } = this.packMessages(
      allMessages,
      options.tokenBudget,
      options.includeSystemMessages
    );

    return {
      messages: messages.reverse(), // Restore chronological order
      metadata: {
        total_tokens: totalTokens,
        budget_used: totalTokens / options.tokenBudget,
        budget_remaining: options.tokenBudget - totalTokens,
        messages_included: messages.length,
        messages_total: allMessages.length,
        strategy: 'recent',
        truncated: messages.length < allMessages.length,
      },
    };
  }

  /**
   * Assemble based on relevance search
   */
  private async assembleRelevant(options: AssemblyOptions): Promise<AssembledContext> {
    if (!options.searchQuery) {
      throw new Error('Search query required for relevant assembly strategy');
    }

    const searchResults = await this.searchEngine.search({
      query: options.searchQuery,
      conversationId: options.conversationId,
      limit: 100, // Get more candidates
    });

    // Filter by minimum relevance score
    const minScore = options.minRelevanceScore || 0.1;
    const relevantResults = searchResults.results.filter(r => r.score >= minScore);

    // Rerank with temporal decay
    const rankedResults = ResultRanker.rerank(relevantResults, {
      temporalDecayHalfLife: 30,
      diversityWeight: 0.1,
    });

    // Pack messages
    const messages = rankedResults.map(r => r.message);
    const { messages: packedMessages, totalTokens } = this.packMessages(
      messages,
      options.tokenBudget,
      options.includeSystemMessages
    );

    // Sort by sequence for coherent context
    packedMessages.sort((a, b) => a.sequence_num - b.sequence_num);

    return {
      messages: packedMessages,
      metadata: {
        total_tokens: totalTokens,
        budget_used: totalTokens / options.tokenBudget,
        budget_remaining: options.tokenBudget - totalTokens,
        messages_included: packedMessages.length,
        messages_total: rankedResults.length,
        strategy: 'relevant',
        truncated: packedMessages.length < rankedResults.length,
      },
    };
  }

  /**
   * Hybrid: Recent messages + relevant search results
   */
  private async assembleHybrid(options: AssemblyOptions): Promise<AssembledContext> {
    const preserveRecent = options.preserveRecent || 5;
    const recentBudget = Math.floor(options.tokenBudget * 0.6); // 60% for recent
    const relevantBudget = options.tokenBudget - recentBudget;   // 40% for relevant

    // Get recent messages
    const allMessages = this.service.getConversationMessages(
      options.conversationId,
      { order: 'DESC' }
    );

    const { messages: recentMessages, totalTokens: recentTokens } = this.packMessages(
      allMessages.slice(0, preserveRecent),
      recentBudget,
      options.includeSystemMessages
    );

    // Get relevant messages (if search query provided)
    let relevantMessages: Message[] = [];
    let relevantTokens = 0;

    if (options.searchQuery) {
      const searchResults = await this.searchEngine.search({
        query: options.searchQuery,
        conversationId: options.conversationId,
        limit: 50,
      });

      const rankedResults = ResultRanker.rerank(searchResults.results, {
        temporalDecayHalfLife: 30,
      });

      // Exclude already included recent messages
      const recentIds = new Set(recentMessages.map(m => m.message_id));
      const candidateMessages = rankedResults
        .map(r => r.message)
        .filter(m => !recentIds.has(m.message_id));

      const packed = this.packMessages(
        candidateMessages,
        relevantBudget,
        options.includeSystemMessages
      );

      relevantMessages = packed.messages;
      relevantTokens = packed.totalTokens;
    }

    // Combine and sort
    const allIncluded = [...recentMessages, ...relevantMessages];
    allIncluded.sort((a, b) => a.sequence_num - b.sequence_num);

    return {
      messages: allIncluded,
      metadata: {
        total_tokens: recentTokens + relevantTokens,
        budget_used: (recentTokens + relevantTokens) / options.tokenBudget,
        budget_remaining: options.tokenBudget - recentTokens - relevantTokens,
        messages_included: allIncluded.length,
        messages_total: allMessages.length,
        strategy: 'hybrid',
        truncated: allIncluded.length < allMessages.length,
      },
    };
  }

  /**
   * Sliding window of most recent messages
   */
  private async assembleSlidingWindow(options: AssemblyOptions): Promise<AssembledContext> {
    const allMessages = this.service.getConversationMessages(
      options.conversationId,
      { order: 'DESC' }
    );

    // Take fixed window that fits in budget
    const { messages, totalTokens } = this.packMessages(
      allMessages,
      options.tokenBudget,
      options.includeSystemMessages
    );

    return {
      messages: messages.reverse(),
      metadata: {
        total_tokens: totalTokens,
        budget_used: totalTokens / options.tokenBudget,
        budget_remaining: options.tokenBudget - totalTokens,
        messages_included: messages.length,
        messages_total: allMessages.length,
        strategy: 'sliding-window',
        truncated: messages.length < allMessages.length,
      },
    };
  }

  /**
   * Include all messages (may exceed budget)
   */
  private async assembleFull(options: AssemblyOptions): Promise<AssembledContext> {
    let allMessages = this.service.getConversationMessages(options.conversationId);

    // Filter system messages if needed
    if (!options.includeSystemMessages) {
      allMessages = allMessages.filter(m => m.role !== 'system');
    }

    const totalTokens = allMessages.reduce((sum, m) => sum + m.tokens, 0);

    return {
      messages: allMessages,
      metadata: {
        total_tokens: totalTokens,
        budget_used: totalTokens / options.tokenBudget,
        budget_remaining: options.tokenBudget - totalTokens,
        messages_included: allMessages.length,
        messages_total: allMessages.length,
        strategy: 'full',
        truncated: false,
      },
    };
  }

  /**
   * Pack messages into token budget using greedy algorithm
   */
  private packMessages(
    messages: Message[],
    budget: number,
    includeSystem: boolean = true
  ): { messages: Message[]; totalTokens: number } {
    const packed: Message[] = [];
    let totalTokens = 0;

    for (const message of messages) {
      // Skip system messages if not included
      if (!includeSystem && message.role === 'system') {
        continue;
      }

      // Check if message fits
      if (totalTokens + message.tokens <= budget) {
        packed.push(message);
        totalTokens += message.tokens;
      } else {
        break; // Budget exceeded
      }
    }

    return { messages: packed, totalTokens };
  }

  /**
   * Estimate how many messages fit in budget
   */
  estimateMessageCount(conversationId: string, tokenBudget: number): number {
    const messages = this.service.getConversationMessages(conversationId, {
      order: 'DESC',
    });

    let count = 0;
    let tokens = 0;

    for (const message of messages) {
      if (tokens + message.tokens <= tokenBudget) {
        count++;
        tokens += message.tokens;
      } else {
        break;
      }
    }

    return count;
  }

  /**
   * Get conversation summary for context
   */
  async getConversationSummary(conversationId: string): Promise<string> {
    const conversation = this.service.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const messages = this.service.getConversationMessages(conversationId, {
      limit: 10,
      order: 'DESC',
    });

    const parts: string[] = [];
    parts.push(`Conversation: ${conversation.title || conversation.conversation_id}`);
    parts.push(`Messages: ${conversation.message_count}`);
    parts.push(`Tokens: ${conversation.total_tokens}`);
    parts.push(`Last updated: ${new Date(conversation.updated_at).toISOString()}`);

    if (messages.length > 0) {
      parts.push(`\nRecent topics:`);
      const recentContent = messages
        .slice(0, 3)
        .reverse()
        .map(m => `- ${m.content.substring(0, 100)}...`);
      parts.push(...recentContent);
    }

    return parts.join('\n');
  }
}

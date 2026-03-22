/**
 * Mneme Context Engine
 *
 * OpenClaw ContextEngine implementation using Mneme's unified storage.
 * Provides bootstrap, ingest, and assemble operations with accurate token counting.
 */

import { MnemeService } from './service.js';
import { TokenCounter } from './tokens.js';
import { SessionImporter } from './import.js';
import { SearchEngine } from './search.js';
import { ContextAssembler, AssemblyOptions, AssemblyStrategy } from './assembly.js';
import Database from 'better-sqlite3';

export interface ContextEngineConfig {
  dbPath: string;
  defaultStrategy?: AssemblyStrategy;
  defaultTokenBudget?: number;
  cacheTokens?: boolean;
}

export interface BootstrapOptions {
  sessionFile?: string;           // JSONL file to import
  sessionId?: string;             // Session identifier
  clearExisting?: boolean;        // Clear existing conversation
}

export interface IngestOptions {
  sessionId: string;
  message: {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    metadata?: Record<string, unknown>;
  };
  model?: string;                 // Model for token counting
}

export interface AssembleOptions {
  sessionId: string;
  tokenBudget?: number;
  strategy?: AssemblyStrategy;
  searchQuery?: string;
  preserveRecent?: number;
}

export interface ContextEngineMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tokens: number;
  metadata?: Record<string, unknown>;
}

export interface ContextEngineResponse {
  messages: ContextEngineMessage[];
  metadata: {
    total_tokens: number;
    budget_used: number;
    strategy: string;
    conversation_id: string;
  };
}

/**
 * Mneme ContextEngine for OpenClaw
 */
export class MnemeContextEngine {
  private service: MnemeService;
  private tokenCounter: TokenCounter;
  private searchEngine: SearchEngine;
  private assembler: ContextAssembler;
  private config: ContextEngineConfig;

  constructor(config: ContextEngineConfig) {
    this.config = {
      defaultStrategy: 'hybrid',
      defaultTokenBudget: 8000,
      cacheTokens: true,
      ...config,
    };

    // Initialize service
    this.service = new MnemeService({
      dbPath: config.dbPath,
      verbose: false,
    });

    const db = (this.service as any).db as Database.Database;
    this.tokenCounter = new TokenCounter(db, config.cacheTokens);
    this.searchEngine = new SearchEngine(db);
    this.assembler = new ContextAssembler(this.service, this.searchEngine);
  }

  /**
   * Bootstrap: Import existing session or create new conversation
   */
  async bootstrap(options: BootstrapOptions): Promise<void> {
    const sessionId = options.sessionId || 'default';

    // Check if conversation exists
    let conversation = this.service.getConversationBySessionKey(sessionId);

    if (options.clearExisting && conversation) {
      // Delete all messages in conversation
      const messages = this.service.getConversationMessages(conversation.conversation_id);
      const messageIds = messages.map(m => m.message_id);
      if (messageIds.length > 0) {
        this.service.deleteMessages(messageIds);
      }
    }

    // Import session file if provided
    if (options.sessionFile) {
      const importer = new SessionImporter(this.service, this.tokenCounter);
      await importer.importSession({
        sessionPath: options.sessionFile,
        sourceId: `openclaw-${sessionId}`,
      });
    } else if (!conversation) {
      // Create new conversation
      this.service.createConversation({
        session_key: sessionId,
        title: `Session ${sessionId}`,
      });
    }
  }

  /**
   * Ingest: Add new message to conversation
   */
  async ingest(options: IngestOptions): Promise<void> {
    // Get or create conversation
    let conversation = this.service.getConversationBySessionKey(options.sessionId);
    if (!conversation) {
      conversation = this.service.createConversation({
        session_key: options.sessionId,
        title: `Session ${options.sessionId}`,
      });
    }

    // Count tokens accurately
    const tokenResult = await this.tokenCounter.count(options.message.content, {
      model: options.model,
      useCache: this.config.cacheTokens,
    });

    // Add message
    this.service.addMessage({
      conversation_id: conversation.conversation_id,
      role: options.message.role,
      content: options.message.content,
      tokens: tokenResult.count,
      model_family: tokenResult.modelFamily,
      metadata: options.message.metadata,
    });
  }

  /**
   * Assemble: Get relevant context within token budget
   */
  async assemble(options: AssembleOptions): Promise<ContextEngineResponse> {
    // Get conversation
    const conversation = this.service.getConversationBySessionKey(options.sessionId);
    if (!conversation) {
      throw new Error(`Session not found: ${options.sessionId}`);
    }

    // Assemble context
    const assemblyOptions: AssemblyOptions = {
      conversationId: conversation.conversation_id,
      tokenBudget: options.tokenBudget || this.config.defaultTokenBudget!,
      strategy: options.strategy || this.config.defaultStrategy,
      searchQuery: options.searchQuery,
      preserveRecent: options.preserveRecent,
      includeSystemMessages: true,
    };

    const assembled = await this.assembler.assemble(assemblyOptions);

    // Convert to ContextEngine format
    return {
      messages: assembled.messages.map(m => ({
        role: m.role,
        content: m.content,
        tokens: m.tokens,
        metadata: m.metadata,
      })),
      metadata: {
        total_tokens: assembled.metadata.total_tokens,
        budget_used: assembled.metadata.budget_used,
        strategy: assembled.metadata.strategy,
        conversation_id: conversation.conversation_id,
      },
    };
  }

  /**
   * Search: Find relevant messages across conversations
   */
  async search(query: string, options?: {
    sessionId?: string;
    limit?: number;
    timeRange?: { start?: number; end?: number };
  }): Promise<Array<{
    message: ContextEngineMessage;
    score: number;
    conversation_id: string;
  }>> {
    const searchOptions: any = {
      query,
      limit: options?.limit || 20,
      timeRange: options?.timeRange,
    };

    if (options?.sessionId) {
      const conversation = this.service.getConversationBySessionKey(options.sessionId);
      if (conversation) {
        searchOptions.conversationId = conversation.conversation_id;
      }
    }

    const searchResults = await this.searchEngine.search(searchOptions);

    return searchResults.results.map(r => ({
      message: {
        role: r.message.role,
        content: r.message.content,
        tokens: r.message.tokens,
        metadata: r.message.metadata,
      },
      score: r.score,
      conversation_id: r.message.conversation_id,
    }));
  }

  /**
   * Get conversation statistics
   */
  getStats(sessionId?: string): {
    conversations: number;
    messages: number;
    tokens: number;
  } {
    if (sessionId) {
      const conversation = this.service.getConversationBySessionKey(sessionId);
      if (!conversation) {
        return { conversations: 0, messages: 0, tokens: 0 };
      }

      return {
        conversations: 1,
        messages: conversation.message_count,
        tokens: conversation.total_tokens,
      };
    }

    const stats = this.service.getStats();
    return {
      conversations: stats.conversations,
      messages: stats.messages,
      tokens: stats.totalTokens,
    };
  }

  /**
   * Record compaction event
   */
  async recordCompaction(options: {
    sessionId: string;
    messagesBefore: number;
    messagesAfter: number;
    tokensBefore: number;
    tokensAfter: number;
    droppedMessageIds: string[];
    summaryMessageId?: string;
    strategy?: string;
  }): Promise<void> {
    const conversation = this.service.getConversationBySessionKey(options.sessionId);
    if (!conversation) {
      throw new Error(`Session not found: ${options.sessionId}`);
    }

    this.service.recordCompaction({
      conversation_id: conversation.conversation_id,
      messages_before: options.messagesBefore,
      messages_after: options.messagesAfter,
      tokens_before: options.tokensBefore,
      tokens_after: options.tokensAfter,
      dropped_message_ids: options.droppedMessageIds,
      summary_message_id: options.summaryMessageId,
      strategy: options.strategy,
    });
  }

  /**
   * Close database connection
   */
  close(): void {
    this.service.close();
  }

  /**
   * Get underlying service (for advanced operations)
   */
  getService(): MnemeService {
    return this.service;
  }

  /**
   * Get token counter (for external token counting)
   */
  getTokenCounter(): TokenCounter {
    return this.tokenCounter;
  }

  /**
   * Get search engine (for advanced search)
   */
  getSearchEngine(): SearchEngine {
    return this.searchEngine;
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    stats: { conversations: number; messages: number; tokens: number };
    cacheStats: ReturnType<TokenCounter['getCacheStats']>;
  }> {
    try {
      const stats = this.getStats();
      const cacheStats = this.tokenCounter.getCacheStats();

      return {
        healthy: true,
        stats,
        cacheStats,
      };
    } catch (error) {
      return {
        healthy: false,
        stats: { conversations: 0, messages: 0, tokens: 0 },
        cacheStats: { totalEntries: 0, byModelFamily: {} as any },
      };
    }
  }
}

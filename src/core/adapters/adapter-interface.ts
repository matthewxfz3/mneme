/**
 * Mneme M2 - Source Adapter Interface
 *
 * Defines the interface for all source adapters.
 * Adapters transform data from various sources into Mneme's internal format.
 */

export interface AdapterConfig {
  /**
   * Unique adapter ID
   */
  id: string;

  /**
   * Source-specific configuration
   */
  [key: string]: any;
}

export interface ContextItem {
  /**
   * Source identifier (e.g., 'slack', 'discord', 'pdf')
   */
  source: string;

  /**
   * Unique ID within source
   */
  sourceId: string;

  /**
   * Message content
   */
  content: string;

  /**
   * Role of message sender
   */
  role: 'user' | 'assistant' | 'system';

  /**
   * Timestamp of message
   */
  createdAt: Date;

  /**
   * Optional conversation/thread ID
   */
  conversationId?: string;

  /**
   * Source-specific metadata
   */
  metadata?: Record<string, any>;
}

export interface FetchOptions {
  /**
   * Start timestamp
   */
  since?: Date;

  /**
   * End timestamp
   */
  until?: Date;

  /**
   * Maximum items to fetch
   */
  limit?: number;

  /**
   * Offset for pagination
   */
  offset?: number;

  /**
   * Conversation/thread IDs to filter
   */
  conversationIds?: string[];

  /**
   * Additional filters
   */
  filters?: Record<string, any>;
}

export interface AdapterStats {
  /**
   * Total items available
   */
  totalItems: number;

  /**
   * Total conversations/threads
   */
  totalConversations: number;

  /**
   * Date range
   */
  dateRange: {
    earliest: Date | null;
    latest: Date | null;
  };

  /**
   * Source-specific stats
   */
  metadata?: Record<string, any>;
}

/**
 * Base interface for all source adapters
 */
export interface SourceAdapter {
  /**
   * Unique adapter ID (e.g., 'slack-export', 'discord-data')
   */
  readonly id: string;

  /**
   * Human-readable name
   */
  readonly name: string;

  /**
   * Version
   */
  readonly version: string;

  /**
   * Supported file formats or data types
   */
  readonly supportedFormats: string[];

  /**
   * Initialize adapter with configuration
   */
  initialize(config: AdapterConfig): Promise<void>;

  /**
   * Start adapter (connect, open files, etc.)
   */
  start(): Promise<void>;

  /**
   * Stop adapter (disconnect, close files, etc.)
   */
  stop(): Promise<void>;

  /**
   * Fetch items from source
   *
   * Returns an async iterator for memory efficiency with large datasets
   */
  fetch(options?: FetchOptions): AsyncIterator<ContextItem>;

  /**
   * Fetch updates since last sync
   */
  fetchUpdates(since?: Date): Promise<ContextItem[]>;

  /**
   * Get timestamp of last update
   */
  getLastUpdate(): Promise<Date | null>;

  /**
   * Get adapter statistics
   */
  getStats(): Promise<AdapterStats>;

  /**
   * Check if adapter is healthy and ready
   */
  isHealthy(): Promise<boolean>;
}

/**
 * Abstract base class for adapters
 */
export abstract class BaseAdapter implements SourceAdapter {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly version: string;
  abstract readonly supportedFormats: string[];

  protected config: AdapterConfig | null = null;
  protected isInitialized = false;
  protected isStarted = false;

  async initialize(config: AdapterConfig): Promise<void> {
    this.config = config;
    this.isInitialized = true;
  }

  async start(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Adapter not initialized. Call initialize() first.');
    }
    this.isStarted = true;
  }

  async stop(): Promise<void> {
    this.isStarted = false;
  }

  abstract fetch(options?: FetchOptions): AsyncIterator<ContextItem>;

  abstract fetchUpdates(since?: Date): Promise<ContextItem[]>;

  abstract getLastUpdate(): Promise<Date | null>;

  abstract getStats(): Promise<AdapterStats>;

  async isHealthy(): Promise<boolean> {
    return this.isInitialized && this.isStarted;
  }

  /**
   * Ensure adapter is ready
   */
  protected ensureReady(): void {
    if (!this.isInitialized) {
      throw new Error(`Adapter '${this.id}' not initialized`);
    }
    if (!this.isStarted) {
      throw new Error(`Adapter '${this.id}' not started`);
    }
  }

  /**
   * Create a context item
   */
  protected createContextItem(
    sourceId: string,
    content: string,
    role: 'user' | 'assistant' | 'system',
    createdAt: Date,
    options: {
      conversationId?: string;
      metadata?: Record<string, any>;
    } = {}
  ): ContextItem {
    return {
      source: this.id,
      sourceId,
      content,
      role,
      createdAt,
      conversationId: options.conversationId,
      metadata: options.metadata,
    };
  }
}

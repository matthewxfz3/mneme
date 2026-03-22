/**
 * Core type definitions for Mneme
 */

export type SourceType =
  | 'google-chat'
  | 'slack'
  | 'discord'
  | 'telegram'
  | 'openclaw-session'
  | 'filesystem'
  | 'rss'
  | 'email'
  | 'custom';

export type ContentType =
  | 'text/plain'
  | 'text/markdown'
  | 'text/html'
  | 'text/code'
  | 'application/json';

export interface Message {
  id: string;
  content: string;
  timestamp: number;
  source: {
    type: SourceType;
    id: string;
    externalId?: string;
  };
  metadata?: Record<string, unknown>;
}

export interface StoredContext {
  // Identity
  id: string;
  contentHash: string;

  // Content
  content: string;
  contentType: ContentType;
  summary?: string;

  // Source
  source: {
    type: SourceType;
    id: string;
    externalId?: string;
    url?: string;
  };

  // Temporal
  timestamp: number;
  createdAt: number;
  updatedAt: number;

  // Relationships
  conversationId: string;
  threadId?: string;
  parentId?: string;

  // Enrichment
  embedding?: number[];
  embeddingModel?: string;

  // Metadata
  metadata: {
    author?: string;
    channel?: string;
    importance?: number;
    visibility?: 'public' | 'internal' | 'private';
    [key: string]: unknown;
  };

  // Indexing
  indexed: {
    vector: boolean;
    fts: boolean;
  };
}

export interface QueryOptions {
  query: string;
  maxTokens?: number;
  sources?: string[];
  timeRange?: {
    start: number;
    end: number;
  };
  conversationId?: string;
  filters?: Record<string, unknown>;
}

export interface QueryResult {
  contexts: Array<{
    id: string;
    content: string;
    score: number;
    source: StoredContext['source'];
    timestamp: number;
    metadata: StoredContext['metadata'];
  }>;
  metadata: {
    totalScanned: number;
    strategy: string;
    latencyMs: number;
    tokenCount: number;
  };
}

export interface SourceAdapter {
  id: string;
  type: 'webhook' | 'poll' | 'stream';
  config: Record<string, unknown>;

  start(): Promise<void>;
  stop(): Promise<void>;
  onMessage(callback: (message: Message) => void): void;
}

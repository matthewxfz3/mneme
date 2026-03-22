/**
 * JSONL Session Importer
 *
 * Imports existing OpenClaw JSONL session files into Mneme database.
 * Supports batch imports and preserves conversation history.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { MnemeService, Message } from './service.js';
import { TokenCounter } from './tokens.js';

export interface ImportOptions {
  sessionPath: string;         // Path to JSONL file or directory
  sourceId?: string;            // Source tracking ID
  modelFamily?: string;         // Model family for token counting
  batchSize?: number;           // Messages per batch
  onProgress?: (progress: ImportProgress) => void;
}

export interface ImportProgress {
  file: string;
  messagesProcessed: number;
  totalMessages: number;
  conversationId: string;
}

export interface ImportResult {
  conversation_id: string;
  session_key: string;
  messages_imported: number;
  tokens_counted: number;
  source_id: string;
  duration_ms: number;
}

/**
 * OpenClaw JSONL message format
 */
interface OpenClawMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | Array<{ type: string; text?: string; [key: string]: any }>;
  timestamp?: number;
  [key: string]: any;
}

/**
 * JSONL Session Importer
 */
export class SessionImporter {
  private service: MnemeService;
  private tokenCounter: TokenCounter;

  constructor(service: MnemeService, tokenCounter: TokenCounter) {
    this.service = service;
    this.tokenCounter = tokenCounter;
  }

  /**
   * Import a single JSONL session file
   */
  async importSession(options: ImportOptions): Promise<ImportResult> {
    const startTime = Date.now();
    const sessionPath = options.sessionPath;

    // Check if path is a file or directory
    const stats = statSync(sessionPath);
    if (stats.isDirectory()) {
      throw new Error('Use importDirectory() for importing multiple sessions');
    }

    // Read JSONL file
    const content = readFileSync(sessionPath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim().length > 0);

    // Parse messages
    const messages: OpenClawMessage[] = [];
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        messages.push(msg);
      } catch (error) {
        console.warn(`Skipping invalid JSON line in ${sessionPath}:`, error);
      }
    }

    if (messages.length === 0) {
      throw new Error(`No valid messages found in ${sessionPath}`);
    }

    // Extract session key from filename (e.g., "session-abc123.jsonl" -> "abc123")
    const filename = basename(sessionPath, '.jsonl');
    const sessionKey = filename.replace(/^session-/, '') || filename;

    // Create or get conversation
    let conversation = this.service.getConversationBySessionKey(sessionKey);
    if (!conversation) {
      conversation = this.service.createConversation({
        session_key: sessionKey,
        title: `Imported: ${sessionKey}`,
        metadata: {
          imported_from: sessionPath,
          imported_at: Date.now(),
        },
      });
    }

    // Create source tracking
    const sourceId = options.sourceId || `openclaw-jsonl-${sessionKey}`;

    // Import messages in batches
    const batchSize = options.batchSize || 100;
    let totalTokens = 0;

    for (let i = 0; i < messages.length; i += batchSize) {
      const batch = messages.slice(i, Math.min(i + batchSize, messages.length));

      for (const msg of batch) {
        // Extract text content
        const content = this.extractContent(msg);
        if (!content) continue;

        // Count tokens
        const tokenResult = await this.tokenCounter.count(content, {
          modelFamily: options.modelFamily as any,
          useCache: true,
        });

        // Add message
        this.service.addMessage({
          conversation_id: conversation.conversation_id,
          role: msg.role,
          content,
          tokens: tokenResult.count,
          model_family: tokenResult.modelFamily,
          metadata: {
            imported: true,
            original_timestamp: msg.timestamp,
          },
        });

        totalTokens += tokenResult.count;
      }

      // Report progress
      if (options.onProgress) {
        options.onProgress({
          file: sessionPath,
          messagesProcessed: Math.min(i + batchSize, messages.length),
          totalMessages: messages.length,
          conversationId: conversation.conversation_id,
        });
      }
    }

    const duration = Date.now() - startTime;

    return {
      conversation_id: conversation.conversation_id,
      session_key: sessionKey,
      messages_imported: messages.length,
      tokens_counted: totalTokens,
      source_id: sourceId,
      duration_ms: duration,
    };
  }

  /**
   * Import all JSONL files from a directory
   */
  async importDirectory(
    directoryPath: string,
    options?: Omit<ImportOptions, 'sessionPath'>
  ): Promise<ImportResult[]> {
    const files = readdirSync(directoryPath);
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

    const results: ImportResult[] = [];

    for (const file of jsonlFiles) {
      const filePath = join(directoryPath, file);
      try {
        const result = await this.importSession({
          ...options,
          sessionPath: filePath,
        });
        results.push(result);
      } catch (error) {
        console.error(`Failed to import ${file}:`, error);
      }
    }

    return results;
  }

  /**
   * Extract text content from OpenClaw message
   */
  private extractContent(msg: OpenClawMessage): string | null {
    if (typeof msg.content === 'string') {
      return msg.content;
    }

    if (Array.isArray(msg.content)) {
      // Handle content blocks (e.g., [{ type: 'text', text: '...' }])
      const textBlocks = msg.content
        .filter(block => block.type === 'text' && block.text)
        .map(block => block.text);

      if (textBlocks.length > 0) {
        return textBlocks.join('\n');
      }
    }

    return null;
  }

  /**
   * Verify import integrity
   */
  async verifyImport(conversation_id: string): Promise<{
    valid: boolean;
    issues: string[];
  }> {
    const issues: string[] = [];

    // Check conversation exists
    const conversation = this.service.getConversation(conversation_id);
    if (!conversation) {
      return { valid: false, issues: ['Conversation not found'] };
    }

    // Check messages
    const messages = this.service.getConversationMessages(conversation_id);

    if (messages.length !== conversation.message_count) {
      issues.push(
        `Message count mismatch: expected ${conversation.message_count}, found ${messages.length}`
      );
    }

    // Verify token counts
    const totalTokens = messages.reduce((sum, msg) => sum + msg.tokens, 0);
    if (totalTokens !== conversation.total_tokens) {
      issues.push(
        `Token count mismatch: expected ${conversation.total_tokens}, found ${totalTokens}`
      );
    }

    // Check sequence numbers
    const expectedSequence = messages.map((_, i) => i);
    const actualSequence = messages.map(m => m.sequence_num);
    if (JSON.stringify(expectedSequence) !== JSON.stringify(actualSequence)) {
      issues.push('Message sequence numbers are not contiguous');
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * Get import statistics
   */
  getImportStats(): {
    total_sessions: number;
    total_messages: number;
    total_tokens: number;
    imported_sessions: number;
  } {
    const stats = this.service.getStats();

    // Count imported sessions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (this.service as any).db;
    const importedStmt = db.prepare(`
      SELECT COUNT(*) as count
      FROM conversations
      WHERE json_extract(metadata, '$.imported_from') IS NOT NULL
    `);
    const { count: imported_sessions } = importedStmt.get() as { count: number };

    return {
      total_sessions: stats.conversations,
      total_messages: stats.messages,
      total_tokens: stats.totalTokens,
      imported_sessions,
    };
  }
}

/**
 * Helper function to import a single session
 */
export async function importSession(
  service: MnemeService,
  tokenCounter: TokenCounter,
  sessionPath: string,
  options?: Partial<ImportOptions>
): Promise<ImportResult> {
  const importer = new SessionImporter(service, tokenCounter);
  return importer.importSession({
    ...options,
    sessionPath,
  });
}

/**
 * Helper function to import a directory of sessions
 */
export async function importDirectory(
  service: MnemeService,
  tokenCounter: TokenCounter,
  directoryPath: string,
  options?: Omit<ImportOptions, 'sessionPath'>
): Promise<ImportResult[]> {
  const importer = new SessionImporter(service, tokenCounter);
  return importer.importDirectory(directoryPath, options);
}

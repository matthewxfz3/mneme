/**
 * Test database utilities
 *
 * Provides helper functions for creating and managing test databases
 */

import { MnemeService, TokenCounter, SearchEngine, ContextAssembler, MnemeContextEngine } from '../../src/index.js';
import Database from 'better-sqlite3';
import { unlinkSync } from 'fs';

export interface TestDbComponents {
  service: MnemeService;
  db: Database.Database;
  tokenCounter: TokenCounter;
  searchEngine: SearchEngine;
  assembler: ContextAssembler;
  engine: MnemeContextEngine;
  dbPath: string;
}

/**
 * Create a test database with all components initialized
 */
export function createTestDb(name = 'test'): TestDbComponents {
  const dbPath = ':memory:'; // Fast in-memory SQLite
  const service = new MnemeService({ dbPath });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = (service as any).db as Database.Database;
  const tokenCounter = new TokenCounter(db);
  const searchEngine = new SearchEngine(db);
  const assembler = new ContextAssembler(service, searchEngine);
  const engine = new MnemeContextEngine({ dbPath });

  return {
    service,
    db,
    tokenCounter,
    searchEngine,
    assembler,
    engine,
    dbPath,
  };
}

/**
 * Clean up test database
 */
export function cleanupTestDb(service: MnemeService, dbPath: string): void {
  try {
    service.close();
  } catch (e) {
    console.warn('Error closing service:', e);
  }

  if (dbPath !== ':memory:') {
    try {
      unlinkSync(dbPath);
    } catch (e) {
      // Ignore - file may not exist
    }
  }
}

/**
 * Create a test conversation with messages
 */
export async function createTestConversation(
  service: MnemeService,
  tokenCounter: TokenCounter,
  options: {
    sessionKey?: string;
    messageCount?: number;
    modelFamily?: 'claude' | 'gpt' | 'gemini' | 'llama';
  } = {}
): Promise<{ conversation_id: string; message_ids: string[] }> {
  const sessionKey = options.sessionKey || `test-session-${Date.now()}`;
  const messageCount = options.messageCount || 10;
  const modelFamily = options.modelFamily || 'claude';

  const conversation = service.createConversation({
    session_key: sessionKey,
    title: `Test Conversation`,
  });

  const message_ids: string[] = [];

  for (let i = 0; i < messageCount; i++) {
    const role = i % 2 === 0 ? 'user' : 'assistant';
    const content = `Test message ${i + 1}: This is ${role === 'user' ? 'a user question' : 'an assistant response'} with some test content.`;

    const tokenResult = await tokenCounter.count(content, {
      modelFamily,
      useCache: true,
    });

    const message = service.addMessage({
      conversation_id: conversation.conversation_id,
      role,
      content,
      tokens: tokenResult.count,
      model_family: modelFamily,
    });

    message_ids.push(message.message_id);
  }

  return {
    conversation_id: conversation.conversation_id,
    message_ids,
  };
}

/**
 * Create multiple test conversations
 */
export async function createTestConversations(
  service: MnemeService,
  tokenCounter: TokenCounter,
  count: number,
  messagesPerConversation: number = 10
): Promise<Array<{ conversation_id: string; message_ids: string[] }>> {
  const conversations = [];

  for (let i = 0; i < count; i++) {
    const conv = await createTestConversation(service, tokenCounter, {
      sessionKey: `session-${i}`,
      messageCount: messagesPerConversation,
    });
    conversations.push(conv);
  }

  return conversations;
}

/**
 * Wait for a specified duration (for testing async operations)
 */
export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Assert that a value is defined (throws if undefined/null)
 */
export function assertDefined<T>(value: T | undefined | null, message?: string): asserts value is T {
  if (value === undefined || value === null) {
    throw new Error(message || 'Expected value to be defined');
  }
}

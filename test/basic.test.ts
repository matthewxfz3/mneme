/**
 * Basic tests for Mneme core functionality
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MnemeService, TokenCounter, MnemeContextEngine } from '../src/index.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync } from 'fs';
import Database from 'better-sqlite3';

describe('MnemeService', () => {
  let service: MnemeService;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `mneme-test-${Date.now()}.db`);
    service = new MnemeService({ dbPath });
  });

  afterEach(() => {
    service.close();
    try {
      unlinkSync(dbPath);
    } catch (e) {
      // Ignore errors
    }
  });

  it('should create a conversation', () => {
    const conv = service.createConversation({
      session_key: 'test-session',
      title: 'Test Conversation',
    });

    expect(conv.conversation_id).toBeDefined();
    expect(conv.session_key).toBe('test-session');
    expect(conv.title).toBe('Test Conversation');
    expect(conv.message_count).toBe(0);
    expect(conv.total_tokens).toBe(0);
  });

  it('should add messages to a conversation', () => {
    const conv = service.createConversation({
      session_key: 'test-session',
    });

    const msg = service.addMessage({
      conversation_id: conv.conversation_id,
      role: 'user',
      content: 'Hello, world!',
      tokens: 3,
    });

    expect(msg.message_id).toBeDefined();
    expect(msg.content).toBe('Hello, world!');
    expect(msg.tokens).toBe(3);
    expect(msg.sequence_num).toBe(0);

    const updatedConv = service.getConversation(conv.conversation_id);
    expect(updatedConv?.message_count).toBe(1);
    expect(updatedConv?.total_tokens).toBe(3);
  });

  it('should retrieve conversation messages', () => {
    const conv = service.createConversation({
      session_key: 'test-session',
    });

    service.addMessage({
      conversation_id: conv.conversation_id,
      role: 'user',
      content: 'Message 1',
      tokens: 2,
    });

    service.addMessage({
      conversation_id: conv.conversation_id,
      role: 'assistant',
      content: 'Message 2',
      tokens: 2,
    });

    const messages = service.getConversationMessages(conv.conversation_id);
    expect(messages).toHaveLength(2);
    expect(messages[0].sequence_num).toBe(0);
    expect(messages[1].sequence_num).toBe(1);
  });

  it('should delete messages and update stats', () => {
    const conv = service.createConversation({
      session_key: 'test-session',
    });

    const msg1 = service.addMessage({
      conversation_id: conv.conversation_id,
      role: 'user',
      content: 'Message 1',
      tokens: 10,
    });

    const msg2 = service.addMessage({
      conversation_id: conv.conversation_id,
      role: 'assistant',
      content: 'Message 2',
      tokens: 20,
    });

    service.deleteMessages([msg1.message_id]);

    const updatedConv = service.getConversation(conv.conversation_id);
    expect(updatedConv?.message_count).toBe(1);
    expect(updatedConv?.total_tokens).toBe(20);
  });

  it('should record compaction events', () => {
    const conv = service.createConversation({
      session_key: 'test-session',
    });

    const eventId = service.recordCompaction({
      conversation_id: conv.conversation_id,
      messages_before: 100,
      messages_after: 50,
      tokens_before: 1000,
      tokens_after: 500,
      dropped_message_ids: ['msg1', 'msg2'],
      strategy: 'test',
    });

    expect(eventId).toBeDefined();

    const history = service.getCompactionHistory(conv.conversation_id);
    expect(history).toHaveLength(1);
    expect(history[0].messages_before).toBe(100);
    expect(history[0].messages_after).toBe(50);
  });
});

describe('TokenCounter', () => {
  let service: MnemeService;
  let counter: TokenCounter;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `mneme-test-${Date.now()}.db`);
    service = new MnemeService({ dbPath });
    const db = (service as any).db as Database.Database;
    counter = new TokenCounter(db);
  });

  afterEach(() => {
    service.close();
    try {
      unlinkSync(dbPath);
    } catch (e) {
      // Ignore
    }
  });

  it('should count tokens', async () => {
    const result = await counter.count('Hello, world!', {
      modelFamily: 'claude',
    });

    expect(result.count).toBeGreaterThan(0);
    expect(result.modelFamily).toBe('claude');
  });

  it('should cache token counts', async () => {
    const content = 'Test content for caching';

    const result1 = await counter.count(content, { modelFamily: 'claude' });
    expect(result1.cached).toBe(false);

    const result2 = await counter.count(content, { modelFamily: 'claude' });
    expect(result2.cached).toBe(true);
    expect(result2.count).toBe(result1.count);
  });

  it('should support batch counting', async () => {
    const contents = ['Message 1', 'Message 2', 'Message 3'];
    const results = await counter.countBatch(contents, { modelFamily: 'gpt' });

    expect(results).toHaveLength(3);
    expect(results.every(r => r.count > 0)).toBe(true);
  });
});

describe('MnemeContextEngine', () => {
  let engine: MnemeContextEngine;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `mneme-test-${Date.now()}.db`);
    engine = new MnemeContextEngine({ dbPath });
  });

  afterEach(() => {
    engine.close();
    try {
      unlinkSync(dbPath);
    } catch (e) {
      // Ignore
    }
  });

  it('should bootstrap a session', async () => {
    await engine.bootstrap({
      sessionId: 'test-session',
    });

    const stats = engine.getStats('test-session');
    expect(stats.conversations).toBe(1);
  });

  it('should ingest messages', async () => {
    await engine.bootstrap({
      sessionId: 'test-session',
    });

    await engine.ingest({
      sessionId: 'test-session',
      message: {
        role: 'user',
        content: 'Hello!',
      },
    });

    const stats = engine.getStats('test-session');
    expect(stats.messages).toBe(1);
    expect(stats.tokens).toBeGreaterThan(0);
  });

  it('should assemble context with token budget', async () => {
    await engine.bootstrap({
      sessionId: 'test-session',
    });

    // Add multiple messages
    for (let i = 0; i < 10; i++) {
      await engine.ingest({
        sessionId: 'test-session',
        message: {
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Message ${i}`,
        },
      });
    }

    const result = await engine.assemble({
      sessionId: 'test-session',
      tokenBudget: 50,
      strategy: 'recent',
    });

    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.metadata.total_tokens).toBeLessThanOrEqual(50);
  });

  it('should search across conversations', async () => {
    await engine.bootstrap({
      sessionId: 'test-session',
    });

    await engine.ingest({
      sessionId: 'test-session',
      message: {
        role: 'user',
        content: 'How do I fix a database connection error?',
      },
    });

    const results = await engine.search('database error');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].message.content).toContain('database');
  });

  it('should perform health check', async () => {
    const health = await engine.healthCheck();
    expect(health.healthy).toBe(true);
    expect(health.stats).toBeDefined();
  });
});

/**
 * End-to-end integration tests
 *
 * Tests complete workflows from import to search to assembly
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, cleanupTestDb, createTestConversation } from '../helpers/test-db.js';
import { SessionImporter } from '../../src/core/import.js';
import { writeFileSync, mkdirSync, unlinkSync, rmdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { TestDbComponents } from '../helpers/test-db.js';

describe('End-to-End Workflows', () => {
  let components: TestDbComponents;
  let testDir: string;

  beforeEach(() => {
    components = createTestDb();
    testDir = join(tmpdir(), `mneme-e2e-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    cleanupTestDb(components.service, components.dbPath);
    try {
      const files = require('fs').readdirSync(testDir);
      files.forEach((file: string) => {
        unlinkSync(join(testDir, file));
      });
      rmdirSync(testDir);
    } catch (e) {
      // Ignore
    }
  });

  it('should complete full lifecycle: Import → Ingest → Search → Assemble', async () => {
    // 1. Import JSONL session
    const sessionFile = join(testDir, 'session-lifecycle.jsonl');
    const jsonlContent = [
      JSON.stringify({
        role: 'user',
        content: 'How do I optimize database queries?',
        timestamp: Date.now(),
      }),
      JSON.stringify({
        role: 'assistant',
        content: 'Here are some tips for database optimization: 1. Use indexes, 2. Avoid N+1 queries, 3. Use connection pooling',
        timestamp: Date.now(),
      }),
      JSON.stringify({
        role: 'user',
        content: 'What about caching strategies?',
        timestamp: Date.now(),
      }),
    ].join('\n');

    writeFileSync(sessionFile, jsonlContent);

    const importer = new SessionImporter(components.service, components.tokenCounter);
    const importResult = await importer.importSession({
      sessionPath: sessionFile,
      modelFamily: 'claude',
    });

    expect(importResult.messages_imported).toBe(3);

    // 2. Ingest new message to the conversation
    components.service.addMessage({
      conversation_id: importResult.conversation_id,
      role: 'assistant',
      content: 'For caching, consider Redis or Memcached for frequently accessed data.',
      tokens: 15,
    });

    // 3. Search for messages
    const searchResponse = await components.searchEngine.search({
      query: 'database optimization',
      limit: 10,
    });
    const searchResults = searchResponse.results;

    expect(searchResults.length).toBeGreaterThan(0);
    expect(searchResults.some(r => r.message.content.includes('database'))).toBe(true);

    // 4. Assemble context with token budget
    const assemblyResult = await components.assembler.assemble({
      conversationId: importResult.conversation_id,
      tokenBudget: 100,
      strategy: 'recent',
    });

    expect(assemblyResult.messages.length).toBeGreaterThan(0);
    expect(assemblyResult.metadata.total_tokens).toBeLessThanOrEqual(100);

    // 5. Verify stats
    const conversation = components.service.getConversation(importResult.conversation_id);
    expect(conversation?.message_count).toBe(4); // 3 imported + 1 ingested
  });

  it('should handle compaction workflow', async () => {
    // Create conversation with many messages
    const { conversation_id, message_ids } = await createTestConversation(
      components.service,
      components.tokenCounter,
      {
        sessionKey: 'compaction-test',
        messageCount: 50,
      }
    );

    const beforeStats = components.service.getConversation(conversation_id);
    expect(beforeStats?.message_count).toBe(50);

    // Delete some messages (simulate compaction)
    const messagesToDelete = message_ids.slice(0, 25);
    components.service.deleteMessages(messagesToDelete);

    // Record compaction event
    const eventId = components.service.recordCompaction({
      conversation_id,
      messages_before: 50,
      messages_after: 25,
      tokens_before: beforeStats?.total_tokens || 0,
      tokens_after: 0, // Will be updated
      dropped_message_ids: messagesToDelete,
      strategy: 'recent-retention',
    });

    expect(eventId).toBeDefined();

    // Verify audit trail
    const history = components.service.getCompactionHistory(conversation_id);
    expect(history.length).toBe(1);
    expect(history[0].messages_before).toBe(50);
    expect(history[0].messages_after).toBe(25);
    expect(history[0].strategy).toBe('recent-retention');

    // Verify conversation stats
    const afterStats = components.service.getConversation(conversation_id);
    expect(afterStats?.message_count).toBe(25);
  });

  it('should search across multiple sessions', async () => {
    // Create multiple conversations
    await createTestConversation(components.service, components.tokenCounter, {
      sessionKey: 'session-1',
      messageCount: 10,
    });

    await createTestConversation(components.service, components.tokenCounter, {
      sessionKey: 'session-2',
      messageCount: 10,
    });

    await createTestConversation(components.service, components.tokenCounter, {
      sessionKey: 'session-3',
      messageCount: 10,
    });

    // Search across all conversations
    const searchResponse = await components.searchEngine.search({
      query: 'test',
      limit: 50,
    });
    const results = searchResponse.results;

    // Should find results from multiple conversations
    const conversationIds = new Set(results.map(r => r.message.conversation_id));
    expect(conversationIds.size).toBeGreaterThan(1);
    expect(results.length).toBeGreaterThan(10);
  });

  it('should handle various token budget constraints', async () => {
    const { conversation_id } = await createTestConversation(
      components.service,
      components.tokenCounter,
      {
        messageCount: 20,
      }
    );

    // Test zero budget
    const zeroBudget = await components.assembler.assemble({
      conversationId: conversation_id,
      tokenBudget: 0,
      strategy: 'recent',
    });
    expect(zeroBudget.messages.length).toBe(0);

    // Test small budget
    const smallBudget = await components.assembler.assemble({
      conversationId: conversation_id,
      tokenBudget: 50,
      strategy: 'recent',
    });
    expect(smallBudget.metadata.total_tokens).toBeLessThanOrEqual(50);
    expect(smallBudget.messages.length).toBeGreaterThan(0);

    // Test large budget
    const largeBudget = await components.assembler.assemble({
      conversationId: conversation_id,
      tokenBudget: 10000,
      strategy: 'recent',
    });
    expect(largeBudget.messages.length).toBe(20); // All messages fit
  });

  it('should maintain data integrity across operations', async () => {
    const { conversation_id } = await createTestConversation(
      components.service,
      components.tokenCounter,
      {
        messageCount: 10,
      }
    );

    // Get initial state
    const initialConv = components.service.getConversation(conversation_id);
    const initialMessages = components.service.getConversationMessages(conversation_id);

    expect(initialConv?.message_count).toBe(initialMessages.length);
    expect(initialMessages).toHaveContiguousSequence();

    // Add more messages
    for (let i = 0; i < 5; i++) {
      const tokenResult = await components.tokenCounter.count(`Additional message ${i}`, {
        modelFamily: 'claude',
      });

      components.service.addMessage({
        conversation_id,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Additional message ${i}`,
        tokens: tokenResult.count,
      });
    }

    // Verify integrity
    const updatedConv = components.service.getConversation(conversation_id);
    const updatedMessages = components.service.getConversationMessages(conversation_id);

    expect(updatedConv?.message_count).toBe(15);
    expect(updatedMessages.length).toBe(15);
    expect(updatedMessages).toHaveContiguousSequence();

    // Verify token counts
    const calculatedTokens = updatedMessages.reduce((sum, msg) => sum + msg.tokens, 0);
    expect(updatedConv?.total_tokens).toBe(calculatedTokens);
  });

  it('should support search with filters', async () => {
    const { conversation_id } = await createTestConversation(
      components.service,
      components.tokenCounter,
      {
        messageCount: 20,
      }
    );

    // Search with conversation filter
    const filteredResponse = await components.searchEngine.search({
      query: 'test',
      conversationId: conversation_id,
      limit: 50,
    });
    const filteredResults = filteredResponse.results;

    expect(filteredResults.every(r => r.message.conversation_id === conversation_id)).toBe(
      true
    );

    // Search with role filter
    const userResponse = await components.searchEngine.search({
      query: 'test',
      roles: ['user'],
      limit: 50,
    });
    const userMessages = userResponse.results;

    expect(userMessages.every(r => r.message.role === 'user')).toBe(true);
  });

  it('should handle empty database gracefully', async () => {
    // Search on empty database
    const searchResponse = await components.searchEngine.search({
      query: 'anything',
      limit: 10,
    });

    expect(searchResponse.results).toHaveLength(0);

    // Get stats on empty database
    const stats = components.service.getStats();
    expect(stats.conversations).toBe(0);
    expect(stats.messages).toBe(0);
    expect(stats.totalTokens).toBe(0);
  });

  it('should support different assembly strategies', async () => {
    const { conversation_id } = await createTestConversation(
      components.service,
      components.tokenCounter,
      {
        messageCount: 30,
      }
    );

    const strategies: Array<'recent' | 'hybrid' | 'sliding-window'> = ['recent', 'hybrid', 'sliding-window'];

    for (const strategy of strategies) {
      const result = await components.assembler.assemble({
        conversationId: conversation_id,
        tokenBudget: 200,
        strategy,
      });

      expect(result.messages.length).toBeGreaterThan(0);
      expect(result.metadata.total_tokens).toBeLessThanOrEqual(200);
      expect(result.metadata.strategy).toBe(strategy);
    }
  });
});

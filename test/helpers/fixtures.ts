/**
 * Test fixture generators and utilities
 *
 * Provides functions for creating mock data and loading fixture files
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type { SearchResult } from '../../src/core/search.js';

/**
 * Message fixture interface
 */
export interface MockMessage {
  message_id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tokens: number;
  sequence_num: number;
  created_at: number;
  model_family?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Create a mock message with default values
 */
export function createMockMessage(overrides?: Partial<MockMessage>): MockMessage {
  const defaults: MockMessage = {
    message_id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    conversation_id: `conv-${Date.now()}`,
    role: 'user',
    content: 'This is a test message with some sample content.',
    tokens: 10,
    sequence_num: 0,
    created_at: Date.now(),
    model_family: 'claude',
  };

  return { ...defaults, ...overrides };
}

/**
 * Create multiple mock messages
 */
export function createMockMessages(
  count: number,
  baseOptions?: Partial<MockMessage>
): MockMessage[] {
  const messages: MockMessage[] = [];
  const conversationId = baseOptions?.conversation_id || `conv-${Date.now()}`;

  for (let i = 0; i < count; i++) {
    messages.push(
      createMockMessage({
        ...baseOptions,
        conversation_id: conversationId,
        sequence_num: i,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i + 1}: ${baseOptions?.content || 'Test content'}`,
        created_at: Date.now() + i * 1000, // 1 second apart
      })
    );
  }

  return messages;
}

/**
 * Create a mock search result
 */
export function createMockSearchResult(overrides?: Partial<SearchResult>): SearchResult {
  const message = createMockMessage(overrides?.message);

  const defaults: SearchResult = {
    message,
    score: 0.75,
    method: 'hybrid',
    explanation: {
      sparse_score: 0.5,
      dense_score: 0.25,
    },
  };

  return { ...defaults, ...overrides, message };
}

/**
 * Create multiple mock search results from message IDs
 */
export function createMockSearchResults(messageIds: string[]): SearchResult[] {
  return messageIds.map((id, index) =>
    createMockSearchResult({
      message: createMockMessage({ message_id: id }),
      score: 1.0 - index * 0.1, // Descending scores
    })
  );
}

/**
 * Load a fixture file from the fixtures directory
 */
export function loadFixture(filename: string): any {
  const fixturePath = join(process.cwd(), 'test', 'fixtures', filename);
  const content = readFileSync(fixturePath, 'utf-8');

  if (filename.endsWith('.json')) {
    return JSON.parse(content);
  } else if (filename.endsWith('.jsonl')) {
    return content
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => JSON.parse(line));
  }

  return content;
}

/**
 * Realistic message content templates
 */
export const CONTENT_TEMPLATES = {
  technical: [
    'How do I fix a database connection error in PostgreSQL?',
    'What is the difference between async/await and promises in JavaScript?',
    'Can you explain how React hooks work?',
    'I am getting a CORS error when making API requests',
    'How do I optimize SQL queries for better performance?',
  ],
  conversational: [
    'Hello! How are you today?',
    'Thank you for your help!',
    'Can you help me with something?',
    'That makes sense, thanks for explaining.',
    'I appreciate your assistance.',
  ],
  code: [
    'Here is the code:\n```python\ndef hello():\n    print("Hello, world!")\n```',
    'Try this solution:\n```javascript\nconst result = await fetch(url);\n```',
    'The error is on line 42:\n```\nTypeError: Cannot read property of undefined\n```',
  ],
  data: [
    'The user count is 1,234 and growing at 5% per month.',
    'Query executed in 45ms and returned 127 results.',
    'API latency: P50=12ms, P95=35ms, P99=120ms',
    'Total tokens: 15,234 | Budget: 20,000 | Remaining: 4,766',
  ],
};

/**
 * Get a random item from an array
 */
function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generate realistic test content
 */
export function generateRealisticContent(type?: keyof typeof CONTENT_TEMPLATES): string {
  if (type && CONTENT_TEMPLATES[type]) {
    return randomItem(CONTENT_TEMPLATES[type]);
  }

  // Random type
  const types = Object.keys(CONTENT_TEMPLATES) as (keyof typeof CONTENT_TEMPLATES)[];
  const randomType = randomItem(types);
  return randomItem(CONTENT_TEMPLATES[randomType]);
}

/**
 * Generate a realistic conversation
 */
export function generateRealisticConversation(messageCount: number): MockMessage[] {
  const messages: MockMessage[] = [];
  const conversationId = `conv-${Date.now()}`;
  const baseTime = Date.now() - messageCount * 60000; // Start N minutes ago

  for (let i = 0; i < messageCount; i++) {
    const role = i % 2 === 0 ? 'user' : 'assistant';
    const content =
      role === 'user'
        ? generateRealisticContent('technical')
        : generateRealisticContent('conversational');

    messages.push(
      createMockMessage({
        conversation_id: conversationId,
        sequence_num: i,
        role,
        content,
        tokens: Math.floor(content.length / 4), // Rough approximation
        created_at: baseTime + i * 60000, // 1 minute apart
      })
    );
  }

  return messages;
}

/**
 * Create JSONL content for a session
 */
export function createSessionJsonl(messages: MockMessage[]): string {
  return messages
    .map(msg => {
      const jsonlMsg = {
        role: msg.role,
        content: msg.content,
        timestamp: msg.created_at,
      };
      return JSON.stringify(jsonlMsg);
    })
    .join('\n');
}

/**
 * Create OpenClaw-style message with content blocks
 */
export function createOpenClawMessage(content: string, role: 'user' | 'assistant' | 'system') {
  return {
    role,
    content: [
      {
        type: 'text',
        text: content,
      },
    ],
    timestamp: Date.now(),
  };
}

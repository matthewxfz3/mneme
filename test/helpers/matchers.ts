/**
 * Custom Vitest matchers for Mneme tests
 *
 * Extends Vitest's expect with domain-specific assertions
 */

import { expect } from 'vitest';

/**
 * Check if a string is a valid message ID
 */
export function toBeValidMessageId(received: string) {
  const isValid =
    typeof received === 'string' &&
    received.length > 0 &&
    (received.startsWith('msg-') || /^[a-f0-9-]{36}$/.test(received));

  return {
    pass: isValid,
    message: () =>
      isValid
        ? `Expected ${received} not to be a valid message ID`
        : `Expected ${received} to be a valid message ID`,
  };
}

/**
 * Check if token count is within budget
 */
export function toBeWithinTokenBudget(received: number, budget: number) {
  const isWithin = received >= 0 && received <= budget;

  return {
    pass: isWithin,
    message: () =>
      isWithin
        ? `Expected ${received} tokens not to be within budget of ${budget}`
        : `Expected ${received} tokens to be within budget of ${budget}, exceeded by ${received - budget}`,
  };
}

/**
 * Check if search results are relevant to query
 */
export function toHaveSearchRelevance(received: any[], query: string) {
  if (!Array.isArray(received)) {
    return {
      pass: false,
      message: () => `Expected an array of search results, got ${typeof received}`,
    };
  }

  // Check if at least one result contains the query term
  const hasRelevance = received.some(result => {
    const content = result.message?.content || result.content || '';
    return content.toLowerCase().includes(query.toLowerCase());
  });

  return {
    pass: hasRelevance,
    message: () =>
      hasRelevance
        ? `Expected search results not to contain query "${query}"`
        : `Expected at least one search result to contain query "${query}"`,
  };
}

/**
 * Check if a conversation has messages
 */
export function toHaveMessages(received: any) {
  const hasMessages =
    received &&
    typeof received.message_count === 'number' &&
    received.message_count > 0;

  return {
    pass: hasMessages,
    message: () =>
      hasMessages
        ? `Expected conversation not to have messages`
        : `Expected conversation to have messages, but message_count was ${received?.message_count || 0}`,
  };
}

/**
 * Check if results are sorted by score descending
 */
export function toBeSortedByScore(received: any[]) {
  if (!Array.isArray(received) || received.length === 0) {
    return {
      pass: true,
      message: () => 'Array is empty or not an array',
    };
  }

  let isSorted = true;
  for (let i = 1; i < received.length; i++) {
    if (received[i].score > received[i - 1].score) {
      isSorted = false;
      break;
    }
  }

  return {
    pass: isSorted,
    message: () =>
      isSorted
        ? `Expected results not to be sorted by score descending`
        : `Expected results to be sorted by score descending`,
  };
}

/**
 * Check if sequence numbers are contiguous
 */
export function toHaveContiguousSequence(received: any[]) {
  if (!Array.isArray(received) || received.length === 0) {
    return {
      pass: true,
      message: () => 'Array is empty or not an array',
    };
  }

  let isContiguous = true;
  for (let i = 0; i < received.length; i++) {
    if (received[i].sequence_num !== i) {
      isContiguous = false;
      break;
    }
  }

  return {
    pass: isContiguous,
    message: () =>
      isContiguous
        ? `Expected sequence numbers not to be contiguous`
        : `Expected sequence numbers to be contiguous starting from 0`,
  };
}

/**
 * Register custom matchers with Vitest
 */
export function registerMatchers() {
  expect.extend({
    toBeValidMessageId,
    toBeWithinTokenBudget,
    toHaveSearchRelevance,
    toHaveMessages,
    toBeSortedByScore,
    toHaveContiguousSequence,
  });
}

// Type augmentation for TypeScript
declare module 'vitest' {
  interface Assertion<T = any> {
    toBeValidMessageId(): T;
    toBeWithinTokenBudget(budget: number): T;
    toHaveSearchRelevance(query: string): T;
    toHaveMessages(): T;
    toBeSortedByScore(): T;
    toHaveContiguousSequence(): T;
  }
  interface AsymmetricMatchersContaining {
    toBeValidMessageId(): any;
    toBeWithinTokenBudget(budget: number): any;
    toHaveSearchRelevance(query: string): any;
    toHaveMessages(): any;
    toBeSortedByScore(): any;
    toHaveContiguousSequence(): any;
  }
}

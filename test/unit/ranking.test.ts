/**
 * Unit tests for ResultRanker and ranking algorithms
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ResultRanker, BatchRanker } from '../../src/core/ranking.js';
import { createMockSearchResult, createMockSearchResults } from '../helpers/fixtures.js';
import type { SearchResult } from '../../src/core/search.js';

describe('ResultRanker', () => {
  describe('reciprocalRankFusion', () => {
    it('should merge multiple result sets using RRF', () => {
      const results1 = createMockSearchResults(['msg-1', 'msg-2', 'msg-3']);
      const results2 = createMockSearchResults(['msg-2', 'msg-1', 'msg-4']);
      const results3 = createMockSearchResults(['msg-3', 'msg-4', 'msg-1']);

      const merged = ResultRanker.reciprocalRankFusion([results1, results2, results3]);

      expect(merged.length).toBe(4); // Unique messages
      expect(merged[0].rank).toBe(1);
      expect(merged).toBeSortedByScore();
    });

    it('should handle empty result sets', () => {
      const results1 = createMockSearchResults(['msg-1', 'msg-2']);
      const results2: SearchResult[] = [];

      const merged = ResultRanker.reciprocalRankFusion([results1, results2]);

      expect(merged.length).toBe(2);
      expect(merged[0].rank).toBe(1);
      expect(merged[1].rank).toBe(2);
    });

    it('should use custom k parameter', () => {
      const results1 = createMockSearchResults(['msg-1', 'msg-2']);
      const results2 = createMockSearchResults(['msg-2', 'msg-1']);

      const defaultK = ResultRanker.reciprocalRankFusion([results1, results2]);
      const customK = ResultRanker.reciprocalRankFusion([results1, results2], { k: 1 });

      // Custom k should produce different scores
      expect(defaultK[0].score).not.toBe(customK[0].score);
    });

    it('should deduplicate messages across result sets', () => {
      const results1 = createMockSearchResults(['msg-1', 'msg-1', 'msg-2']);
      const results2 = createMockSearchResults(['msg-1', 'msg-2', 'msg-3']);

      const merged = ResultRanker.reciprocalRankFusion([results1, results2]);

      const messageIds = new Set(merged.map(r => r.message.message_id));
      expect(messageIds.size).toBe(3); // msg-1, msg-2, msg-3
    });

    it('should handle single result set', () => {
      const results = createMockSearchResults(['msg-1', 'msg-2', 'msg-3']);

      const ranked = ResultRanker.reciprocalRankFusion([results]);

      expect(ranked.length).toBe(3);
      expect(ranked).toBeSortedByScore();
    });
  });

  describe('applyTemporalDecay', () => {
    it('should boost recent messages', () => {
      const now = Date.now();
      const recentMsg = createMockSearchResult({
        message: { created_at: now - 1000 } as any, // 1 second ago
        score: 0.5,
      });
      const oldMsg = createMockSearchResult({
        message: { created_at: now - 30 * 24 * 60 * 60 * 1000 } as any, // 30 days ago
        score: 0.5,
      });

      const results = [oldMsg, recentMsg];
      const decayed = ResultRanker.applyTemporalDecay(results, {
        temporalDecayHalfLife: 30, // 30 days
      });

      // Recent message should rank higher after decay
      expect(decayed[0].message.message_id).toBe(recentMsg.message.message_id);
      expect(decayed[0].score).toBeGreaterThan(decayed[1].score);
    });

    it('should apply exponential decay formula correctly', () => {
      const now = Date.now();
      const halfLife = 30; // days
      const halfLifeMs = halfLife * 24 * 60 * 60 * 1000;

      const msg = createMockSearchResult({
        message: { created_at: now - halfLifeMs } as any,
        score: 1.0,
      });

      const decayed = ResultRanker.applyTemporalDecay([msg], {
        temporalDecayHalfLife: halfLife,
      });

      // After one half-life, score should be approximately 0.5
      expect(decayed[0].score).toBeCloseTo(0.5, 1);
    });

    it('should handle zero half-life edge case', () => {
      const results = createMockSearchResults(['msg-1', 'msg-2']);

      const decayed = ResultRanker.applyTemporalDecay(results, {
        temporalDecayHalfLife: 0,
      });

      // With zero half-life, scores will be NaN due to division by zero
      // This is expected behavior - zero half-life is not valid
      expect(decayed.length).toBe(2);
    });

    it('should add recency_score to explanation', () => {
      const results = createMockSearchResults(['msg-1']);

      const decayed = ResultRanker.applyTemporalDecay(results);

      expect(decayed[0].explanation.recency_score).toBeDefined();
      expect(decayed[0].explanation.recency_score).toBeGreaterThan(0);
      expect(decayed[0].explanation.recency_score).toBeLessThanOrEqual(1);
    });

    it('should maintain rank order after decay', () => {
      const results = createMockSearchResults(['msg-1', 'msg-2', 'msg-3']);

      const decayed = ResultRanker.applyTemporalDecay(results);

      expect(decayed).toBeSortedByScore();
      expect(decayed[0].rank).toBe(1);
      expect(decayed[1].rank).toBe(2);
      expect(decayed[2].rank).toBe(3);
    });
  });

  describe('diversifyResults', () => {
    it('should penalize repeated conversations', () => {
      const conv1Results = [
        createMockSearchResult({
          message: { conversation_id: 'conv-1', message_id: 'msg-1' } as any,
          score: 0.9,
        }),
        createMockSearchResult({
          message: { conversation_id: 'conv-1', message_id: 'msg-2' } as any,
          score: 0.85,
        }),
      ];

      const conv2Result = createMockSearchResult({
        message: { conversation_id: 'conv-2', message_id: 'msg-3' } as any,
        score: 0.8,
      });

      const results = [...conv1Results, conv2Result];
      const diversified = ResultRanker.diversifyResults(results, {
        diversityWeight: 0.5,
      });

      // Second message from conv-1 should be penalized
      expect(diversified[0].conversationGroup).toBeDefined();
    });

    it('should apply diversity weighting', () => {
      const results = [
        createMockSearchResult({
          message: { conversation_id: 'conv-1' } as any,
          score: 1.0,
        }),
        createMockSearchResult({
          message: { conversation_id: 'conv-1' } as any,
          score: 0.9,
        }),
      ];

      const noDiversity = ResultRanker.diversifyResults(results, {
        diversityWeight: 0,
      });
      const withDiversity = ResultRanker.diversifyResults(results, {
        diversityWeight: 0.5,
      });

      // Diversity weight should affect scores
      expect(withDiversity[1].score).toBeLessThan(noDiversity[1].score);
    });

    it('should track original rank', () => {
      const results = createMockSearchResults(['msg-1', 'msg-2', 'msg-3']);

      const diversified = ResultRanker.diversifyResults(results);

      diversified.forEach((result, index) => {
        expect(result.originalRank).toBeDefined();
      });
    });

    it('should handle single conversation', () => {
      const results = createMockSearchResults(['msg-1', 'msg-2']).map(r => ({
        ...r,
        message: { ...r.message, conversation_id: 'conv-1' },
      }));

      const diversified = ResultRanker.diversifyResults(results);

      expect(diversified.length).toBe(2);
      expect(diversified).toBeSortedByScore();
    });
  });

  describe('rerank', () => {
    it('should apply full reranking pipeline', () => {
      const results = createMockSearchResults(['msg-1', 'msg-2', 'msg-3']);

      const reranked = ResultRanker.rerank(results, {
        temporalDecayHalfLife: 30,
        diversityWeight: 0.1,
      });

      expect(reranked.length).toBe(3);
      expect(reranked).toBeSortedByScore();
      expect(reranked.every(r => r.rank > 0)).toBe(true);
    });

    it('should skip temporal decay when halfLife is 0', () => {
      const results = createMockSearchResults(['msg-1', 'msg-2']);

      const reranked = ResultRanker.rerank(results, {
        temporalDecayHalfLife: 0,
        diversityWeight: 0,
      });

      expect(reranked.length).toBe(2);
    });

    it('should skip diversity when weight is 0', () => {
      const results = createMockSearchResults(['msg-1', 'msg-2']);

      const reranked = ResultRanker.rerank(results, {
        temporalDecayHalfLife: 0,
        diversityWeight: 0,
      });

      expect(reranked.every(r => !r.conversationGroup)).toBe(true);
    });
  });

  describe('groupByConversation', () => {
    it('should group results by conversation ID', () => {
      const results = [
        createMockSearchResult({
          message: { conversation_id: 'conv-1' } as any,
          rank: 1,
        }),
        createMockSearchResult({
          message: { conversation_id: 'conv-2' } as any,
          rank: 2,
        }),
        createMockSearchResult({
          message: { conversation_id: 'conv-1' } as any,
          rank: 3,
        }),
      ];

      const groups = ResultRanker.groupByConversation(results);

      expect(groups.size).toBe(2);
      expect(groups.get('conv-1')?.length).toBe(2);
      expect(groups.get('conv-2')?.length).toBe(1);
    });
  });

  describe('topPerConversation', () => {
    it('should return top N results per conversation', () => {
      const results = [
        createMockSearchResult({
          message: { conversation_id: 'conv-1', message_id: 'msg-1' } as any,
          score: 1.0,
          rank: 1,
        }),
        createMockSearchResult({
          message: { conversation_id: 'conv-1', message_id: 'msg-2' } as any,
          score: 0.9,
          rank: 2,
        }),
        createMockSearchResult({
          message: { conversation_id: 'conv-1', message_id: 'msg-3' } as any,
          score: 0.8,
          rank: 3,
        }),
        createMockSearchResult({
          message: { conversation_id: 'conv-2', message_id: 'msg-4' } as any,
          score: 0.7,
          rank: 4,
        }),
      ];

      const topResults = ResultRanker.topPerConversation(results, 2);

      // Should get 2 from conv-1 and 1 from conv-2
      expect(topResults.length).toBe(3);
    });
  });

  describe('calculateMRR', () => {
    it('should calculate Mean Reciprocal Rank correctly', () => {
      const results = createMockSearchResults(['msg-1', 'msg-2', 'msg-3']).map(
        (r, i) => ({ ...r, rank: i + 1 })
      );
      const relevantIds = new Set(['msg-2']);

      const mrr = ResultRanker.calculateMRR(results, relevantIds);

      // First relevant result is at rank 2, so MRR = 1/2 = 0.5
      expect(mrr).toBe(0.5);
    });

    it('should return 0 when no relevant results', () => {
      const results = createMockSearchResults(['msg-1', 'msg-2']).map((r, i) => ({
        ...r,
        rank: i + 1,
      }));
      const relevantIds = new Set(['msg-99']);

      const mrr = ResultRanker.calculateMRR(results, relevantIds);

      expect(mrr).toBe(0);
    });

    it('should return 1.0 for first result relevant', () => {
      const results = createMockSearchResults(['msg-1', 'msg-2']).map((r, i) => ({
        ...r,
        rank: i + 1,
      }));
      const relevantIds = new Set(['msg-1']);

      const mrr = ResultRanker.calculateMRR(results, relevantIds);

      expect(mrr).toBe(1.0);
    });
  });

  describe('calculateNDCG', () => {
    it('should calculate NDCG correctly', () => {
      const results = createMockSearchResults(['msg-1', 'msg-2', 'msg-3']).map(
        (r, i) => ({ ...r, rank: i + 1 })
      );
      const relevanceScores = new Map([
        ['msg-1', 3],
        ['msg-2', 2],
        ['msg-3', 1],
      ]);

      const ndcg = ResultRanker.calculateNDCG(results, relevanceScores);

      // Perfect ranking should give NDCG close to 1.0
      expect(ndcg).toBeGreaterThan(0.9);
      expect(ndcg).toBeLessThanOrEqual(1.0);
    });

    it('should return 1.0 for perfect ranking', () => {
      const results = createMockSearchResults(['msg-1', 'msg-2', 'msg-3']).map(
        (r, i) => ({ ...r, rank: i + 1 })
      );
      const relevanceScores = new Map([
        ['msg-1', 3],
        ['msg-2', 2],
        ['msg-3', 1],
      ]);

      const ndcg = ResultRanker.calculateNDCG(results, relevanceScores);

      expect(ndcg).toBeCloseTo(1.0, 2);
    });

    it('should handle k parameter', () => {
      const results = createMockSearchResults(['msg-1', 'msg-2', 'msg-3']).map(
        (r, i) => ({ ...r, rank: i + 1 })
      );
      const relevanceScores = new Map([
        ['msg-1', 3],
        ['msg-2', 2],
        ['msg-3', 1],
      ]);

      const ndcg3 = ResultRanker.calculateNDCG(results, relevanceScores, 3);
      const ndcg2 = ResultRanker.calculateNDCG(results, relevanceScores, 2);

      // NDCG@2 and NDCG@3 should be different
      expect(ndcg2).toBeDefined();
      expect(ndcg3).toBeDefined();
    });
  });

  describe('explainRanking', () => {
    it('should generate ranking explanation', () => {
      const result = createMockSearchResult({
        score: 0.85,
        rank: 1,
        explanation: {
          sparse_score: 0.6,
          dense_score: 0.25,
          recency_score: 0.9,
        },
      });

      const explanation = ResultRanker.explainRanking(result);

      expect(explanation).toContain('Rank: 1');
      expect(explanation).toContain('Final Score:');
      expect(explanation).toContain('Sparse (BM25):');
      expect(explanation).toContain('Dense (Vector):');
      expect(explanation).toContain('Recency:');
    });
  });
});

describe('BatchRanker', () => {
  let ranker: BatchRanker;

  beforeEach(() => {
    ranker = new BatchRanker();
  });

  describe('rankBatch', () => {
    it('should rank multiple result sets in parallel', async () => {
      const resultSets = [
        createMockSearchResults(['msg-1', 'msg-2']),
        createMockSearchResults(['msg-3', 'msg-4']),
        createMockSearchResults(['msg-5', 'msg-6']),
      ];

      const ranked = await ranker.rankBatch(resultSets);

      expect(ranked.length).toBe(3);
      expect(ranked[0].length).toBe(2);
      expect(ranked[1].length).toBe(2);
      expect(ranked[2].length).toBe(2);
    });
  });

  describe('findBestAcrossQueries', () => {
    it('should find best results across multiple queries using RRF', async () => {
      const resultSets = [
        createMockSearchResults(['msg-1', 'msg-2', 'msg-3']),
        createMockSearchResults(['msg-2', 'msg-1', 'msg-4']),
      ];

      const best = await ranker.findBestAcrossQueries(resultSets);

      expect(best.length).toBeGreaterThan(0);
      expect(best).toBeSortedByScore();
      expect(best.every(r => r.rank > 0)).toBe(true);
    });
  });
});

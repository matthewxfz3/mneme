/**
 * Advanced Ranking and Reranking
 *
 * Implements Reciprocal Rank Fusion (RRF), temporal decay,
 * and conversation-aware grouping for improved retrieval quality.
 */

import { SearchResult } from './search.js';

export interface RankingOptions {
  k?: number;                     // RRF constant (default: 60)
  temporalDecayHalfLife?: number; // Days until score halves (default: 30)
  groupByConversation?: boolean;  // Group results by conversation
  diversityWeight?: number;       // Diversity bonus (0-1, default: 0.1)
}

export interface RankedResult extends SearchResult {
  rank: number;
  originalRank?: number;
  conversationGroup?: number;
}

/**
 * Result ranker
 */
export class ResultRanker {
  /**
   * Apply Reciprocal Rank Fusion to merge multiple result sets
   */
  static reciprocalRankFusion(
    resultSets: SearchResult[][],
    options?: RankingOptions
  ): RankedResult[] {
    const k = options?.k ?? 60;
    const scores = new Map<string, number>();
    const resultMap = new Map<string, SearchResult>();

    // Compute RRF scores
    for (const results of resultSets) {
      results.forEach((result, rank) => {
        const messageId = result.message.message_id;
        const rrfScore = 1 / (k + rank + 1);

        const currentScore = scores.get(messageId) || 0;
        scores.set(messageId, currentScore + rrfScore);

        if (!resultMap.has(messageId)) {
          resultMap.set(messageId, result);
        }
      });
    }

    // Create ranked results
    const rankedResults: RankedResult[] = Array.from(scores.entries())
      .map(([messageId, score]) => ({
        ...resultMap.get(messageId)!,
        rank: 0, // Will be set after sorting
        score,
      }))
      .sort((a, b) => b.score - a.score)
      .map((result, index) => ({
        ...result,
        rank: index + 1,
      }));

    return rankedResults;
  }

  /**
   * Apply temporal decay to results
   */
  static applyTemporalDecay(
    results: SearchResult[],
    options?: RankingOptions
  ): RankedResult[] {
    const halfLife = (options?.temporalDecayHalfLife ?? 30) * 24 * 60 * 60 * 1000; // Convert days to ms
    const now = Date.now();

    const decayedResults = results.map(result => {
      const age = now - result.message.created_at;
      const decayFactor = Math.exp(-(age * Math.LN2) / halfLife);
      const decayedScore = result.score * decayFactor;

      return {
        ...result,
        rank: 0,
        score: decayedScore,
        explanation: {
          ...result.explanation,
          recency_score: decayFactor,
        },
      };
    });

    // Re-rank based on decayed scores
    decayedResults.sort((a, b) => b.score - a.score);
    decayedResults.forEach((result, index) => {
      result.rank = index + 1;
    });

    return decayedResults;
  }

  /**
   * Group results by conversation and boost diversity
   */
  static diversifyResults(
    results: SearchResult[],
    options?: RankingOptions
  ): RankedResult[] {
    const diversityWeight = options?.diversityWeight ?? 0.1;

    // Track conversations already seen
    const conversationCounts = new Map<string, number>();
    const maxConversationCount = Math.max(
      1,
      ...Array.from(
        results.reduce((map, r) => {
          const count = (map.get(r.message.conversation_id) || 0) + 1;
          map.set(r.message.conversation_id, count);
          return map;
        }, new Map<string, number>()).values()
      )
    );

    const diversifiedResults = results.map((result, index) => {
      const conversationId = result.message.conversation_id;
      const conversationCount = conversationCounts.get(conversationId) || 0;
      conversationCounts.set(conversationId, conversationCount + 1);

      // Penalize repeated conversations
      const diversityPenalty = conversationCount / maxConversationCount;
      const diversifiedScore = result.score * (1 - diversityWeight * diversityPenalty);

      return {
        ...result,
        rank: 0,
        originalRank: index + 1,
        score: diversifiedScore,
        conversationGroup: conversationCount,
      };
    });

    // Re-rank
    diversifiedResults.sort((a, b) => b.score - a.score);
    diversifiedResults.forEach((result, index) => {
      result.rank = index + 1;
    });

    return diversifiedResults;
  }

  /**
   * Complete reranking pipeline
   */
  static rerank(
    results: SearchResult[],
    options?: RankingOptions
  ): RankedResult[] {
    let rankedResults: RankedResult[] = results.map((r, i) => ({
      ...r,
      rank: i + 1,
    }));

    // Apply temporal decay
    if (options?.temporalDecayHalfLife !== 0) {
      rankedResults = this.applyTemporalDecay(rankedResults, options);
    }

    // Apply diversity
    if (options?.diversityWeight !== 0) {
      rankedResults = this.diversifyResults(rankedResults, options);
    }

    return rankedResults;
  }

  /**
   * Group results by conversation
   */
  static groupByConversation(results: RankedResult[]): Map<string, RankedResult[]> {
    const groups = new Map<string, RankedResult[]>();

    for (const result of results) {
      const conversationId = result.message.conversation_id;
      const group = groups.get(conversationId) || [];
      group.push(result);
      groups.set(conversationId, group);
    }

    return groups;
  }

  /**
   * Get top N results per conversation
   */
  static topPerConversation(
    results: RankedResult[],
    n: number = 3
  ): RankedResult[] {
    const groups = this.groupByConversation(results);
    const topResults: RankedResult[] = [];

    for (const group of groups.values()) {
      topResults.push(...group.slice(0, n));
    }

    // Re-rank globally
    topResults.sort((a, b) => b.score - a.score);
    topResults.forEach((result, index) => {
      result.rank = index + 1;
    });

    return topResults;
  }

  /**
   * Calculate Mean Reciprocal Rank (MRR) for evaluation
   */
  static calculateMRR(
    results: RankedResult[],
    relevantIds: Set<string>
  ): number {
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result && relevantIds.has(result.message.message_id)) {
        return 1 / (i + 1);
      }
    }
    return 0;
  }

  /**
   * Calculate Normalized Discounted Cumulative Gain (NDCG)
   */
  static calculateNDCG(
    results: RankedResult[],
    relevanceScores: Map<string, number>,
    k?: number
  ): number {
    const topK = k ? results.slice(0, k) : results;

    // Calculate DCG
    const dcg = topK.reduce((sum, result, index) => {
      const relevance = relevanceScores.get(result.message.message_id) || 0;
      return sum + relevance / Math.log2(index + 2);
    }, 0);

    // Calculate ideal DCG
    const idealScores = Array.from(relevanceScores.values())
      .sort((a, b) => b - a)
      .slice(0, topK.length);

    const idcg = idealScores.reduce((sum, relevance, index) => {
      return sum + relevance / Math.log2(index + 2);
    }, 0);

    return idcg > 0 ? dcg / idcg : 0;
  }

  /**
   * Explain ranking for a specific result
   */
  static explainRanking(result: RankedResult): string {
    const parts: string[] = [];

    parts.push(`Rank: ${result.rank}`);
    parts.push(`Final Score: ${result.score.toFixed(4)}`);

    if (result.explanation.sparse_score !== undefined) {
      parts.push(`Sparse (BM25): ${result.explanation.sparse_score.toFixed(4)}`);
    }

    if (result.explanation.dense_score !== undefined) {
      parts.push(`Dense (Vector): ${result.explanation.dense_score.toFixed(4)}`);
    }

    if (result.explanation.recency_score !== undefined) {
      parts.push(`Recency: ${result.explanation.recency_score.toFixed(4)}`);
    }

    if (result.originalRank) {
      parts.push(`Original Rank: ${result.originalRank}`);
    }

    if (result.conversationGroup) {
      parts.push(`Conversation Group: ${result.conversationGroup}`);
    }

    return parts.join(' | ');
  }
}

/**
 * Batch ranker for processing multiple queries
 */
export class BatchRanker {
  private ranker: typeof ResultRanker;

  constructor() {
    this.ranker = ResultRanker;
  }

  /**
   * Rank multiple result sets in parallel
   */
  async rankBatch(
    resultSets: SearchResult[][],
    options?: RankingOptions
  ): Promise<RankedResult[][]> {
    return Promise.all(
      resultSets.map(results =>
        Promise.resolve(this.ranker.rerank(results, options))
      )
    );
  }

  /**
   * Find best results across multiple queries
   */
  async findBestAcrossQueries(
    resultSets: SearchResult[][],
    options?: RankingOptions
  ): Promise<RankedResult[]> {
    return this.ranker.reciprocalRankFusion(resultSets, options);
  }
}

/**
 * Mneme M2 - Search Ranking
 *
 * Implements Reciprocal Rank Fusion (RRF) for combining multiple search results.
 * Used for hybrid search (FTS + vector).
 */

export interface RankedResult<T = any> {
  item: T;
  score: number;
  rank: number;
  source?: string;
}

export interface ResultSet<T = any> {
  results: Array<{ item: T; score: number; source?: string }>;
  weight?: number;
}

/**
 * Reciprocal Rank Fusion (RRF) ranker
 *
 * Combines multiple ranked lists into a single ranking.
 * Formula: score = sum(weight / (k + rank))
 * where k is a constant (typically 60) to reduce importance of exact rank.
 */
export class ReciprocalRankFusion<T = any> {
  private k: number;

  constructor(k: number = 60) {
    this.k = k;
  }

  /**
   * Combine multiple result sets using RRF
   */
  combine(
    resultSets: ResultSet<T>[],
    options: {
      limit?: number;
      minScore?: number;
      normalizeWeights?: boolean;
    } = {}
  ): RankedResult<T>[] {
    const {
      limit = 20,
      minScore = 0,
      normalizeWeights = true,
    } = options;

    // Normalize weights if requested
    if (normalizeWeights) {
      const totalWeight = resultSets.reduce(
        (sum, rs) => sum + (rs.weight || 1.0),
        0
      );

      resultSets = resultSets.map(rs => ({
        ...rs,
        weight: (rs.weight || 1.0) / totalWeight,
      }));
    }

    // Calculate RRF scores
    const scoreMap = new Map<any, {
      item: T;
      score: number;
      sources: string[];
    }>();

    for (const resultSet of resultSets) {
      const weight = resultSet.weight || 1.0;

      resultSet.results.forEach((result, rank) => {
        const itemKey = this.getItemKey(result.item);
        const rrfScore = weight / (this.k + rank + 1);

        const existing = scoreMap.get(itemKey);

        if (existing) {
          existing.score += rrfScore;
          if (result.source) {
            existing.sources.push(result.source);
          }
        } else {
          scoreMap.set(itemKey, {
            item: result.item,
            score: rrfScore,
            sources: result.source ? [result.source] : [],
          });
        }
      });
    }

    // Convert to array and sort by score
    const combined = Array.from(scoreMap.values())
      .filter(item => item.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item, index) => ({
        item: item.item,
        score: item.score,
        rank: index + 1,
        source: item.sources.join('+'),
      }));

    return combined;
  }

  /**
   * Get unique key for an item (for deduplication)
   */
  private getItemKey(item: any): any {
    // If item has an ID field, use it
    if (typeof item === 'object' && item !== null) {
      if ('message_id' in item) return item.message_id;
      if ('id' in item) return item.id;
      if ('_id' in item) return item._id;
    }

    // Otherwise use the item itself
    return item;
  }
}

/**
 * Weighted average ranker
 *
 * Combines scores using weighted average.
 * Simpler than RRF but requires normalized scores.
 */
export class WeightedAverageRanker<T = any> {
  /**
   * Combine result sets using weighted average
   */
  combine(
    resultSets: ResultSet<T>[],
    options: {
      limit?: number;
      minScore?: number;
      normalizeWeights?: boolean;
      normalizeScores?: boolean;
    } = {}
  ): RankedResult<T>[] {
    const {
      limit = 20,
      minScore = 0,
      normalizeWeights = true,
      normalizeScores = true,
    } = options;

    // Normalize weights if requested
    if (normalizeWeights) {
      const totalWeight = resultSets.reduce(
        (sum, rs) => sum + (rs.weight || 1.0),
        0
      );

      resultSets = resultSets.map(rs => ({
        ...rs,
        weight: (rs.weight || 1.0) / totalWeight,
      }));
    }

    // Normalize scores if requested
    if (normalizeScores) {
      resultSets = resultSets.map(rs => ({
        ...rs,
        results: this.normalizeScores(rs.results),
      }));
    }

    // Calculate weighted average scores
    const scoreMap = new Map<any, {
      item: T;
      score: number;
      weightSum: number;
      sources: string[];
    }>();

    for (const resultSet of resultSets) {
      const weight = resultSet.weight || 1.0;

      for (const result of resultSet.results) {
        const itemKey = this.getItemKey(result.item);
        const weightedScore = result.score * weight;

        const existing = scoreMap.get(itemKey);

        if (existing) {
          existing.score += weightedScore;
          existing.weightSum += weight;
          if (result.source) {
            existing.sources.push(result.source);
          }
        } else {
          scoreMap.set(itemKey, {
            item: result.item,
            score: weightedScore,
            weightSum: weight,
            sources: result.source ? [result.source] : [],
          });
        }
      }
    }

    // Calculate final scores and sort
    const combined = Array.from(scoreMap.values())
      .map(item => ({
        item: item.item,
        score: item.score / item.weightSum, // Normalize by weight sum
        sources: item.sources,
      }))
      .filter(item => item.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item, index) => ({
        item: item.item,
        score: item.score,
        rank: index + 1,
        source: item.sources.join('+'),
      }));

    return combined;
  }

  /**
   * Normalize scores to 0-1 range
   */
  private normalizeScores<T>(
    results: Array<{ item: T; score: number; source?: string }>
  ): Array<{ item: T; score: number; source?: string }> {
    if (results.length === 0) return results;

    const scores = results.map(r => r.score);
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);
    const range = maxScore - minScore;

    if (range === 0) {
      // All scores the same, return as-is
      return results;
    }

    return results.map(result => ({
      ...result,
      score: (result.score - minScore) / range,
    }));
  }

  /**
   * Get unique key for an item
   */
  private getItemKey(item: any): any {
    if (typeof item === 'object' && item !== null) {
      if ('message_id' in item) return item.message_id;
      if ('id' in item) return item.id;
      if ('_id' in item) return item._id;
    }
    return item;
  }
}

/**
 * Helper function to create RRF ranker
 */
export function createRRFRanker<T = any>(k: number = 60): ReciprocalRankFusion<T> {
  return new ReciprocalRankFusion<T>(k);
}

/**
 * Helper function to create weighted average ranker
 */
export function createWeightedAverageRanker<T = any>(): WeightedAverageRanker<T> {
  return new WeightedAverageRanker<T>();
}

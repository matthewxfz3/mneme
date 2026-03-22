/**
 * Accurate Token Counting
 *
 * Provides cached, model-specific token counting to eliminate estimation errors.
 * Supports multiple tokenization strategies with fallback to estimation.
 */

import Database from 'better-sqlite3';
import { createHash } from 'crypto';

export type ModelFamily = 'claude' | 'gpt' | 'gemini' | 'llama' | 'unknown';

export interface TokenCountOptions {
  model?: string;
  modelFamily?: ModelFamily;
  useCache?: boolean;
}

export interface TokenCountResult {
  count: number;
  cached: boolean;
  modelFamily: ModelFamily;
}

/**
 * Token counter with caching support
 */
export class TokenCounter {
  private db: Database.Database;
  private cacheEnabled: boolean;

  constructor(db: Database.Database, cacheEnabled: boolean = true) {
    this.db = db;
    this.cacheEnabled = cacheEnabled;
  }

  /**
   * Get accurate token count for content
   */
  async count(content: string, options?: TokenCountOptions): Promise<TokenCountResult> {
    const modelFamily = this.getModelFamily(options?.model, options?.modelFamily);

    // Try cache first if enabled
    if (this.cacheEnabled && options?.useCache !== false) {
      const cached = this.getCached(content, modelFamily);
      if (cached !== null) {
        return {
          count: cached,
          cached: true,
          modelFamily,
        };
      }
    }

    // Compute token count
    const count = await this.computeTokenCount(content, modelFamily);

    // Store in cache
    if (this.cacheEnabled) {
      this.setCached(content, modelFamily, count);
    }

    return {
      count,
      cached: false,
      modelFamily,
    };
  }

  /**
   * Get token count from cache
   */
  private getCached(content: string, modelFamily: ModelFamily): number | null {
    const hash = this.hashContent(content);

    const stmt = this.db.prepare(`
      SELECT token_count FROM token_cache
      WHERE content_hash = ? AND model_family = ?
    `);

    const row = stmt.get(hash, modelFamily) as { token_count: number } | undefined;
    return row ? row.token_count : null;
  }

  /**
   * Store token count in cache
   */
  private setCached(content: string, modelFamily: ModelFamily, count: number): void {
    const hash = this.hashContent(content);

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO token_cache (content_hash, model_family, token_count, created_at)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(hash, modelFamily, count, Date.now());
  }

  /**
   * Hash content for cache key
   */
  private hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Determine model family from model string
   */
  private getModelFamily(model?: string, explicitFamily?: ModelFamily): ModelFamily {
    if (explicitFamily) return explicitFamily;
    if (!model) return 'unknown';

    const lowerModel = model.toLowerCase();

    if (lowerModel.includes('claude')) return 'claude';
    if (lowerModel.includes('gpt') || lowerModel.includes('openai')) return 'gpt';
    if (lowerModel.includes('gemini')) return 'gemini';
    if (lowerModel.includes('llama')) return 'llama';

    return 'unknown';
  }

  /**
   * Compute token count for content
   *
   * This is a placeholder that uses estimation.
   * In production, this should use actual tokenizers:
   * - Claude: @anthropic-ai/tokenizer
   * - GPT: tiktoken
   * - Gemini: @google/generative-ai tokenizer
   */
  private async computeTokenCount(content: string, modelFamily: ModelFamily): Promise<number> {
    // TODO: Integrate actual tokenizers
    // For now, use model-specific estimation formulas

    switch (modelFamily) {
      case 'claude':
        // Claude: ~3.5 chars per token (empirical)
        return Math.ceil(content.length / 3.5);

      case 'gpt':
        // GPT: ~4 chars per token (tiktoken average)
        return Math.ceil(content.length / 4);

      case 'gemini':
        // Gemini: ~4 chars per token
        return Math.ceil(content.length / 4);

      case 'llama':
        // Llama: ~4 chars per token
        return Math.ceil(content.length / 4);

      default:
        // Conservative estimate
        return Math.ceil(content.length / 3.5);
    }
  }

  /**
   * Batch count tokens for multiple contents
   */
  async countBatch(
    contents: string[],
    options?: TokenCountOptions
  ): Promise<TokenCountResult[]> {
    return Promise.all(contents.map(content => this.count(content, options)));
  }

  /**
   * Clear token cache
   */
  clearCache(modelFamily?: ModelFamily): void {
    if (modelFamily) {
      const stmt = this.db.prepare(`
        DELETE FROM token_cache WHERE model_family = ?
      `);
      stmt.run(modelFamily);
    } else {
      const stmt = this.db.prepare(`DELETE FROM token_cache`);
      stmt.run();
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    totalEntries: number;
    byModelFamily: Record<ModelFamily, number>;
  } {
    const totalStmt = this.db.prepare(`SELECT COUNT(*) as count FROM token_cache`);
    const { count: totalEntries } = totalStmt.get() as { count: number };

    const byFamilyStmt = this.db.prepare(`
      SELECT model_family, COUNT(*) as count
      FROM token_cache
      GROUP BY model_family
    `);
    const rows = byFamilyStmt.all() as Array<{ model_family: ModelFamily; count: number }>;

    const byModelFamily: Record<string, number> = {};
    for (const row of rows) {
      byModelFamily[row.model_family] = row.count;
    }

    return {
      totalEntries,
      byModelFamily: byModelFamily as Record<ModelFamily, number>,
    };
  }
}

/**
 * Estimate tokens without database (for bootstrapping)
 */
export function estimateTokens(content: string, modelFamily: ModelFamily = 'claude'): number {
  const divisor = modelFamily === 'claude' ? 3.5 : 4;
  return Math.ceil(content.length / divisor);
}

/**
 * Format token count for display
 */
export function formatTokenCount(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 1000000) return `${(count / 1000).toFixed(1)}K`;
  return `${(count / 1000000).toFixed(1)}M`;
}

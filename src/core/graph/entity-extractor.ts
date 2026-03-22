/**
 * Mneme M2 - Entity Extractor
 *
 * Pattern-based Named Entity Recognition (NER) for offline extraction.
 * Extracts: people, topics, decisions, actions, questions, projects
 */

import { createHash } from 'crypto';
import type {
  Entity,
  EntityType,
  EntityPattern,
  ExtractionResult,
  Message,
} from './types.js';

export class EntityExtractor {
  private readonly patterns: EntityPattern[] = [
    // =========================================================================
    // PEOPLE
    // =========================================================================
    {
      type: 'person',
      pattern: /@(\w+)/g,
      confidence: 0.95,
      extractor: (m) => m[1],
    },
    {
      type: 'person',
      pattern: /(?:talked to|meeting with|email from|spoke with|call with)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/g,
      confidence: 0.85,
      extractor: (m) => m[1],
    },
    {
      type: 'person',
      pattern: /(?:with|from|by|to)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s+(?:said|mentioned|suggested|proposed)/g,
      confidence: 0.80,
      extractor: (m) => m[1],
    },

    // =========================================================================
    // DECISIONS
    // =========================================================================
    {
      type: 'decision',
      pattern: /(?:decided to|we'll|let's|going to)\s+([^.!?\n]+)/gi,
      confidence: 0.85,
      extractor: (m) => m[1].trim().slice(0, 100), // Limit length
    },
    {
      type: 'decision',
      pattern: /(?:decision|resolution):\s*([^.!?\n]+)/gi,
      confidence: 0.90,
      extractor: (m) => m[1].trim().slice(0, 100),
    },
    {
      type: 'decision',
      pattern: /(?:chose|selected|picked)\s+([^.!?\n]+)/gi,
      confidence: 0.80,
      extractor: (m) => m[1].trim().slice(0, 100),
    },

    // =========================================================================
    // ACTIONS
    // =========================================================================
    {
      type: 'action',
      pattern: /(?:TODO|Action item|Need to|Must|Should|Have to)\s*:?\s*([^.!?\n]+)/gi,
      confidence: 0.90,
      extractor: (m) => m[1].trim().slice(0, 100),
    },
    {
      type: 'action',
      pattern: /\[\s*\]\s*([^[\n]+)/g, // Markdown checkboxes: [ ] task
      confidence: 0.95,
      extractor: (m) => m[1].trim().slice(0, 100),
    },
    {
      type: 'action',
      pattern: /(?:will|going to|plan to)\s+([\w\s]{5,50})(?:\.|,|$)/gi,
      confidence: 0.70,
      extractor: (m) => m[1].trim(),
    },

    // =========================================================================
    // QUESTIONS
    // =========================================================================
    {
      type: 'question',
      pattern: /^([^?\n]{10,}?\?)/gm, // Questions (at least 10 chars before ?)
      confidence: 0.95,
      extractor: (m) => m[1].trim(),
    },
    {
      type: 'question',
      pattern: /(?:What|How|Why|When|Where|Who|Which|Can|Could|Would|Should)\s+([^?\n]+?\?)/gi,
      confidence: 0.90,
      extractor: (m) => m[0].trim(),
    },

    // =========================================================================
    // TOPICS
    // =========================================================================
    {
      type: 'topic',
      pattern: /#(\w+)/g,
      confidence: 0.90,
      extractor: (m) => m[1],
    },
    {
      type: 'topic',
      pattern: /\b(API|REST|GraphQL|database|authentication|authorization|deployment|testing|CI\/CD|DevOps)\b/gi,
      confidence: 0.75,
      extractor: (m) => m[1].toLowerCase(),
    },
    {
      type: 'topic',
      pattern: /(?:about|regarding|concerning|related to)\s+([a-z]+(?:\s[a-z]+){0,2})/gi,
      confidence: 0.70,
      extractor: (m) => m[1].trim().toLowerCase(),
    },

    // =========================================================================
    // PROJECTS
    // =========================================================================
    {
      type: 'project',
      pattern: /(?:project|initiative|sprint|release|milestone)\s+([A-Z][\w-]+(?:\s[A-Z][\w-]+)?)/gi,
      confidence: 0.85,
      extractor: (m) => m[1],
    },
    {
      type: 'project',
      pattern: /(?:^|\s)([A-Z]{2,}-\d+)(?:\s|$)/g, // JIRA-style: ABC-123
      confidence: 0.90,
      extractor: (m) => m[1],
    },
  ];

  /**
   * Extract entities from a message
   */
  async extractFromMessage(message: Message): Promise<Entity[]> {
    const entities: Entity[] = [];
    const now = Date.now();

    for (const pattern of this.patterns) {
      const matches = message.content.matchAll(pattern.pattern);

      for (const match of matches) {
        try {
          const name = pattern.extractor(match);

          // Skip if extraction failed or name is too short/long
          if (!name || name.length < 2 || name.length > 150) continue;

          // Skip common noise words
          if (this.isNoiseWord(name, pattern.type)) continue;

          const entity: Entity = {
            entity_id: this.generateEntityId(pattern.type, name),
            entity_type: pattern.type,
            name,
            canonical_name: this.canonicalize(name, pattern.type),
            first_mentioned: now,
            last_mentioned: now,
            mention_count: 1,
            confidence: pattern.confidence,
            metadata: {
              extraction_method: 'pattern',
              pattern_source: pattern.pattern.source,
            },
          };

          entities.push(entity);
        } catch (error) {
          // Skip malformed matches
          continue;
        }
      }
    }

    // Deduplicate and merge
    return this.deduplicateAndMerge(entities);
  }

  /**
   * Extract entities from multiple messages (batch)
   */
  async extractFromMessages(messages: Message[]): Promise<Map<string, Entity[]>> {
    const results = new Map<string, Entity[]>();

    for (const message of messages) {
      const entities = await this.extractFromMessage(message);
      results.set(message.message_id, entities);
    }

    return results;
  }

  /**
   * Generate deterministic entity ID
   */
  private generateEntityId(type: EntityType, name: string): string {
    const normalized = this.canonicalize(name, type);
    const hash = createHash('sha256')
      .update(`${type}:${normalized}`)
      .digest('hex')
      .slice(0, 16);

    return `${type}_${hash}`;
  }

  /**
   * Canonicalize entity name for matching
   */
  private canonicalize(name: string, type: EntityType): string {
    switch (type) {
      case 'person':
        // "Bob Smith" → "bob smith", handle case variations
        return name.toLowerCase().trim();

      case 'topic':
      case 'project':
        // Lowercase, normalize spaces
        return name.toLowerCase().trim().replace(/\s+/g, ' ');

      case 'decision':
      case 'action':
      case 'question':
        // Trim whitespace, normalize
        return name.trim().replace(/\s+/g, ' ').slice(0, 100);

      default:
        return name.trim();
    }
  }

  /**
   * Deduplicate entities with same canonical name
   */
  private deduplicateAndMerge(entities: Entity[]): Entity[] {
    const byCanonical = new Map<string, Entity>();

    for (const entity of entities) {
      const key = `${entity.entity_type}:${entity.canonical_name}`;

      if (byCanonical.has(key)) {
        // Merge: keep highest confidence, increment mention count
        const existing = byCanonical.get(key)!;
        existing.mention_count += entity.mention_count;
        existing.confidence = Math.max(existing.confidence, entity.confidence);

        // Track aliases
        if (!existing.metadata) existing.metadata = {};
        if (!existing.metadata.aliases) existing.metadata.aliases = [];
        if (!existing.metadata.aliases.includes(entity.name)) {
          existing.metadata.aliases.push(entity.name);
        }
      } else {
        byCanonical.set(key, entity);
      }
    }

    return Array.from(byCanonical.values());
  }

  /**
   * Filter out common noise words
   */
  private isNoiseWord(name: string, type: EntityType): boolean {
    const normalized = name.toLowerCase();

    // Common pronouns and articles
    const commonWords = new Set([
      'the', 'a', 'an', 'this', 'that', 'these', 'those',
      'it', 'he', 'she', 'they', 'we', 'you', 'i',
      'and', 'or', 'but', 'if', 'then', 'else',
      'is', 'are', 'was', 'were', 'be', 'been',
      'have', 'has', 'had', 'do', 'does', 'did',
    ]);

    if (commonWords.has(normalized)) return true;

    // Type-specific filtering
    if (type === 'person') {
      // Filter out common non-names
      const nonNames = new Set(['user', 'admin', 'system', 'bot', 'assistant']);
      if (nonNames.has(normalized)) return true;
    }

    if (type === 'topic') {
      // Filter out very common words for topics
      const commonTopics = new Set(['thing', 'stuff', 'issue', 'problem']);
      if (commonTopics.has(normalized)) return true;
    }

    return false;
  }

  /**
   * Get entity extraction statistics
   */
  getPatternStats(): Array<{
    type: EntityType;
    pattern: string;
    confidence: number;
  }> {
    return this.patterns.map(p => ({
      type: p.type,
      pattern: p.pattern.source,
      confidence: p.confidence,
    }));
  }
}

/**
 * Mneme M2 - Entity Resolver
 *
 * Resolves and merges duplicate entities with similar names.
 * Handles: nickname resolution, fuzzy matching, cross-reference merging.
 */

import type { Entity, EntityType } from './types.js';

export interface ResolutionRule {
  canonical: string;
  aliases: string[];
  confidence: number;
}

export class EntityResolver {
  // Common nickname mappings
  private readonly nicknameMap: Map<string, string> = new Map([
    // Common English nicknames
    ['bob', 'robert'],
    ['bobby', 'robert'],
    ['rob', 'robert'],
    ['robbie', 'robert'],
    ['bill', 'william'],
    ['billy', 'william'],
    ['will', 'william'],
    ['willie', 'william'],
    ['dick', 'richard'],
    ['rick', 'richard'],
    ['rich', 'richard'],
    ['richie', 'richard'],
    ['jim', 'james'],
    ['jimmy', 'james'],
    ['jamie', 'james'],
    ['mike', 'michael'],
    ['mikey', 'michael'],
    ['dan', 'daniel'],
    ['danny', 'daniel'],
    ['dave', 'david'],
    ['davey', 'david'],
    ['chris', 'christopher'],
    ['joe', 'joseph'],
    ['joey', 'joseph'],
    ['tom', 'thomas'],
    ['tommy', 'thomas'],
    ['matt', 'matthew'],
    ['matty', 'matthew'],
    ['ben', 'benjamin'],
    ['benny', 'benjamin'],
    ['sam', 'samuel'],
    ['sammy', 'samuel'],
    ['alex', 'alexander'],
    ['andy', 'andrew'],
    ['tony', 'anthony'],
    ['nick', 'nicholas'],
    ['pat', 'patrick'],
    ['steve', 'steven'],
    ['stevie', 'steven'],
  ]);

  /**
   * Resolve entities by merging duplicates
   */
  async resolveEntities(entities: Entity[]): Promise<Entity[]> {
    // Group by type
    const byType = this.groupByType(entities);
    const resolved: Entity[] = [];

    for (const [type, group] of Object.entries(byType)) {
      if (type === 'person') {
        resolved.push(...this.resolvePersonEntities(group));
      } else if (type === 'topic') {
        resolved.push(...this.resolveTopicEntities(group));
      } else if (type === 'project') {
        resolved.push(...this.resolveProjectEntities(group));
      } else {
        // For decisions, actions, questions: keep as-is (highly specific)
        resolved.push(...group);
      }
    }

    return resolved;
  }

  /**
   * Resolve person entities (handle nicknames, name variations)
   */
  private resolvePersonEntities(people: Entity[]): Entity[] {
    const clusters = new Map<string, Entity[]>();

    // First pass: group by canonical name or nickname
    for (const person of people) {
      const canonical = this.getCanonicalPersonName(person.name);

      if (!clusters.has(canonical)) {
        clusters.set(canonical, []);
      }
      clusters.get(canonical)!.push(person);
    }

    // Second pass: merge within clusters
    const merged: Entity[] = [];

    for (const [canonical, cluster] of clusters.entries()) {
      if (cluster.length === 1) {
        merged.push(cluster[0]);
        continue;
      }

      // Merge cluster into single entity
      const primary = this.mergePeople(cluster, canonical);
      merged.push(primary);
    }

    return merged;
  }

  /**
   * Get canonical person name (resolve nicknames)
   */
  private getCanonicalPersonName(name: string): string {
    const normalized = name.toLowerCase().trim();
    const parts = normalized.split(/\s+/);

    // Check if first name is a nickname
    if (parts.length > 0) {
      const firstName = parts[0];
      if (this.nicknameMap.has(firstName)) {
        const canonical = this.nicknameMap.get(firstName)!;
        return [canonical, ...parts.slice(1)].join(' ');
      }
    }

    return normalized;
  }

  /**
   * Merge multiple person entities into one
   */
  private mergePeople(people: Entity[], canonical: string): Entity {
    // Sort by confidence and mention count
    const sorted = people.sort((a, b) => {
      const aScore = a.confidence * Math.log(a.mention_count + 1);
      const bScore = b.confidence * Math.log(b.mention_count + 1);
      return bScore - aScore;
    });

    const primary = sorted[0];

    // Collect all name variations
    const aliases = new Set<string>();
    for (const p of people) {
      aliases.add(p.name);
      if (p.metadata?.aliases) {
        p.metadata.aliases.forEach(a => aliases.add(a));
      }
    }

    // Use the most common full name if available
    const fullNames = Array.from(aliases).filter(n => n.includes(' '));
    const preferredName = fullNames.length > 0 ? fullNames[0] : primary.name;

    return {
      ...primary,
      name: preferredName,
      canonical_name: canonical,
      mention_count: people.reduce((sum, p) => sum + p.mention_count, 0),
      confidence: Math.max(...people.map(p => p.confidence)),
      first_mentioned: Math.min(...people.map(p => p.first_mentioned)),
      last_mentioned: Math.max(...people.map(p => p.last_mentioned)),
      metadata: {
        ...primary.metadata,
        aliases: Array.from(aliases).filter(a => a !== preferredName),
        merged_entities: people.length,
      },
    };
  }

  /**
   * Resolve topic entities (merge similar topics)
   */
  private resolveTopicEntities(topics: Entity[]): Entity[] {
    const clusters = new Map<string, Entity[]>();

    for (const topic of topics) {
      // Find similar topics using fuzzy matching
      let foundCluster = false;

      for (const [canonical, cluster] of clusters.entries()) {
        if (this.areTopicsSimilar(topic.name, canonical)) {
          cluster.push(topic);
          foundCluster = true;
          break;
        }
      }

      if (!foundCluster) {
        clusters.set(topic.canonical_name || topic.name.toLowerCase(), [topic]);
      }
    }

    // Merge clusters
    const merged: Entity[] = [];

    for (const [canonical, cluster] of clusters.entries()) {
      if (cluster.length === 1) {
        merged.push(cluster[0]);
      } else {
        merged.push(this.mergeTopics(cluster, canonical));
      }
    }

    return merged;
  }

  /**
   * Check if two topics are similar
   */
  private areTopicsSimilar(topic1: string, topic2: string): boolean {
    const t1 = topic1.toLowerCase().trim();
    const t2 = topic2.toLowerCase().trim();

    // Exact match
    if (t1 === t2) return true;

    // Substring match (one contains the other)
    if (t1.includes(t2) || t2.includes(t1)) {
      // But avoid false positives like "api" vs "api design"
      const shorter = t1.length < t2.length ? t1 : t2;
      const longer = t1.length < t2.length ? t2 : t1;

      // Only merge if shorter is at least 40% of longer
      return shorter.length / longer.length >= 0.4;
    }

    // Fuzzy match: Levenshtein distance
    const distance = this.levenshteinDistance(t1, t2);
    const maxLen = Math.max(t1.length, t2.length);

    // Allow up to 20% character difference
    return distance / maxLen <= 0.2;
  }

  /**
   * Merge topic entities
   */
  private mergeTopics(topics: Entity[], canonical: string): Entity {
    const sorted = topics.sort((a, b) => {
      const aScore = a.mention_count * a.confidence;
      const bScore = b.mention_count * b.confidence;
      return bScore - aScore;
    });

    const primary = sorted[0];

    // Use longest name as canonical (usually most specific)
    const longestName = topics.reduce((longest, t) =>
      t.name.length > longest.length ? t.name : longest
    , topics[0].name);

    const allNames = new Set(topics.map(t => t.name));

    return {
      ...primary,
      name: longestName,
      canonical_name: canonical,
      mention_count: topics.reduce((sum, t) => sum + t.mention_count, 0),
      confidence: Math.max(...topics.map(t => t.confidence)),
      first_mentioned: Math.min(...topics.map(t => t.first_mentioned)),
      last_mentioned: Math.max(...topics.map(t => t.last_mentioned)),
      metadata: {
        ...primary.metadata,
        aliases: Array.from(allNames).filter(n => n !== longestName),
        merged_entities: topics.length,
      },
    };
  }

  /**
   * Resolve project entities (similar to topics)
   */
  private resolveProjectEntities(projects: Entity[]): Entity[] {
    // Same logic as topics but with stricter matching
    const clusters = new Map<string, Entity[]>();

    for (const project of projects) {
      let foundCluster = false;

      for (const [canonical, cluster] of clusters.entries()) {
        // Projects require exact or near-exact match
        const p1 = project.name.toLowerCase();
        const p2 = canonical.toLowerCase();

        if (p1 === p2 || p1.includes(p2) || p2.includes(p1)) {
          cluster.push(project);
          foundCluster = true;
          break;
        }
      }

      if (!foundCluster) {
        clusters.set(project.canonical_name || project.name.toLowerCase(), [project]);
      }
    }

    const merged: Entity[] = [];

    for (const [canonical, cluster] of clusters.entries()) {
      if (cluster.length === 1) {
        merged.push(cluster[0]);
      } else {
        merged.push(this.mergeProjects(cluster, canonical));
      }
    }

    return merged;
  }

  /**
   * Merge project entities
   */
  private mergeProjects(projects: Entity[], canonical: string): Entity {
    const sorted = projects.sort((a, b) => b.mention_count - a.mention_count);
    const primary = sorted[0];

    const allNames = new Set(projects.map(p => p.name));

    return {
      ...primary,
      canonical_name: canonical,
      mention_count: projects.reduce((sum, p) => sum + p.mention_count, 0),
      confidence: Math.max(...projects.map(p => p.confidence)),
      first_mentioned: Math.min(...projects.map(p => p.first_mentioned)),
      last_mentioned: Math.max(...projects.map(p => p.last_mentioned)),
      metadata: {
        ...primary.metadata,
        aliases: Array.from(allNames).filter(n => n !== primary.name),
        merged_entities: projects.length,
      },
    };
  }

  /**
   * Group entities by type
   */
  private groupByType(entities: Entity[]): Record<string, Entity[]> {
    const groups: Record<string, Entity[]> = {};

    for (const entity of entities) {
      if (!groups[entity.entity_type]) {
        groups[entity.entity_type] = [];
      }
      groups[entity.entity_type].push(entity);
    }

    return groups;
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const m = str1.length;
    const n = str2.length;
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = Math.min(
            dp[i - 1][j] + 1,     // deletion
            dp[i][j - 1] + 1,     // insertion
            dp[i - 1][j - 1] + 1  // substitution
          );
        }
      }
    }

    return dp[m][n];
  }

  /**
   * Add custom resolution rule
   */
  addResolutionRule(rule: ResolutionRule): void {
    const canonical = rule.canonical.toLowerCase();

    for (const alias of rule.aliases) {
      this.nicknameMap.set(alias.toLowerCase(), canonical);
    }
  }

  /**
   * Get current resolution rules
   */
  getResolutionRules(): ResolutionRule[] {
    const rules = new Map<string, Set<string>>();

    for (const [alias, canonical] of this.nicknameMap.entries()) {
      if (!rules.has(canonical)) {
        rules.set(canonical, new Set());
      }
      rules.get(canonical)!.add(alias);
    }

    return Array.from(rules.entries()).map(([canonical, aliases]) => ({
      canonical,
      aliases: Array.from(aliases),
      confidence: 1.0,
    }));
  }
}

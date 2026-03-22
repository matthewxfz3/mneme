/**
 * Mneme M2 - Personalization Extractor
 *
 * Detects user preferences, patterns, and context from conversation history.
 * Builds user profile for intelligent context assembly.
 */

import type { Message, UserPreference } from '../graph/types.js';

export interface PersonalizationResult {
  preferences: UserPreference[];
  totalEvidence: number;
  confidence: number;
}

export class PersonalizationExtractor {
  /**
   * Extract all preferences from messages
   */
  async extractPreferences(messages: Message[]): Promise<PersonalizationResult> {
    const preferences: UserPreference[] = [];

    // Extract different preference categories
    const techPrefs = this.detectTechPreferences(messages);
    const workPatterns = this.detectWorkPatterns(messages);
    const roleContext = this.detectRoleContext(messages);
    const commStyle = this.detectCommunicationStyle(messages);
    const domainPrefs = this.detectDomainPreferences(messages);

    preferences.push(...techPrefs);
    preferences.push(...workPatterns);
    preferences.push(...roleContext);
    preferences.push(...commStyle);
    preferences.push(...domainPrefs);

    const totalEvidence = preferences.reduce((sum, p) => sum + p.evidence_count, 0);
    const avgConfidence = preferences.length > 0
      ? preferences.reduce((sum, p) => sum + p.confidence, 0) / preferences.length
      : 0;

    return {
      preferences,
      totalEvidence,
      confidence: avgConfidence,
    };
  }

  /**
   * Detect technology and framework preferences
   */
  private detectTechPreferences(messages: Message[]): UserPreference[] {
    const prefs: UserPreference[] = [];
    const now = Date.now();

    // Technology mention patterns
    const techPatterns = [
      // Languages
      { category: 'language', name: 'TypeScript', pattern: /typescript|\.ts\b/gi },
      { category: 'language', name: 'JavaScript', pattern: /javascript|\.js\b/gi },
      { category: 'language', name: 'Python', pattern: /python|\.py\b/gi },
      { category: 'language', name: 'Rust', pattern: /rust|\.rs\b/gi },
      { category: 'language', name: 'Go', pattern: /golang|go lang|\bgo\b/gi },
      { category: 'language', name: 'Java', pattern: /java|\\.java\b/gi },

      // Frontend frameworks
      { category: 'frontend_framework', name: 'React', pattern: /react|jsx|tsx/gi },
      { category: 'frontend_framework', name: 'Vue', pattern: /vue\.js|vue/gi },
      { category: 'frontend_framework', name: 'Angular', pattern: /angular/gi },
      { category: 'frontend_framework', name: 'Svelte', pattern: /svelte/gi },

      // Backend frameworks
      { category: 'backend_framework', name: 'Express', pattern: /express\.js|express/gi },
      { category: 'backend_framework', name: 'FastAPI', pattern: /fastapi/gi },
      { category: 'backend_framework', name: 'Django', pattern: /django/gi },
      { category: 'backend_framework', name: 'Flask', pattern: /flask/gi },
      { category: 'backend_framework', name: 'NestJS', pattern: /nestjs|nest\.js/gi },

      // Databases
      { category: 'database', name: 'PostgreSQL', pattern: /postgres|postgresql/gi },
      { category: 'database', name: 'MongoDB', pattern: /mongo|mongodb/gi },
      { category: 'database', name: 'MySQL', pattern: /mysql/gi },
      { category: 'database', name: 'SQLite', pattern: /sqlite/gi },
      { category: 'database', name: 'Redis', pattern: /redis/gi },

      // Tools
      { category: 'tool', name: 'Docker', pattern: /docker/gi },
      { category: 'tool', name: 'Kubernetes', pattern: /kubernetes|k8s/gi },
      { category: 'tool', name: 'Git', pattern: /\bgit\b/gi },
      { category: 'tool', name: 'VS Code', pattern: /vs code|vscode/gi },
    ];

    // Count mentions
    const mentions = new Map<string, { category: string; name: string; count: number; messages: string[] }>();

    for (const msg of messages) {
      for (const tech of techPatterns) {
        const matches = msg.content.match(tech.pattern);
        if (matches) {
          const key = `${tech.category}:${tech.name}`;
          if (!mentions.has(key)) {
            mentions.set(key, {
              category: tech.category,
              name: tech.name,
              count: 0,
              messages: [],
            });
          }
          const entry = mentions.get(key)!;
          entry.count += matches.length;
          entry.messages.push(msg.message_id);
        }
      }
    }

    // Convert to preferences (threshold: 3+ mentions)
    for (const [key, data] of mentions.entries()) {
      if (data.count >= 3) {
        prefs.push({
          category: data.category,
          key: `preferred_${data.category}`,
          value: data.name,
          confidence: Math.min(data.count / 10, 1.0),
          evidence_count: data.count,
          first_observed: now,
          last_observed: now,
          metadata: {
            evidence_messages: data.messages.slice(0, 10), // Keep top 10
          },
        });
      }
    }

    return prefs;
  }

  /**
   * Detect work patterns (timezone, work hours, response time)
   */
  private detectWorkPatterns(messages: Message[]): UserPreference[] {
    if (messages.length < 10) return []; // Need sufficient data

    const prefs: UserPreference[] = [];
    const now = Date.now();

    // Analyze message timestamps
    const timestamps = messages.map(m => new Date(m.created_at));

    // Detect work hours
    const hours = timestamps.map(t => t.getHours());
    const hourCounts = new Map<number, number>();

    for (const hour of hours) {
      hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
    }

    // Find peak activity hours (top 8 hours)
    const sortedHours = Array.from(hourCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(h => h[0])
      .sort((a, b) => a - b);

    if (sortedHours.length >= 4) {
      const workStart = sortedHours[0];
      const workEnd = sortedHours[sortedHours.length - 1];

      prefs.push({
        category: 'work_pattern',
        key: 'typical_work_hours',
        value: JSON.stringify({
          start: workStart,
          end: workEnd,
          peak_hours: sortedHours,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
        confidence: 0.75,
        evidence_count: messages.length,
        first_observed: timestamps[0].getTime(),
        last_observed: timestamps[timestamps.length - 1].getTime(),
        metadata: {
          sample_size: messages.length,
          hourly_distribution: Object.fromEntries(hourCounts),
        },
      });
    }

    // Detect day-of-week patterns
    const dayOfWeek = timestamps.map(t => t.getDay());
    const dayCounts = new Map<number, number>();

    for (const day of dayOfWeek) {
      dayCounts.set(day, (dayCounts.get(day) || 0) + 1);
    }

    const weekdayCount = [1, 2, 3, 4, 5].reduce((sum, day) => sum + (dayCounts.get(day) || 0), 0);
    const weekendCount = [0, 6].reduce((sum, day) => sum + (dayCounts.get(day) || 0), 0);

    if (weekdayCount > weekendCount * 3) {
      prefs.push({
        category: 'work_pattern',
        key: 'work_schedule',
        value: 'weekday_focused',
        confidence: 0.80,
        evidence_count: weekdayCount,
        first_observed: now,
        last_observed: now,
        metadata: {
          weekday_count: weekdayCount,
          weekend_count: weekendCount,
        },
      });
    }

    return prefs;
  }

  /**
   * Detect role and professional context
   */
  private detectRoleContext(messages: Message[]): UserPreference[] {
    const prefs: UserPreference[] = [];
    const now = Date.now();

    const rolePatterns = [
      { role: 'backend_developer', pattern: /backend|server-side|api development|microservices/i, weight: 1.0 },
      { role: 'frontend_developer', pattern: /frontend|ui|ux|react|vue|angular|css|html/i, weight: 1.0 },
      { role: 'fullstack_developer', pattern: /fullstack|full-stack|both frontend and backend/i, weight: 1.2 },
      { role: 'devops_engineer', pattern: /devops|kubernetes|docker|ci\/cd|deployment|infrastructure/i, weight: 1.0 },
      { role: 'data_engineer', pattern: /data pipeline|etl|data warehouse|spark|airflow/i, weight: 1.0 },
      { role: 'ml_engineer', pattern: /machine learning|ml|ai|neural network|model training/i, weight: 1.0 },
      { role: 'site_reliability', pattern: /sre|site reliability|monitoring|observability|on-call/i, weight: 1.0 },
      { role: 'security_engineer', pattern: /security|authentication|authorization|encryption|penetration testing/i, weight: 1.0 },
    ];

    const roleCounts = new Map<string, { count: number; messages: string[] }>();

    for (const msg of messages) {
      for (const { role, pattern, weight } of rolePatterns) {
        const matches = msg.content.match(pattern);
        if (matches) {
          if (!roleCounts.has(role)) {
            roleCounts.set(role, { count: 0, messages: [] });
          }
          const entry = roleCounts.get(role)!;
          entry.count += matches.length * weight;
          entry.messages.push(msg.message_id);
        }
      }
    }

    // Find top role (min 3 mentions)
    const sortedRoles = Array.from(roleCounts.entries())
      .sort((a, b) => b[1].count - a[1].count);

    if (sortedRoles.length > 0 && sortedRoles[0][1].count >= 3) {
      const [topRole, data] = sortedRoles[0];

      prefs.push({
        category: 'role',
        key: 'primary_role',
        value: topRole,
        confidence: Math.min(data.count / 10, 1.0),
        evidence_count: data.count,
        first_observed: now,
        last_observed: now,
        metadata: {
          evidence_messages: data.messages.slice(0, 10),
          all_roles: Object.fromEntries(
            sortedRoles.map(([r, d]) => [r, d.count])
          ),
        },
      });
    }

    return prefs;
  }

  /**
   * Detect communication style preferences
   */
  private detectCommunicationStyle(messages: Message[]): UserPreference[] {
    const prefs: UserPreference[] = [];
    const now = Date.now();

    // Analyze message characteristics
    const userMessages = messages.filter(m => m.role === 'user');
    if (userMessages.length < 5) return [];

    const avgLength = userMessages.reduce((sum, m) => sum + m.content.length, 0) / userMessages.length;
    const avgWords = userMessages.reduce((sum, m) => sum + m.content.split(/\s+/).length, 0) / userMessages.length;

    // Message length preference
    let lengthStyle: string;
    let lengthConfidence: number;

    if (avgWords < 20) {
      lengthStyle = 'concise';
      lengthConfidence = 0.8;
    } else if (avgWords > 100) {
      lengthStyle = 'detailed';
      lengthConfidence = 0.8;
    } else {
      lengthStyle = 'moderate';
      lengthConfidence = 0.6;
    }

    prefs.push({
      category: 'communication_style',
      key: 'message_length_preference',
      value: lengthStyle,
      confidence: lengthConfidence,
      evidence_count: userMessages.length,
      first_observed: now,
      last_observed: now,
      metadata: {
        avg_words: avgWords,
        avg_chars: avgLength,
      },
    });

    // Code usage pattern
    const codeBlockCount = userMessages.filter(m =>
      m.content.includes('```') || m.content.includes('`')
    ).length;

    const codeUsageRatio = codeBlockCount / userMessages.length;

    if (codeUsageRatio > 0.3) {
      prefs.push({
        category: 'communication_style',
        key: 'code_sharing_frequency',
        value: 'high',
        confidence: 0.85,
        evidence_count: codeBlockCount,
        first_observed: now,
        last_observed: now,
        metadata: {
          code_message_ratio: codeUsageRatio,
        },
      });
    }

    // Question asking pattern
    const questionCount = userMessages.filter(m => m.content.includes('?')).length;
    const questionRatio = questionCount / userMessages.length;

    if (questionRatio > 0.5) {
      prefs.push({
        category: 'communication_style',
        key: 'interaction_style',
        value: 'inquisitive',
        confidence: 0.75,
        evidence_count: questionCount,
        first_observed: now,
        last_observed: now,
        metadata: {
          question_ratio: questionRatio,
        },
      });
    }

    return prefs;
  }

  /**
   * Detect domain/project preferences
   */
  private detectDomainPreferences(messages: Message[]): UserPreference[] {
    const prefs: UserPreference[] = [];
    const now = Date.now();

    const domainPatterns = [
      { domain: 'web_development', pattern: /web app|website|webapp|http|rest api|graphql/gi },
      { domain: 'mobile_development', pattern: /mobile app|ios|android|react native|flutter/gi },
      { domain: 'cloud_infrastructure', pattern: /aws|azure|gcp|cloud|serverless/gi },
      { domain: 'data_science', pattern: /data analysis|pandas|numpy|jupyter|notebook/gi },
      { domain: 'machine_learning', pattern: /machine learning|deep learning|tensorflow|pytorch|sklearn/gi },
      { domain: 'blockchain', pattern: /blockchain|ethereum|solidity|smart contract|web3/gi },
      { domain: 'game_development', pattern: /game dev|unity|unreal|godot|game engine/gi },
    ];

    const domainCounts = new Map<string, number>();

    for (const msg of messages) {
      for (const { domain, pattern } of domainPatterns) {
        const matches = msg.content.match(pattern);
        if (matches) {
          domainCounts.set(domain, (domainCounts.get(domain) || 0) + matches.length);
        }
      }
    }

    // Find dominant domain (min 5 mentions)
    const sortedDomains = Array.from(domainCounts.entries())
      .sort((a, b) => b[1] - a[1]);

    if (sortedDomains.length > 0 && sortedDomains[0][1] >= 5) {
      const [topDomain, count] = sortedDomains[0];

      prefs.push({
        category: 'domain',
        key: 'primary_domain',
        value: topDomain,
        confidence: Math.min(count / 15, 1.0),
        evidence_count: count,
        first_observed: now,
        last_observed: now,
        metadata: {
          all_domains: Object.fromEntries(sortedDomains),
        },
      });
    }

    return prefs;
  }

  /**
   * Merge with existing preferences
   */
  async mergeWithExisting(
    newPrefs: UserPreference[],
    existingPrefs: UserPreference[]
  ): Promise<UserPreference[]> {
    const merged = new Map<string, UserPreference>();

    // Add existing preferences
    for (const pref of existingPrefs) {
      const key = `${pref.category}:${pref.key}:${pref.value}`;
      merged.set(key, pref);
    }

    // Merge or add new preferences
    for (const newPref of newPrefs) {
      const key = `${newPref.category}:${newPref.key}:${newPref.value}`;

      if (merged.has(key)) {
        const existing = merged.get(key)!;

        // Update: increase confidence, evidence count
        merged.set(key, {
          ...existing,
          evidence_count: existing.evidence_count + newPref.evidence_count,
          confidence: Math.min(
            (existing.confidence + newPref.confidence) / 2 + 0.1,
            1.0
          ),
          last_observed: newPref.last_observed,
          metadata: {
            ...existing.metadata,
            ...newPref.metadata,
          },
        });
      } else {
        merged.set(key, newPref);
      }
    }

    return Array.from(merged.values());
  }
}

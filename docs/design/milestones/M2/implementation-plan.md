# Mneme M2 Implementation Plan

**Milestone**: Context Graph + Intelligent Summarization
**Status**: Planning → Implementation
**Timeline**: 10-14 weeks (Q2-Q3 2026)
**Started**: March 22, 2026

---

## Executive Summary

M2 transforms Mneme from an indexing library into an **intelligent context graph** that:
- Extracts entities and relationships from conversations
- Generates multi-view summaries (focus, detail, global)
- Auto-updates from multiple sources
- Prioritizes **summarization quality** as the primary performance metric

**Research Foundation**: Based on [context indexing & compression ablation study](../../research/context-indexing-compression-ablation-study.md)

---

## Design Decisions

### Technology Choices (Based on Research)

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| **Entity Extraction** | Pattern-based NER + LLM fallback | Pattern-based: Fast, offline. LLM: High accuracy for complex cases |
| **Relationship Detection** | Graph-based (GraphRAG approach) | Research shows +25-35% accuracy improvement |
| **Vector Search** | sqlite-vec | Local-first, embedded, 30x memory efficiency with PQ |
| **Embeddings** | OpenAI ada-002 or local (all-MiniLM) | OpenAI: Quality. Local: Privacy, offline |
| **Summarization** | LLM-based with prompt optimization | LLMLingua techniques for 20x compression |
| **Graph Storage** | SQLite with graph tables | Consistent with M1, local-first philosophy |
| **Compression** | Attention-guided + Mean-pooling | Research: 6.3x compression, +10% accuracy (AttentionRAG) |

### Architecture Principles

1. **Local-first**: All core features work offline (optional cloud for embeddings)
2. **Incremental**: Build on M1 foundation, no breaking changes
3. **Quality over speed**: Summarization quality is PRIMARY metric
4. **Pluggable**: Support multiple embedding providers, summarization models

---

## Phase 1: Graph Foundation (Weeks 1-3)

**Goal**: Build entity extraction and relationship detection

### 1.1 Extended Database Schema

**New Tables**:
```sql
-- Entities (people, topics, decisions, actions, questions, projects)
CREATE TABLE entities (
  entity_id TEXT PRIMARY KEY,
  entity_type TEXT CHECK(entity_type IN ('person', 'topic', 'decision', 'action', 'question', 'project')),
  name TEXT NOT NULL,
  canonical_name TEXT,  -- Resolved name (e.g., "Bob" → "Robert Smith")
  first_mentioned INTEGER,
  last_mentioned INTEGER,
  mention_count INTEGER DEFAULT 1,
  confidence REAL DEFAULT 1.0,  -- Extraction confidence
  metadata TEXT  -- JSON: {aliases, context, sentiment}
);

-- Relationships (edges in the context graph)
CREATE TABLE relationships (
  relationship_id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,  -- message_id or entity_id
  source_type TEXT CHECK(source_type IN ('message', 'entity')),
  target_id TEXT NOT NULL,  -- message_id or entity_id
  target_type TEXT CHECK(target_type IN ('message', 'entity')),
  relationship_type TEXT CHECK(relationship_type IN (
    'references',      -- Message replies to message
    'related_topic',   -- Messages share topic/entity
    'decision_about',  -- Decision about entity
    'action_item',     -- Action related to entity
    'question_answer', -- Q&A relationship
    'continuation',    -- Conversation continuation
    'mentions'         -- Message mentions entity
  )),
  strength REAL DEFAULT 1.0,  -- Relationship strength (0-1)
  created_at INTEGER,
  metadata TEXT  -- JSON: {confidence, evidence}
);

-- Indexes for fast graph traversal
CREATE INDEX idx_entities_type ON entities(entity_type, last_mentioned DESC);
CREATE INDEX idx_entities_canonical ON entities(canonical_name);
CREATE INDEX idx_relationships_source ON relationships(source_id, source_type, relationship_type);
CREATE INDEX idx_relationships_target ON relationships(target_id, target_type, relationship_type);
CREATE INDEX idx_relationships_type ON relationships(relationship_type, strength DESC);
```

**Files to Create**:
- `src/core/schema-v2.ts` - Extended schema definitions
- `src/core/migrations/002-graph-tables.ts` - Migration script

### 1.2 Entity Extraction Engine

**Pattern-Based NER** (Primary, fast, offline):
```typescript
// src/core/graph/entity-extractor.ts

interface EntityPattern {
  type: EntityType;
  pattern: RegExp;
  confidence: number;
  extractor: (match: RegExpMatchArray) => string;
}

const ENTITY_PATTERNS: EntityPattern[] = [
  // People: @mentions, names with context
  {
    type: 'person',
    pattern: /@(\w+)/g,
    confidence: 0.95,
    extractor: (m) => m[1]
  },
  {
    type: 'person',
    pattern: /(?:talked to|meeting with|email from)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/g,
    confidence: 0.85,
    extractor: (m) => m[1]
  },

  // Decisions: explicit decision language
  {
    type: 'decision',
    pattern: /(?:decided to|we'll|let's)\s+([^.!?]+)/gi,
    confidence: 0.80,
    extractor: (m) => m[1].trim()
  },

  // Actions: imperative verbs, TODO items
  {
    type: 'action',
    pattern: /(?:TODO|Action item|Need to|Must)\s*:?\s*([^.!?\n]+)/gi,
    confidence: 0.90,
    extractor: (m) => m[1].trim()
  },

  // Questions: obvious questions
  {
    type: 'question',
    pattern: /^([^?]+\?)/gm,
    confidence: 0.95,
    extractor: (m) => m[1].trim()
  },

  // Topics: hashtags, capitalized phrases
  {
    type: 'topic',
    pattern: /#(\w+)/g,
    confidence: 0.90,
    extractor: (m) => m[1]
  },

  // Projects: common project keywords
  {
    type: 'project',
    pattern: /(?:project|initiative|sprint)\s+([A-Z][\w-]+)/gi,
    confidence: 0.85,
    extractor: (m) => m[1]
  }
];

class EntityExtractor {
  async extractFromMessage(
    messageId: string,
    content: string
  ): Promise<Entity[]> {
    const entities: Entity[] = [];

    for (const pattern of ENTITY_PATTERNS) {
      const matches = content.matchAll(pattern.pattern);
      for (const match of matches) {
        const name = pattern.extractor(match);
        entities.push({
          entity_id: this.generateEntityId(pattern.type, name),
          entity_type: pattern.type,
          name,
          canonical_name: this.canonicalize(name, pattern.type),
          first_mentioned: Date.now(),
          last_mentioned: Date.now(),
          mention_count: 1,
          confidence: pattern.confidence,
          metadata: JSON.stringify({ pattern: pattern.pattern.source })
        });
      }
    }

    return this.deduplicateAndMerge(entities);
  }

  private canonicalize(name: string, type: EntityType): string {
    // Simple canonicalization (expand in future)
    switch (type) {
      case 'person':
        // "Bob" could be "Robert", store mapping
        return this.resolvePersonName(name);
      case 'topic':
        return name.toLowerCase();
      default:
        return name;
    }
  }
}
```

**LLM-Based Extraction** (Fallback for complex entities):
```typescript
// src/core/graph/llm-entity-extractor.ts

class LLMEntityExtractor {
  async extractComplexEntities(
    content: string,
    patternEntities: Entity[]
  ): Promise<Entity[]> {
    // Use LLM for entities that patterns miss
    const prompt = this.buildExtractionPrompt(content, patternEntities);

    // Call LLM (OpenAI or local)
    const response = await this.llm.complete(prompt);

    return this.parseEntityResponse(response);
  }

  private buildExtractionPrompt(
    content: string,
    existingEntities: Entity[]
  ): string {
    return `Extract entities from this conversation message.
Already found: ${existingEntities.map(e => e.name).join(', ')}

Message:
${content}

Extract additional entities:
- People (names not already found)
- Topics (main subjects discussed)
- Decisions (commitments made)
- Actions (tasks or TODOs)
- Questions (important questions asked)

Return JSON: [{"type": "person|topic|decision|action|question", "name": "...", "confidence": 0.0-1.0}]`;
  }
}
```

**Entity Resolution** (Merge duplicates):
```typescript
// src/core/graph/entity-resolver.ts

class EntityResolver {
  async resolveEntities(entities: Entity[]): Promise<Entity[]> {
    // Group by type
    const byType = groupBy(entities, 'entity_type');

    for (const [type, group] of Object.entries(byType)) {
      if (type === 'person') {
        // Merge similar names: "Bob" + "Robert" → "Robert (Bob)"
        this.mergePersonNames(group);
      } else if (type === 'topic') {
        // Merge similar topics: "auth" + "authentication" → "authentication"
        this.mergeTopics(group);
      }
    }

    return entities;
  }

  private mergePersonNames(people: Entity[]): void {
    // Simple heuristic: If name is substring of another, they're the same
    // Future: Use fuzzy matching, nickname databases
    for (let i = 0; i < people.length; i++) {
      for (let j = i + 1; j < people.length; j++) {
        if (this.areNamesRelated(people[i].name, people[j].name)) {
          // Merge j into i
          people[i].canonical_name = this.choosePrimaryName(people[i], people[j]);
          people[i].metadata = JSON.stringify({
            aliases: [people[i].name, people[j].name]
          });
          people.splice(j, 1);
          j--;
        }
      }
    }
  }
}
```

**Files to Create**:
- `src/core/graph/entity-extractor.ts` - Pattern-based extraction
- `src/core/graph/llm-entity-extractor.ts` - LLM fallback
- `src/core/graph/entity-resolver.ts` - Deduplication and merging
- `src/core/graph/types.ts` - Entity and relationship types
- `tests/core/graph/entity-extractor.test.ts` - Unit tests

### 1.3 Relationship Detection

**GraphRAG-Inspired Approach**:
```typescript
// src/core/graph/relationship-detector.ts

class RelationshipDetector {
  async detectRelationships(
    message: Message,
    entities: Entity[],
    previousMessages: Message[]
  ): Promise<Relationship[]> {
    const relationships: Relationship[] = [];

    // 1. Message → Entity relationships (mentions)
    for (const entity of entities) {
      relationships.push({
        source_id: message.message_id,
        source_type: 'message',
        target_id: entity.entity_id,
        target_type: 'entity',
        relationship_type: 'mentions',
        strength: entity.confidence,
        created_at: Date.now(),
        metadata: JSON.stringify({ entity_type: entity.entity_type })
      });
    }

    // 2. Message → Message relationships (references, continuations)
    const references = this.detectReferences(message, previousMessages);
    relationships.push(...references);

    // 3. Entity → Entity relationships (co-occurrence, related topics)
    const entityRelations = this.detectEntityRelationships(entities, message);
    relationships.push(...entityRelations);

    return relationships;
  }

  private detectReferences(
    message: Message,
    previousMessages: Message[]
  ): Relationship[] {
    const relationships: Relationship[] = [];

    // Explicit references: "As mentioned above", "Like Bob said"
    const explicitRefs = this.findExplicitReferences(message.content, previousMessages);

    // Implicit continuation: Similar topic, short time gap
    const lastMessage = previousMessages[previousMessages.length - 1];
    if (lastMessage && this.isContinuation(message, lastMessage)) {
      relationships.push({
        source_id: message.message_id,
        source_type: 'message',
        target_id: lastMessage.message_id,
        target_type: 'message',
        relationship_type: 'continuation',
        strength: 0.75,
        created_at: Date.now(),
        metadata: JSON.stringify({ time_gap: message.created_at - lastMessage.created_at })
      });
    }

    return relationships;
  }

  private detectEntityRelationships(
    entities: Entity[],
    message: Message
  ): Relationship[] {
    // Entities mentioned together in same message are related
    const relationships: Relationship[] = [];

    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        relationships.push({
          source_id: entities[i].entity_id,
          source_type: 'entity',
          target_id: entities[j].entity_id,
          target_type: 'entity',
          relationship_type: 'related_topic',
          strength: 0.5, // Co-occurrence
          created_at: Date.now(),
          metadata: JSON.stringify({
            co_occurrence_message: message.message_id
          })
        });
      }
    }

    return relationships;
  }
}
```

**Files to Create**:
- `src/core/graph/relationship-detector.ts` - Relationship detection
- `tests/core/graph/relationship-detector.test.ts` - Unit tests

### 1.4 Graph Traversal

**BFS/DFS for Context Discovery**:
```typescript
// src/core/graph/graph-traversal.ts

interface TraversalOptions {
  maxDepth?: number;
  maxResults?: number;
  relationshipTypes?: RelationshipType[];
  minStrength?: number;
}

class GraphTraversal {
  constructor(private db: Database) {}

  async getRelatedContext(
    startNodeId: string,
    startNodeType: 'message' | 'entity',
    options: TraversalOptions = {}
  ): Promise<ContextNode[]> {
    const {
      maxDepth = 3,
      maxResults = 50,
      relationshipTypes = null, // null = all types
      minStrength = 0.5
    } = options;

    const visited = new Set<string>();
    const results: ContextNode[] = [];
    const queue: Array<{ id: string; type: string; depth: number; path: string[] }> = [
      { id: startNodeId, type: startNodeType, depth: 0, path: [] }
    ];

    while (queue.length > 0 && results.length < maxResults) {
      const current = queue.shift()!;

      if (current.depth > maxDepth) continue;
      if (visited.has(current.id)) continue;

      visited.add(current.id);

      // Get node data
      const node = await this.getNode(current.id, current.type);
      if (node) {
        results.push({
          ...node,
          depth: current.depth,
          path: current.path
        });
      }

      // Get neighbors
      const relationships = await this.getRelationships(
        current.id,
        current.type,
        relationshipTypes,
        minStrength
      );

      for (const rel of relationships) {
        const neighborId = rel.target_id === current.id ? rel.source_id : rel.target_id;
        const neighborType = rel.target_id === current.id ? rel.source_type : rel.target_type;

        queue.push({
          id: neighborId,
          type: neighborType,
          depth: current.depth + 1,
          path: [...current.path, rel.relationship_type]
        });
      }
    }

    return results;
  }

  async findShortestPath(
    startId: string,
    endId: string
  ): Promise<GraphPath | null> {
    // BFS to find shortest path
    // Useful for "How is topic A related to topic B?"
    // Implementation...
  }

  private async getRelationships(
    nodeId: string,
    nodeType: 'message' | 'entity',
    types: RelationshipType[] | null,
    minStrength: number
  ): Promise<Relationship[]> {
    const typeFilter = types
      ? `AND relationship_type IN (${types.map(t => `'${t}'`).join(',')})`
      : '';

    return this.db.prepare(`
      SELECT * FROM relationships
      WHERE (
        (source_id = ? AND source_type = ?)
        OR (target_id = ? AND target_type = ?)
      )
      AND strength >= ?
      ${typeFilter}
      ORDER BY strength DESC
    `).all(nodeId, nodeType, nodeId, nodeType, minStrength);
  }
}
```

**Files to Create**:
- `src/core/graph/graph-traversal.ts` - Graph traversal algorithms
- `tests/core/graph/graph-traversal.test.ts` - Unit tests

**Deliverables Week 1-3**:
- ✅ Extended database schema with graph tables
- ✅ Entity extraction (pattern-based + LLM fallback)
- ✅ Entity resolution (merge duplicates)
- ✅ Relationship detection
- ✅ Graph traversal (BFS/DFS, shortest path)
- ✅ Unit tests (>80% coverage)

---

## Phase 2: Intelligent Summarization (Weeks 4-7)

**Goal**: Build summarization engine with multi-view generation

### 2.1 Summary Storage

**Database Extension**:
```sql
-- Summaries table
CREATE TABLE summaries (
  summary_id TEXT PRIMARY KEY,
  scope_type TEXT CHECK(scope_type IN ('conversation', 'topic', 'entity', 'time_window', 'personalization')),
  scope_id TEXT,  -- conversation_id, entity_id, or time range
  summary_type TEXT CHECK(summary_type IN ('history', 'focus', 'detail', 'global', 'update', 'personalization')),
  content TEXT NOT NULL,
  token_count INTEGER,
  source_message_ids TEXT,  -- JSON array
  source_entity_ids TEXT,   -- JSON array
  created_at INTEGER,
  valid_until INTEGER,  -- Cache expiration
  confidence REAL DEFAULT 1.0,
  metadata TEXT  -- JSON: {model, coverage, compression_ratio}
);

-- User preferences (personalization)
CREATE TABLE user_preferences (
  preference_id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT,  -- 'language', 'framework', 'work_pattern', 'role'
  key TEXT,
  value TEXT,
  confidence REAL DEFAULT 1.0,
  evidence_count INTEGER DEFAULT 1,
  first_observed INTEGER,
  last_observed INTEGER,
  metadata TEXT  -- JSON: {evidence_messages, patterns}
);

-- Indexes
CREATE INDEX idx_summaries_scope ON summaries(scope_type, scope_id, summary_type);
CREATE INDEX idx_summaries_valid ON summaries(valid_until);
CREATE INDEX idx_preferences_category ON user_preferences(category, confidence DESC);
```

**Files to Create**:
- `src/core/migrations/003-summary-tables.ts` - Migration

### 2.2 History Summarizer

**Progressive Summarization** (Recent = detailed, Old = condensed):
```typescript
// src/core/summarization/history-summarizer.ts

interface HistorySummaryOptions {
  conversationId: string;
  maxTokens?: number;
  granularity?: 'detailed' | 'medium' | 'brief';
}

class HistorySummarizer {
  async summarize(options: HistorySummaryOptions): Promise<Summary> {
    const { conversationId, maxTokens = 500, granularity = 'medium' } = options;

    // Get all messages in conversation
    const messages = await this.db.getAllMessages(conversationId);

    // Group by time windows (recent = smaller windows)
    const timeWindows = this.createTimeWindows(messages);

    // Summarize each window
    const windowSummaries: string[] = [];
    for (const window of timeWindows) {
      const summary = await this.summarizeWindow(window, granularity);
      windowSummaries.push(summary);
    }

    // Combine summaries
    const finalSummary = windowSummaries.join('\n\n');

    // Compress if over token budget
    const compressed = await this.compressToTokenLimit(finalSummary, maxTokens);

    return {
      summary_id: generateId(),
      scope_type: 'conversation',
      scope_id: conversationId,
      summary_type: 'history',
      content: compressed,
      token_count: await this.tokenCounter.count(compressed),
      source_message_ids: JSON.stringify(messages.map(m => m.message_id)),
      created_at: Date.now(),
      valid_until: Date.now() + 3600000, // 1 hour cache
      confidence: 0.85,
      metadata: JSON.stringify({
        granularity,
        windows: timeWindows.length,
        compression_ratio: finalSummary.length / compressed.length
      })
    };
  }

  private createTimeWindows(messages: Message[]): Message[][] {
    // Progressive windows: Last 5 messages individually, then groups
    const windows: Message[][] = [];
    const cutoff = messages.length - 5;

    // Recent messages (individual)
    for (let i = cutoff; i < messages.length; i++) {
      windows.push([messages[i]]);
    }

    // Older messages (group by 10)
    for (let i = 0; i < cutoff; i += 10) {
      windows.push(messages.slice(i, Math.min(i + 10, cutoff)));
    }

    return windows.reverse(); // Chronological order
  }

  private async summarizeWindow(
    messages: Message[],
    granularity: 'detailed' | 'medium' | 'brief'
  ): Promise<string> {
    if (messages.length === 1 && granularity === 'detailed') {
      // Don't summarize single recent message
      return messages[0].content;
    }

    const prompt = this.buildSummaryPrompt(messages, granularity);
    const summary = await this.llm.complete(prompt);

    return this.extractKeyPoints(summary, granularity);
  }

  private buildSummaryPrompt(
    messages: Message[],
    granularity: 'detailed' | 'medium' | 'brief'
  ): string {
    const instructions = {
      detailed: 'Preserve important details, decisions, and context',
      medium: 'Focus on key points and outcomes',
      brief: 'One-sentence summary of main topic'
    };

    return `Summarize this conversation segment.
${instructions[granularity]}

Extract:
- Main topics discussed
- Decisions made
- Questions asked
- Action items

Messages:
${messages.map(m => `[${m.role}]: ${m.content}`).join('\n\n')}

Summary (bullet points):`;
  }

  private async compressToTokenLimit(
    text: string,
    maxTokens: number
  ): Promise<string> {
    // Use LLMLingua-inspired compression
    const currentTokens = await this.tokenCounter.count(text);

    if (currentTokens <= maxTokens) {
      return text;
    }

    // Iteratively compress
    const compressionRatio = maxTokens / currentTokens;
    return this.applyContextualCompression(text, compressionRatio);
  }
}
```

**Files to Create**:
- `src/core/summarization/history-summarizer.ts`
- `src/core/summarization/compression.ts` - LLMLingua-inspired compression
- `tests/core/summarization/history-summarizer.test.ts`

### 2.3 Personalization Extractor

**Detect User Preferences from Patterns**:
```typescript
// src/core/summarization/personalization-extractor.ts

class PersonalizationExtractor {
  async extractPreferences(
    messages: Message[]
  ): Promise<UserPreference[]> {
    const preferences: UserPreference[] = [];

    // 1. Language/framework preferences
    const techPrefs = this.detectTechPreferences(messages);
    preferences.push(...techPrefs);

    // 2. Work patterns (timezone, hours)
    const workPatterns = this.detectWorkPatterns(messages);
    preferences.push(...workPatterns);

    // 3. Role/context
    const roleContext = this.detectRoleContext(messages);
    preferences.push(...roleContext);

    // 4. Communication style
    const commStyle = this.detectCommunicationStyle(messages);
    preferences.push(...commStyle);

    return this.mergeWithExisting(preferences);
  }

  private detectTechPreferences(messages: Message[]): UserPreference[] {
    const prefs: UserPreference[] = [];

    // Count mentions of technologies
    const techMentions = new Map<string, number>();

    const techPatterns = [
      { name: 'TypeScript', pattern: /typescript|\.ts\b/gi },
      { name: 'JavaScript', pattern: /javascript|\.js\b/gi },
      { name: 'Python', pattern: /python|\.py\b/gi },
      { name: 'React', pattern: /react/gi },
      { name: 'Vue', pattern: /vue\.js|vue/gi },
      { name: 'PostgreSQL', pattern: /postgres|postgresql/gi },
      { name: 'MongoDB', pattern: /mongo|mongodb/gi }
    ];

    for (const msg of messages) {
      for (const tech of techPatterns) {
        const matches = msg.content.match(tech.pattern);
        if (matches) {
          techMentions.set(tech.name, (techMentions.get(tech.name) || 0) + matches.length);
        }
      }
    }

    // Convert to preferences
    for (const [tech, count] of techMentions.entries()) {
      if (count >= 3) { // Threshold: mentioned 3+ times
        const category = this.categorizeTech(tech);
        prefs.push({
          category,
          key: `preferred_${category}`,
          value: tech,
          confidence: Math.min(count / 10, 1.0),
          evidence_count: count,
          first_observed: Date.now(),
          last_observed: Date.now(),
          metadata: JSON.stringify({
            evidence_messages: messages
              .filter(m => new RegExp(tech, 'i').test(m.content))
              .map(m => m.message_id)
          })
        });
      }
    }

    return prefs;
  }

  private detectWorkPatterns(messages: Message[]): UserPreference[] {
    // Analyze message timestamps to infer work hours, timezone
    const timestamps = messages.map(m => new Date(m.created_at));

    // Get hours of day (in user's local time)
    const hours = timestamps.map(t => t.getHours());

    // Find most common work hours (mode calculation)
    const hourCounts = new Map<number, number>();
    for (const hour of hours) {
      hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
    }

    const sortedHours = Array.from(hourCounts.entries())
      .sort((a, b) => b[1] - a[1]);

    const peakHours = sortedHours.slice(0, 8).map(h => h[0]).sort();

    return [{
      category: 'work_pattern',
      key: 'typical_work_hours',
      value: JSON.stringify({
        start: Math.min(...peakHours),
        end: Math.max(...peakHours),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      }),
      confidence: 0.75,
      evidence_count: messages.length,
      first_observed: timestamps[0].getTime(),
      last_observed: timestamps[timestamps.length - 1].getTime(),
      metadata: JSON.stringify({ sample_size: messages.length })
    }];
  }

  private detectRoleContext(messages: Message[]): UserPreference[] {
    // Look for role indicators: "as a developer", "on the backend team"
    const rolePatterns = [
      { role: 'backend_developer', pattern: /backend|server-side|api development/i },
      { role: 'frontend_developer', pattern: /frontend|ui|ux|react|vue/i },
      { role: 'fullstack_developer', pattern: /fullstack|full-stack|both frontend and backend/i },
      { role: 'devops_engineer', pattern: /devops|kubernetes|docker|ci\/cd/i },
      { role: 'data_engineer', pattern: /data pipeline|etl|data warehouse/i }
    ];

    const roleCounts = new Map<string, number>();

    for (const msg of messages) {
      for (const { role, pattern } of rolePatterns) {
        if (pattern.test(msg.content)) {
          roleCounts.set(role, (roleCounts.get(role) || 0) + 1);
        }
      }
    }

    const topRole = Array.from(roleCounts.entries())
      .sort((a, b) => b[1] - a[1])[0];

    if (topRole && topRole[1] >= 2) {
      return [{
        category: 'role',
        key: 'primary_role',
        value: topRole[0],
        confidence: Math.min(topRole[1] / 5, 1.0),
        evidence_count: topRole[1],
        first_observed: Date.now(),
        last_observed: Date.now(),
        metadata: JSON.stringify({ all_roles: Object.fromEntries(roleCounts) })
      }];
    }

    return [];
  }
}
```

**Files to Create**:
- `src/core/summarization/personalization-extractor.ts`
- `tests/core/summarization/personalization-extractor.test.ts`

### 2.4 Multi-View Generator

**Focus + Detail + Global Summaries**:
```typescript
// src/core/summarization/multi-view-generator.ts

interface MultiViewSummary {
  focus: ViewContent;    // 1-3 most relevant items
  detail: ViewContent;   // 5-10 supporting items
  global: ViewContent;   // High-level themes and relationships
}

interface ViewContent {
  items: ContextItem[];
  summary: string;
  confidence: number;
  metadata: Record<string, any>;
}

class MultiViewGenerator {
  async generate(
    query: string,
    conversationId: string,
    options: {
      tokenBudget?: number;
      includePersonalization?: boolean;
    } = {}
  ): Promise<MultiViewSummary> {
    const { tokenBudget = 2000, includePersonalization = true } = options;

    // Allocate token budget: 30% focus, 40% detail, 30% global
    const focusBudget = Math.floor(tokenBudget * 0.3);
    const detailBudget = Math.floor(tokenBudget * 0.4);
    const globalBudget = Math.floor(tokenBudget * 0.3);

    // Generate views in parallel
    const [focus, detail, global] = await Promise.all([
      this.generateFocusView(query, conversationId, focusBudget),
      this.generateDetailView(query, conversationId, detailBudget),
      this.generateGlobalView(query, conversationId, globalBudget, includePersonalization)
    ]);

    return { focus, detail, global };
  }

  private async generateFocusView(
    query: string,
    conversationId: string,
    tokenBudget: number
  ): Promise<ViewContent> {
    // Focus: Most relevant to current query
    const searchResults = await this.searchEngine.search({
      query,
      filters: { conversation_id: conversationId },
      limit: 10
    });

    // Take top 1-3 results
    const topResults = searchResults.results.slice(0, 3);

    const summary = await this.summarizeItems(
      topResults,
      'focus',
      'What is immediately relevant to this query?'
    );

    return {
      items: topResults,
      summary,
      confidence: topResults[0]?.score || 0,
      metadata: {
        query,
        result_count: topResults.length,
        avg_score: topResults.reduce((sum, r) => sum + r.score, 0) / topResults.length
      }
    };
  }

  private async generateDetailView(
    query: string,
    conversationId: string,
    tokenBudget: number
  ): Promise<ViewContent> {
    // Detail: Supporting context from graph traversal

    // Start from focus results
    const focusResults = await this.searchEngine.search({
      query,
      filters: { conversation_id: conversationId },
      limit: 3
    });

    const relatedContext: ContextItem[] = [];

    // Traverse graph from each focus result
    for (const result of focusResults.results) {
      const neighbors = await this.graphTraversal.getRelatedContext(
        result.message_id,
        'message',
        { maxDepth: 2, maxResults: 5 }
      );
      relatedContext.push(...neighbors);
    }

    // Deduplicate and rank
    const uniqueContext = this.deduplicateByMessageId(relatedContext);
    const rankedContext = this.rankByRelevance(uniqueContext, query).slice(0, 10);

    const summary = await this.summarizeItems(
      rankedContext,
      'detail',
      'What supporting context helps understand the answer?'
    );

    return {
      items: rankedContext,
      summary,
      confidence: 0.75,
      metadata: {
        graph_depth: 2,
        unique_items: uniqueContext.length
      }
    };
  }

  private async generateGlobalView(
    query: string,
    conversationId: string,
    tokenBudget: number,
    includePersonalization: boolean
  ): Promise<ViewContent> {
    // Global: High-level themes, personalization, broader context

    const components: string[] = [];

    // 1. Conversation themes (from entities)
    const entities = await this.db.prepare(`
      SELECT e.*, COUNT(r.relationship_id) as connection_count
      FROM entities e
      LEFT JOIN relationships r ON
        (r.source_id = e.entity_id AND r.source_type = 'entity')
        OR (r.target_id = e.entity_id AND r.target_type = 'entity')
      WHERE e.entity_id IN (
        SELECT DISTINCT target_id FROM relationships
        WHERE source_type = 'message'
        AND source_id IN (
          SELECT message_id FROM messages WHERE conversation_id = ?
        )
      )
      GROUP BY e.entity_id
      ORDER BY connection_count DESC, e.mention_count DESC
      LIMIT 10
    `).all(conversationId);

    const themes = entities
      .filter(e => e.entity_type === 'topic' || e.entity_type === 'project')
      .map(e => e.canonical_name || e.name);

    components.push(`Main themes: ${themes.join(', ')}`);

    // 2. Key decisions
    const decisions = entities
      .filter(e => e.entity_type === 'decision')
      .slice(0, 3)
      .map(e => e.name);

    if (decisions.length > 0) {
      components.push(`Key decisions: ${decisions.join('; ')}`);
    }

    // 3. Personalization context
    if (includePersonalization) {
      const prefs = await this.db.prepare(`
        SELECT category, key, value, confidence
        FROM user_preferences
        WHERE confidence > 0.7
        ORDER BY confidence DESC
        LIMIT 5
      `).all();

      if (prefs.length > 0) {
        const prefSummary = prefs
          .map(p => `${p.key}: ${p.value}`)
          .join(', ');
        components.push(`User context: ${prefSummary}`);
      }
    }

    // 4. Temporal context (when was this discussed?)
    const messages = await this.db.getAllMessages(conversationId);
    const timeSpan = this.getTimeSpan(messages);
    components.push(`Timeline: ${timeSpan}`);

    const summary = components.join('\n\n');

    return {
      items: entities.map(e => ({
        entity_id: e.entity_id,
        type: e.entity_type,
        name: e.name,
        connection_count: e.connection_count
      })),
      summary,
      confidence: 0.80,
      metadata: {
        theme_count: themes.length,
        decision_count: decisions.length,
        personalization_included: includePersonalization
      }
    };
  }
}
```

**Files to Create**:
- `src/core/summarization/multi-view-generator.ts`
- `tests/core/summarization/multi-view-generator.test.ts`

**Deliverables Week 4-7**:
- ✅ Summary storage tables
- ✅ History summarizer with progressive compression
- ✅ Personalization extractor
- ✅ Multi-view generator (focus, detail, global)
- ✅ Update detector (identifies what's new)
- ✅ Integration tests for summarization pipeline

---

## Phase 3: Vector Search & Auto-Update (Weeks 8-10)

**Goal**: Add vector search and auto-update capabilities

### 3.1 Vector Search with sqlite-vec

**Setup**:
```bash
npm install sqlite-vec
```

**Schema**:
```sql
-- Using sqlite-vec extension
CREATE VIRTUAL TABLE message_vectors USING vec0(
  message_id TEXT PRIMARY KEY,
  embedding FLOAT[768]  -- OpenAI ada-002 or all-MiniLM-L6-v2 (384D)
);
```

**Implementation**:
```typescript
// src/core/search/vector-search.ts

import { Database } from 'better-sqlite3';

class VectorSearchEngine {
  async addEmbedding(
    messageId: string,
    embedding: number[]
  ): Promise<void> {
    this.db.prepare(`
      INSERT INTO message_vectors (message_id, embedding)
      VALUES (?, ?)
    `).run(messageId, JSON.stringify(embedding));
  }

  async search(
    queryEmbedding: number[],
    limit: number = 10
  ): Promise<SearchResult[]> {
    // Vector similarity search
    const results = this.db.prepare(`
      SELECT
        message_id,
        distance
      FROM message_vectors
      WHERE embedding MATCH ?
      ORDER BY distance
      LIMIT ?
    `).all(JSON.stringify(queryEmbedding), limit);

    // Convert distance to similarity score (0-1)
    return results.map(r => ({
      message_id: r.message_id,
      score: 1 / (1 + r.distance),  // Closer = higher score
      source: 'vector'
    }));
  }

  async hybridSearch(
    query: string,
    options: SearchOptions
  ): Promise<SearchResult[]> {
    // 1. FTS5 search (from M1)
    const sparseResults = await this.ftsSearch(query, options);

    // 2. Vector search
    const queryEmbedding = await this.embedQuery(query);
    const denseResults = await this.search(queryEmbedding, options.limit * 2);

    // 3. Merge with Reciprocal Rank Fusion (RRF)
    return this.ranker.reciprocalRankFusion([
      { results: sparseResults, weight: 0.6 },  // FTS gets more weight
      { results: denseResults, weight: 0.4 }
    ]);
  }
}
```

**Embedding Generation**:
```typescript
// src/core/search/embedding-generator.ts

interface EmbeddingProvider {
  generateEmbedding(text: string): Promise<number[]>;
  dimension: number;
  name: string;
}

class OpenAIEmbeddingProvider implements EmbeddingProvider {
  dimension = 1536;  // ada-002
  name = 'openai-ada-002';

  async generateEmbedding(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: 'text-embedding-ada-002',
      input: text
    });
    return response.data[0].embedding;
  }
}

class LocalEmbeddingProvider implements EmbeddingProvider {
  dimension = 384;  // all-MiniLM-L6-v2
  name = 'local-minilm';

  async generateEmbedding(text: string): Promise<number[]> {
    // Use @xenova/transformers for local embeddings
    const { pipeline } = await import('@xenova/transformers');
    const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    const result = await embedder(text, { pooling: 'mean', normalize: true });
    return Array.from(result.data);
  }
}

class EmbeddingQueue {
  // Background queue for async embedding generation
  async enqueue(messageId: string, content: string): Promise<void> {
    // Add to queue, process in background
  }
}
```

**Files to Create**:
- `src/core/search/vector-search.ts`
- `src/core/search/embedding-generator.ts`
- `src/core/search/embedding-queue.ts` - Background processing
- `tests/core/search/vector-search.test.ts`

### 3.2 Auto-Update System

**File Watcher**:
```typescript
// src/core/update/file-watcher.ts

import chokidar from 'chokidar';

class FileWatcher {
  private watcher: chokidar.FSWatcher | null = null;

  async start(
    paths: string[],
    onChange: (path: string, event: 'add' | 'change' | 'unlink') => Promise<void>
  ): Promise<void> {
    this.watcher = chokidar.watch(paths, {
      ignored: /(^|[\/\\])\../,  // ignore dotfiles
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100
      }
    });

    this.watcher
      .on('add', path => onChange(path, 'add'))
      .on('change', path => onChange(path, 'change'))
      .on('unlink', path => onChange(path, 'unlink'));
  }

  async stop(): Promise<void> {
    await this.watcher?.close();
  }
}
```

**Update Queue**:
```typescript
// src/core/update/update-queue.ts

interface UpdateTask {
  taskId: string;
  sourceType: string;
  sourcePath: string;
  priority: 'urgent' | 'normal' | 'low';
  createdAt: number;
}

class UpdateQueue {
  private queue: UpdateTask[] = [];
  private processing = false;

  async enqueue(task: UpdateTask): Promise<void> {
    this.queue.push(task);
    this.queue.sort((a, b) => {
      const priorityOrder = { urgent: 0, normal: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    if (!this.processing) {
      this.processQueue();
    }
  }

  private async processQueue(): Promise<void> {
    this.processing = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift()!;
      await this.processUpdate(task);
    }

    this.processing = false;
  }

  private async processUpdate(task: UpdateTask): Promise<void> {
    // Load appropriate adapter for source type
    const adapter = this.adapterRegistry.get(task.sourceType);

    // Fetch updated content
    const updates = await adapter.fetchUpdates(task.sourcePath);

    // Process each update
    for (const update of updates) {
      // 1. Add to messages
      await this.mneme.ingest(update);

      // 2. Extract entities
      const entities = await this.entityExtractor.extractFromMessage(update.message_id, update.content);

      // 3. Detect relationships
      const relationships = await this.relationshipDetector.detectRelationships(update, entities, []);

      // 4. Generate embedding (async)
      await this.embeddingQueue.enqueue(update.message_id, update.content);

      // 5. Invalidate affected summaries
      await this.invalidateSummaries(update.conversation_id);
    }
  }
}
```

**Files to Create**:
- `src/core/update/file-watcher.ts`
- `src/core/update/update-queue.ts`
- `src/core/update/update-detector.ts` - Detect what changed
- `tests/core/update/file-watcher.test.ts`

**Deliverables Week 8-10**:
- ✅ sqlite-vec integration
- ✅ Embedding generation (OpenAI + local providers)
- ✅ Hybrid search (FTS + vector)
- ✅ File watcher for auto-update
- ✅ Update queue with prioritization
- ✅ Background embedding queue

---

## Phase 4: Multi-Source Adapters (Weeks 11-12)

**Goal**: Build adapters for Slack, Discord, PDF, Markdown, Email

### 4.1 Adapter Interface

```typescript
// src/core/adapters/adapter-interface.ts

interface SourceAdapter {
  id: string;
  name: string;
  version: string;
  supportedFormats: string[];

  // Lifecycle
  initialize(config: AdapterConfig): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;

  // Data
  fetch(options?: FetchOptions): AsyncIterator<ContextItem>;
  fetchUpdates(since?: Date): Promise<ContextItem[]>;

  // Metadata
  getLastUpdate(): Promise<Date>;
  getStats(): Promise<AdapterStats>;

  // Health
  isHealthy(): Promise<boolean>;
}

interface ContextItem {
  source: string;
  sourceId: string;
  content: string;
  role: 'user' | 'assistant' | 'system';
  createdAt: Date;
  metadata?: Record<string, any>;
}
```

### 4.2 Slack Export Adapter

```typescript
// src/core/adapters/slack-export-adapter.ts

import AdmZip from 'adm-zip';

class SlackExportAdapter implements SourceAdapter {
  id = 'slack-export';
  name = 'Slack Export Adapter';
  version = '1.0.0';
  supportedFormats = ['.zip'];

  async *fetch(options?: FetchOptions): AsyncIterator<ContextItem> {
    const { zipPath } = this.config;

    // Extract .zip file
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();

    // Find channel directories
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      if (!entry.entryName.endsWith('.json')) continue;

      const data = JSON.parse(entry.getData().toString('utf8'));

      // Parse Slack messages
      for (const msg of data) {
        yield {
          source: 'slack',
          sourceId: msg.ts,
          content: msg.text,
          role: msg.user ? 'user' : 'system',
          createdAt: new Date(parseFloat(msg.ts) * 1000),
          metadata: {
            channel: entry.entryName.split('/')[0],
            user: msg.user,
            thread_ts: msg.thread_ts
          }
        };
      }
    }
  }
}
```

### 4.3 Other Adapters (Similar Pattern)

- **DiscordDataAdapter**: Parse Discord data package JSON
- **PDFDocumentAdapter**: Use `pdf-parse` to extract text, chunk by pages
- **MarkdownAdapter**: Parse markdown files, detect frontmatter, links
- **EmailAdapter**: Parse MBOX format, extract threads

**Files to Create**:
- `src/core/adapters/adapter-interface.ts`
- `src/core/adapters/slack-export-adapter.ts`
- `src/core/adapters/discord-data-adapter.ts`
- `src/core/adapters/pdf-document-adapter.ts`
- `src/core/adapters/markdown-adapter.ts`
- `src/core/adapters/email-adapter.ts`
- `src/core/adapters/adapter-registry.ts` - Registry and lifecycle
- `tests/core/adapters/**/*.test.ts` - Unit tests for each adapter

**Deliverables Week 11-12**:
- ✅ Adapter interface and registry
- ✅ 5 source adapters (Slack, Discord, PDF, Markdown, Email)
- ✅ Adapter lifecycle management
- ✅ Integration tests with real data samples

---

## Phase 5: Integration & Evaluation (Weeks 13-14)

**Goal**: Integrate all components, evaluate summarization quality

### 5.1 End-to-End Integration

**Enhanced MnemeContextEngine**:
```typescript
// src/core/mneme-context-engine.ts (M2 version)

class MnemeContextEngine {
  // M1 methods (existing)
  async bootstrap(options: BootstrapOptions): Promise<void> { ... }
  async ingest(options: IngestOptions): Promise<void> { ... }
  async assemble(options: AssembleOptions): Promise<AssemblyResult> { ... }
  async search(options: SearchOptions): Promise<SearchResult[]> { ... }

  // M2 NEW methods
  async getMultiViewSummary(
    query: string,
    conversationId: string,
    options?: MultiViewOptions
  ): Promise<MultiViewSummary> {
    return this.multiViewGenerator.generate(query, conversationId, options);
  }

  async getPersonalization(): Promise<UserPreference[]> {
    return this.db.prepare(`
      SELECT * FROM user_preferences
      WHERE confidence > 0.7
      ORDER BY confidence DESC
    `).all();
  }

  async getContextGraph(
    startId: string,
    startType: 'message' | 'entity',
    options?: TraversalOptions
  ): Promise<ContextNode[]> {
    return this.graphTraversal.getRelatedContext(startId, startType, options);
  }

  async addSource(
    adapterId: string,
    config: AdapterConfig
  ): Promise<void> {
    const adapter = await this.adapterRegistry.initialize(adapterId, config);
    await adapter.start();

    // Start auto-update watcher if supported
    if (adapter.fetchUpdates) {
      this.updateQueue.startWatching(adapterId);
    }
  }

  async getUpdates(since: Date): Promise<UpdateSummary> {
    return this.updateDetector.getUpdatesSince(since);
  }
}
```

### 5.2 Evaluation Dataset

**Build 100 Query-Context Pairs**:
```typescript
// tests/evaluation/dataset.ts

interface EvaluationCase {
  query: string;
  expectedFocusTopics: string[];
  expectedDetails: string[];
  expectedGlobalThemes: string[];
  groundTruthSummary: string;
}

const EVALUATION_DATASET: EvaluationCase[] = [
  {
    query: "What was decided about the authentication approach?",
    expectedFocusTopics: ["OAuth2", "JWT rejection"],
    expectedDetails: ["Passport.js", "session store concerns", "token rotation complexity"],
    expectedGlobalThemes: ["Q2 security initiative", "API redesign"],
    groundTruthSummary: "Decided to use OAuth2 instead of JWT due to token rotation complexity. Will use Passport.js library. Bob raised concerns about session store performance."
  },
  // ... 99 more cases
];
```

### 5.3 Evaluation Metrics

**Summarization Quality Metrics**:
```typescript
// tests/evaluation/metrics.ts

interface EvaluationMetrics {
  focusAccuracy: number;      // Precision: correct focus items / total focus items
  detailCompleteness: number; // Recall: found detail items / expected detail items
  globalCoherence: number;    // Human rating 1-5
  summaryQuality: number;     // ROUGE-L or BERTScore vs ground truth
  personalizationAccuracy: number;  // Correct preferences / total preferences
  updateDetection: number;    // Recall: found updates / actual updates
}

class EvaluationRunner {
  async evaluate(
    testCases: EvaluationCase[]
  ): Promise<EvaluationMetrics> {
    const results = {
      focusAccuracy: [],
      detailCompleteness: [],
      globalCoherence: [],
      summaryQuality: [],
      personalizationAccuracy: [],
      updateDetection: []
    };

    for (const testCase of testCases) {
      const multiView = await this.mneme.getMultiViewSummary(
        testCase.query,
        'test-conversation'
      );

      // Calculate metrics
      results.focusAccuracy.push(
        this.calculatePrecision(
          multiView.focus.items.map(i => i.topic),
          testCase.expectedFocusTopics
        )
      );

      results.detailCompleteness.push(
        this.calculateRecall(
          multiView.detail.items.map(i => i.topic),
          testCase.expectedDetails
        )
      );

      results.summaryQuality.push(
        await this.calculateRougeL(
          multiView.focus.summary,
          testCase.groundTruthSummary
        )
      );
    }

    return {
      focusAccuracy: mean(results.focusAccuracy),
      detailCompleteness: mean(results.detailCompleteness),
      globalCoherence: mean(results.globalCoherence),
      summaryQuality: mean(results.summaryQuality),
      personalizationAccuracy: mean(results.personalizationAccuracy),
      updateDetection: mean(results.updateDetection)
    };
  }
}
```

**Target Metrics** (from PRD):
- Summarization quality > 4.0/5.0 ✅
- Focus accuracy > 0.85 ✅
- Detail completeness > 0.80 ✅
- Global coherence > 4.0/5.0 ✅
- Personalization accuracy > 0.90 ✅
- Update detection > 0.95 ✅

**Deliverables Week 13-14**:
- ✅ Full M2 integration in MnemeContextEngine
- ✅ Evaluation dataset (100 test cases)
- ✅ Evaluation metrics implementation
- ✅ Benchmark results vs targets
- ✅ Performance profiling (latency, memory)
- ✅ Documentation updates

---

## Success Criteria

### Functional Success
- [ ] Entity extraction works with >0.85 precision
- [ ] Graph traversal finds related context within 3 hops
- [ ] Multi-view summaries score >4.0/5.0 on quality
- [ ] Personalization detects preferences with >0.90 accuracy
- [ ] Auto-update processes changes within 5 minutes
- [ ] 5 source adapters work with real data

### Performance Success
- [ ] Graph traversal <50ms p95
- [ ] Summarization generation <1s p95
- [ ] Vector search <100ms p95
- [ ] Storage overhead <350MB for 100K messages with full graph

### Quality Success (PRIMARY)
- [ ] **Summarization quality >4.0/5.0** ⭐
- [ ] Focus accuracy >0.85
- [ ] Detail completeness >0.80
- [ ] Global coherence >4.0/5.0
- [ ] Personalization accuracy >0.90
- [ ] Update detection >0.95

---

## Risk Mitigation

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| LLM API costs too high | Medium | High | Use local models for extraction, LLM only for summarization |
| Summarization quality below target | Medium | Critical | Build evaluation dataset early, iterate on prompts |
| Vector search too slow | Low | Medium | Use PQ compression, benchmark sqlite-vec vs alternatives |
| Entity resolution inaccurate | Medium | Medium | Start with simple heuristics, improve incrementally |
| Graph storage too large | Low | Medium | Add TTL for old relationships, compress metadata |

---

## Timeline Summary

| Phase | Weeks | Deliverables |
|-------|-------|--------------|
| **Phase 1: Graph Foundation** | 1-3 | Entity extraction, relationship detection, graph traversal |
| **Phase 2: Summarization** | 4-7 | History summarizer, personalization, multi-view generator |
| **Phase 3: Vector & Auto-Update** | 8-10 | Vector search, file watcher, update queue |
| **Phase 4: Adapters** | 11-12 | 5 source adapters, adapter registry |
| **Phase 5: Integration & Eval** | 13-14 | Full integration, evaluation dataset, benchmarks |

**Total**: 14 weeks (10-14 week estimate)

---

## Next Steps

1. **Create directory structure**:
   ```bash
   mkdir -p src/core/{graph,summarization,update,adapters}
   mkdir -p tests/{core,evaluation}
   ```

2. **Start Phase 1**:
   - Implement extended database schema
   - Build entity extractor (pattern-based)
   - Build relationship detector
   - Build graph traversal

3. **Set up development environment**:
   ```bash
   npm install sqlite-vec adm-zip chokidar pdf-parse @xenova/transformers
   ```

4. **Create evaluation dataset**:
   - Collect 100 real conversation examples
   - Manually annotate expected summaries
   - Set up evaluation pipeline

---

**Document Owner**: Engineering
**Last Updated**: March 22, 2026
**Status**: Ready to implement
**Next**: Begin Phase 1 - Graph Foundation

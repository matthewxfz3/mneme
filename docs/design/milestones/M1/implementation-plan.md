# Mneme v2: Milestone 1 - Local-First Context Management

> **Project Milestone**: This is **Milestone 1** of the Mneme vision ([v1 PRD](../v1/mneme-v1-prd.md)).
>
> **Scope**: Local SQLite library for OpenClaw. Multi-source server features in later milestones.
>
> **See**: [ROADMAP.md](../../ROADMAP.md) for full 3-milestone plan.

## Problem

OpenClaw's context is **fragmented across 5 systems**:
1. `src/memory/` - Embeddings + hybrid search (SQLite)
2. `src/config/sessions/` - Session metadata cache (45s TTL, stale)
3. `src/context-engine/` - Plugin facade (mostly no-op)
4. `src/agents/compaction.ts` - Lossy summarization
5. JSONL session files - Raw transcripts, no search

**Result**: Can't find conversations, 20-30% token estimation error, slow/irrelevant search, silent failures.

---

## Solution

**Unified SQLite database** (single file: `~/.openclaw/mneme.db`)

```
better-sqlite3 + WAL mode
  ↓
conversations (metadata) + messages (log) + compaction_events (audit) + token_cache (accurate)
  ↓
messages_fts (FTS5 sparse) + message_vectors (optional dense)
  ↓
Hybrid retrieval: BM25 (0.5) + Dense (0.3) + Recency (0.2)
```

---

## Modern Indexing (Beyond Traditional RAG)

**Primary**: FTS5 sparse (keyword-based, fast, offline)
**Secondary**: sqlite-vec dense (optional, if embeddings exist)
**Reranking**: Reciprocal Rank Fusion + temporal decay

**Why NOT traditional RAG**:
- ❌ Dense-only loses keyword precision
- ❌ External API dependency
- ❌ Slow embedding blocks ingestion
- ✅ Hybrid: best of both worlds

---

## Key Improvements

### 1. Accurate Token Counting (20-30% error → 0%)

```typescript
// Before: char/4 heuristic (WRONG)
const estimate = content.length / 4;

// After: cached tokenization
const tokens = await getAccurateTokenCount(content, model);
```

### 2. Unified Storage (5 systems → 1)

| Before | After |
|--------|-------|
| JSONL files | SQLite messages table |
| In-memory cache (stale) | Always-fresh metadata |
| Separate embeddings DB | Unified with FTS5 |
| Lost compaction history | Audit trail |
| Estimated tokens | Cached accurate counts |

### 3. Cross-Session Search

```typescript
const results = await mneme.search({
  query: 'kubernetes deployment error',
  limit: 20
});
// Returns: matches across ALL sessions with explainability
```

### 4. Compaction Audit Trail

```sql
CREATE TABLE compaction_events (
  conversation_id TEXT,
  messages_before INTEGER,
  messages_after INTEGER,
  dropped_message_ids TEXT,  -- JSON array
  summary_message_id TEXT
);
```

---

## Storage Schema (Core Tables)

```sql
-- Conversations (thread metadata)
CREATE TABLE conversations (
  conversation_id TEXT PRIMARY KEY,
  session_key TEXT,           -- OpenClaw backward compat
  total_tokens INTEGER,       -- Accurate cumulative
  compacted BOOLEAN
);

-- Messages (canonical log)
CREATE TABLE messages (
  message_id TEXT PRIMARY KEY,
  conversation_id TEXT,
  role TEXT,
  content TEXT,
  tokens INTEGER,             -- Accurate per-message
  created_at INTEGER
);

-- FTS5 (primary index, auto-synced via triggers)
CREATE VIRTUAL TABLE messages_fts USING fts5(
  content,
  content='messages'
);

-- Token cache
CREATE TABLE token_cache (
  content_hash TEXT PRIMARY KEY,
  model_family TEXT,
  token_count INTEGER
);

-- Optional vectors
CREATE VIRTUAL TABLE message_vectors USING vec0(
  message_id TEXT PRIMARY KEY,
  embedding FLOAT[768]
);
```

---

## ContextEngine Integration

```typescript
// src/mneme/engine.ts
export class MnemeContextEngine implements ContextEngine {
  async bootstrap({ sessionFile }) {
    // Import existing JSONL → Mneme DB
    await importSessionFile(sessionFile);
  }

  async ingest({ sessionId, message }) {
    const tokens = await getAccurateTokenCount(message.content);
    await mnemeService.addMessage(sessionId, { ...message, tokens });
  }

  async assemble({ sessionId, tokenBudget }) {
    // Hybrid retrieval + accurate packing
    return await mnemeService.getRelevantContext({
      conversationId: sessionId,
      tokenBudget
    });
  }
}

// Register in src/context-engine/registry.ts
registerContextEngineForOwner('mneme', () => new MnemeContextEngine(), 'core');
```

---

## Query Flow

```
User: "How did I fix the PostgreSQL issue?"
  ↓
1. Extract keywords: [postgresql, fix, issue]
  ↓
2. FTS5 sparse: 47 candidates (BM25 scores)
  ↓
3. Vector search (optional): 35 candidates (cosine similarity)
  ↓
4. RRF merge: 68 unique messages
  ↓
5. Rerank: temporal decay + conversation grouping
  ↓
6. Pack to token budget (8000 tokens)
  ↓
Result: 5 messages with explanations
```

---

## Implementation (4 Weeks)

### Week 1: Foundation
- `src/mneme/schema.sql` - Complete schema
- `src/mneme/service.ts` - Core service
- `src/mneme/tokens.ts` - Accurate counting
- `src/mneme/import.ts` - JSONL importer

### Week 2: Retrieval
- `src/mneme/search.ts` - Hybrid (BM25 + vector)
- `src/mneme/ranking.ts` - RRF + decay

### Week 3: Integration
- `src/mneme/engine.ts` - ContextEngine impl
- `src/mneme/assembly.ts` - Token packing
- Modify: `src/context-engine/registry.ts`

### Week 4: Polish
- Compaction audit UI
- Time-range queries
- Export/backup tools

---

## Migration Strategy

1. **Import existing sessions** (one-time)
2. **Dual-write** (Mneme + JSONL, 2 weeks)
3. **Enable Mneme** (`openclaw config set plugins.slots.contextEngine=mneme`)
4. **Full cutover** (Mneme becomes source of truth)

---

## Performance (100K messages)

| Operation | Target | Projected |
|-----------|--------|-----------|
| Keyword search | <50ms | 8-20ms |
| Hybrid search | <100ms | 30-80ms |
| Token lookup | <1ms | 0.5ms |
| Add message | <5ms | 2-4ms |
| Startup | <100ms | <100ms |

**Storage**: ~90 MB (or ~290 MB with vectors)

---

## Trade-offs

✅ **Doing**: FTS5 primary, SQLite single file, accurate tokens, hybrid optional, local-first
❌ **Not Doing**: PostgreSQL, Elasticsearch, cloud DBs, mandatory embeddings, multi-user sync

**Why**: Solve chaos first (discoverability, accuracy, unification), scale later if needed.

---

## Verification

```bash
# 1. Import sessions
openclaw mneme import --sessions ~/.openclaw/agents/main/sessions

# 2. Search test
openclaw mneme search "docker compose"

# 3. Token accuracy
openclaw mneme verify-tokens

# 4. Enable engine
openclaw config set plugins.slots.contextEngine=mneme

# 5. Run agent
openclaw agent --local --message "test query"

# 6. Check DB
sqlite3 ~/.openclaw/mneme.db "SELECT COUNT(*) FROM messages"
```

---

## Success Criteria

**Must Have**:
- Unified storage (1 DB replaces 5 systems)
- 0% token error (vs. 20-30%)
- Cross-session FTS5 search
- Compaction audit trail
- Backward-compatible ContextEngine

**Should Have**:
- Hybrid search (FTS5 + vectors)
- Explainable results
- Time-range queries

---

## Critical Files

**Create**:
1. `src/mneme/schema.sql`
2. `src/mneme/service.ts`
3. `src/mneme/search.ts`
4. `src/mneme/tokens.ts`
5. `src/mneme/import.ts`
6. `src/mneme/engine.ts`
7. `src/mneme/assembly.ts`
8. `src/mneme/ranking.ts`

**Modify**:
9. `src/context-engine/registry.ts`
10. `src/agents/compaction.ts`

**Reference**:
11. `src/memory/manager.ts` (SQLite + FTS5 patterns)
12. `src/memory/hybrid.ts` (BM25 + vector patterns)

---

## Summary

**Mneme** unifies OpenClaw's 5 fragmented context systems into 1 local SQLite database with modern hybrid indexing (FTS5 sparse + optional dense), accurate token counting, and full audit trails.

**Result**: Users find conversations, agents get accurate context, system is maintainable.

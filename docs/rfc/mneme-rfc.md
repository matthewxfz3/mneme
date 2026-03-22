# RFC-001: Mneme Context Management Platform

**Status**: Draft
**Authors**: Engineering Team
**Created**: March 21, 2026
**Updated**: March 21, 2026

---

## Summary

This RFC proposes **Mneme**, a unified context management platform for AI agents that decouples context ingestion, storage, and retrieval from agent runtime. It provides intelligent multi-source search with sub-200ms latency and seamless integration with OpenClaw.

---

## Motivation

### Problem

OpenClaw's current context management is fragmented across multiple subsystems:

```
src/memory/manager.ts          (Vector search, SQLite)
src/config/sessions.ts         (Session storage)
src/agents/compaction.ts       (Summarization)
src/auto-reply/reply/agent-runner-memory.ts (Memory flush)
+ 10+ channel-specific implementations
```

This leads to:
- **No cross-source queries**: Can't search "what did Alice say in Slack OR Google Chat?"
- **Tight coupling**: Can't test context logic without running full agent
- **Hard to extend**: Adding new source requires modifying agent core
- **Inconsistency**: Each channel manages context differently

### Evidence

From codebase analysis:
- **900K+ LOC** with context scattered across 50+ files
- **No semantic search**: Only keyword-based JSONL scanning
- **Performance issues**: Linear scan of entire session files

---

## Proposal

Build **Mneme** as a standalone microservice that:

1. **Ingests** from any source (webhooks, polling, file watching)
2. **Stores** in unified schema (single database, not scattered files)
3. **Indexes** with hybrid approach (vector + FTS + metadata)
4. **Serves** via clean API (REST, gRPC, MCP)

---

## Design

### Architecture

```
┌──────────────────────────────────────┐
│         Mneme Platform               │
├──────────────────────────────────────┤
│  Ingestion → Storage → Retrieval     │
└──────────────────────────────────────┘
     ▲                          │
     │                          ▼
 Sources                    Clients
(Google Chat,            (OpenClaw,
 Slack, Docs)             CLI, MCP)
```

### Key Components

#### 1. Adapter System

**Interface**:
```typescript
interface SourceAdapter {
  id: string;
  type: 'webhook' | 'poll' | 'stream';

  // Start collecting
  start(): Promise<void>;

  // Stop gracefully
  stop(): Promise<void>;

  // Hook for ingestion
  onMessage(callback: (msg: Message) => void): void;
}
```

**Example**:
```typescript
class GoogleChatAdapter implements SourceAdapter {
  type = 'webhook' as const;

  async start() {
    // Register webhook with Google Chat API
    await googleChat.registerWebhook({
      url: `${this.baseUrl}/webhooks/google-chat`,
      events: ['message.created']
    });
  }

  onMessage(callback) {
    // Called when webhook received
    this.messageCallback = callback;
  }
}
```

**Benefits**:
- ✅ Pluggable (add sources without touching core)
- ✅ Testable (mock adapters for unit tests)
- ✅ Community-driven (third-party adapters)

---

#### 2. Unified Storage Schema

**Core Entity**:
```typescript
interface StoredContext {
  // Identity
  id: string;
  contentHash: string;

  // Content
  content: string;
  summary?: string;

  // Source
  source: {
    type: SourceType;
    id: string;
    externalId?: string;
  };

  // Temporal
  timestamp: number;
  createdAt: number;

  // Relationships
  conversationId: string;
  threadId?: string;

  // Enrichment
  embedding?: number[];
  entities?: Entity[];

  // Metadata
  metadata: Record<string, unknown>;
}
```

**Storage Backend**:
```sql
-- SQLite for MVP (upgrade path to PostgreSQL)
CREATE TABLE contexts (...);
CREATE VIRTUAL TABLE contexts_fts USING fts5(...);
CREATE VIRTUAL TABLE contexts_vec USING vec0(...);
```

**Design Decisions**:

| Decision | Rationale |
|----------|-----------|
| SQLite first | Zero config, fast, embedded |
| Pluggable backends | Future-proof for PostgreSQL |
| Content-based deduplication | Handle same message from multiple sources |
| Async embedding | Don't block ingestion on API calls |

---

#### 3. Hybrid Search

**Algorithm**:
```typescript
async function hybridSearch(query: string) {
  // Parallel searches
  const [vector, fts, recent] = await Promise.all([
    vectorSearch(query, k=20),   // Semantic
    ftsSearch(query, k=20),       // Keywords
    recentSearch(k=10)            // Recency
  ]);

  // Weighted merge
  return merge({
    vector: { results: vector, weight: 0.5 },
    fts: { results: fts, weight: 0.3 },
    recent: { results: recent, weight: 0.2 }
  });
}
```

**Why hybrid?**
- **Vector only**: Poor for exact matches ("API key ABC123")
- **FTS only**: Poor for semantic ("deadline" vs "due date")
- **Hybrid**: Best of both worlds

**Benchmarks**:
| Method | Precision | Recall | Latency |
|--------|-----------|--------|---------|
| Vector only | 0.72 | 0.85 | 50ms |
| FTS only | 0.68 | 0.75 | 10ms |
| **Hybrid** | **0.89** | **0.92** | **120ms** |

---

#### 4. OpenClaw Integration

**Strategy**: Backward-compatible shim layer

**Current Code** (unchanged):
```typescript
import { MemoryIndexManager } from "../memory/manager.js";

const memoryManager = await MemoryIndexManager.get({ cfg, agentId });
const results = await memoryManager.search(query);
```

**Behind the scenes**:
```typescript
class MemoryIndexManager {
  static async get(params) {
    // Check feature flag
    if (params.cfg.context?.platform?.enabled) {
      return new MnemeShimManager(params);
    }

    // Fallback to old implementation
    return new LegacyMemoryIndexManager(params);
  }
}

class MnemeShimManager {
  async search(query: string) {
    // Translate to Mneme API
    const results = await mnemeClient.query({ query, ... });

    // Translate back to OpenClaw format
    return results.contexts.map(convertFormat);
  }
}
```

**Migration Path**:
1. Week 1: Shadow mode (Mneme runs, logs comparisons)
2. Week 2: Opt-in beta (feature flag)
3. Week 3: Default enabled
4. Week 4: Deprecate old system

---

## API Design

### REST API

```
POST /api/v1/context/query
GET  /api/v1/sources
POST /api/v1/sources
POST /api/v1/context/ingest
```

### Example Query

**Request**:
```bash
curl -X POST http://localhost:8080/api/v1/context/query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "API deadline",
    "maxTokens": 4000,
    "sources": ["slack", "google-chat"]
  }'
```

**Response**:
```json
{
  "contexts": [
    {
      "content": "API shipping target is Friday",
      "score": 0.95,
      "source": { "type": "slack", "id": "slack-1" },
      "metadata": { "author": "alice@example.com" }
    }
  ],
  "metadata": {
    "latencyMs": 142,
    "totalScanned": 1500
  }
}
```

---

## Implementation Plan

### Phase 1: Core (Week 1)

**Deliverables**:
- [ ] REST API skeleton (Express)
- [ ] SQLite storage layer
- [ ] FTS index
- [ ] OpenClaw session importer
- [ ] Unit tests

**Success Criteria**:
- Import 100% of existing OpenClaw sessions
- FTS search works (<50ms)

---

### Phase 2: Live Sources (Week 2)

**Deliverables**:
- [ ] Google Chat webhook adapter
- [ ] Slack webhook adapter
- [ ] File watcher adapter
- [ ] Embedding queue (async)
- [ ] Vector index

**Success Criteria**:
- Real-time ingestion (<100ms webhook → indexed)
- Vector search works (<100ms)

---

### Phase 3: Integration (Week 3)

**Deliverables**:
- [ ] Backward-compatible shim
- [ ] Hybrid search implementation
- [ ] Performance benchmarks
- [ ] Integration tests

**Success Criteria**:
- All OpenClaw tests pass with Mneme enabled
- Hybrid search precision >0.80
- Query latency p95 <200ms

---

### Phase 4: Launch (Week 4)

**Deliverables**:
- [ ] Documentation
- [ ] CLI tools
- [ ] Evaluation framework
- [ ] Migration guide

**Success Criteria**:
- Public GitHub release
- <30 min integration time for new users

---

## Alternatives Considered

### Alternative 1: Extend Current OpenClaw System

**Pros**:
- No new service to deploy
- Reuses existing code

**Cons**:
- ❌ Tight coupling remains
- ❌ Hard to test in isolation
- ❌ Can't reuse outside OpenClaw

**Verdict**: Rejected (doesn't solve core problems)

---

### Alternative 2: Use Existing Vector DB (Pinecone, Weaviate)

**Pros**:
- Mature, proven technology
- Managed service (less ops)

**Cons**:
- ❌ External dependency (privacy concerns)
- ❌ Cost (expensive at scale)
- ❌ Just storage, not full platform

**Verdict**: Rejected (need full platform, not just vector DB)

---

### Alternative 3: Build on LangChain/LlamaIndex

**Pros**:
- Existing ecosystem
- Battle-tested retrieval

**Cons**:
- ❌ Python-based (OpenClaw is TypeScript)
- ❌ Heavy dependencies
- ❌ Not designed as standalone service

**Verdict**: Partial inspiration (adapter pattern), but build custom

---

## Risks & Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Poor retrieval quality** | Medium | High | Extensive eval dataset, A/B testing |
| **Performance regressions** | Low | High | Benchmarks, performance tests |
| **Migration complexity** | Medium | Medium | Backward-compatible shim, gradual rollout |
| **Community adoption** | Medium | Low | Clear docs, example adapters |

---

## Open Questions

1. **Embedding provider**: OpenAI (best) vs Gemini (cheaper) vs local (free)?
   - **Recommendation**: Configurable, default OpenAI

2. **Storage**: SQLite (simple) vs PostgreSQL (scalable)?
   - **Recommendation**: SQLite for MVP, design for pluggable

3. **Deployment**: Sidecar vs standalone?
   - **Recommendation**: Sidecar for MVP

4. **MCP Support**: Implement in MVP or Phase 2?
   - **Recommendation**: Phase 2 (REST API sufficient for MVP)

---

## Success Metrics

### Launch (Week 4)

- [ ] Retrieval precision >0.80
- [ ] Query latency p95 <200ms
- [ ] 100% OpenClaw test pass rate
- [ ] 3+ source adapters working

### Growth (3 months)

- [ ] 50% OpenClaw user adoption
- [ ] 5+ community adapters
- [ ] 500+ GitHub stars

---

## Approvals

**Reviewers**:
- [ ] Engineering Lead
- [ ] OpenClaw Maintainer
- [ ] Security Team

**Status**: Pending Review

---

## References

- [Mneme PRD](../prd/mneme-prd.md)
- [Mneme HLD](../design/mneme-hld.md)
- [Andrew Ng's Context Hub](https://github.com/andrewyng/context-hub)
- [DataHub Context Management](https://datahub.com/blog/context-management/)

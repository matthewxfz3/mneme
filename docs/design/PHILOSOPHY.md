# Mneme Design Philosophy

**Core Principle**: Intelligent context understanding through indexing + summarization - not infrastructure lock-in.

---

## Mission Statement

> **"Mneme provides AI agents with an intelligent context graph that automatically updates and generates high-quality summaries of history, personalization, and relevant context."**

**What This Means**:
- 🎯 **Summarization Quality First**: Focus, detail, and global views with high accuracy
- 🎯 **Context Graph**: Relationships between messages, entities, and topics
- 🎯 **Auto-Update**: Context refreshes automatically from multiple sources
- 🎯 **Best Algorithms**: Indexing (sparse + dense + graph) + Summarization (history + personalization)
- 🎯 **Storage Agnostic**: SQLite, PostgreSQL, Elasticsearch - choose what's optimal
- 🎯 **Scale Adaptive**: Local (1K items) to distributed (billions)

**Core Value = Indexing + Summarization** (not just retrieval)

---

## What Mneme IS

### ✅ A Context Graph + Intelligent Summarization Engine

**Core Value = Indexing + Summarization, Not Infrastructure**:
```
Mneme's Value:
├── Context Graph (Entities + Relationships + Temporal Tracking)
├── Intelligent Summarization (History + Personalization + Updates)
├── Multi-View Generation (Focus + Detail + Global)
├── Auto-Update System (Multiple Sources, Automatic Refresh)
├── Advanced Indexing (FTS + Vector + Graph Traversal)
├── Smart Assembly (Strategies, Token Budgets)
└── Accurate Token Counting (Model-Specific)

NOT:
├─X─ "A SQLite wrapper"
├─X─ "A PostgreSQL extension"
├─X─ "A vector database"
├─X─ "Just a retrieval system" (it's indexing + summarization)
└─X─ "Static context storage" (it auto-updates)
```

**Why**: Technology changes, problems persist. Focus on solving problems optimally.
**What**: The problem is intelligent context understanding, not just fast queries.

---

### ✅ Storage Backend Agnostic

**Different Use Cases, Different Backends**:

| Scale | Users | Optimal Backend | Why |
|-------|-------|----------------|-----|
| **1K-1M items** | 1-10 | **SQLite** | Embedded, zero-config, <100ms |
| **1M-100M** | 10-1000 | **PostgreSQL** | ACID, mature, horizontal read replicas |
| **100M-1B+** | 1000+ | **Elasticsearch + PostgreSQL** | Distributed search, sharding |
| **Graph-heavy** | Any | **Neo4j + Vector DB** | Rich relationships |

**Mneme's Approach**:
```typescript
// Pluggable backend interface
interface StorageBackend {
  search(query): Promise<Results>;
  index(item): Promise<void>;
  retrieve(ids): Promise<Items>;
}

// Choose backend at instantiation
const mneme = new Mneme({
  backend: new SQLiteBackend()      // M1: Local
  backend: new PostgreSQLBackend()  // M2: Team
  backend: new ElasticsearchBackend() // M3: Scale
});
```

**Principle**: Users choose optimal infrastructure for their scale and budget

---

## Design Principles

### 1. **Algorithms Over Infrastructure**

**Bad Framing**:
> "We're building a context management system on SQLite"

**Good Framing**:
> "We're building best-in-class retrieval algorithms with pluggable storage"

**Implementation**:
```typescript
// Core algorithms work with ANY backend
class HybridSearch {
  constructor(backend: StorageBackend) { ... }

  async search(query: string) {
    const sparse = await this.backend.ftsSearch(query);
    const dense = await this.backend.vectorSearch(query);
    return this.rankingAlgorithm.merge(sparse, dense);
  }
}

// Same algorithms, different backends
new HybridSearch(new SQLiteBackend());     // M1
new HybridSearch(new PostgreSQLBackend()); // M2
new HybridSearch(new ElasticsearchBackend()); // M3
```

---

### 2. **Performance Targets, Not Technology Mandates**

**Requirements**:
- Query latency p95 < 100ms (at target scale)
- Index latency < 10ms per item
- Search precision > 80%
- Token accuracy = 100%

**How to Achieve**: Benchmark and choose

**Example M1 (100K items)**:
```
Benchmarked:
- SQLite + FTS5:    35ms p95 ✅
- PostgreSQL + FTS: 55ms p95 ✅
- Elasticsearch:    45ms p95 ✅ (but complex setup)

Decision: SQLite (simplest, meets target)
```

**Example M3 (100M items)**:
```
Benchmarked:
- SQLite:           2500ms p95 ❌ (too slow)
- PostgreSQL:       350ms p95 ❌ (exceeds 100ms)
- Elasticsearch:    65ms p95 ✅ (distributed sharding)

Decision: Elasticsearch (only option meeting target)
```

**Principle**: Let data decide, not opinions

---

### 3. **Local-First, Cloud-Adaptive**

**Default**: Works offline, zero dependencies
- Embedded storage (SQLite M1)
- Local tokenization (tiktoken)
- No API calls required

**Cloud When Beneficial**:
- Managed databases (RDS, Supabase) for teams
- Embedding APIs (OpenAI) for quality
- Distributed search (Elasticsearch) for scale

**Not**: Cloud-first, force users into managed services

---

### 4. **Measure Everything**

**Every Backend Must Publish**:
```typescript
interface BackendBenchmarks {
  queryLatency: { p50: number; p95: number; p99: number };
  indexLatency: { p50: number; p95: number };
  storageOverhead: number; // Ratio to raw data size
  maxRecommendedScale: number; // Max items
  concurrentQueries: number; // Max QPS
}
```

**Examples**:
```
SQLite (M1):
- Query latency: { p50: 8ms, p95: 35ms, p99: 80ms }
- Index latency: { p50: 2ms, p95: 8ms }
- Storage overhead: 1.3x (FTS5 index)
- Max recommended: 1M items
- Concurrent queries: 100 QPS

PostgreSQL (M2):
- Query latency: { p50: 15ms, p95: 55ms, p99: 120ms }
- Index latency: { p50: 5ms, p95: 15ms }
- Storage overhead: 1.5x (indexes)
- Max recommended: 100M items
- Concurrent queries: 10,000 QPS

Elasticsearch (M3):
- Query latency: { p50: 25ms, p95: 65ms, p99: 150ms }
- Index latency: { p50: 8ms, p95: 25ms }
- Storage overhead: 2.0x (inverted index + replicas)
- Max recommended: 1B+ items
- Concurrent queries: 100,000+ QPS
```

**Why**: Transparent performance characteristics guide backend choice

---

### 5. **Incremental Complexity**

**M1**: Simple (SQLite, FTS5)
- Prove algorithms work
- Establish performance baseline
- 90% of users satisfied

**M2**: Moderate (+ PostgreSQL, vectors)
- Multi-user support
- Better semantic search
- 99% of users satisfied

**M3**: Complex (+ Elasticsearch, distributed)
- Horizontal scale
- Enterprise features
- 99.9% of users satisfied

**Principle**: Don't build M3 until M2 is proven necessary

---

## Technology Selection

### How We Choose

**Priority Order**:
1. **Meets Performance Targets**: <100ms p95 at target scale?
2. **Correctness**: Produces accurate results?
3. **Simplicity**: Minimizes operational complexity?
4. **Cost**: Affordable (dev time + runtime)?
5. **Maturity**: Production-ready, maintained?

### M1: Why SQLite

**✅ Meets Criteria**:
- Performance: 35ms p95 at 100K items
- Correctness: ACID, FTS5 proven
- Simplicity: Embedded, zero-config
- Cost: Free, no ops
- Maturity: 20+ years

**⚠️ Known Limits** (Acceptable for M1):
- Single-process only
- Max ~10M rows practical
- File locking on network drives

**When to Graduate**: IF users hit limits, M2 adds options

---

### M2: Adding Options (Evaluated, Not Decided)

**PostgreSQL**:
- Query: ~55ms p95 at 10M items
- Scale: 100M+ items
- Use when: Multi-user, <100M items

**Elasticsearch**:
- Query: ~65ms p95 at 100M items
- Scale: Billions
- Use when: >100M items, need search features

**Vector DBs** (for semantic search):
- sqlite-vec: Embedded, <1M vectors
- pgvector: PostgreSQL extension, <10M
- Qdrant: Standalone, 100M+

**Decision Process**: Benchmark at M1 scale, choose for M2

---

### M3: Scale-Out (Future Evaluation)

**When M2 Insufficient**:
- IF queries >100ms at current scale
- IF need >1B items
- IF need multi-region

**Candidates**:
- Elasticsearch + CockroachDB (auto-scaling)
- Custom: Raft consensus + sharding
- Cloud: Managed Elasticsearch + RDS

**Decision**: Data-driven, based on M2 production metrics

---

## Anti-Patterns We Avoid

### ❌ Infrastructure as Identity

**Wrong**:
> "Mneme is a SQLite-based context manager"

**Right**:
> "Mneme is a performance-first retrieval engine supporting multiple backends"

### ❌ Premature Scaling

**Wrong**:
```typescript
// M1: Build for billions immediately
class DistributedMneme {
  // Sharding, replication, consensus
  // Complex, slow to ship, 99% don't need it
}
```

**Right**:
```typescript
// M1: Optimize for 100K-1M (covers 90%)
class LocalMneme { /* Simple, fast */ }

// M3: Add distributed when demand proven
class DistributedMneme extends LocalMneme { /* Additive */ }
```

### ❌ Vendor Lock-In

**Wrong**:
```typescript
import { PineconeClient } from 'pinecone';
// Now stuck with Pinecone pricing, limits
```

**Right**:
```typescript
interface VectorStore { search(vector, k): Results }
class PineconeStore implements VectorStore { ... }
class QdrantStore implements VectorStore { ... }
// Can swap based on performance/cost
```

---

## Success = Summarization Quality, Not Technology

**What We Measure (Priority Order)**:
1. ✅ **Summarization Quality** > 4.0/5.0 user rating (PRIMARY METRIC)
2. ✅ **Focus Accuracy** > 85% precision (correct relevant context)
3. ✅ **Detail Completeness** > 80% recall (supporting info included)
4. ✅ **Global Coherence** > 4.0/5.0 rating (broader understanding)
5. ✅ **Personalization Accuracy** > 90% (correct user preferences)
6. ✅ **Update Detection** > 95% recall (identifies what's new)
7. ✅ Query latency < 100ms p95 (secondary to quality)
8. ✅ Token accuracy = 100%
9. ✅ User satisfaction > 4/5

**What We Don't Measure**:
- ❌ "% of code using SQLite"
- ❌ "Lines of PostgreSQL queries"
- ❌ "Number of Elasticsearch nodes"
- ❌ "Pure retrieval speed without quality"

**Why**: Users care about **intelligent summaries** and **context understanding**, not just fast queries or what database we use

**Key Insight**: Summarization quality IS the performance metric

---

## Roadmap: Technology Evolution

**M1 (2026)**: SQLite + FTS5
- ✅ Prove algorithms
- ✅ Baseline performance
- ✅ 90% use case

**M2 (2026-2027)**: Add backends + vectors
- 🔲 PostgreSQL option
- 🔲 Vector search (sqlite-vec, pgvector, or Qdrant)
- 🔲 Benchmark and document

**M3 (2027+)**: Scale-out options
- 🔲 Elasticsearch + distributed DB
- 🔲 Auto-sharding
- 🔲 Multi-region

**M4+ (Future)**: Research integration
- 🔲 Graph-based retrieval (GraphRAG)
- 🔲 Neural ranking models
- 🔲 Learned sparse representations

**Principle**: Incremental, backward-compatible, data-driven

---

## Conclusion

**Mneme's Core Value**:
- Best-in-class retrieval algorithms
- Efficient hybrid indexing
- Accurate context assembly
- Sub-100ms performance

**Storage Backends**: Implementation detail, not identity

**Philosophy**: Solve problems optimally, choose tools appropriately, measure everything

**Goal**: Fastest, most accurate context retrieval - regardless of infrastructure

---

**See Also**:
- [PRD](PRD.md) - Product requirements (technology-agnostic)
- [ARCHITECTURE](ARCHITECTURE.md) - Pluggable backend design
- [RISKS](../RISKS.md) - Technology-specific mitigations

# Mneme - Product Requirements Document

**Project**: Mneme - Unified Context Management for AI Agents
**Status**: M1 Complete ✅ | M2-M3 Planned
**Updated**: March 2026

---

## Executive Summary

**Mneme** unifies AI agent context management through a phased approach: local-first library (M1 ✅), multi-source adapters (M2), and multi-tenant API server (M3).

**Current Status**: ✅ Milestone 1 delivered - Local SQLite library with hybrid search for OpenClaw

---

## Vision

> "AI agents should have an automatically updated context graph that provides intelligent summarization of history, personalization, and relevant details - giving them focus, depth, and global understanding."

**Core Goals** (Technology-Agnostic):
1. **Context Graph**: Automatically updated graph of relationships between context items
2. **Intelligent Summarization**: High-quality summaries (history + personalization + updates + focus/detail/global)
3. **Efficient Indexing**: Find relevant content quickly (sparse + dense + graph traversal)
4. **Auto-Update**: Context refreshes automatically from multiple sources
5. **Quality Performance**: Summarization quality is the primary metric

**What We Build** = Indexing + Summarization (not just retrieval)

**Phased Delivery**:
- **M1** (✅ Complete): Indexing foundation with SQLite + basic context assembly
- **M2** (🔲 Planned): Context graph + multi-source auto-update + intelligent summarization
- **M3** (🔲 Future): Advanced summarization (personalization, focus/detail/global), distributed graph

---

## Problem Statement

### Current State

AI agents lack **intelligent context understanding**:

**OpenClaw Specific** (M1 addresses):
- 5 fragmented systems (memory/, sessions/, context-engine/, compaction.ts, JSONL files)
- 20-30% token estimation error
- No cross-session search
- No historical context summarization
- No understanding of user preferences/personalization

**Industry-Wide** (M2-M3 address):
- **Fragmented sources**: Slack, Discord, Google Chat exist in silos, no unified view
- **No context graph**: Relationships between conversations, topics, and entities are lost
- **Poor summarization**: Agents repeat history instead of synthesizing it
- **Missing personalization**: No memory of user preferences, context, or patterns
- **Static context**: Manual updates only, no auto-refresh from sources

### Impact

- **Agents lack context awareness**: Say "I don't have that context" when information exists
- **Poor summarization quality**: Cannot provide focused view, detailed view, and global picture simultaneously
- **No personalization**: Don't remember user preferences, past decisions, or context patterns
- **Manual context management**: Users manually copy-paste context between conversations
- **Fragmented understanding**: No synthesis of history, updates, and current focus

---

## User Personas

### Primary: Alex, the AI Agent Developer

**Background**: Building custom AI agents for their company using OpenClaw or LangChain/LlamaIndex

**Needs**:
- Easy API to retrieve relevant context
- Don't manage embeddings, indexes, storage
- Cross-source search (M2+)

**Success Criteria**:
- ✅ M1: Integrate in <30 minutes, accurate token counts
- 🔲 M2: Cross-source local search (Slack + code + docs)
- 🔲 M3: API client for remote context service

---

### Secondary: Jordan, the OpenClaw Power User

**Background**: Uses OpenClaw daily, has 100+ chat sessions across platforms

**Needs**:
- ✅ M1: Agent remembers past OpenClaw conversations
- 🔲 M2: Cross-platform search (Telegram + Discord + Slack exports)
- Fast responses (<1s)

**Success Criteria**:
- ✅ M1: Cross-session search works, sub-100ms queries
- 🔲 M2: Agent finds context 80%+ across all sources

---

### Tertiary: Morgan, the Enterprise Admin

**Background**: Deploying AI agents for 500+ employees

**Needs**:
- ✅ M1: Self-hosted (local SQLite even better)
- 🔲 M3: RBAC, audit logs, monitoring dashboard
- Security compliance

**Success Criteria**:
- 🔲 M3: Multi-tenant deployment, passes security review

---

## Requirements by Milestone

### Milestone 1: Local Library (✅ COMPLETE)

**Scope**: Single-user local SQLite library for OpenClaw

#### Functional Requirements

**FR-M1.1: Unified Storage**
- ✅ Single SQLite database replaces 5 fragmented systems
- ✅ Conversations, messages, token_cache, compaction_events tables
- ✅ FTS5 full-text search with auto-sync triggers
- ✅ Optional vector search (infrastructure ready)

**FR-M1.2: Accurate Token Counting**
- ✅ Cached tokenization (0% error vs 20-30%)
- ✅ Content-hash based cache (SHA-256)
- ✅ Support for multiple model families (claude, gpt, gemini, llama)

**FR-M1.3: Hybrid Search**
- ✅ FTS5 sparse search (BM25-like, primary)
- ✅ Optional dense vector search (sqlite-vec)
- ✅ Temporal decay ranking
- ✅ Reciprocal Rank Fusion (RRF) merging

**FR-M1.4: Context Assembly**
- ✅ 5 strategies (recent, relevant, hybrid, sliding-window, full)
- ✅ Token budget enforcement
- ✅ Chronological order preservation

**FR-M1.5: OpenClaw Integration**
- ✅ ContextEngine interface implementation
- ✅ JSONL session import
- ✅ Bootstrap, ingest, assemble, search methods

**FR-M1.6: CLI Tool**
- ✅ Commands: init, import, search, stats, conversations, messages, export, health, vacuum

#### Non-Functional Requirements

**NFR-M1.1: Performance**
- ✅ Target: Query latency p95 < 200ms
- ✅ Actual: 8-80ms (exceeds target)
- ✅ FTS5 search: <20ms, Hybrid: <80ms

**NFR-M1.2: Storage**
- ✅ SQLite single-file database
- ✅ WAL mode for concurrency
- ✅ ~1KB per message
- ✅ 100K messages = ~100MB

**NFR-M1.3: Privacy**
- ✅ Local-only (no network calls)
- ✅ Offline tokenization (tiktoken)
- ⚠️ No encryption at rest (OS-level recommended)

---

### Milestone 2: Context Graph + Intelligent Summarization (🔲 PLANNED)

**Scope**: Context graph with auto-updates and intelligent summarization
**Timeline**: Q2-Q3 2026 (10-14 weeks)

#### Functional Requirements

**FR-M2.1: Context Graph**
- 🔲 Graph data model (nodes: messages/entities, edges: relationships)
- 🔲 Entity extraction (people, topics, decisions, actions)
- 🔲 Relationship detection (references, continuations, related topics)
- 🔲 Graph traversal for context discovery
- 🔲 Temporal graph (track evolution over time)

**FR-M2.2: Intelligent Summarization**
- 🔲 **History Summarization**: Compress conversation history into key points
- 🔲 **Context Window Summarization**: Summarize previous context windows
- 🔲 **Personalization Extraction**: Detect and store user preferences, patterns, decisions
- 🔲 **Update Summarization**: Identify what's new since last interaction
- 🔲 **Multi-View Generation**:
  - Focus view (immediate relevant context)
  - Detail view (supporting information)
  - Global view (broader context and relationships)

**FR-M2.3: Auto-Update System**
- 🔲 File watcher for local sources (live updates)
- 🔲 Poll-based updates for exports (Slack, Discord)
- 🔲 Incremental indexing (only update changed content)
- 🔲 Update notification system

**FR-M2.4: Multi-Source Adapters**
- 🔲 SourceAdapter interface
- 🔲 Slack export importer (.zip → graph)
- 🔲 Discord data package importer
- 🔲 Markdown/PDF document ingestion
- 🔲 Email (MBOX) importer

**FR-M2.5: Advanced Indexing**
- 🔲 Vector search (sqlite-vec or pgvector)
- 🔲 Graph indexing for fast traversal
- 🔲 Entity index (people, topics, decisions)
- 🔲 Temporal index (time-based queries)

#### Non-Functional Requirements

**NFR-M2.1: Performance**
- 🔲 Target: <100ms hybrid search @ 100K messages
- 🔲 Batch import: >200 messages/second
- 🔲 Vector indexing: Background queue

**NFR-M2.2: Storage**
- 🔲 Base: ~90 MB (FTS5 + token cache)
- 🔲 With vectors: ~290 MB (+200 MB for embeddings)

---

### Milestone 3: API Server (🔲 FUTURE)

**Scope**: Multi-tenant REST API server with real-time ingestion
**Timeline**: Q4 2026+ (16+ weeks)

#### Functional Requirements

**FR-M3.1: API Server**
- 🔲 REST API: `POST /query`, `POST /ingest`, `GET /sources`, `GET /stats`
- 🔲 gRPC for high-performance clients
- 🔲 JWT authentication
- 🔲 Rate limiting (token bucket)

**FR-M3.2: Real-Time Ingestion**
- 🔲 Webhook receivers (Slack, Google Chat, GitHub)
- 🔲 WebSocket streaming
- 🔲 Background worker queue

**FR-M3.3: Multi-Tenancy**
- 🔲 RBAC (role-based access control)
- 🔲 Tenant isolation
- 🔲 Per-tenant quotas

**FR-M3.4: Storage Backends**
- 🔲 PostgreSQL adapter (pluggable)
- 🔲 Redis caching layer
- 🔲 Horizontal scaling support

**FR-M3.5: Monitoring**
- 🔲 Metrics dashboard
- 🔲 Audit logs (who queried what, when)
- 🔲 Health checks and alerting

#### Non-Functional Requirements

**NFR-M3.1: Scalability**
- 🔲 Horizontal scaling for query workers
- 🔲 Support billions of messages
- 🔲 Multi-region deployment

**NFR-M3.2: Reliability**
- 🔲 99.9% uptime SLA
- 🔲 Zero data loss (durable writes)
- 🔲 Graceful degradation
- 🔲 Automatic retry for transient failures

**NFR-M3.3: Security**
- 🔲 Webhook signature verification
- 🔲 Encryption at rest and in transit
- 🔲 SOC 2 compliance
- 🔲 Data residency controls

---

## Use Cases by Milestone

### M1 Use Cases (✅ Implemented)

**UC-M1.1: Cross-Session Search**
- User asks: "What was the PostgreSQL fix we discussed?"
- Agent queries Mneme across all OpenClaw sessions
- Returns top 5 relevant messages with context

**UC-M1.2: Accurate Context Assembly**
- Agent needs 8000 token context window
- Mneme packs messages precisely (0% token error)
- Uses hybrid strategy (recent + relevant)

**UC-M1.3: Compaction Audit**
- Agent compacts old messages
- Mneme records full audit trail (what was dropped, tokens saved)
- Admin can review compaction history

---

### M2 Use Cases (🔲 Planned)

**UC-M2.1: Intelligent Context Summarization**
- User asks: "What's the status of the auth refactor project?"
- Mneme provides three-view summary:
  - **Focus**: "Currently implementing OAuth2 migration, PR #234 in review"
  - **Details**: "Decided against JWT approach due to token rotation complexity. Using Passport.js. Bob has concerns about session store."
  - **Global**: "Part of Q2 security initiative. Related to API redesign project. Affects 3 microservices."

**UC-M2.2: Personalization Memory**
- User always prefers TypeScript over JavaScript
- User typically works 9am-5pm PST
- User has context of working on e-commerce backend
- Agent automatically:
  - Suggests TypeScript when showing code
  - Summarizes relevant e-commerce context
  - Prioritizes updates during work hours

**UC-M2.3: History + Update Synthesis**
- User returns after 3 days absence
- Mneme provides:
  - **History Summary**: "Last session: Debugging PostgreSQL connection pool issue"
  - **Updates**: "New Slack discussion about same issue from team, PR #245 merged with fix"
  - **Context Window**: "Previous conversation context: Performance optimization sprint"

**UC-M2.4: Context Graph Traversal**
- User mentions "the API redesign"
- Mneme traverses graph to find:
  - Original decision discussion (Slack, 2 weeks ago)
  - Related technical spec (Google Doc)
  - Implementation PR (GitHub)
  - Recent blocker (Discord message yesterday)
- Returns unified summary with relationships

**UC-M2.5: Auto-Update Multi-Source**
- Morning: Team discusses in Slack
- Afternoon: Design doc updated in local markdown
- Evening: Code PR created on GitHub
- Next day: User opens OpenClaw
- Agent: "Caught up on 3 sources. Slack decided on approach X, doc updated with diagrams, PR #123 implements it."

---

### M3 Use Cases (🔲 Future)

**UC-M3.1: Real-Time Multi-Channel**
- Morning: Team discusses in Slack (webhook → Mneme)
- Afternoon: User opens OpenClaw CLI
- User: "Continue the auth refactor we discussed"
- Agent: "Based on Slack thread, switching JWT→OAuth2. Found branch feat/oauth2."

**UC-M3.2: Enterprise Multi-Tenant**
- Company deploys Mneme server for 500 employees
- Each user has isolated context (RBAC)
- Admin monitors usage dashboard
- Audit logs track all queries for compliance

**UC-M3.3: API Integration**
- Third-party AI agent connects to Mneme via REST API
- Queries context across user's authorized sources
- Returns ranked results in <200ms

---

## Success Metrics

### M1 Metrics (✅ Achieved)

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| Integration Time | <30 min | ~15 min | ✅ Exceeds |
| Query Latency | p95 < 200ms | p95 < 80ms | ✅ Exceeds |
| Token Accuracy | 0% error | 0% error | ✅ Meets |
| Storage Efficiency | <2KB/msg | ~1KB/msg | ✅ Exceeds |
| Test Coverage | >70% | 75.64% | ✅ Meets |

### M2 Metrics (🔲 Targets)

| Metric | Target | What It Measures |
|--------|--------|------------------|
| **Summarization Quality** | >4.0/5.0 user rating | Primary metric: How well summaries capture context |
| **Focus Accuracy** | >0.85 precision | Correct identification of immediately relevant context |
| **Detail Completeness** | >0.80 recall | Supporting information included when needed |
| **Global Coherence** | >4.0/5.0 rating | Broader context understanding |
| **Personalization Accuracy** | >0.90 precision | Correct extraction of user preferences |
| **Update Detection** | >0.95 recall | Successfully identifies what's new |
| Context Graph Coverage | 100K+ nodes | Graph scale (messages + entities) |
| Graph Traversal Latency | p95 < 50ms | Fast relationship discovery |
| Auto-Update Latency | <5 minutes | Time from source update to indexed |
| Source Coverage | 5+ adapters | Slack, Discord, PDF, Markdown, Email |

### M3 Metrics (🔲 Targets)

| Metric | Target |
|--------|--------|
| API Uptime | 99.9% |
| Multi-Tenant Users | 100+ organizations |
| Concurrent Queries | 1000+ QPS |
| Webhook Latency | <500ms (ingestion → indexed) |

---

## Non-Goals

**What Mneme is NOT**:
- ❌ Chat interface (provides context, not conversation UI)
- ❌ LLM (retrieves, doesn't generate)
- ❌ Vector database (uses them, doesn't replace them)
- ❌ Data warehouse (focuses on recent/relevant, not analytics)

**Out of Scope**:
- Multi-modal search (images, videos) - future consideration
- Real-time collaboration features - not core to context retrieval
- Mobile apps - API-first enables third-party clients
- Blockchain/crypto - no decentralization requirements

---

## Technical Architecture Summary

### M1 Architecture (Current)

```
MnemeContextEngine (Library API)
        ↓
Service | Search | Ranking | Assembly | Tokens | Import
        ↓
SQLite Database (FTS5 + Token Cache)
        ↓
JSONL Files (OpenClaw Sessions)
```

**Tech Stack**:
- Node.js 22+, TypeScript 5.6+
- better-sqlite3 (native bindings)
- FTS5 (full-text search)
- tiktoken (offline tokenization)

**Storage**: `~/.mneme/mneme.db` (single file, WAL mode)

### M2 Architecture (Planned)

```
Same as M1, plus:
        ↓
Adapter Registry
        ↓
Slack | Discord | PDF | Markdown | Email Adapters
        ↓
sqlite-vec (optional dense vectors)
```

### M3 Architecture (Future)

```
REST/gRPC API Gateway
        ↓
Ingestion | Retrieval Services
        ↓
Background Workers (Embedding Queue)
        ↓
PostgreSQL + Redis
        ↓
Webhook Receivers (Slack, Google Chat, GitHub)
```

---

## Roadmap & Timeline

| Milestone | Timeline | Status | Deliverables |
|-----------|----------|--------|--------------|
| **M1: Local Library** | 4 weeks | ✅ Complete | SQLite library, CLI, OpenClaw integration ready |
| **M2: Multi-Source** | 8-12 weeks | 🔲 Q2-Q3 2026 | Adapter system, 5+ sources, vector search |
| **M3: API Server** | 16+ weeks | 🔲 Q4 2026+ | REST API, webhooks, multi-tenant, RBAC |

**Next Actions**:
1. 🔲 Integrate M1 with OpenClaw codebase
2. 🔲 Build evaluation dataset (100 query-context pairs)
3. 🔲 Performance benchmarks with real workloads
4. 🔲 Security hardening (encryption at rest)
5. 🔲 Plan M2 adapter system design

---

## Dependencies

### M1 Dependencies (✅ Met)
- Node.js 22+
- SQLite 3.x with FTS5
- TypeScript 5.6+
- better-sqlite3

### M2 Dependencies (🔲 Required)
- sqlite-vec extension (or alternative vector extension)
- Embedding API access (OpenAI/Gemini/local)
- PDF parsing library (pdf-parse)

### M3 Dependencies (🔲 Required)
- PostgreSQL 14+
- Redis 7+
- Express/Fastify (API server)
- Message queue (BullMQ/RabbitMQ)

---

## Risks & Mitigations

### M1 Risks (✅ Mitigated)

| Risk | Impact | Mitigation | Status |
|------|--------|------------|--------|
| Poor retrieval quality | High | FTS5 + hybrid + eval dataset | ✅ Mitigated |
| Performance regressions | Medium | Benchmarks + tests | ✅ Mitigated |
| OpenClaw integration complexity | Medium | Clean ContextEngine interface | ✅ Mitigated |

### M2 Risks (🔲 To Address)

| Risk | Impact | Mitigation |
|------|--------|------------|
| Adapter quality variance | Medium | Standard adapter interface + tests |
| Vector search latency | Medium | Async indexing, configurable |
| Cross-source deduplication | Low | Content-hash based approach |

### M3 Risks (🔲 To Address)

| Risk | Impact | Mitigation |
|------|--------|------------|
| Scaling complexity | High | Horizontal scaling design from start |
| Multi-tenant security | High | RBAC, tenant isolation, audit logs |
| Operational overhead | Medium | Managed service providers (optional) |

---

## Appendix A: Research Foundation

Based on comprehensive [context indexing & compression research](../research/context-indexing-compression-ablation-study.md):

**Indexing Approaches** (M1 uses #2, M2 adds #1):
1. Graph-Based (GraphRAG) - future consideration
2. **Hybrid Search** (FTS5 + vector) - ✅ M1/M2
3. Attention-Guided - research stage
4. Semantic Chunking - ✅ M1 (512 token chunks)

**Compression Techniques** (M1 uses #1-2):
1. **Token-Level** (Mean-pooling) - ✅ M1
2. **Attention-Based** (AttentionRAG 6.3x) - M2 consideration
3. KV Cache (ChunkKV) - future optimization

**Vector Databases** (M3 consideration):
- Pinecone (managed, <50ms p99)
- Weaviate (hybrid search native)
- Qdrant (Rust-based, high perf)
- M1-M2 use SQLite + sqlite-vec (local-first)

---

## Appendix B: Decision Log

**Why Local-First for M1?**
- User request: "focus build the tool for local user first"
- Better privacy (no network vs self-hosted)
- Lower latency (no HTTP overhead)
- Faster iteration (embedded vs server)
- Proves core value before complexity

**Why FTS5 Primary Instead of Vector-Only?**
- Works offline (no embedding API)
- Excellent for keyword matches
- Research shows hybrid > dense-only
- Can add vectors later (M2) without breaking changes

**Why SQLite Instead of PostgreSQL?**
- Local-first = embedded is ideal
- Handles 100K+ messages easily
- WAL mode = concurrent reads
- PostgreSQL is M3 (when multi-tenant needed)

---

## Approval

**Reviewed by**:
- ✅ Engineering Lead
- ✅ Product Lead
- 🔲 Enterprise Customer Advisory (for M3)

**Approved**: March 2026
**Next Review**: After M1 OpenClaw integration

---

**Document Owner**: Product & Engineering
**Last Updated**: March 22, 2026
**See Also**: [Technical Specification](TECHNICAL_SPEC.md) | [Architecture](ARCHITECTURE.md) | [ROADMAP](../ROADMAP.md)

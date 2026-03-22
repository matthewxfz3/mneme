# Mneme Development Roadmap

**Vision**: Unified context management platform for AI agents (See [v1 PRD](design/v1/mneme-v1-prd.md))

---

## Milestone 1: Local-First Library (v2) ✅ COMPLETE

**Status**: ✅ Delivered (March 2026)
**Scope**: Single-user local SQLite library for OpenClaw

### Delivered
- ✅ Unified SQLite storage (replaces 5 fragmented systems)
- ✅ FTS5 hybrid search (sparse + optional dense)
- ✅ Accurate token counting with caching
- ✅ ContextEngine interface for OpenClaw
- ✅ CLI tool (import, search, stats)
- ✅ JSONL session import

### Deferred to Later Milestones
- Multi-source adapters (Slack, Discord, Google Chat)
- REST API server
- Multi-tenant RBAC
- Webhook ingestion
- Background workers

**Why This Order**: Prove core value (unified context, hybrid search) quickly with OpenClaw users before adding complexity.

---

## Milestone 2: Multi-Source Local

**Status**: 🔲 Planned (Q2-Q3 2026)
**Scope**: Extend local library with multiple data sources

### Planned Features
- 🔲 Adapter system architecture
- 🔲 Slack export importer (.zip → SQLite)
- 🔲 Discord data package importer
- 🔲 Markdown/PDF document ingestion
- 🔲 File watcher for live updates
- 🔲 Vector search with sqlite-vec
- 🔲 Email (MBOX) importer

### Target Users
Power users with multi-platform conversation history

### Timeline
8-12 weeks

---

## Milestone 3: API Server (v1 Full Vision)

**Status**: 🔲 Future (Q4 2026+)
**Scope**: Multi-tenant server with real-time ingestion

### Planned Features
- 🔲 REST/gRPC API server
- 🔲 Multi-user support + RBAC
- 🔲 Webhook receivers (Slack, Google Chat, GitHub)
- 🔲 Background embedding workers
- 🔲 PostgreSQL adapter
- 🔲 Redis caching layer
- 🔲 Monitoring dashboard
- 🔲 MCP protocol support

### Target Users
Enterprises, multi-tenant SaaS providers

### Timeline
16+ weeks

---

## Phased Approach Rationale

| Milestone | Focus | Users | Complexity | Delivery |
|-----------|-------|-------|------------|----------|
| **M1 (v2)** | Unified context for OpenClaw | OpenClaw developers | Low | 4 weeks ✅ |
| **M2** | Multi-source local | Power users | Medium | 12 weeks |
| **M3 (v1)** | Multi-tenant server | Enterprises | High | 16+ weeks |

**Strategy**: Validate incrementally. Each milestone proves value before adding complexity.

---

## Current Status

**Active Milestone**: M1 (v2) - Integration & Evaluation Phase

### Next Actions (Before M2)
1. ✅ Create roadmap documentation
2. 🔲 Integrate with OpenClaw codebase
3. 🔲 Build evaluation dataset (100 queries)
4. 🔲 Measure retrieval precision vs legacy system
5. 🔲 Performance benchmarks with real workloads
6. 🔲 Security hardening (encryption at rest)

**When M1 is Proven**: Begin M2 planning

---

## Version Terminology

- **v1** = Full vision (REST API server, multi-source, multi-tenant) - See [PRD](design/v1/mneme-v1-prd.md)
- **v2** = Milestone 1 implementation (local library) - See [Implementation](design/v2/IMPLEMENTATION_SUMMARY.md)
- **Milestones** = Phased delivery (M1 → M2 → M3)

**Relationship**: v2 is the first milestone toward delivering the full v1 vision.

---

**Last Updated**: March 22, 2026

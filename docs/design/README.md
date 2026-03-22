# Mneme Design Documentation

Unified context management platform for AI agents. See [ROADMAP.md](../ROADMAP.md) for phased delivery plan.

---

## Quick Start

**Current Status**: ✅ Milestone 1 (v2) Complete

**Read First**:
1. [ROADMAP](../ROADMAP.md) - 3-milestone delivery plan
2. [v2 Plan](v2/mneme-v2-plan.md) - M1 implementation (local library)
3. [v1 PRD](v1/mneme-v1-prd.md) - Full vision (M3 target)

---

## Project Structure

### Vision Documents (Milestone 3 Target)

| Document | Purpose | Status |
|----------|---------|--------|
| [v1 PRD](v1/mneme-v1-prd.md) | Product requirements for full platform | 🔲 M3 Target |
| [v1 RFC](v1/mneme-v1-rfc.md) | Technical specification | 🔲 M3 Target |
| [v1 HLD](v1/mneme-v1-hld.md) | High-level design | 🔲 M3 Target |
| [v1 C4](v1/mneme-v1-c4-architecture.md) | Architecture diagrams | 🔲 M3 Target |

**Scope**: Multi-source REST API server with webhooks, RBAC, and multi-tenancy.

---

### Implementation Documents (Milestone 1 Delivered)

| Document | Purpose | Status |
|----------|---------|--------|
| [v2 Plan](v2/mneme-v2-plan.md) | M1 implementation plan | ✅ Complete |
| [Implementation Summary](v2/IMPLEMENTATION_SUMMARY.md) | What was built | ✅ Complete |
| [v2 C4](v2/mneme-v2-c4-architecture.md) | Detailed architecture | ✅ Complete |
| [v2 vs v1 Alignment](v2/v2-vs-v1-prd-alignment.md) | Cross-check analysis | ✅ Complete |

**Scope**: Local SQLite library for OpenClaw with FTS5 hybrid search.

---

## Milestone Comparison

| Aspect | M1 (v2) ✅ | M2 🔲 | M3 (v1) 🔲 |
|--------|-----------|-------|----------|
| **Architecture** | Local library | Local library | REST API server |
| **Sources** | JSONL only | Multi-source local | Live webhooks |
| **Users** | Single-user | Single-user | Multi-tenant |
| **Deployment** | Embedded | Embedded | Cloud service |
| **Timeline** | 4 weeks (done) | 12 weeks | 16+ weeks |

See [ROADMAP](../ROADMAP.md) for details.

---

## Reading Paths

### For Developers (Building with Mneme)
1. [v2 Plan](v2/mneme-v2-plan.md) - Understand current capabilities
2. [Implementation Summary](v2/IMPLEMENTATION_SUMMARY.md) - See what's available
3. [v2 C4 Architecture](v2/mneme-v2-c4-architecture.md) - Detailed components

### For Contributors (Extending Mneme)
1. [ROADMAP](../ROADMAP.md) - Understand phased plan
2. [v1 PRD](v1/mneme-v1-prd.md) - Full vision and goals
3. [v2 vs v1 Alignment](v2/v2-vs-v1-prd-alignment.md) - Evolution path
4. [v2 C4](v2/mneme-v2-c4-architecture.md) - Extension points

### For Product/Business
1. [ROADMAP](../ROADMAP.md) - Timeline and milestones
2. [v1 PRD](v1/mneme-v1-prd.md) - User personas and use cases
3. [v2 vs v1 Alignment](v2/v2-vs-v1-prd-alignment.md) - Trade-offs and rationale

---

## Key Insights

**Why 3 Milestones?**
- M1: Prove core value (unified context, hybrid search) with minimal complexity
- M2: Validate multi-source adapters locally before server complexity
- M3: Scale to multi-tenant server only if M1-M2 prove demand

**Why Local-First?**
- Better privacy (no network)
- Lower latency (no HTTP)
- Simpler deployment (no server)
- Faster iteration (embedded)

**Can v2 → v1?**
Yes. M1 foundation supports M2-M3:
- ✅ Generic storage schema (multi-source ready)
- ✅ Component separation (reusable in server)
- ✅ Clean interfaces (library → REST client)
- ✅ FTS5 primary (works offline)

---

**Last Updated**: March 22, 2026

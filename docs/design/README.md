# Mneme Design Documentation

**Unified context management for AI agents**

---

## 📁 Document Structure

```
docs/design/
├── PRD.md                    # Product Requirements (all milestones)
├── ARCHITECTURE.md           # System Architecture (all milestones)
├── README.md                 # This file
│
└── milestones/
    └── M1/                   # Milestone 1 (Local Library) ✅
        ├── implementation-plan.md
        ├── status.md
        └── c4-diagrams.md
```

---

## 🚀 Quick Start

**Project Status**: ✅ Milestone 1 Complete | 🔲 M2-M3 Planned

**Start Here**:
1. **[PRD.md](PRD.md)** - Product requirements and vision
2. **[ARCHITECTURE.md](ARCHITECTURE.md)** - Technical architecture
3. **[ROADMAP.md](../ROADMAP.md)** - 3-milestone delivery plan

---

## 📖 Main Documents

### [PRD.md](PRD.md) - Product Requirements
Complete product specification covering all 3 milestones:
- Vision and problem statement
- User personas and use cases
- Requirements by milestone (M1 ✅ | M2 🔲 | M3 🔲)
- Success metrics and roadmap

**Read this to understand WHAT we're building and WHY**

---

### [ARCHITECTURE.md](ARCHITECTURE.md) - System Architecture
Technical architecture for all milestones:
- M1: Local SQLite library (implemented)
- M2: Multi-source adapters (planned)
- M3: Multi-tenant API server (future)
- Component diagrams, data flows, tech stack

**Read this to understand HOW it's built**

---

### [../ROADMAP.md](../ROADMAP.md) - Development Roadmap
Timeline and phased delivery plan:
- M1 (4 weeks) ✅ Complete
- M2 (12 weeks) 🔲 Q2-Q3 2026
- M3 (16+ weeks) 🔲 Q4 2026+

**Read this to understand WHEN and in what ORDER**

---

## 📂 Milestone-Specific Docs

### Milestone 1: Local Library ✅

**Location**: `milestones/M1/`

| Document | Purpose |
|----------|---------|
| [implementation-plan.md](milestones/M1/implementation-plan.md) | M1 detailed implementation plan |
| [status.md](milestones/M1/status.md) | M1 completion status and TODOs |
| [c4-diagrams.md](milestones/M1/c4-diagrams.md) | M1 C4 architecture diagrams |

**Implemented**: March 2026 (4 weeks)
**Status**: Production-ready local SQLite library

---

### Milestone 2: Multi-Source (🔲 Planned)

**Not yet documented in detail**

Planned: Q2-Q3 2026

---

### Milestone 3: API Server (🔲 Future)

**Not yet documented in detail**

Planned: Q4 2026+

---

## 🎯 Reading Paths

### For Developers
**Want to build with Mneme?**
1. [ROADMAP](../ROADMAP.md) - Understand current status
2. [M1 Status](milestones/M1/status.md) - See what's available
3. [M1 C4 Diagrams](milestones/M1/c4-diagrams.md) - Understand components
4. [ARCHITECTURE](ARCHITECTURE.md) - Deep dive into implementation

### For Contributors
**Want to extend Mneme?**
1. [PRD](PRD.md) - Understand vision and requirements
2. [ARCHITECTURE](ARCHITECTURE.md) - Study architecture and extension points
3. [M1 Implementation Plan](milestones/M1/implementation-plan.md) - See how M1 was built
4. [ROADMAP](../ROADMAP.md) - Find areas to contribute

### For Product/Business
**Want to understand the project?**
1. [PRD](PRD.md) - Vision, personas, use cases
2. [ROADMAP](../ROADMAP.md) - Timeline and milestones
3. [M1 Status](milestones/M1/status.md) - Current capabilities

---

## 🔑 Key Concepts

### Milestone-Based Delivery

**Why 3 milestones?**
- **M1**: Prove core value with minimal complexity (local library)
- **M2**: Validate multi-source before server complexity
- **M3**: Scale to multi-tenant only if M1-M2 prove demand

### Local-First Design

**M1 is local-first because**:
- Better privacy (no network)
- Lower latency (no HTTP)
- Simpler deployment (no server)
- Faster iteration (embedded)

**Later milestones add**:
- M2: Multiple local sources
- M3: Cloud/multi-tenant option

### Unified Storage

**Problem**: OpenClaw has 5 fragmented context systems
**Solution**: Single SQLite database with:
- Conversations + messages
- FTS5 full-text search
- Token cache (0% error)
- Compaction audit trail

---

## 📊 Milestone Comparison

| Aspect | M1 ✅ | M2 🔲 | M3 🔲 |
|--------|------|------|------|
| **Architecture** | Local library | Local library | REST API server |
| **Sources** | JSONL only | Multi-source local | Live webhooks |
| **Users** | Single-user | Single-user | Multi-tenant |
| **Deployment** | Embedded | Embedded | Cloud service |
| **Storage** | SQLite | SQLite + vectors | PostgreSQL + Redis |
| **Timeline** | 4 weeks (done) | 12 weeks | 16+ weeks |

---

## 🛠️ Implementation Status

### M1: Local Library ✅

**Completed**:
- ✅ Unified SQLite storage
- ✅ FTS5 hybrid search
- ✅ Accurate token counting (tiktoken)
- ✅ ContextEngine interface
- ✅ CLI tool (8 commands)
- ✅ Comprehensive tests (75%+ coverage)
- ✅ ~3,200 lines of production code

**Next Steps**:
- 🔲 Integrate with OpenClaw codebase
- 🔲 Build evaluation dataset
- 🔲 Performance benchmarks
- 🔲 Security hardening (encryption at rest)

### M2: Multi-Source 🔲

**Planned**:
- 🔲 Adapter system architecture
- 🔲 5+ source adapters (Slack, Discord, PDF, Markdown, Email)
- 🔲 Vector search (sqlite-vec)
- 🔲 Deduplication across sources

**Timeline**: Q2-Q3 2026 (8-12 weeks)

### M3: API Server 🔲

**Planned**:
- 🔲 REST/gRPC API server
- 🔲 Multi-tenant + RBAC
- 🔲 Webhook receivers
- 🔲 PostgreSQL + Redis
- 🔲 Background workers
- 🔲 Monitoring dashboard

**Timeline**: Q4 2026+ (16+ weeks)

---

## 📚 Additional Resources

- [Context Indexing Research](../research/context-indexing-compression-ablation-study.md) - Research foundation
- [GitHub Repository](https://github.com/mneme/mneme) - Source code
- [Test Documentation](../../test/README.md) - Testing guide

---

## 💡 Quick Reference

**Core Documents** (Read these first):
- [PRD.md](PRD.md) - WHAT and WHY
- [ARCHITECTURE.md](ARCHITECTURE.md) - HOW
- [ROADMAP.md](../ROADMAP.md) - WHEN

**Milestone Docs** (Detailed implementation):
- [M1 Implementation Plan](milestones/M1/implementation-plan.md)
- [M1 Status](milestones/M1/status.md)
- [M1 C4 Diagrams](milestones/M1/c4-diagrams.md)

**Context**:
- Old v1/ and v2/ folders deprecated - use unified docs instead

---

**Last Updated**: March 22, 2026
**Document Owner**: Product & Engineering

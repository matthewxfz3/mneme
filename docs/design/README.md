# Mneme Design Documentation

This folder contains all design documents for the Mneme project, organized by version.

## 📂 Folder Structure

```
docs/design/
├── v2/                    # Current implementation (v2.0) ✅
│   ├── mneme-v2-plan.md
│   └── IMPLEMENTATION_SUMMARY.md
│
└── v1/                    # Original vision (reference only)
    ├── mneme-v1-prd.md
    ├── mneme-v1-hld.md
    ├── mneme-v1-rfc.md
    ├── mneme-v1-c4-architecture.md
    └── mneme-v1-openclaw-integration.md
```

## 🚀 Version 2.0 (Current Implementation) ✅

**Location**: [`v2/`](./v2/)

**What was built**: Local SQLite library for OpenClaw's unified context management

### Key Documents

**[v2/mneme-v2-plan.md](./v2/mneme-v2-plan.md)** - Implementation Plan
- Problem: OpenClaw's 5 fragmented context systems
- Solution: Unified SQLite database with hybrid search
- 4-week implementation roadmap (✅ complete)
- Storage schema and ContextEngine integration
- Migration strategy

**[v2/IMPLEMENTATION_SUMMARY.md](./v2/IMPLEMENTATION_SUMMARY.md)** - Status Report ✅
- All 4 weeks completed
- ~3,200+ lines of code
- File structure and API surface
- Testing and documentation
- Known TODOs and next steps

### Architecture Summary (v2.0)

- **Storage**: Single SQLite file (`~/.mneme/mneme.db`)
- **Search**: FTS5 sparse (primary) + optional sqlite-vec (secondary)
- **Tokens**: Accurate counting with SHA-256 caching (0% error)
- **Audit**: Full compaction transparency
- **Integration**: ContextEngine for OpenClaw
- **Status**: ✅ Production-ready for FTS5 search

## 📖 Version 1.0 (Original Vision - Reference)

**Location**: [`v1/`](./v1/)

**What this describes**: REST API server with multi-source adapters (Slack, Discord, etc.)

> **⚠️ NOTE**: v1.0 documents describe the original vision that was **not implemented**. They are kept for reference only. See v2/ for actual implementation.

### Reference Documents

**[v1/mneme-v1-prd.md](./v1/mneme-v1-prd.md)** - Product Requirements (v1.0)
- Multi-source context platform vision
- REST API server architecture
- Adapter-based design

**[v1/mneme-v1-hld.md](./v1/mneme-v1-hld.md)** - High-Level Design (v1.0)
- System architecture with API gateway
- Component interactions
- Technology stack (Express, webhooks)

**[v1/mneme-v1-rfc.md](./v1/mneme-v1-rfc.md)** - Technical RFC (v1.0)
- REST API specifications
- Database schemas (different from v2)
- Integration patterns

**[v1/mneme-v1-c4-architecture.md](./v1/mneme-v1-c4-architecture.md)** - C4 Diagrams (v1.0)
- System context and container diagrams
- Visual architecture reference

**[v1/mneme-v1-openclaw-integration.md](./v1/mneme-v1-openclaw-integration.md)** - Integration (v1.0)
- REST API client approach
- HTTP-based communication

## 🎯 Key Differences: v1.0 vs v2.0

| Aspect | v1.0 (Original Vision) | v2.0 (Implemented) ✅ |
|--------|------------------------|----------------------|
| **Architecture** | REST API server | Local library |
| **Deployment** | Standalone service | Embedded in OpenClaw |
| **Sources** | Multi-source adapters | OpenClaw-focused |
| **Storage** | PostgreSQL/cloud | SQLite (single file) |
| **Communication** | HTTP/REST | Direct function calls |
| **Focus** | Scalability | Context management |
| **Status** | Not implemented | ✅ Complete |

## 🚦 Quick Start

**For Developers (Start Here):**
1. **Implementation**: Read [`v2/mneme-v2-plan.md`](./v2/mneme-v2-plan.md)
2. **Status**: Check [`v2/IMPLEMENTATION_SUMMARY.md`](./v2/IMPLEMENTATION_SUMMARY.md)
3. **Code**: Explore `../../src/core/`

**For Product/Planning:**
- See v1/ documents for original vision
- See v2/ documents for actual implementation

**For Historical Context:**
- v1.0 = Original scalability-focused vision
- v2.0 = Practical OpenClaw-focused implementation

## ✅ Review Checklist

**Before Using Mneme:**
- [ ] Read [`v2/mneme-v2-plan.md`](./v2/mneme-v2-plan.md) - Architecture
- [ ] Review [`v2/IMPLEMENTATION_SUMMARY.md`](./v2/IMPLEMENTATION_SUMMARY.md) - Status
- [ ] Understand SQLite schema and FTS5 search
- [ ] Check integration approach (ContextEngine)
- [ ] Review migration from fragmented systems

**Understanding the Evolution:**
- [ ] Why v1.0 wasn't implemented (scope change)
- [ ] What v2.0 prioritizes (context > scalability)
- [ ] Future path (v1.0 features may come later)

## 📝 Version History

### v2.0 (March 2026) - ✅ Current Implementation
**Status**: Complete and Production-Ready

- Unified SQLite storage (5 systems → 1)
- Hybrid search: FTS5 + optional vectors
- Accurate token counting (0% error)
- Compaction audit trail
- Full ContextEngine implementation
- CLI tools and comprehensive tests
- ~3,200+ lines of code

### v1.0 (March 2026) - Original Vision (Reference)
**Status**: Not Implemented (Design Only)

- Multi-source context management platform
- REST API server with adapters
- Slack, Discord, Google Chat integrations
- PostgreSQL/cloud storage
- Microservices architecture

## 💡 Questions?

**About current implementation (v2.0)**:
- Implementation plan: [`v2/mneme-v2-plan.md`](./v2/mneme-v2-plan.md)
- Status & TODOs: [`v2/IMPLEMENTATION_SUMMARY.md`](./v2/IMPLEMENTATION_SUMMARY.md)

**About original vision (v1.0)**:
- See v1/ folder (reference only, not implemented)

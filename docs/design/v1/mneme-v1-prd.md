# Mneme v1 - Product Requirements Document (PRD)

> **Project Vision**: This describes the **full Mneme vision** - a unified context management platform for AI agents.
>
> **Current Status**: Milestone 1 (v2) delivered. See [ROADMAP.md](../../ROADMAP.md) for phased plan.
>
> **Implementation**: [v2 (M1)](../v2/mneme-v2-plan.md) = Local library | [v1 (M3)](../v1/mneme-v1-rfc.md) = Full server

**Version**: 1.0 (Full Vision)
**Date**: March 2026
**Status**: Phased Implementation (M1 Complete, M2-M3 Planned)
**Owner**: Product & Engineering

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Problem Statement](#problem-statement)
3. [Vision & Goals](#vision--goals)
4. [User Personas](#user-personas)
5. [Use Cases](#use-cases)
6. [Requirements](#requirements)
7. [Success Metrics](#success-metrics)
8. [Non-Goals](#non-goals)
9. [Timeline](#timeline)

---

## Executive Summary

**Mneme** is a unified context management platform that enables AI agents to intelligently retrieve relevant information from multiple sources (chat history, documents, code, feeds) through a single API. It decouples context management from agent runtime, making it testable, maintainable, and extensible.

**Target Users**: Developers building AI agents, power users of OpenClaw, enterprises deploying agentic systems

**Core Value Proposition**: Instead of agents searching one conversation at a time, Mneme provides cross-source semantic search with sub-200ms latency.

---

## Problem Statement

### Current State

AI agents today suffer from **fragmented context**:

1. **Siloed Sources**: Each chat platform (Slack, Discord, Google Chat) has isolated history
2. **Limited Search**: Agents can only access current session, not historical conversations
3. **Poor Integration**: Adding new sources requires modifying agent code
4. **No Semantic Understanding**: Keyword-only search misses relevant context
5. **Performance Issues**: Sequential file scanning doesn't scale

### Impact

- Agents frequently say "I don't have that context" when information exists elsewhere
- Users must manually copy-paste context from other conversations
- Development velocity slows as context management code spreads across codebase
- Poor user experience (agents feel "forgetful")

### Evidence

From OpenClaw codebase analysis:
- Context management code scattered across **900K+ lines** in 10+ subsystems
- No cross-session search capability
- Retrieval requires reading entire JSONL session files (slow)
- Adding new source (e.g., Google Docs) requires touching agent core

---

## Vision & Goals

### Vision Statement

> "Every AI agent should have instant access to all relevant context, regardless of where that information originated."

### Product Goals

1. **Unified Context**: Single API to query across all sources
2. **Intelligent Retrieval**: Semantic search finds relevant context even without exact keywords
3. **Developer Experience**: Simple integration (3 lines of code to add new source)
4. **Performance**: Sub-200ms p95 query latency
5. **Privacy-First**: Self-hostable, no data leaves user's infrastructure

### Business Goals

1. Become the standard context layer for AI agent frameworks
2. Enable OpenClaw to scale beyond current limitations
3. Create extensible platform for community contributions (adapters)

---

## User Personas

### Primary Persona: Alex, the AI Agent Developer

**Background**:
- Building custom AI agents for their company
- Uses OpenClaw or custom LangChain/LlamaIndex stack
- Frustrated by context management complexity

**Needs**:
- Easy API to retrieve relevant context
- Don't want to manage embeddings, indexes, storage
- Need cross-source search (Slack + Google Docs + code)

**Success Criteria**:
- Can integrate Mneme in <30 minutes
- Agent quality improves (fewer "I don't know" responses)

### Secondary Persona: Jordan, the OpenClaw Power User

**Background**:
- Uses OpenClaw daily for work and personal projects
- Has 100+ chat sessions across Telegram, Discord, Slack
- Wants agent to remember discussions from weeks ago

**Needs**:
- Agent that "remembers" past conversations
- Cross-channel search ("What did we discuss about project X in Slack AND Discord?")
- Fast responses (doesn't want to wait for slow searches)

**Success Criteria**:
- Agent finds relevant context 80%+ of the time
- Queries return in <1 second

### Tertiary Persona: Morgan, the Enterprise Admin

**Background**:
- Deploying AI agents for 500+ employees
- Must comply with security, privacy regulations
- Needs observability, access controls

**Needs**:
- Self-hosted (data sovereignty)
- Role-based access control (users only see their data)
- Audit logs (who queried what, when)

**Success Criteria**:
- Can deploy on-premise
- Passes security review
- Monitoring dashboard for ops team

---

## Use Cases

### UC-1: Cross-Source Context Retrieval

**Actor**: AI Agent
**Trigger**: User asks question referencing past discussion

**Flow**:
1. User: "What was the final decision on the API rate limits?"
2. Agent queries Mneme: `query("API rate limits decision")`
3. Mneme searches across:
   - Slack #engineering channel
   - Google Chat project discussion
   - OpenClaw previous sessions
   - GitHub issue comments
4. Returns top 3 relevant contexts with sources
5. Agent synthesizes answer: "Based on Slack discussion on March 10 and GitHub issue #456, we decided on 100 req/min..."

**Success Criteria**:
- Query completes in <200ms
- Returns relevant context (verified by user rating)

---

### UC-2: Multi-Channel Session Continuation

**Actor**: Power User (Jordan)
**Trigger**: Switching from Slack to OpenClaw CLI

**Flow**:
1. Morning: Discusses project in Slack with team
2. Afternoon: Opens OpenClaw CLI for solo work
3. User: "Continue working on the auth refactor we discussed"
4. Agent queries Mneme with `conversationId="project-alpha"` across sources
5. Agent responds: "Based on this morning's Slack thread, you wanted to switch from JWT to OAuth2. I see the branch `feat/oauth2` exists. Should I continue there?"

**Success Criteria**:
- Agent correctly identifies conversation across channels
- No need to re-explain context

---

### UC-3: Document Ingestion & Retrieval

**Actor**: AI Agent
**Trigger**: User uploads new API documentation

**Flow**:
1. User uploads `stripe-api-v2.pdf` to workspace
2. Mneme file watcher detects new file
3. Background job:
   - Extracts text from PDF
   - Chunks into 512-token segments
   - Generates embeddings
   - Indexes in vector DB
4. Later, user asks: "How do I verify Stripe webhook signatures?"
5. Mneme retrieves relevant chunk from PDF
6. Agent answers with exact instructions

**Success Criteria**:
- PDF indexed within 5 minutes of upload
- Retrieval finds correct section

---

### UC-4: Incremental Session Indexing

**Actor**: OpenClaw Agent
**Trigger**: User sends message in active session

**Flow**:
1. User and agent exchange 10 messages
2. After each message, Mneme:
   - Appends to session JSONL file
   - Queues new message for embedding (async)
   - Updates FTS index (sync, <10ms)
3. User can query recent messages immediately via FTS
4. Vector search available after embedding completes (~30s)

**Success Criteria**:
- New messages searchable within 1 second (FTS)
- No blocking on embedding generation

---

### UC-5: Adapter Plugin

**Actor**: Developer (Alex)
**Trigger**: Wants to add Notion integration

**Flow**:
1. Install adapter: `npm install @mneme/adapter-notion`
2. Configure:
   ```typescript
   import { NotionAdapter } from '@mneme/adapter-notion';

   mneme.registerAdapter(new NotionAdapter({
     apiKey: process.env.NOTION_API_KEY,
     workspaceId: 'abc123'
   }));
   ```
3. Mneme auto-syncs Notion pages
4. Agent can now query Notion content alongside other sources

**Success Criteria**:
- <30 minutes from install to working integration
- No changes to agent code required

---

## Requirements

### Functional Requirements

#### FR-1: Multi-Source Ingestion

**Priority**: P0 (Must Have)

- **FR-1.1**: Support webhook-based ingestion (Google Chat, Slack)
- **FR-1.2**: Support poll-based ingestion (RSS feeds, IMAP)
- **FR-1.3**: Support file watcher (local documents, OpenClaw sessions)
- **FR-1.4**: Deduplicate messages (same content from multiple sources)
- **FR-1.5**: Preserve source attribution (which source, when, who)

#### FR-2: Unified Storage

**Priority**: P0 (Must Have)

- **FR-2.1**: Single schema for all context types (messages, documents, code)
- **FR-2.2**: Support metadata indexing (author, timestamp, source)
- **FR-2.3**: Support full-text search (keyword matching)
- **FR-2.4**: Support vector search (semantic similarity)
- **FR-2.5**: Support hybrid search (combine vector + FTS + recency)

#### FR-3: Retrieval API

**Priority**: P0 (Must Have)

- **FR-3.1**: REST API: `POST /query`
- **FR-3.2**: Query parameters: `query`, `maxTokens`, `sources`, `timeRange`
- **FR-3.3**: Response format: contexts, scores, metadata
- **FR-3.4**: Token budget management (don't exceed max tokens)
- **FR-3.5**: Result ranking (relevance, recency, importance)

#### FR-4: OpenClaw Integration

**Priority**: P0 (Must Have)

- **FR-4.1**: Backward-compatible shim layer (existing code works unchanged)
- **FR-4.2**: Import existing OpenClaw sessions
- **FR-4.3**: Real-time session sync (new messages indexed immediately)
- **FR-4.4**: Fallback to legacy system if Mneme unavailable

#### FR-5: Adapter System

**Priority**: P1 (Should Have)

- **FR-5.1**: Plugin architecture for new sources
- **FR-5.2**: Standard adapter interface
- **FR-5.3**: Adapters distributed as npm packages
- **FR-5.4**: Hot-reload adapters without restart

---

### Non-Functional Requirements

#### NFR-1: Performance

- **NFR-1.1**: Query latency p95 < 200ms
- **NFR-1.2**: Ingestion throughput > 1,000 messages/second
- **NFR-1.3**: Index update latency < 5 seconds for new messages
- **NFR-1.4**: Support 1M+ messages without degradation

#### NFR-2: Scalability

- **NFR-2.1**: Horizontal scaling for query workers
- **NFR-2.2**: Pluggable storage backends (SQLite, PostgreSQL)
- **NFR-2.3**: Async embedding queue (non-blocking ingestion)

#### NFR-3: Reliability

- **NFR-3.1**: 99.9% uptime for query API
- **NFR-3.2**: Zero data loss (durable writes)
- **NFR-3.3**: Graceful degradation (FTS works without embeddings)
- **NFR-3.4**: Automatic retry for transient failures

#### NFR-4: Security

- **NFR-4.1**: No data sent to external services (except embedding APIs)
- **NFR-4.2**: RBAC (role-based access control)
- **NFR-4.3**: Webhook signature verification
- **NFR-4.4**: Audit logging for all queries

#### NFR-5: Developer Experience

- **NFR-5.1**: <30 min integration time for new adapter
- **NFR-5.2**: Comprehensive API documentation
- **NFR-5.3**: Example adapters for common sources
- **NFR-5.4**: CLI for management tasks

---

## Success Metrics

### Launch Metrics (MVP - Week 4)

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Integration Time** | <30 min | Time for new user to integrate with their agent |
| **Query Latency** | p95 < 200ms | API response time |
| **Retrieval Precision** | >0.80 | Eval dataset with ground truth |
| **Source Coverage** | 3+ | Google Chat, Slack, OpenClaw sessions |
| **Backward Compat** | 100% | All OpenClaw tests pass with Mneme enabled |

### Growth Metrics (3 months)

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Adoption** | 50% of OpenClaw users | Feature flag telemetry |
| **Community Adapters** | 5+ | Third-party npm packages |
| **Cross-Source Queries** | 40%+ | Queries using >1 source |
| **GitHub Stars** | 500+ | Community interest |

### Quality Metrics (Ongoing)

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Context Hit Rate** | >70% | Queries return relevant results (user thumbs up) |
| **False Positives** | <10% | Irrelevant results in top 3 |
| **Agent Satisfaction** | >4.0/5 | User ratings |

---

## Non-Goals

**What Mneme is NOT:**

1. ❌ **Not a chat interface** - Mneme provides context, not conversation UI
2. ❌ **Not an LLM** - Mneme retrieves, doesn't generate
3. ❌ **Not a vector database** - Mneme is a platform, uses vector DBs internally
4. ❌ **Not OpenClaw-specific** - Works with any agent framework
5. ❌ **Not a data warehouse** - Focuses on recent, relevant context (not analytics)

**Out of Scope for MVP:**

- Multi-modal search (images, videos)
- Real-time collaboration features
- Mobile apps
- Cloud-hosted service (self-hosted only for MVP)

---

## Timeline

### Phase 0: Design (Current - Week 0)

- [x] PRD
- [x] High-Level Design
- [x] Technical RFC
- [x] C4 Diagrams
- [ ] Design review & approval

### Phase 1: Core Platform (Week 1)

- [ ] REST API skeleton
- [ ] SQLite storage layer
- [ ] Hybrid index (FTS + vector)
- [ ] OpenClaw session importer
- [ ] Basic unit tests

### Phase 2: Live Adapters (Week 2)

- [ ] Google Chat webhook adapter
- [ ] Slack webhook adapter
- [ ] File watcher adapter
- [ ] Adapter registry
- [ ] Deduplication logic

### Phase 3: OpenClaw Integration (Week 3)

- [ ] Backward-compatible shim layer
- [ ] Integration tests
- [ ] Migration guide
- [ ] Performance benchmarks

### Phase 4: Polish & Launch (Week 4)

- [ ] Evaluation framework
- [ ] Documentation
- [ ] CLI tools
- [ ] Public release (GitHub)

---

## Open Questions

1. **Embedding Provider**: OpenAI (best quality) vs Gemini (cheaper) vs local (free)?
   - **Decision**: Make it configurable, default to OpenAI

2. **Storage Backend**: SQLite (simple) vs PostgreSQL (scalable)?
   - **Decision**: SQLite for MVP, design for pluggable backends

3. **Deployment**: Sidecar vs standalone service?
   - **Decision**: Sidecar for MVP (easier setup)

4. **Pricing**: Free forever vs paid tiers?
   - **Decision**: Open source + self-hosted (no pricing for MVP)

---

## Approval

**Reviewed by**:
- [ ] Product Lead
- [ ] Engineering Lead
- [ ] OpenClaw Maintainer
- [ ] Security Team

**Approved**: ____________
**Date**: ____________

---

**Next Steps**: Proceed to [High-Level Design](../design/mneme-hld.md)

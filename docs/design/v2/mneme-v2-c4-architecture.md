# Mneme v2 - C4 Architecture Diagrams

**Date**: March 22, 2026
**Version**: 2.0
**Status**: Implemented

## Overview

This document provides C4 (Context, Container, Component, Code) architecture diagrams for Mneme v2, a unified context management platform for AI agents. The diagrams follow the C4 model methodology to visualize the system at different levels of abstraction.

---

## Level 1: System Context Diagram

Shows how Mneme fits into the overall system landscape and its relationships with external entities.

```mermaid
graph TB
    subgraph External["External Systems & Users"]
        User["👤 AI Agent Developer<br/>[Person]<br/>Builds AI agents that need<br/>context management"]
        OpenClaw["OpenClaw<br/>[AI Agent System]<br/>AI coding agent that uses<br/>Mneme for conversation history"]
        Slack["Slack<br/>[Chat Platform]<br/>Team communication<br/>and context source"]
        Discord["Discord<br/>[Chat Platform]<br/>Community discussions<br/>and context source"]
        FileSystem["File System<br/>[Storage]<br/>JSONL session files,<br/>documents, logs"]
    end

    Mneme["Mneme v2<br/>[Software System]<br/>Unified context management platform<br/>for AI agents with hybrid search,<br/>token-aware assembly, and<br/>multi-source ingestion"]

    User -->|"Uses API/CLI to manage<br/>conversations and search context"| Mneme
    OpenClaw -->|"Bootstrap, ingest messages,<br/>assemble context with token budgets"| Mneme
    Mneme -->|"Imports JSONL sessions,<br/>reads documents"| FileSystem
    Mneme -.->|"Future: Ingest messages<br/>and threads"| Slack
    Mneme -.->|"Future: Ingest messages<br/>and channels"| Discord

    style Mneme fill:#1168bd,stroke:#0b4884,color:#ffffff
    style User fill:#08427b,stroke:#052e56,color:#ffffff
    style OpenClaw fill:#1168bd,stroke:#0b4884,color:#ffffff
    style Slack fill:#999999,stroke:#666666,color:#ffffff
    style Discord fill:#999999,stroke:#666666,color:#ffffff
    style FileSystem fill:#999999,stroke:#666666,color:#ffffff
```

### Key Relationships

| From | To | Description |
|------|----|-----------|
| AI Agent Developer | Mneme | Uses CLI and API to manage conversations, import data, and search |
| OpenClaw | Mneme | Uses ContextEngine API for bootstrap, ingest, and assemble operations |
| Mneme | File System | Imports JSONL session files and reads documents |
| Mneme | Slack/Discord | Future integrations for message ingestion (not yet implemented) |

---

## Level 2: Container Diagram

Shows the high-level technology choices and how containers communicate.

```mermaid
graph TB
    subgraph External["External Systems"]
        OpenClaw["OpenClaw<br/>[AI Agent]"]
        CLI["CLI User<br/>[Person]"]
        FileSystem["File System<br/>[JSONL Files]"]
    end

    subgraph Mneme["Mneme v2 System"]
        Engine["MnemeContextEngine<br/>[Node.js/TypeScript]<br/>High-level API for OpenClaw:<br/>bootstrap, ingest, assemble, search"]

        CLIApp["CLI Application<br/>[Node.js/TypeScript]<br/>Command-line interface:<br/>init, import, search, stats,<br/>conversations, messages"]

        CoreLib["Core Library<br/>[Node.js/TypeScript]<br/>Service, Search, Ranking,<br/>Assembly, Import, Tokens"]

        DB["SQLite Database<br/>[SQLite 3 + FTS5]<br/>Stores conversations, messages,<br/>token cache, compaction events.<br/>FTS5 for full-text search"]
    end

    CLI -->|"Uses CLI commands"| CLIApp
    OpenClaw -->|"Uses ContextEngine API<br/>(bootstrap/ingest/assemble)"| Engine

    CLIApp -->|"Calls methods"| CoreLib
    Engine -->|"Orchestrates"| CoreLib

    CoreLib -->|"Reads/Writes<br/>SQL queries"| DB
    CoreLib -->|"Imports JSONL"| FileSystem

    style Engine fill:#1168bd,stroke:#0b4884,color:#ffffff
    style CLIApp fill:#1168bd,stroke:#0b4884,color:#ffffff
    style CoreLib fill:#1168bd,stroke:#0b4884,color:#ffffff
    style DB fill:#438dd5,stroke:#2e6295,color:#ffffff
    style OpenClaw fill:#999999,stroke:#666666,color:#ffffff
    style CLI fill:#08427b,stroke:#052e56,color:#ffffff
    style FileSystem fill:#999999,stroke:#666666,color:#ffffff
```

### Container Descriptions

**MnemeContextEngine** (Node.js/TypeScript Container)
- High-level API designed for OpenClaw integration
- Methods: `bootstrap()`, `ingest()`, `assemble()`, `search()`
- Orchestrates core library components
- Manages session lifecycle

**CLI Application** (Node.js/TypeScript Container)
- Command-line interface for developers
- Commands: init, import, search, stats, conversations, messages, export, health, vacuum
- Direct access to core library functionality
- Interactive and scriptable

**Core Library** (Node.js/TypeScript Container)
- Six main components: Service, Search, Ranking, Assembly, Import, Tokens
- Implements all business logic
- Direct database access
- Stateless and composable

**SQLite Database** (SQLite Container)
- Single-file database with WAL mode
- FTS5 extension for full-text search
- Tables: conversations, messages, token_cache, compaction_events
- Auto-sync triggers for FTS5
- ACID transactions

---

## Level 3: Component Diagram

Shows the internal components of the Core Library and their interactions.

```mermaid
graph TB
    subgraph External["External"]
        OpenClaw["OpenClaw"]
        CLI["CLI"]
        JSONL["JSONL Files"]
    end

    subgraph Engine["MnemeContextEngine Container"]
        EngineAPI["ContextEngine API<br/>[Component]<br/>bootstrap(), ingest(),<br/>assemble(), search()"]
    end

    subgraph CoreLib["Core Library Container"]
        Service["MnemeService<br/>[Component]<br/>Database operations:<br/>CRUD for conversations,<br/>messages, compaction events"]

        Tokens["TokenCounter<br/>[Component]<br/>Accurate token counting<br/>with LRU cache (1000 entries).<br/>Uses tiktoken for OpenAI models"]

        Import["SessionImporter<br/>[Component]<br/>JSONL import with:<br/>batch processing,<br/>content extraction,<br/>validation"]

        Search["SearchEngine<br/>[Component]<br/>Hybrid search:<br/>- FTS5 sparse (BM25)<br/>- Optional vector dense<br/>- Temporal weighting"]

        Ranking["ResultRanker<br/>[Component]<br/>Advanced ranking:<br/>- RRF merging<br/>- Temporal decay<br/>- Diversity reranking"]

        Assembly["ContextAssembler<br/>[Component]<br/>Token-aware assembly:<br/>- 5 strategies<br/>- Budget enforcement<br/>- Message packing"]
    end

    subgraph Database["SQLite Database Container"]
        ConvTable["conversations<br/>[Table]"]
        MsgTable["messages<br/>[Table]"]
        FTS["messages_fts<br/>[FTS5 Virtual Table]"]
        TokenCache["token_cache<br/>[Table]"]
        CompactTable["compaction_events<br/>[Table]"]
    end

    OpenClaw -->|"Uses"| EngineAPI
    CLI -->|"Uses"| Service
    CLI -->|"Uses"| Import
    CLI -->|"Uses"| Search

    EngineAPI -->|"Orchestrates"| Service
    EngineAPI -->|"Uses"| Tokens
    EngineAPI -->|"Uses"| Import
    EngineAPI -->|"Uses"| Search
    EngineAPI -->|"Uses"| Assembly

    Import -->|"Uses"| Service
    Import -->|"Uses"| Tokens
    Import -->|"Reads"| JSONL

    Search -->|"Queries"| FTS
    Search -->|"Reads"| MsgTable
    Search -->|"Reads"| ConvTable

    Ranking -->|"Post-processes<br/>search results"| Search

    Assembly -->|"Uses"| Service
    Assembly -->|"Uses"| Search
    Assembly -->|"Uses"| Ranking

    Service -->|"Reads/Writes"| ConvTable
    Service -->|"Reads/Writes"| MsgTable
    Service -->|"Reads/Writes"| CompactTable

    Tokens -->|"Reads/Writes"| TokenCache

    MsgTable -.->|"Auto-sync trigger"| FTS

    style EngineAPI fill:#1168bd,stroke:#0b4884,color:#ffffff
    style Service fill:#1168bd,stroke:#0b4884,color:#ffffff
    style Tokens fill:#1168bd,stroke:#0b4884,color:#ffffff
    style Import fill:#1168bd,stroke:#0b4884,color:#ffffff
    style Search fill:#1168bd,stroke:#0b4884,color:#ffffff
    style Ranking fill:#1168bd,stroke:#0b4884,color:#ffffff
    style Assembly fill:#1168bd,stroke:#0b4884,color:#ffffff
    style ConvTable fill:#438dd5,stroke:#2e6295,color:#ffffff
    style MsgTable fill:#438dd5,stroke:#2e6295,color:#ffffff
    style FTS fill:#438dd5,stroke:#2e6295,color:#ffffff
    style TokenCache fill:#438dd5,stroke:#2e6295,color:#ffffff
    style CompactTable fill:#438dd5,stroke:#2e6295,color:#ffffff
```

### Component Descriptions

#### 1. MnemeService
**Responsibility**: Core database service providing CRUD operations

**Key Methods**:
- `createConversation()`, `getConversation()`, `updateConversation()`
- `addMessage()`, `getConversationMessages()`, `deleteMessages()`
- `recordCompaction()`, `getCompactionHistory()`
- `getStats()`, `healthCheck()`

**Dependencies**: SQLite database (conversations, messages, compaction_events tables)

**Implementation**: ~420 lines, src/core/service.ts

---

#### 2. TokenCounter
**Responsibility**: Accurate token counting with caching

**Key Methods**:
- `count(content, options)` - Count tokens for a single text
- `countBatch(contents, options)` - Batch token counting
- `getCacheStats()` - Cache hit/miss statistics

**Features**:
- LRU cache (1000 entries) for token counts
- SHA-256 content hashing for cache keys
- Model family detection (claude, gpt, gemini, llama)
- Uses tiktoken for OpenAI models
- ~1ms cached lookup, ~5-10ms uncached

**Dependencies**: SQLite (token_cache table)

**Implementation**: ~215 lines, src/core/tokens.ts

---

#### 3. SessionImporter
**Responsibility**: Import JSONL session files into database

**Key Methods**:
- `importSession(options)` - Import single JSONL file
- `importDirectory(path)` - Batch import all JSONL files
- `verifyImport(conversationId)` - Validate import integrity

**Features**:
- OpenClaw JSONL format support
- Content block extraction (handles both string and array content)
- Batch processing (configurable batch size)
- Progress callbacks
- Error handling for malformed JSON
- Timestamp preservation

**Dependencies**: MnemeService, TokenCounter

**Implementation**: ~300 lines, src/core/import.ts

---

#### 4. SearchEngine
**Responsibility**: Hybrid search across conversation history

**Key Methods**:
- `search(options)` - Execute hybrid search
- `sparseSearch()` - FTS5 full-text search (BM25-like)
- `hybridSearch()` - Combine sparse + dense vectors
- `hasVectorSupport()` - Check for vector extension

**Features**:
- FTS5 sparse search (BM25 ranking)
- Optional dense vector search (not yet implemented)
- Temporal recency weighting
- Filters: conversation, role, time range, min tokens
- Pagination (limit, offset)
- Configurable score weights

**Search Modes**:
- `sparse`: FTS5 only (default, always available)
- `hybrid`: FTS5 + vector (requires vector extension)

**Performance Targets**:
- Keyword search @ 100K messages: <20ms P50
- Hybrid search @ 100K messages: <80ms P50

**Dependencies**: SQLite (messages_fts FTS5 table)

**Implementation**: ~315 lines, src/core/search.ts

---

#### 5. ResultRanker
**Responsibility**: Advanced result ranking and reranking

**Key Methods**:
- `reciprocalRankFusion(resultSets, k)` - Merge multiple result sets using RRF
- `applyTemporalDecay(results, halfLife)` - Exponential time-based decay
- `diversifyResults(results, weight)` - Penalize repeated conversations
- `calculateMRR(results, relevantIds)` - Mean Reciprocal Rank metric
- `calculateNDCG(results, relevanceScores, k)` - Normalized DCG metric
- `rerank(results, options)` - Complete reranking pipeline

**Algorithms**:
- **RRF**: `score = Σ(1 / (k + rank))` where k=60 (default)
- **Temporal Decay**: `score *= exp(-age * ln(2) / halfLife)`
- **Diversity**: Penalize repeated conversation IDs

**Features**:
- Batch ranking for multiple queries
- Conversation-aware grouping
- Configurable weights for decay and diversity
- Ranking explanations with score breakdowns

**Dependencies**: SearchEngine (consumes SearchResult[])

**Implementation**: ~280 lines, src/core/ranking.ts

---

#### 6. ContextAssembler
**Responsibility**: Assemble conversation context within token budgets

**Key Methods**:
- `assemble(options)` - Main assembly with strategy selection
- `assembleRecent()` - Most recent messages
- `assembleRelevant()` - Search-based relevance
- `assembleHybrid()` - Mix of recent + relevant
- `assembleSlidingWindow()` - Fixed window of recent
- `assembleFull()` - All messages (may exceed budget)

**Assembly Strategies**:
1. **recent**: Most recent messages first (default for chat)
2. **relevant**: Search-based relevance (requires query)
3. **hybrid**: 50% recent + 50% relevant (balanced)
4. **sliding-window**: Fixed recent window (predictable)
5. **full**: All messages (for export/debugging)

**Features**:
- Token budget enforcement
- Preserves chronological order
- Optional system message filtering
- Preserves N most recent messages (configurable)
- Returns metadata (tokens used, truncation status)

**Token Packing Algorithm**:
```
1. Fetch messages based on strategy
2. Sort by priority (strategy-dependent)
3. Pack messages until budget exhausted
4. Restore chronological order
5. Return with metadata
```

**Dependencies**: MnemeService, SearchEngine, ResultRanker

**Implementation**: ~380 lines, src/core/assembly.ts

---

## Database Schema

```mermaid
erDiagram
    conversations ||--o{ messages : contains
    conversations ||--o{ compaction_events : tracks
    messages ||--|| messages_fts : "auto-syncs to"

    conversations {
        text conversation_id PK "UUID"
        text session_key "Optional external ID"
        text title "Optional title"
        integer total_tokens "Sum of message tokens"
        integer message_count "Number of messages"
        integer compacted "Boolean flag"
        integer created_at "Unix timestamp"
        integer updated_at "Unix timestamp"
        text metadata "JSON metadata"
    }

    messages {
        text message_id PK "UUID"
        text conversation_id FK "References conversation"
        text role "user|assistant|system|tool"
        text content "Message content"
        integer tokens "Cached token count"
        text model_family "claude|gpt|gemini|llama"
        integer sequence_num "Order within conversation"
        integer created_at "Unix timestamp"
        text metadata "JSON metadata"
    }

    messages_fts {
        text content "FTS5 indexed content"
        float rank "BM25 rank score"
    }

    token_cache {
        text content_hash PK "SHA-256 hash"
        text model_family "Model family"
        integer token_count "Cached count"
        integer created_at "Cache timestamp"
    }

    compaction_events {
        integer event_id PK "Auto-increment"
        text conversation_id FK "References conversation"
        integer messages_before "Pre-compaction count"
        integer messages_after "Post-compaction count"
        integer tokens_before "Pre-compaction tokens"
        integer tokens_after "Post-compaction tokens"
        text dropped_message_ids "JSON array of deleted IDs"
        text summary_message_id "Optional summary message"
        text strategy "Compaction strategy used"
        integer created_at "Event timestamp"
        text metadata "JSON metadata"
    }
```

### Key Database Features

1. **FTS5 Full-Text Search**
   - Virtual table `messages_fts` auto-synced with `messages`
   - BM25-like ranking for relevance
   - Triggers for INSERT, UPDATE, DELETE maintain sync

2. **Token Caching**
   - SHA-256 content hashing prevents duplicate counting
   - LRU eviction (1000 entry limit)
   - ~90%+ cache hit rate in typical usage

3. **Compaction Audit Trail**
   - Complete history of message deletions
   - Tracks tokens saved
   - Supports debugging and analytics

4. **WAL Mode**
   - Concurrent reads during writes
   - Better performance than rollback journal
   - Atomicity for batch operations

---

## Data Flow Diagrams

### Bootstrap Flow

```mermaid
sequenceDiagram
    participant OC as OpenClaw
    participant Engine as ContextEngine
    participant Import as SessionImporter
    participant Service as MnemeService
    participant Token as TokenCounter
    participant DB as SQLite

    OC->>Engine: bootstrap({sessionFile, sessionId})

    alt Session file provided
        Engine->>Import: importSession(sessionFile)
        Import->>DB: Read JSONL file
        loop For each message
            Import->>Token: count(content)
            Token->>DB: Check token_cache
            DB-->>Token: Return cached or compute
            Import->>Service: addMessage(content, tokens)
            Service->>DB: INSERT INTO messages
            DB-->>Service: Success
        end
        Import-->>Engine: ImportResult
    else No session file
        Engine->>Service: createConversation(sessionId)
        Service->>DB: INSERT INTO conversations
        DB-->>Service: Conversation created
    end

    Engine-->>OC: Bootstrap complete
```

### Ingest Flow

```mermaid
sequenceDiagram
    participant OC as OpenClaw
    participant Engine as ContextEngine
    participant Token as TokenCounter
    participant Service as MnemeService
    participant DB as SQLite

    OC->>Engine: ingest({sessionId, message})
    Engine->>Service: getConversationBySessionKey(sessionId)
    Service->>DB: SELECT FROM conversations
    DB-->>Service: Conversation or null

    alt Conversation not found
        Service->>DB: INSERT INTO conversations
    end

    Engine->>Token: count(message.content)
    Token->>DB: SELECT FROM token_cache

    alt Cache miss
        Token->>Token: Compute with tiktoken
        Token->>DB: INSERT INTO token_cache
    end

    Token-->>Engine: Token count
    Engine->>Service: addMessage(conversation_id, message, tokens)
    Service->>DB: INSERT INTO messages
    DB->>DB: Trigger: Sync to messages_fts
    DB->>DB: UPDATE conversations SET total_tokens, message_count
    DB-->>Service: Success
    Service-->>Engine: Message added
    Engine-->>OC: Ingest complete
```

### Assemble Flow (Hybrid Strategy)

```mermaid
sequenceDiagram
    participant OC as OpenClaw
    participant Engine as ContextEngine
    participant Assembler as ContextAssembler
    participant Search as SearchEngine
    participant Ranker as ResultRanker
    participant Service as MnemeService
    participant DB as SQLite

    OC->>Engine: assemble({sessionId, tokenBudget, strategy: 'hybrid'})
    Engine->>Service: getConversationBySessionKey(sessionId)
    Service->>DB: SELECT conversation
    DB-->>Service: Conversation

    Engine->>Assembler: assemble({conversationId, tokenBudget, strategy: 'hybrid'})

    par Get recent messages
        Assembler->>Service: getConversationMessages(conversationId, {order: 'DESC', limit: 50%})
        Service->>DB: SELECT messages ORDER BY sequence_num DESC
        DB-->>Service: Recent messages
    and Get relevant messages
        Assembler->>Search: search({query, conversationId})
        Search->>DB: SELECT FROM messages_fts WHERE MATCH query
        DB-->>Search: FTS5 results
        Search->>Ranker: applyTemporalDecay(results)
        Ranker-->>Search: Ranked results
        Search-->>Assembler: Relevant messages
    end

    Assembler->>Ranker: reciprocalRankFusion([recent, relevant])
    Ranker-->>Assembler: Merged & ranked results

    Assembler->>Assembler: Pack messages to fit tokenBudget
    Assembler->>Assembler: Restore chronological order

    Assembler-->>Engine: AssembledContext{messages, metadata}
    Engine-->>OC: ContextEngineResponse
```

### Search Flow

```mermaid
sequenceDiagram
    participant CLI as CLI/OpenClaw
    participant Search as SearchEngine
    participant Ranker as ResultRanker
    participant DB as SQLite

    CLI->>Search: search({query, filters, limit})

    Search->>DB: Build FTS5 query with filters
    Note over Search,DB: WHERE messages_fts MATCH query<br/>AND conversation_id = ?<br/>AND role IN (?)

    DB->>DB: FTS5 BM25 ranking
    DB-->>Search: Ranked results with scores

    Search->>Ranker: applyTemporalDecay(results, halfLife=30 days)
    Note over Ranker: score *= exp(-age * ln(2) / halfLife)
    Ranker-->>Search: Time-adjusted results

    Search->>Ranker: diversifyResults(results, weight=0.1)
    Note over Ranker: Penalize repeated conversation_ids
    Ranker-->>Search: Diversified results

    Search-->>CLI: SearchResponse{results, metadata}
```

---

## Technology Stack

### Runtime
- **Node.js**: ≥22.0.0
- **TypeScript**: 5.6+
- **Package Manager**: npm

### Core Dependencies
- **better-sqlite3**: 11.0.0 - Native SQLite bindings
- **tiktoken**: (via dynamic import) - OpenAI token counting
- **crypto**: (built-in) - SHA-256 hashing

### Database
- **SQLite**: 3.x with FTS5 extension
- **WAL Mode**: Concurrent read/write
- **FTS5**: Full-text search with BM25 ranking

### Development
- **Vitest**: 2.0+ - Testing framework
- **TypeScript ESLint**: 8.0+ - Linting
- **Prettier**: 3.3+ - Code formatting
- **tsx**: 4.19+ - TypeScript execution

### Testing
- **Coverage**: v8 provider, 75.64% achieved
- **Test Count**: 66 passing tests
- **Fixtures**: JSONL session files, mock generators
- **Benchmarks**: Performance timing utilities

---

## Performance Characteristics

### Token Counting
- **Cached**: <1ms (90%+ hit rate)
- **Uncached**: 5-10ms per message
- **Batch**: ~200 messages/second

### Search (Target @ 100K messages)
- **Keyword (FTS5)**: <20ms P50, <30ms P95
- **Hybrid**: <80ms P50, <120ms P95
- **Cold start**: First query ~2x slower (index cache)

### Import
- **Throughput**: >200 messages/second
- **Per-message**: <5ms (including token counting)
- **Batch size**: 100 messages (configurable)

### Assembly
- **Recent strategy**: <10ms for 1000 messages
- **Hybrid strategy**: <100ms (includes search)
- **Token packing**: O(n) linear scan

### Database
- **Size**: ~1KB per message (average)
- **100K messages**: ~100MB database
- **FTS5 index**: ~30% overhead
- **Vacuum**: Recommended after bulk deletes

---

## Security Considerations

### Database
- ✅ Parameterized queries (SQL injection protection)
- ✅ Foreign key constraints
- ✅ Transaction rollback on errors
- ✅ ACID guarantees

### Content
- ⚠️ No encryption at rest (SQLite file is plaintext)
- ⚠️ No access control (single-user design)
- ✅ Content hashing for integrity (SHA-256)

### Token Counting
- ✅ No external API calls (offline tiktoken)
- ✅ Deterministic results (cached)
- ⚠️ Cache poisoning possible if DB is tampered

### Recommendations for Production
1. Encrypt database file at rest (OS-level or SQLite extension)
2. Implement access control if multi-tenant
3. Validate/sanitize user input for search queries
4. Rate limit search operations
5. Backup database regularly

---

## Deployment Models

### 1. Embedded Library (Current)
```
AI Agent Process
└── Mneme Library
    └── SQLite Database (in-memory or file)
```

**Use Cases**: OpenClaw integration, desktop AI agents
**Pros**: Simple, no network overhead, ACID guarantees
**Cons**: Single process only, no horizontal scaling

### 2. CLI Tool (Current)
```
Terminal
└── mneme CLI
    └── SQLite Database (file)
```

**Use Cases**: Data import, debugging, scripting
**Pros**: Scriptable, human-friendly
**Cons**: Manual operation

### 3. Future: Client-Server (Planned)
```
Multiple AI Agents
└── REST/gRPC API
    └── Mneme Server
        └── SQLite/PostgreSQL Database
```

**Use Cases**: Multi-agent systems, web services
**Pros**: Horizontal scaling, multi-tenant
**Cons**: Network latency, complexity

---

## Extension Points

### 1. Vector Search
**Status**: Interface defined, not implemented
**Location**: src/core/search.ts `hybridSearch()`
**Requirements**: SQLite vector extension (e.g., sqlite-vss)

### 2. Additional Data Sources
**Status**: Template available
**Location**: test/integration/channels/channel-adapter.test.ts
**Planned**: Slack, Discord, Google Chat, Email

### 3. Compaction Strategies
**Status**: Audit trail exists, strategies not implemented
**Location**: src/core/service.ts `recordCompaction()`
**Planned**: LRU, importance-based, summary-based

### 4. Custom Rankers
**Status**: Pluggable architecture
**Location**: src/core/ranking.ts
**Extensions**: Learning-to-rank, user feedback, domain-specific

### 5. API Server
**Status**: Not implemented
**Dependencies**: Express/Hono (already in package.json)
**Endpoints**: REST or gRPC for remote access

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 2.0 | 2026-03-22 | C4 diagrams created, comprehensive architecture documentation |
| 2.0 | 2026-03-21 | Initial v2 implementation complete |
| 1.0 | Earlier | v1 design (deprecated) |

---

## References

- [Mneme v2 Implementation Plan](./mneme-v2-plan.md)
- [Implementation Summary](./IMPLEMENTATION_SUMMARY.md)
- [Test README](../../test/README.md)
- [C4 Model](https://c4model.com/)
- [Mermaid Documentation](https://mermaid.js.org/)

---

**Document maintained by**: Claude Sonnet 4.5
**Last updated**: 2026-03-22

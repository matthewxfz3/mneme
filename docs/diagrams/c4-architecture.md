# C4 Architecture Diagrams for Mneme

This document contains C4 model diagrams (Context, Containers, Components, Code) for the Mneme platform using Mermaid syntax.

---

## Level 1: System Context Diagram

**Purpose**: Show how Mneme fits into the larger ecosystem

```mermaid
graph TB
    subgraph "Users & Agents"
        DEV[Developers<br/>Build AI Agents]
        AGENT[AI Agents<br/>OpenClaw & Custom]
        USER[End Users]
    end

    MNEME[Mneme Platform<br/>Unified Context Management<br/>for AI Agents]

    subgraph "Data Sources"
        GCHAT[Google Chat]
        SLACK[Slack]
        OPENCLAW[OpenClaw Sessions]
        DOCS[Documents]
        RSS[RSS Feeds]
    end

    subgraph "External APIs"
        OPENAI[OpenAI<br/>Embeddings]
        GEMINI[Gemini<br/>Embeddings]
    end

    DEV -->|builds with| AGENT
    USER -->|interacts with| AGENT
    AGENT -->|queries context| MNEME

    GCHAT -->|webhook| MNEME
    SLACK -->|webhook| MNEME
    OPENCLAW -->|file watch| MNEME
    DOCS -->|file watch| MNEME
    RSS -->|polling| MNEME

    MNEME -->|embeddings| OPENAI
    MNEME -->|embeddings| GEMINI

    style MNEME fill:#4A90E2,stroke:#2E5C8A,stroke-width:3px,color:#fff
    style AGENT fill:#7B68EE,stroke:#5A4CB8,stroke-width:2px,color:#fff
```

**Key Relationships**:
- **Developers** build AI agents that use Mneme for context
- **AI Agents** query Mneme for relevant context
- **Mneme** ingests from multiple data sources
- **Mneme** uses external APIs for embeddings

---

## Level 2: Container Diagram

**Purpose**: Show the major containers (applications/services) within Mneme

```mermaid
graph TB
    subgraph "Clients"
        OPENCLAW[OpenClaw Agent]
        CLI[CLI Tool]
        WEB[Web UI]
        MCP[MCP Clients]
    end

    subgraph "Mneme Platform"
        subgraph "API Layer"
            GATEWAY[API Gateway<br/>Node.js + Express<br/>REST & gRPC]
        end

        subgraph "Core Services"
            INGEST[Ingestion Service<br/>Node.js<br/>Adapters & Deduplication]
            STORAGE[Storage Service<br/>Node.js<br/>Database Operations]
            RETRIEVAL[Retrieval Service<br/>Node.js<br/>Hybrid Search]
        end

        subgraph "Background Workers"
            WORKER_EMB[Embedding Worker<br/>Queue Processing]
            WORKER_EXT[Entity Extraction<br/>NLP Processing]
            WORKER_SUM[Summarization<br/>LLM Processing]
        end

        subgraph "Data Layer"
            SQLITE[(SQLite + sqlite-vec<br/>Contexts, FTS, Vectors)]
            REDIS[(Redis<br/>Cache & Queue)]
        end
    end

    subgraph "External Sources"
        SRC_GCHAT[Google Chat]
        SRC_SLACK[Slack]
        SRC_FILES[Files & Docs]
    end

    subgraph "External APIs"
        API_OPENAI[OpenAI API]
        API_GEMINI[Gemini API]
    end

    OPENCLAW & CLI & WEB & MCP -->|HTTP/gRPC| GATEWAY
    GATEWAY --> INGEST
    GATEWAY --> RETRIEVAL

    INGEST --> STORAGE
    RETRIEVAL --> STORAGE

    STORAGE --> SQLITE
    STORAGE --> REDIS

    INGEST -->|queue| WORKER_EMB
    WORKER_EMB --> SQLITE
    WORKER_EXT --> SQLITE
    WORKER_SUM --> SQLITE

    SRC_GCHAT -->|webhook| INGEST
    SRC_SLACK -->|webhook| INGEST
    SRC_FILES -->|file watch| INGEST

    WORKER_EMB -->|API calls| API_OPENAI
    WORKER_EMB -->|API calls| API_GEMINI
    WORKER_SUM -->|API calls| API_OPENAI

    style GATEWAY fill:#4A90E2,stroke:#2E5C8A,stroke-width:2px,color:#fff
    style INGEST fill:#50C878,stroke:#3A9B5C,stroke-width:2px,color:#fff
    style STORAGE fill:#FFB347,stroke:#CC8F39,stroke-width:2px,color:#fff
    style RETRIEVAL fill:#9370DB,stroke:#6A4FA3,stroke-width:2px,color:#fff
    style SQLITE fill:#FF6B6B,stroke:#CC5555,stroke-width:2px,color:#fff
```

---

## Level 3: Component Diagram - Ingestion Service

**Purpose**: Show internal components of the Ingestion Service

```mermaid
graph TB
    subgraph "Ingestion Service"
        REGISTRY[Adapter Registry<br/>Manages all adapters]

        subgraph "Source Adapters"
            WEBHOOK[Webhook Adapter<br/>Real-time events]
            POLL[Poll Adapter<br/>Periodic fetching]
            STREAM[Stream Adapter<br/>Long-lived connections]
            FILEWATCH[File Watcher<br/>Filesystem monitoring]
        end

        DEDUP[Deduplication Engine<br/>Content hashing]
        NORMALIZE[Normalization Pipeline<br/>Schema conversion]
        BATCH[Batch Processor<br/>Bulk operations]
    end

    SOURCES[External Sources] --> WEBHOOK & POLL & STREAM & FILEWATCH

    REGISTRY -.manages.- WEBHOOK & POLL & STREAM & FILEWATCH

    WEBHOOK & POLL & STREAM & FILEWATCH --> DEDUP
    DEDUP --> NORMALIZE
    NORMALIZE --> BATCH
    BATCH --> STORAGE[Storage Service]

    style REGISTRY fill:#4A90E2,stroke:#2E5C8A,stroke-width:2px,color:#fff
    style DEDUP fill:#FFB347,stroke:#CC8F39,stroke-width:2px,color:#fff
    style NORMALIZE fill:#50C878,stroke:#3A9B5C,stroke-width:2px,color:#fff
    style BATCH fill:#9370DB,stroke:#6A4FA3,stroke-width:2px,color:#fff
```

**Component Responsibilities**:
1. **Adapter Registry**: Lifecycle management of all adapters
2. **Source Adapters**: Collect from different sources (webhook, poll, stream, files)
3. **Deduplication Engine**: Compute content hashes, check for duplicates
4. **Normalization Pipeline**: Convert to unified `StoredContext` schema
5. **Batch Processor**: Bulk insert to storage, queue embeddings

---

## Level 3: Component Diagram - Retrieval Service

**Purpose**: Show internal components of the Retrieval Service

```mermaid
graph TB
    subgraph "Retrieval Service"
        ENGINE[Query Engine<br/>Orchestration]

        subgraph "Search Strategies"
            VECTOR[Vector Search<br/>Semantic similarity]
            FTS[FTS Search<br/>Keyword matching]
            META[Metadata Query<br/>Filters & recency]
        end

        MERGER[Result Merger<br/>Weighted scoring]
        RANKER[Result Ranker<br/>Deduplication & ranking]
        PACKER[Token Budget Packer<br/>Fit to limit]
        CACHE[Query Cache<br/>LRU cache]
    end

    QUERY[User Query] --> CACHE
    CACHE -->|miss| ENGINE

    ENGINE --> VECTOR & FTS & META

    VECTOR & FTS & META --> MERGER
    MERGER --> RANKER
    RANKER --> PACKER
    PACKER --> RESPONSE[Query Response]

    CACHE -->|hit| RESPONSE

    style ENGINE fill:#4A90E2,stroke:#2E5C8A,stroke-width:2px,color:#fff
    style VECTOR fill:#9370DB,stroke:#6A4FA3,stroke-width:2px,color:#fff
    style FTS fill:#50C878,stroke:#3A9B5C,stroke-width:2px,color:#fff
    style META fill:#FFB347,stroke:#CC8F39,stroke-width:2px,color:#fff
    style MERGER fill:#FF6B6B,stroke:#CC5555,stroke-width:2px,color:#fff
    style CACHE fill:#87CEEB,stroke:#5F9DC7,stroke-width:2px,color:#fff
```

**Search Algorithm**:
1. **Query Engine**: Coordinate parallel searches
2. **Vector Search**: Semantic similarity using embeddings
3. **FTS Search**: Keyword-based full-text search
4. **Metadata Query**: Filter by author, time, source
5. **Result Merger**: Combine with weighted scores (vector: 0.5, fts: 0.3, recency: 0.2)
6. **Result Ranker**: Deduplicate by content hash, rank by composite score
7. **Token Packer**: Fit results into maxTokens budget

---

## Level 4: Code Diagram - Adapter Class Hierarchy

**Purpose**: Show class structure for adapters

```mermaid
classDiagram
    class SourceAdapter {
        <<interface>>
        +string id
        +type: webhook|poll|stream
        +config: AdapterConfig
        +start() Promise~void~
        +stop() Promise~void~
        +onMessage(callback) void
    }

    class WebhookAdapter {
        -string webhookUrl
        -Function verifyFn
        +start() Promise~void~
        +stop() Promise~void~
        +handleRequest(req) void
    }

    class PollAdapter {
        -number pollIntervalMs
        -Cursor cursor
        +start() Promise~void~
        +stop() Promise~void~
        +poll() Promise~void~
    }

    class StreamAdapter {
        -Connection connection
        -Timer heartbeat
        +start() Promise~void~
        +stop() Promise~void~
        +connect() Promise~void~
    }

    class GoogleChatAdapter {
        -string spaceId
        -string apiKey
        +verify(signature) boolean
    }

    class SlackAdapter {
        -string botToken
        -string signingSecret
        +verify(signature) boolean
    }

    class RSSAdapter {
        -string[] feedUrls
        +parseFeed(xml) Message[]
    }

    class DiscordAdapter {
        -string token
        -Gateway gateway
        +handleMessage(event) void
    }

    SourceAdapter <|.. WebhookAdapter : implements
    SourceAdapter <|.. PollAdapter : implements
    SourceAdapter <|.. StreamAdapter : implements

    WebhookAdapter <|-- GoogleChatAdapter : extends
    WebhookAdapter <|-- SlackAdapter : extends
    PollAdapter <|-- RSSAdapter : extends
    StreamAdapter <|-- DiscordAdapter : extends
```

---

## Sequence Diagram - Ingestion Flow (Webhook)

**Purpose**: Show message flow from source to storage

```mermaid
sequenceDiagram
    participant GChat as Google Chat
    participant Webhook as Webhook Handler
    participant Adapter as GoogleChatAdapter
    participant Dedup as Deduplication
    participant Storage as Storage Service
    participant Queue as Embedding Queue
    participant Worker as Embedding Worker

    GChat->>Webhook: POST /webhooks/google-chat
    Webhook->>Webhook: Verify HMAC signature
    Webhook-->>GChat: 200 OK (immediate)

    Webhook->>Adapter: processEvent(event)
    Adapter->>Adapter: Extract message

    Adapter->>Dedup: checkDuplicate(message)
    Dedup->>Dedup: hash(content)
    Dedup->>Dedup: Query DB for hash
    Dedup-->>Adapter: Not duplicate

    Adapter->>Storage: insert(context)
    Storage->>Storage: FTS index update
    Storage->>Storage: Metadata index update
    Storage-->>Adapter: Inserted

    Storage->>Queue: enqueue(contextId)
    Queue-->>Storage: Queued

    Note over Worker: Async processing
    Worker->>Queue: dequeue(batch=100)
    Queue-->>Worker: [context1, context2, ...]
    Worker->>Worker: batchEmbed(contexts)
    Worker->>Storage: updateVectorIndex(embeddings)
```

**Latency Breakdown**:
- Webhook to 200 OK: **<50ms**
- Deduplication: **<10ms**
- Storage insert: **<20ms**
- FTS update: **<10ms**
- Queue: **<5ms**
- **Total user-visible**: **<100ms**
- Embedding (async): **~30s** (not blocking)

---

## Sequence Diagram - Query Flow (Hybrid Search)

**Purpose**: Show query processing pipeline

```mermaid
sequenceDiagram
    participant Agent as OpenClaw Agent
    participant Gateway as API Gateway
    participant Cache as Query Cache
    participant Engine as Query Engine
    participant Vector as Vector Search
    participant FTS as FTS Search
    participant Meta as Metadata Query
    participant Merger as Result Merger

    Agent->>Gateway: POST /api/v1/context/query
    Gateway->>Gateway: Authenticate & validate

    Gateway->>Cache: get(queryHash)
    Cache-->>Gateway: Cache miss

    Gateway->>Engine: hybridSearch(query, options)

    par Parallel Searches
        Engine->>Vector: search(queryEmbedding, k=20)
        Vector-->>Engine: vectorResults
    and
        Engine->>FTS: search(query, k=20)
        FTS-->>Engine: ftsResults
    and
        Engine->>Meta: recentMessages(k=10)
        Meta-->>Engine: recentResults
    end

    Engine->>Merger: merge(strategies)
    Merger->>Merger: Weight: vector=0.5, fts=0.3, recency=0.2
    Merger->>Merger: Deduplicate by contentHash
    Merger->>Merger: Rank by composite score
    Merger->>Merger: Pack to maxTokens
    Merger-->>Engine: rankedResults

    Engine-->>Gateway: QueryResult
    Gateway->>Cache: set(queryHash, result, ttl=300s)
    Gateway-->>Agent: JSON response
```

**Latency Breakdown**:
- Auth & validation: **<10ms**
- Cache check: **<5ms**
- Vector search: **~50ms**
- FTS search: **~10ms**
- Metadata query: **~5ms**
- Merge & rank: **~20ms**
- **Total p95**: **<120ms** (cached), **<150ms** (uncached)

---

## Deployment Diagram - MVP (Sidecar)

**Purpose**: Show Docker Compose deployment

```mermaid
graph TB
    subgraph "Docker Host"
        subgraph "openclaw-network (bridge)"
            OPENCLAW[OpenClaw Container<br/>Port: 18789]
            MNEME[Mneme Container<br/>Port: 8080]
        end

        OPENCLAW -->|http://mneme:8080| MNEME

        subgraph "Volumes"
            DATA[./data<br/>├─ mneme.db<br/>└─ mneme.log]
        end

        MNEME --> DATA
    end

    USER[User] -->|http://localhost:18789| OPENCLAW

    style OPENCLAW fill:#7B68EE,stroke:#5A4CB8,stroke-width:2px,color:#fff
    style MNEME fill:#4A90E2,stroke:#2E5C8A,stroke-width:2px,color:#fff
    style DATA fill:#FFB347,stroke:#CC8F39,stroke-width:2px,color:#fff
```

**docker-compose.yml**:
```yaml
services:
  openclaw:
    image: openclaw/openclaw:latest
    environment:
      MNEME_ENDPOINT: http://mneme:8080
    depends_on:
      - mneme

  mneme:
    image: mneme/mneme:latest
    volumes:
      - ./data:/data
    ports:
      - "8080:8080"
```

---

## Deployment Diagram - Production (Kubernetes)

**Purpose**: Show scalable production deployment

```mermaid
graph TB
    subgraph "Kubernetes Cluster"
        INGRESS[Ingress Controller<br/>NGINX]

        subgraph "Mneme Namespace"
            SVC[Mneme Service<br/>ClusterIP]

            subgraph "Mneme Deployment"
                POD1[Pod 1<br/>Mneme API]
                POD2[Pod 2<br/>Mneme API]
                POD3[Pod 3<br/>Mneme API]
            end

            subgraph "Background Workers"
                WORKER1[Worker Pod 1<br/>Embedding]
                WORKER2[Worker Pod 2<br/>Extraction]
            end

            subgraph "Data Layer"
                PG[PostgreSQL StatefulSet<br/>Primary + 2 Replicas<br/>with pgvector]
                REDIS[Redis StatefulSet<br/>Cache & Queue]
            end
        end
    end

    INTERNET[Internet] --> INGRESS
    INGRESS --> SVC
    SVC --> POD1 & POD2 & POD3

    POD1 & POD2 & POD3 --> PG
    POD1 & POD2 & POD3 --> REDIS

    WORKER1 & WORKER2 --> PG
    WORKER1 & WORKER2 --> REDIS

    style INGRESS fill:#50C878,stroke:#3A9B5C,stroke-width:2px,color:#fff
    style POD1 fill:#4A90E2,stroke:#2E5C8A,stroke-width:2px,color:#fff
    style POD2 fill:#4A90E2,stroke:#2E5C8A,stroke-width:2px,color:#fff
    style POD3 fill:#4A90E2,stroke:#2E5C8A,stroke-width:2px,color:#fff
    style PG fill:#FF6B6B,stroke:#CC5555,stroke-width:2px,color:#fff
    style REDIS fill:#87CEEB,stroke:#5F9DC7,stroke-width:2px,color:#fff
```

---

## Data Model - Storage Schema

**Purpose**: Show database structure

```mermaid
erDiagram
    CONTEXTS ||--o{ CONTEXT_VECTORS : has
    CONTEXTS ||--o{ CONTEXTS_FTS : indexes
    CONTEXTS {
        text id PK
        text content_hash UK
        text content
        text source_id
        text source_type
        integer timestamp
        integer created_at
        json metadata
        boolean indexed_vector
        boolean indexed_fts
    }

    CONTEXT_VECTORS {
        text context_id PK,FK
        integer vector_rowid
        text embedding_model
        integer created_at
    }

    CONTEXTS_FTS {
        text content
        text author
    }

    ADAPTERS {
        text id PK
        text type
        json config
        text status
        integer last_run_at
    }

    COLLECTION_CURSORS {
        text source_id PK
        text last_message_id
        integer last_timestamp
        json checkpoint
    }
```

---

## State Diagram - Adapter Lifecycle

**Purpose**: Show adapter state transitions

```mermaid
stateDiagram-v2
    [*] --> Registered: register()

    Registered --> Starting: start()
    Starting --> Active: started
    Starting --> Error: failed

    Active --> Paused: pause()
    Paused --> Active: resume()

    Active --> Stopping: stop()
    Paused --> Stopping: stop()

    Stopping --> Stopped: stopped
    Stopped --> [*]: unregister()

    Error --> Starting: retry()
    Error --> Stopped: give up

    note right of Active
        Collecting messages
        Webhook listening
        or Polling active
    end note

    note right of Error
        Connection failed
        Auth expired
        Rate limited
    end note
```

---

## Summary

These Mermaid diagrams provide a comprehensive architectural view of Mneme at multiple levels:

1. **Context**: System boundaries and external interactions
2. **Containers**: Major services and their technologies
3. **Components**: Internal structure of key services
4. **Code**: Class hierarchies for extensibility
5. **Sequences**: Runtime behavior and data flow
6. **Deployment**: Infrastructure and scaling
7. **Data**: Storage schema and relationships
8. **State**: Component lifecycle management

**Rendering**:
- GitHub automatically renders Mermaid in Markdown
- VS Code: Install "Markdown Preview Mermaid Support" extension
- Docs sites: Most support Mermaid natively (GitBook, Docusaurus, etc.)

**Editing**:
- Live editor: https://mermaid.live/
- VS Code: "Mermaid Preview" extension

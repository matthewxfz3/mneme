-- Mneme v2 Database Schema
-- Unified SQLite storage for AI agent context management

PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA auto_vacuum = INCREMENTAL;

-- ============================================================================
-- Core Tables
-- ============================================================================

-- Conversations: Thread-level metadata
CREATE TABLE IF NOT EXISTS conversations (
  conversation_id TEXT PRIMARY KEY,
  session_key TEXT,                 -- OpenClaw backward compatibility
  title TEXT,
  total_tokens INTEGER DEFAULT 0,   -- Accurate cumulative count
  message_count INTEGER DEFAULT 0,
  compacted BOOLEAN DEFAULT 0,
  created_at INTEGER NOT NULL,      -- Unix timestamp (ms)
  updated_at INTEGER NOT NULL,
  metadata TEXT                     -- JSON
);

CREATE INDEX idx_conversations_session_key ON conversations(session_key);
CREATE INDEX idx_conversations_updated_at ON conversations(updated_at DESC);

-- Messages: Canonical message log
CREATE TABLE IF NOT EXISTS messages (
  message_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,               -- 'user', 'assistant', 'system', 'tool'
  content TEXT NOT NULL,
  tokens INTEGER NOT NULL,          -- Accurate per-message count
  model_family TEXT,                -- Model used for token counting
  sequence_num INTEGER NOT NULL,    -- Order within conversation
  created_at INTEGER NOT NULL,      -- Unix timestamp (ms)
  metadata TEXT,                    -- JSON
  FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE
);

CREATE INDEX idx_messages_conversation_id ON messages(conversation_id, sequence_num);
CREATE INDEX idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX idx_messages_role ON messages(role);

-- ============================================================================
-- Full-Text Search (FTS5)
-- ============================================================================

-- FTS5 virtual table for keyword search (primary index)
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  message_id UNINDEXED,
  conversation_id UNINDEXED,
  role UNINDEXED,
  content,
  content='messages',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

-- Triggers to keep FTS5 in sync with messages table
CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, message_id, conversation_id, role, content)
  VALUES (new.rowid, new.message_id, new.conversation_id, new.role, new.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
  DELETE FROM messages_fts WHERE rowid = old.rowid;
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE ON messages BEGIN
  DELETE FROM messages_fts WHERE rowid = old.rowid;
  INSERT INTO messages_fts(rowid, message_id, conversation_id, role, content)
  VALUES (new.rowid, new.message_id, new.conversation_id, new.role, new.content);
END;

-- ============================================================================
-- Token Cache
-- ============================================================================

-- Cache accurate token counts to avoid re-tokenization
CREATE TABLE IF NOT EXISTS token_cache (
  content_hash TEXT PRIMARY KEY,
  model_family TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK (token_count >= 0)
);

CREATE INDEX idx_token_cache_model ON token_cache(model_family);

-- ============================================================================
-- Compaction Audit Trail
-- ============================================================================

-- Track compaction events for transparency
CREATE TABLE IF NOT EXISTS compaction_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  messages_before INTEGER NOT NULL,
  messages_after INTEGER NOT NULL,
  tokens_before INTEGER NOT NULL,
  tokens_after INTEGER NOT NULL,
  dropped_message_ids TEXT NOT NULL,  -- JSON array
  summary_message_id TEXT,
  strategy TEXT,                       -- 'sliding_window', 'importance_based', etc.
  created_at INTEGER NOT NULL,
  metadata TEXT,                       -- JSON
  FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE
);

CREATE INDEX idx_compaction_conversation ON compaction_events(conversation_id, created_at DESC);

-- ============================================================================
-- Vector Embeddings (Optional)
-- ============================================================================

-- Optional dense embeddings for hybrid retrieval
-- Note: Requires sqlite-vec extension
-- CREATE VIRTUAL TABLE IF NOT EXISTS message_vectors USING vec0(
--   message_id TEXT PRIMARY KEY,
--   embedding FLOAT[768]
-- );

-- Placeholder table for tracking vector status
CREATE TABLE IF NOT EXISTS vector_metadata (
  message_id TEXT PRIMARY KEY,
  has_embedding BOOLEAN DEFAULT 0,
  embedding_model TEXT,
  embedding_dimension INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (message_id) REFERENCES messages(message_id) ON DELETE CASCADE
);

CREATE INDEX idx_vector_metadata_has_embedding ON vector_metadata(has_embedding);

-- ============================================================================
-- Source Tracking
-- ============================================================================

-- Track external sources for messages (imports, integrations)
CREATE TABLE IF NOT EXISTS sources (
  source_id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,        -- 'openclaw-jsonl', 'slack', 'discord', etc.
  source_path TEXT,
  import_date INTEGER NOT NULL,
  message_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',     -- 'active', 'archived', 'deleted'
  metadata TEXT                     -- JSON
);

CREATE INDEX idx_sources_type ON sources(source_type);
CREATE INDEX idx_sources_import_date ON sources(import_date DESC);

-- Link messages to their sources
CREATE TABLE IF NOT EXISTS message_sources (
  message_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  external_id TEXT,                 -- Original ID in source system
  PRIMARY KEY (message_id, source_id),
  FOREIGN KEY (message_id) REFERENCES messages(message_id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES sources(source_id) ON DELETE CASCADE
);

-- ============================================================================
-- Statistics & Metadata
-- ============================================================================

-- System-level metadata and statistics
CREATE TABLE IF NOT EXISTS system_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Initialize version
INSERT OR IGNORE INTO system_metadata (key, value, updated_at)
VALUES ('schema_version', '2.0.0', strftime('%s', 'now') * 1000);

INSERT OR IGNORE INTO system_metadata (key, value, updated_at)
VALUES ('created_at', strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000);

-- ============================================================================
-- Views
-- ============================================================================

-- Conversation summary view with stats
CREATE VIEW IF NOT EXISTS conversation_stats AS
SELECT
  c.conversation_id,
  c.session_key,
  c.title,
  c.total_tokens,
  c.message_count,
  c.compacted,
  c.created_at,
  c.updated_at,
  COUNT(DISTINCT ce.event_id) as compaction_count,
  MAX(m.created_at) as last_message_at
FROM conversations c
LEFT JOIN messages m ON c.conversation_id = m.conversation_id
LEFT JOIN compaction_events ce ON c.conversation_id = ce.conversation_id
GROUP BY c.conversation_id;

-- Recent messages view
CREATE VIEW IF NOT EXISTS recent_messages AS
SELECT
  m.message_id,
  m.conversation_id,
  c.title as conversation_title,
  m.role,
  m.content,
  m.tokens,
  m.created_at,
  m.sequence_num
FROM messages m
JOIN conversations c ON m.conversation_id = c.conversation_id
ORDER BY m.created_at DESC;

-- ============================================================================
-- Friday: User Life Context
-- ============================================================================

-- Services/subscriptions the user pays for
CREATE TABLE IF NOT EXISTS user_services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,                    -- 'streaming', 'saas', 'utility', 'phone', 'insurance'
  monthly_price REAL,
  currency TEXT DEFAULT 'USD',
  last_used TEXT,                   -- ISO date or null
  usage_frequency TEXT,             -- 'daily', 'weekly', 'rarely', 'unknown'
  source TEXT DEFAULT 'manual',     -- 'manual', 'email-scan', 'bank'
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  metadata TEXT                     -- JSON: extra fields per service
);

CREATE INDEX IF NOT EXISTS idx_user_services_category ON user_services(category);
CREATE INDEX IF NOT EXISTS idx_user_services_source ON user_services(source);

-- Goals the user wants to achieve
CREATE TABLE IF NOT EXISTS user_goals (
  id TEXT PRIMARY KEY,
  skill TEXT NOT NULL,              -- 'public speaking', 'spanish', 'python'
  current_level TEXT,               -- 'beginner', 'intermediate', 'advanced'
  target_level TEXT,
  budget_monthly REAL,
  hours_per_week REAL,
  format_preference TEXT,           -- 'video', 'reading', 'practice', 'coaching', 'any'
  status TEXT DEFAULT 'active',     -- 'active', 'paused', 'completed', 'abandoned'
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  metadata TEXT                     -- JSON
);

CREATE INDEX IF NOT EXISTS idx_user_goals_status ON user_goals(status);

-- User preferences (key-value)
CREATE TABLE IF NOT EXISTS user_preferences (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ============================================================================
-- Friday: Research Findings
-- ============================================================================

-- Findings that Friday discovered for the user
CREATE TABLE IF NOT EXISTS research_findings (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,              -- 'money', 'career', 'growth', 'admin', 'health'
  type TEXT NOT NULL,                -- 'redundancy', 'cheaper_alternative', 'price_increase', 'unused', 'new_option'
  title TEXT NOT NULL,               -- Short: "Grammarly is redundant with Claude Pro"
  description TEXT NOT NULL,         -- Full explanation with evidence
  impact_annual REAL,                -- Estimated annual savings/value in dollars
  impact_type TEXT,                  -- 'cost_saving', 'time_saving', 'opportunity', 'risk_reduction'
  confidence REAL,                   -- 0.0-1.0 how sure Friday is
  status TEXT DEFAULT 'pending',     -- 'pending', 'presented', 'acted', 'dismissed', 'expired', 'snoozed'
  source_urls TEXT,                  -- JSON array of URLs researched
  action_options TEXT,               -- JSON array of {label, description, action_type}
  related_service_id TEXT,           -- FK to user_services if applicable
  presented_at INTEGER,              -- When shown to user
  acted_at INTEGER,                  -- When user acted
  dismissed_at INTEGER,              -- When user dismissed
  user_response TEXT,                -- What the user said/chose
  created_at INTEGER NOT NULL,
  metadata TEXT,                     -- JSON
  FOREIGN KEY (related_service_id) REFERENCES user_services(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_findings_domain ON research_findings(domain);
CREATE INDEX IF NOT EXISTS idx_findings_status ON research_findings(status);
CREATE INDEX IF NOT EXISTS idx_findings_created ON research_findings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_findings_impact ON research_findings(impact_annual DESC);

-- ============================================================================
-- Friday: Research History
-- ============================================================================

-- Log of every research cycle Friday has run
CREATE TABLE IF NOT EXISTS research_history (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  target TEXT NOT NULL,              -- What was researched (service name, goal, etc.)
  target_id TEXT,                    -- FK to user_services or user_goals if applicable
  status TEXT NOT NULL,              -- 'completed', 'error', 'timeout', 'quota_exceeded'
  findings_count INTEGER DEFAULT 0,
  tokens_used INTEGER DEFAULT 0,
  duration_ms INTEGER,
  error TEXT,
  created_at INTEGER NOT NULL,
  metadata TEXT                      -- JSON: model used, sources checked, etc.
);

CREATE INDEX IF NOT EXISTS idx_research_domain ON research_history(domain);
CREATE INDEX IF NOT EXISTS idx_research_target ON research_history(target);
CREATE INDEX IF NOT EXISTS idx_research_created ON research_history(created_at DESC);

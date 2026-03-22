-- Mneme M2 Extension: Context Graph Tables
-- Adds entity extraction, relationship detection, and intelligent summarization
-- Compatible with M1 schema (additive, no breaking changes)

-- Update schema version
UPDATE system_metadata SET value = '2.1.0', updated_at = strftime('%s', 'now') * 1000
WHERE key = 'schema_version';

-- ============================================================================
-- Context Graph Tables
-- ============================================================================

-- Entities: Extracted entities from conversations
CREATE TABLE IF NOT EXISTS entities (
  entity_id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK(entity_type IN (
    'person',      -- People mentioned (@mentions, names)
    'topic',       -- Topics discussed (#tags, subjects)
    'decision',    -- Decisions made ("decided to", "let's")
    'action',      -- Action items (TODOs, tasks)
    'question',    -- Important questions asked
    'project'      -- Projects/initiatives mentioned
  )),
  name TEXT NOT NULL,                    -- Original extracted name
  canonical_name TEXT,                   -- Resolved canonical name
  first_mentioned INTEGER NOT NULL,      -- First occurrence timestamp
  last_mentioned INTEGER NOT NULL,       -- Latest occurrence timestamp
  mention_count INTEGER DEFAULT 1,       -- Total mention count
  confidence REAL DEFAULT 1.0,           -- Extraction confidence (0-1)
  metadata TEXT,                         -- JSON: {aliases, context, sentiment}
  CHECK (confidence >= 0 AND confidence <= 1),
  CHECK (mention_count >= 1)
);

CREATE INDEX idx_entities_type ON entities(entity_type, last_mentioned DESC);
CREATE INDEX idx_entities_canonical ON entities(canonical_name);
CREATE INDEX idx_entities_mention_count ON entities(mention_count DESC);
CREATE INDEX idx_entities_confidence ON entities(confidence DESC);

-- Relationships: Graph edges between messages and entities
CREATE TABLE IF NOT EXISTS relationships (
  relationship_id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,               -- message_id or entity_id
  source_type TEXT NOT NULL CHECK(source_type IN ('message', 'entity')),
  target_id TEXT NOT NULL,               -- message_id or entity_id
  target_type TEXT NOT NULL CHECK(target_type IN ('message', 'entity')),
  relationship_type TEXT NOT NULL CHECK(relationship_type IN (
    'references',       -- Message replies to/references another message
    'related_topic',    -- Messages/entities share topic
    'decision_about',   -- Decision made about entity
    'action_item',      -- Action related to entity
    'question_answer',  -- Q&A relationship
    'continuation',     -- Conversation continuation
    'mentions'          -- Message mentions entity
  )),
  strength REAL DEFAULT 1.0,             -- Relationship strength (0-1)
  created_at INTEGER NOT NULL,
  metadata TEXT,                         -- JSON: {confidence, evidence}
  CHECK (strength >= 0 AND strength <= 1)
);

CREATE INDEX idx_relationships_source ON relationships(source_id, source_type, relationship_type);
CREATE INDEX idx_relationships_target ON relationships(target_id, target_type, relationship_type);
CREATE INDEX idx_relationships_type ON relationships(relationship_type, strength DESC);
CREATE INDEX idx_relationships_created_at ON relationships(created_at DESC);

-- ============================================================================
-- Intelligent Summarization Tables
-- ============================================================================

-- Summaries: Generated summaries for different scopes
CREATE TABLE IF NOT EXISTS summaries (
  summary_id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK(scope_type IN (
    'conversation',      -- Summary of entire conversation
    'topic',             -- Summary of specific topic/entity
    'entity',            -- Summary related to entity
    'time_window',       -- Summary of time range
    'personalization'    -- User personalization summary
  )),
  scope_id TEXT,                         -- conversation_id, entity_id, or time range
  summary_type TEXT NOT NULL CHECK(summary_type IN (
    'history',           -- Historical summary (what happened)
    'focus',             -- Focus view (most relevant now)
    'detail',            -- Detail view (supporting context)
    'global',            -- Global view (themes, relationships)
    'update',            -- Update summary (what's new)
    'personalization'    -- User preferences and patterns
  )),
  content TEXT NOT NULL,                 -- Summary content
  token_count INTEGER NOT NULL,          -- Accurate token count
  source_message_ids TEXT,               -- JSON array of message IDs
  source_entity_ids TEXT,                -- JSON array of entity IDs
  created_at INTEGER NOT NULL,
  valid_until INTEGER,                   -- Cache expiration timestamp
  confidence REAL DEFAULT 1.0,           -- Summary quality confidence
  metadata TEXT,                         -- JSON: {model, coverage, compression_ratio}
  CHECK (token_count >= 0),
  CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE INDEX idx_summaries_scope ON summaries(scope_type, scope_id, summary_type);
CREATE INDEX idx_summaries_valid ON summaries(valid_until);
CREATE INDEX idx_summaries_type ON summaries(summary_type, confidence DESC);
CREATE INDEX idx_summaries_created_at ON summaries(created_at DESC);

-- User Preferences: Personalization data extracted from patterns
CREATE TABLE IF NOT EXISTS user_preferences (
  preference_id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,                -- 'language', 'framework', 'work_pattern', 'role'
  key TEXT NOT NULL,                     -- Specific preference key
  value TEXT NOT NULL,                   -- Preference value
  confidence REAL DEFAULT 1.0,           -- How confident in this preference (0-1)
  evidence_count INTEGER DEFAULT 1,      -- Number of observations
  first_observed INTEGER NOT NULL,       -- First observation timestamp
  last_observed INTEGER NOT NULL,        -- Latest observation timestamp
  metadata TEXT,                         -- JSON: {evidence_messages, patterns}
  CHECK (confidence >= 0 AND confidence <= 1),
  CHECK (evidence_count >= 1)
);

CREATE INDEX idx_preferences_category ON user_preferences(category, confidence DESC);
CREATE INDEX idx_preferences_key ON user_preferences(key);
CREATE INDEX idx_preferences_confidence ON user_preferences(confidence DESC);
CREATE INDEX idx_preferences_last_observed ON user_preferences(last_observed DESC);

-- ============================================================================
-- Auto-Update Tracking
-- ============================================================================

-- Update Events: Track auto-update processing
CREATE TABLE IF NOT EXISTS update_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,               -- From sources table
  update_type TEXT NOT NULL CHECK(update_type IN (
    'add',          -- New content added
    'change',       -- Existing content changed
    'delete'        -- Content deleted
  )),
  items_processed INTEGER DEFAULT 0,     -- Number of items processed
  entities_extracted INTEGER DEFAULT 0,  -- Entities found
  relationships_created INTEGER DEFAULT 0, -- Relationships created
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  status TEXT DEFAULT 'pending' CHECK(status IN (
    'pending',      -- Queued
    'processing',   -- Currently processing
    'completed',    -- Successfully completed
    'failed'        -- Failed with error
  )),
  error_message TEXT,                    -- Error details if failed
  metadata TEXT,                         -- JSON: {file_path, changes}
  FOREIGN KEY (source_id) REFERENCES sources(source_id) ON DELETE CASCADE
);

CREATE INDEX idx_update_events_source ON update_events(source_id, started_at DESC);
CREATE INDEX idx_update_events_status ON update_events(status);
CREATE INDEX idx_update_events_completed ON update_events(completed_at DESC);

-- ============================================================================
-- Views for M2
-- ============================================================================

-- Entity statistics view
CREATE VIEW IF NOT EXISTS entity_stats AS
SELECT
  e.entity_id,
  e.entity_type,
  e.name,
  e.canonical_name,
  e.mention_count,
  e.confidence,
  COUNT(DISTINCT r.relationship_id) as connection_count,
  e.first_mentioned,
  e.last_mentioned
FROM entities e
LEFT JOIN relationships r ON
  (r.source_id = e.entity_id AND r.source_type = 'entity')
  OR (r.target_id = e.entity_id AND r.target_type = 'entity')
GROUP BY e.entity_id
ORDER BY e.mention_count DESC, connection_count DESC;

-- Context graph summary view
CREATE VIEW IF NOT EXISTS graph_stats AS
SELECT
  (SELECT COUNT(*) FROM entities) as total_entities,
  (SELECT COUNT(*) FROM entities WHERE entity_type = 'person') as person_count,
  (SELECT COUNT(*) FROM entities WHERE entity_type = 'topic') as topic_count,
  (SELECT COUNT(*) FROM entities WHERE entity_type = 'decision') as decision_count,
  (SELECT COUNT(*) FROM entities WHERE entity_type = 'action') as action_count,
  (SELECT COUNT(*) FROM entities WHERE entity_type = 'question') as question_count,
  (SELECT COUNT(*) FROM entities WHERE entity_type = 'project') as project_count,
  (SELECT COUNT(*) FROM relationships) as total_relationships,
  (SELECT COUNT(*) FROM relationships WHERE relationship_type = 'mentions') as mention_relationships,
  (SELECT COUNT(*) FROM relationships WHERE relationship_type = 'related_topic') as topic_relationships,
  (SELECT COUNT(*) FROM summaries) as total_summaries,
  (SELECT COUNT(*) FROM summaries WHERE summary_type = 'focus') as focus_summaries,
  (SELECT COUNT(*) FROM summaries WHERE summary_type = 'detail') as detail_summaries,
  (SELECT COUNT(*) FROM summaries WHERE summary_type = 'global') as global_summaries,
  (SELECT COUNT(*) FROM user_preferences) as total_preferences;

-- Recent entity activity view
CREATE VIEW IF NOT EXISTS recent_entity_activity AS
SELECT
  e.entity_id,
  e.entity_type,
  e.name,
  e.canonical_name,
  e.mention_count,
  e.last_mentioned,
  COUNT(DISTINCT m.message_id) as recent_message_count
FROM entities e
LEFT JOIN relationships r ON
  (r.target_id = e.entity_id AND r.target_type = 'entity' AND r.source_type = 'message')
LEFT JOIN messages m ON r.source_id = m.message_id
WHERE e.last_mentioned > (strftime('%s', 'now') * 1000 - 86400000)  -- Last 24 hours
GROUP BY e.entity_id
ORDER BY e.last_mentioned DESC;

-- ============================================================================
-- Triggers for M2
-- ============================================================================

-- Auto-update entity last_mentioned timestamp
CREATE TRIGGER IF NOT EXISTS entities_update_mentioned AFTER INSERT ON relationships
WHEN NEW.target_type = 'entity' AND NEW.relationship_type = 'mentions'
BEGIN
  UPDATE entities
  SET
    last_mentioned = NEW.created_at,
    mention_count = mention_count + 1
  WHERE entity_id = NEW.target_id;
END;

-- Invalidate summaries when conversation updated
CREATE TRIGGER IF NOT EXISTS summaries_invalidate_on_message AFTER INSERT ON messages
BEGIN
  UPDATE summaries
  SET valid_until = strftime('%s', 'now') * 1000  -- Expire immediately
  WHERE scope_type = 'conversation'
    AND scope_id = NEW.conversation_id
    AND summary_type IN ('history', 'update');
END;

-- ============================================================================
-- Migration Complete
-- ============================================================================

INSERT INTO system_metadata (key, value, updated_at)
VALUES ('m2_graph_migration', 'completed', strftime('%s', 'now') * 1000)
ON CONFLICT(key) DO UPDATE SET value = 'completed', updated_at = strftime('%s', 'now') * 1000;

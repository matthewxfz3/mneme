/**
 * Mneme M2 - Context Graph Types
 *
 * Type definitions for entities, relationships, and graph operations.
 */

// ============================================================================
// Entity Types
// ============================================================================

export type EntityType = 'person' | 'topic' | 'decision' | 'action' | 'question' | 'project';

export interface Entity {
  entity_id: string;
  entity_type: EntityType;
  name: string;
  canonical_name?: string;
  first_mentioned: number;
  last_mentioned: number;
  mention_count: number;
  confidence: number;
  metadata?: EntityMetadata;
}

export interface EntityMetadata {
  aliases?: string[];
  context?: string;
  sentiment?: number; // -1 to 1
  extraction_method?: 'pattern' | 'llm';
  pattern_source?: string;
  [key: string]: unknown;
}

// ============================================================================
// Relationship Types
// ============================================================================

export type RelationshipType =
  | 'references'      // Message replies to/references another message
  | 'related_topic'   // Messages/entities share topic
  | 'decision_about'  // Decision made about entity
  | 'action_item'     // Action related to entity
  | 'question_answer' // Q&A relationship
  | 'continuation'    // Conversation continuation
  | 'mentions';       // Message mentions entity

export type NodeType = 'message' | 'entity';

export interface Relationship {
  relationship_id?: number;
  source_id: string;
  source_type: NodeType;
  target_id: string;
  target_type: NodeType;
  relationship_type: RelationshipType;
  strength: number;
  created_at: number;
  metadata?: RelationshipMetadata;
}

export interface RelationshipMetadata {
  confidence?: number;
  evidence?: string[];
  co_occurrence_message?: string;
  time_gap?: number;
  [key: string]: unknown;
}

// ============================================================================
// Summary Types
// ============================================================================

export type ScopeType = 'conversation' | 'topic' | 'entity' | 'time_window' | 'personalization';
export type SummaryType = 'history' | 'focus' | 'detail' | 'global' | 'update' | 'personalization';

export interface Summary {
  summary_id: string;
  scope_type: ScopeType;
  scope_id?: string;
  summary_type: SummaryType;
  content: string;
  token_count: number;
  source_message_ids?: string[];
  source_entity_ids?: string[];
  created_at: number;
  valid_until?: number;
  confidence: number;
  metadata?: SummaryMetadata;
}

export interface SummaryMetadata {
  model?: string;
  coverage?: number;
  compression_ratio?: number;
  granularity?: 'detailed' | 'medium' | 'brief';
  windows?: number;
  theme_count?: number;
  decision_count?: number;
  personalization_included?: boolean;
  [key: string]: unknown;
}

// ============================================================================
// User Preference Types
// ============================================================================

export interface UserPreference {
  preference_id?: number;
  category: string;
  key: string;
  value: string;
  confidence: number;
  evidence_count: number;
  first_observed: number;
  last_observed: number;
  metadata?: UserPreferenceMetadata;
}

export interface UserPreferenceMetadata {
  evidence_messages?: string[];
  patterns?: string[];
  all_roles?: Record<string, number>;
  sample_size?: number;
  [key: string]: unknown;
}

// ============================================================================
// Graph Traversal Types
// ============================================================================

export interface TraversalOptions {
  maxDepth?: number;
  maxResults?: number;
  relationshipTypes?: RelationshipType[];
  minStrength?: number;
}

export interface ContextNode {
  id: string;
  type: NodeType;
  data: Entity | Message;
  depth: number;
  path: string[];
}

export interface GraphPath {
  start: string;
  end: string;
  path: Array<{
    node_id: string;
    node_type: NodeType;
    relationship_type: RelationshipType;
  }>;
  length: number;
}

// ============================================================================
// Extraction Types
// ============================================================================

export interface EntityPattern {
  type: EntityType;
  pattern: RegExp;
  confidence: number;
  extractor: (match: RegExpMatchArray) => string;
}

export interface ExtractionResult {
  entities: Entity[];
  relationships: Relationship[];
  confidence: number;
}

// ============================================================================
// Multi-View Summarization Types
// ============================================================================

export interface MultiViewSummary {
  focus: ViewContent;
  detail: ViewContent;
  global: ViewContent;
}

export interface ViewContent {
  items: ContextItem[];
  summary: string;
  confidence: number;
  metadata: Record<string, unknown>;
}

export interface ContextItem {
  message_id?: string;
  entity_id?: string;
  type?: EntityType | 'message';
  name?: string;
  content?: string;
  score?: number;
  connection_count?: number;
  [key: string]: unknown;
}

// ============================================================================
// Auto-Update Types
// ============================================================================

export type UpdateType = 'add' | 'change' | 'delete';
export type UpdateStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface UpdateEvent {
  event_id?: number;
  source_id: string;
  update_type: UpdateType;
  items_processed: number;
  entities_extracted: number;
  relationships_created: number;
  started_at: number;
  completed_at?: number;
  status: UpdateStatus;
  error_message?: string;
  metadata?: UpdateEventMetadata;
}

export interface UpdateEventMetadata {
  file_path?: string;
  changes?: Array<{
    type: UpdateType;
    path: string;
  }>;
  [key: string]: unknown;
}

export interface UpdateSummary {
  since: Date;
  new_messages: number;
  new_entities: number;
  new_relationships: number;
  updates: Array<{
    category: 'urgent' | 'informational' | 'blocking';
    description: string;
    timestamp: number;
  }>;
}

// ============================================================================
// Statistics Types
// ============================================================================

export interface EntityStats {
  entity_id: string;
  entity_type: EntityType;
  name: string;
  canonical_name?: string;
  mention_count: number;
  confidence: number;
  connection_count: number;
  first_mentioned: number;
  last_mentioned: number;
}

export interface GraphStats {
  total_entities: number;
  person_count: number;
  topic_count: number;
  decision_count: number;
  action_count: number;
  question_count: number;
  project_count: number;
  total_relationships: number;
  mention_relationships: number;
  topic_relationships: number;
  total_summaries: number;
  focus_summaries: number;
  detail_summaries: number;
  global_summaries: number;
  total_preferences: number;
}

// Re-export Message type for convenience
export interface Message {
  message_id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tokens: number;
  model_family?: string;
  sequence_num: number;
  created_at: number;
  metadata?: Record<string, unknown>;
}

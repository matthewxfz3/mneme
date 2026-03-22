/**
 * Mneme M2 - Relationship Detector
 *
 * Detects relationships between messages and entities using GraphRAG-inspired approach.
 * Builds the context graph with semantic and temporal relationships.
 */

import type {
  Entity,
  Message,
  Relationship,
  RelationshipType,
  ExtractionResult,
} from './types.js';

export interface RelationshipDetectionOptions {
  maxPreviousMessages?: number;
  minRelationshipStrength?: number;
  enableCoOccurrence?: boolean;
  timeWindowMs?: number;
}

export class RelationshipDetector {
  private readonly options: Required<RelationshipDetectionOptions>;

  constructor(options: RelationshipDetectionOptions = {}) {
    this.options = {
      maxPreviousMessages: options.maxPreviousMessages ?? 10,
      minRelationshipStrength: options.minRelationshipStrength ?? 0.5,
      enableCoOccurrence: options.enableCoOccurrence ?? true,
      timeWindowMs: options.timeWindowMs ?? 3600000, // 1 hour default
    };
  }

  /**
   * Detect all relationships for a message and its entities
   */
  async detectRelationships(
    message: Message,
    entities: Entity[],
    previousMessages: Message[],
    previousEntities: Map<string, Entity[]>
  ): Promise<Relationship[]> {
    const relationships: Relationship[] = [];
    const now = Date.now();

    // 1. Message → Entity relationships (mentions)
    for (const entity of entities) {
      relationships.push({
        source_id: message.message_id,
        source_type: 'message',
        target_id: entity.entity_id,
        target_type: 'entity',
        relationship_type: 'mentions',
        strength: entity.confidence,
        created_at: now,
        metadata: {
          entity_type: entity.entity_type,
          confidence: entity.confidence,
        },
      });
    }

    // 2. Message → Message relationships
    const messageRelationships = await this.detectMessageRelationships(
      message,
      previousMessages
    );
    relationships.push(...messageRelationships);

    // 3. Entity → Entity relationships (co-occurrence)
    if (this.options.enableCoOccurrence && entities.length > 1) {
      const entityRelationships = this.detectEntityCoOccurrence(
        entities,
        message
      );
      relationships.push(...entityRelationships);
    }

    // 4. Cross-entity relationships (decisions about topics, actions for projects, etc.)
    const crossRelationships = this.detectCrossEntityRelationships(
      entities,
      message
    );
    relationships.push(...crossRelationships);

    // 5. Temporal relationships (if within time window)
    const temporalRelationships = await this.detectTemporalRelationships(
      message,
      entities,
      previousMessages,
      previousEntities
    );
    relationships.push(...temporalRelationships);

    // Filter by minimum strength
    return relationships.filter(
      r => r.strength >= this.options.minRelationshipStrength
    );
  }

  /**
   * Detect message-to-message relationships
   */
  private async detectMessageRelationships(
    message: Message,
    previousMessages: Message[]
  ): Promise<Relationship[]> {
    const relationships: Relationship[] = [];
    const recentMessages = previousMessages.slice(-this.options.maxPreviousMessages);

    for (const prevMsg of recentMessages) {
      // Explicit references
      const explicitRef = this.detectExplicitReference(message, prevMsg);
      if (explicitRef) {
        relationships.push(explicitRef);
        continue;
      }

      // Continuation (short time gap, same role often)
      const continuation = this.detectContinuation(message, prevMsg);
      if (continuation) {
        relationships.push(continuation);
      }

      // Question-Answer pairs
      const qaRelationship = this.detectQuestionAnswer(message, prevMsg);
      if (qaRelationship) {
        relationships.push(qaRelationship);
      }
    }

    return relationships;
  }

  /**
   * Detect explicit references ("as mentioned", "like Bob said")
   */
  private detectExplicitReference(
    message: Message,
    prevMessage: Message
  ): Relationship | null {
    const content = message.content.toLowerCase();

    const referencePatterns = [
      /as (?:i|you|we|they) (?:mentioned|said|noted)/i,
      /like (?:\w+) said/i,
      /mentioned (?:above|earlier|previously)/i,
      /(?:see|check) (?:above|previous|earlier)/i,
      /following up on/i,
      /regarding (?:your|the) (?:question|comment|message)/i,
    ];

    for (const pattern of referencePatterns) {
      if (pattern.test(content)) {
        return {
          source_id: message.message_id,
          source_type: 'message',
          target_id: prevMessage.message_id,
          target_type: 'message',
          relationship_type: 'references',
          strength: 0.9,
          created_at: Date.now(),
          metadata: {
            reference_type: 'explicit',
            pattern: pattern.source,
          },
        };
      }
    }

    return null;
  }

  /**
   * Detect conversation continuation
   */
  private detectContinuation(
    message: Message,
    prevMessage: Message
  ): Relationship | null {
    const timeGap = message.created_at - prevMessage.created_at;

    // Within time window?
    if (timeGap > this.options.timeWindowMs) {
      return null;
    }

    // Adjacent messages from same role are likely continuations
    const isSameRole = message.role === prevMessage.role;

    // Very short messages are often continuations
    const isShortMessage = message.content.length < 50;

    if (isSameRole && timeGap < 60000) { // Within 1 minute
      const strength = isShortMessage ? 0.85 : 0.75;

      return {
        source_id: message.message_id,
        source_type: 'message',
        target_id: prevMessage.message_id,
        target_type: 'message',
        relationship_type: 'continuation',
        strength,
        created_at: Date.now(),
        metadata: {
          time_gap_ms: timeGap,
          same_role: isSameRole,
        },
      };
    }

    return null;
  }

  /**
   * Detect question-answer pairs
   */
  private detectQuestionAnswer(
    message: Message,
    prevMessage: Message
  ): Relationship | null {
    // Previous message is a question?
    const hasQuestion = prevMessage.content.includes('?');

    if (!hasQuestion) return null;

    // Current message from different role (answer pattern)
    const isDifferentRole = message.role !== prevMessage.role;

    // Within reasonable time (5 minutes)
    const timeGap = message.created_at - prevMessage.created_at;
    const isTimelyResponse = timeGap < 300000;

    if (isDifferentRole && isTimelyResponse) {
      const strength = 0.8;

      return {
        source_id: message.message_id,
        source_type: 'message',
        target_id: prevMessage.message_id,
        target_type: 'message',
        relationship_type: 'question_answer',
        strength,
        created_at: Date.now(),
        metadata: {
          time_gap_ms: timeGap,
        },
      };
    }

    return null;
  }

  /**
   * Detect entity co-occurrence (mentioned together)
   */
  private detectEntityCoOccurrence(
    entities: Entity[],
    message: Message
  ): Relationship[] {
    const relationships: Relationship[] = [];

    // Create relationships between all pairs
    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        const entity1 = entities[i];
        const entity2 = entities[j];

        // Strength based on confidence of both entities
        const strength = Math.min(entity1.confidence, entity2.confidence) * 0.6;

        relationships.push({
          source_id: entity1.entity_id,
          source_type: 'entity',
          target_id: entity2.entity_id,
          target_type: 'entity',
          relationship_type: 'related_topic',
          strength,
          created_at: Date.now(),
          metadata: {
            co_occurrence_message: message.message_id,
            entity1_type: entity1.entity_type,
            entity2_type: entity2.entity_type,
          },
        });
      }
    }

    return relationships;
  }

  /**
   * Detect cross-entity relationships (decisions about topics, etc.)
   */
  private detectCrossEntityRelationships(
    entities: Entity[],
    message: Message
  ): Relationship[] {
    const relationships: Relationship[] = [];

    const decisions = entities.filter(e => e.entity_type === 'decision');
    const topics = entities.filter(e => e.entity_type === 'topic');
    const projects = entities.filter(e => e.entity_type === 'project');
    const actions = entities.filter(e => e.entity_type === 'action');

    // Decisions about topics/projects
    for (const decision of decisions) {
      for (const topic of [...topics, ...projects]) {
        relationships.push({
          source_id: decision.entity_id,
          source_type: 'entity',
          target_id: topic.entity_id,
          target_type: 'entity',
          relationship_type: 'decision_about',
          strength: 0.75,
          created_at: Date.now(),
          metadata: {
            context_message: message.message_id,
          },
        });
      }
    }

    // Actions for projects
    for (const action of actions) {
      for (const project of projects) {
        relationships.push({
          source_id: action.entity_id,
          source_type: 'entity',
          target_id: project.entity_id,
          target_type: 'entity',
          relationship_type: 'action_item',
          strength: 0.8,
          created_at: Date.now(),
          metadata: {
            context_message: message.message_id,
          },
        });
      }
    }

    return relationships;
  }

  /**
   * Detect temporal relationships (recurring topics, similar discussions)
   */
  private async detectTemporalRelationships(
    message: Message,
    entities: Entity[],
    previousMessages: Message[],
    previousEntities: Map<string, Entity[]>
  ): Promise<Relationship[]> {
    const relationships: Relationship[] = [];

    // Find messages with overlapping entities
    for (const prevMsg of previousMessages) {
      const prevEntitiesList = previousEntities.get(prevMsg.message_id) || [];

      const overlap = this.calculateEntityOverlap(entities, prevEntitiesList);

      // If significant overlap, create related_topic relationship
      if (overlap > 0.3) {
        const timeGap = message.created_at - prevMsg.created_at;

        // Only within time window
        if (timeGap <= this.options.timeWindowMs) {
          relationships.push({
            source_id: message.message_id,
            source_type: 'message',
            target_id: prevMsg.message_id,
            target_type: 'message',
            relationship_type: 'related_topic',
            strength: overlap * 0.7,
            created_at: Date.now(),
            metadata: {
              entity_overlap: overlap,
              time_gap_ms: timeGap,
            },
          });
        }
      }
    }

    return relationships;
  }

  /**
   * Calculate entity overlap between two entity sets
   */
  private calculateEntityOverlap(
    entities1: Entity[],
    entities2: Entity[]
  ): number {
    if (entities1.length === 0 || entities2.length === 0) {
      return 0;
    }

    const set1 = new Set(entities1.map(e => e.canonical_name || e.name));
    const set2 = new Set(entities2.map(e => e.canonical_name || e.name));

    let overlapCount = 0;
    for (const entity of set1) {
      if (set2.has(entity)) {
        overlapCount++;
      }
    }

    // Jaccard similarity
    const union = new Set([...set1, ...set2]);
    return overlapCount / union.size;
  }

  /**
   * Get relationship detection statistics
   */
  getStats(): {
    maxPreviousMessages: number;
    minRelationshipStrength: number;
    enableCoOccurrence: boolean;
    timeWindowMs: number;
  } {
    return { ...this.options };
  }

  /**
   * Update detection options
   */
  updateOptions(options: Partial<RelationshipDetectionOptions>): void {
    Object.assign(this.options, options);
  }
}

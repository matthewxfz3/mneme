/**
 * Mneme M2 - Graph Traversal
 *
 * BFS/DFS graph traversal for context discovery.
 * Finds related messages and entities through relationship graph.
 */

import type Database from 'better-sqlite3';
import type {
  ContextNode,
  GraphPath,
  Relationship,
  RelationshipType,
  TraversalOptions,
  Entity,
  Message,
} from './types.js';

export class GraphTraversal {
  constructor(private db: Database.Database) {}

  /**
   * Get related context starting from a node (BFS)
   */
  async getRelatedContext(
    startNodeId: string,
    startNodeType: 'message' | 'entity',
    options: TraversalOptions = {}
  ): Promise<ContextNode[]> {
    const {
      maxDepth = 3,
      maxResults = 50,
      relationshipTypes = null,
      minStrength = 0.5,
    } = options;

    const visited = new Set<string>();
    const results: ContextNode[] = [];
    const queue: Array<{
      id: string;
      type: 'message' | 'entity';
      depth: number;
      path: string[];
    }> = [
      { id: startNodeId, type: startNodeType, depth: 0, path: [] }
    ];

    while (queue.length > 0 && results.length < maxResults) {
      const current = queue.shift()!;

      if (current.depth > maxDepth) continue;

      const nodeKey = `${current.type}:${current.id}`;
      if (visited.has(nodeKey)) continue;

      visited.add(nodeKey);

      // Get node data
      const data = await this.getNodeData(current.id, current.type);
      if (data) {
        results.push({
          id: current.id,
          type: current.type,
          data,
          depth: current.depth,
          path: current.path,
        });
      }

      // Get neighbors
      const relationships = await this.getRelationships(
        current.id,
        current.type,
        relationshipTypes,
        minStrength
      );

      for (const rel of relationships) {
        // Determine neighbor
        const isSource = rel.source_id === current.id && rel.source_type === current.type;
        const neighborId = isSource ? rel.target_id : rel.source_id;
        const neighborType = isSource ? rel.target_type : rel.source_type;

        const neighborKey = `${neighborType}:${neighborId}`;
        if (visited.has(neighborKey)) continue;

        queue.push({
          id: neighborId,
          type: neighborType,
          depth: current.depth + 1,
          path: [...current.path, rel.relationship_type],
        });
      }
    }

    return results;
  }

  /**
   * Find shortest path between two nodes (BFS)
   */
  async findShortestPath(
    startId: string,
    startType: 'message' | 'entity',
    endId: string,
    endType: 'message' | 'entity',
    maxDepth: number = 5
  ): Promise<GraphPath | null> {
    const visited = new Set<string>();
    const queue: Array<{
      id: string;
      type: 'message' | 'entity';
      depth: number;
      path: Array<{
        node_id: string;
        node_type: 'message' | 'entity';
        relationship_type: RelationshipType;
      }>;
    }> = [
      { id: startId, type: startType, depth: 0, path: [] }
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.depth > maxDepth) continue;

      const nodeKey = `${current.type}:${current.id}`;
      if (visited.has(nodeKey)) continue;

      visited.add(nodeKey);

      // Found target?
      if (current.id === endId && current.type === endType) {
        return {
          start: startId,
          end: endId,
          path: current.path,
          length: current.path.length,
        };
      }

      // Get neighbors
      const relationships = await this.getRelationships(
        current.id,
        current.type,
        null,
        0.5
      );

      for (const rel of relationships) {
        const isSource = rel.source_id === current.id && rel.source_type === current.type;
        const neighborId = isSource ? rel.target_id : rel.source_id;
        const neighborType = isSource ? rel.target_type : rel.source_type;

        const neighborKey = `${neighborType}:${neighborId}`;
        if (visited.has(neighborKey)) continue;

        queue.push({
          id: neighborId,
          type: neighborType,
          depth: current.depth + 1,
          path: [
            ...current.path,
            {
              node_id: neighborId,
              node_type: neighborType,
              relationship_type: rel.relationship_type,
            },
          ],
        });
      }
    }

    return null; // No path found
  }

  /**
   * Get all neighbors of a node (1-hop)
   */
  async getNeighbors(
    nodeId: string,
    nodeType: 'message' | 'entity',
    relationshipType?: RelationshipType
  ): Promise<ContextNode[]> {
    const typeFilter = relationshipType
      ? `AND relationship_type = '${relationshipType}'`
      : '';

    const relationships = this.db.prepare(`
      SELECT * FROM relationships
      WHERE (
        (source_id = ? AND source_type = ?)
        OR (target_id = ? AND target_type = ?)
      )
      ${typeFilter}
      ORDER BY strength DESC
    `).all(nodeId, nodeType, nodeId, nodeType) as Relationship[];

    const neighbors: ContextNode[] = [];

    for (const rel of relationships) {
      const isSource = rel.source_id === nodeId && rel.source_type === nodeType;
      const neighborId = isSource ? rel.target_id : rel.source_id;
      const neighborType = isSource ? rel.target_type : rel.source_type;

      const data = await this.getNodeData(neighborId, neighborType);
      if (data) {
        neighbors.push({
          id: neighborId,
          type: neighborType,
          data,
          depth: 1,
          path: [rel.relationship_type],
        });
      }
    }

    return neighbors;
  }

  /**
   * Get strongly connected entities (high relationship strength)
   */
  async getStronglyConnectedEntities(
    entityId: string,
    minStrength: number = 0.75,
    limit: number = 10
  ): Promise<Array<{
    entity: Entity;
    strength: number;
    relationship_type: RelationshipType;
  }>> {
    const relationships = this.db.prepare(`
      SELECT * FROM relationships
      WHERE (
        (source_id = ? AND source_type = 'entity')
        OR (target_id = ? AND target_type = 'entity')
      )
      AND strength >= ?
      ORDER BY strength DESC
      LIMIT ?
    `).all(entityId, entityId, minStrength, limit) as Relationship[];

    const results: Array<{
      entity: Entity;
      strength: number;
      relationship_type: RelationshipType;
    }> = [];

    for (const rel of relationships) {
      const isSource = rel.source_id === entityId;
      const connectedId = isSource ? rel.target_id : rel.source_id;

      if (rel.target_type === 'entity' || rel.source_type === 'entity') {
        const entity = this.db.prepare(`
          SELECT * FROM entities WHERE entity_id = ?
        `).get(connectedId) as Entity | undefined;

        if (entity) {
          results.push({
            entity: this.parseEntity(entity),
            strength: rel.strength,
            relationship_type: rel.relationship_type,
          });
        }
      }
    }

    return results;
  }

  /**
   * Get relationship density (how connected is the graph?)
   */
  async getGraphDensity(
    conversationId?: string
  ): Promise<{
    nodeCount: number;
    edgeCount: number;
    density: number;
    avgDegree: number;
  }> {
    let messageFilter = '';
    let params: any[] = [];

    if (conversationId) {
      messageFilter = `
        WHERE source_id IN (
          SELECT message_id FROM messages WHERE conversation_id = ?
        )
        OR target_id IN (
          SELECT message_id FROM messages WHERE conversation_id = ?
        )
      `;
      params = [conversationId, conversationId];
    }

    const edgeCount = this.db.prepare(`
      SELECT COUNT(*) as count FROM relationships ${messageFilter}
    `).get(...params) as { count: number };

    const nodeCount = this.db.prepare(`
      SELECT COUNT(DISTINCT node) as count FROM (
        SELECT source_id as node FROM relationships ${messageFilter}
        UNION
        SELECT target_id as node FROM relationships ${messageFilter}
      )
    `).get(...params) as { count: number };

    const n = nodeCount.count;
    const e = edgeCount.count;

    // Density = 2E / (N * (N-1)) for directed graph
    const density = n > 1 ? (2 * e) / (n * (n - 1)) : 0;
    const avgDegree = n > 0 ? (2 * e) / n : 0;

    return {
      nodeCount: n,
      edgeCount: e,
      density,
      avgDegree,
    };
  }

  /**
   * Get centrality scores (which entities are most connected?)
   */
  async getEntityCentrality(
    limit: number = 20
  ): Promise<Array<{
    entity: Entity;
    degree: number;
    strength_sum: number;
  }>> {
    const results = this.db.prepare(`
      SELECT
        e.*,
        COUNT(r.relationship_id) as degree,
        SUM(r.strength) as strength_sum
      FROM entities e
      LEFT JOIN relationships r ON
        (r.source_id = e.entity_id AND r.source_type = 'entity')
        OR (r.target_id = e.entity_id AND r.target_type = 'entity')
      GROUP BY e.entity_id
      ORDER BY degree DESC, strength_sum DESC
      LIMIT ?
    `).all(limit) as any[];

    return results.map(row => ({
      entity: this.parseEntity(row),
      degree: row.degree,
      strength_sum: row.strength_sum || 0,
    }));
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Get relationships for a node
   */
  private async getRelationships(
    nodeId: string,
    nodeType: 'message' | 'entity',
    relationshipTypes: RelationshipType[] | null,
    minStrength: number
  ): Promise<Relationship[]> {
    const typeFilter = relationshipTypes
      ? `AND relationship_type IN (${relationshipTypes.map(t => `'${t}'`).join(',')})`
      : '';

    return this.db.prepare(`
      SELECT * FROM relationships
      WHERE (
        (source_id = ? AND source_type = ?)
        OR (target_id = ? AND target_type = ?)
      )
      AND strength >= ?
      ${typeFilter}
      ORDER BY strength DESC
    `).all(nodeId, nodeType, nodeId, nodeType, minStrength) as Relationship[];
  }

  /**
   * Get node data (message or entity)
   */
  private async getNodeData(
    nodeId: string,
    nodeType: 'message' | 'entity'
  ): Promise<Entity | Message | null> {
    if (nodeType === 'message') {
      const message = this.db.prepare(`
        SELECT * FROM messages WHERE message_id = ?
      `).get(nodeId) as any;

      return message ? this.parseMessage(message) : null;
    } else {
      const entity = this.db.prepare(`
        SELECT * FROM entities WHERE entity_id = ?
      `).get(nodeId) as any;

      return entity ? this.parseEntity(entity) : null;
    }
  }

  /**
   * Parse message row
   */
  private parseMessage(row: any): Message {
    return {
      message_id: row.message_id,
      conversation_id: row.conversation_id,
      role: row.role,
      content: row.content,
      tokens: row.tokens,
      model_family: row.model_family,
      sequence_num: row.sequence_num,
      created_at: row.created_at,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  /**
   * Parse entity row
   */
  private parseEntity(row: any): Entity {
    return {
      entity_id: row.entity_id,
      entity_type: row.entity_type,
      name: row.name,
      canonical_name: row.canonical_name,
      first_mentioned: row.first_mentioned,
      last_mentioned: row.last_mentioned,
      mention_count: row.mention_count,
      confidence: row.confidence,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }
}

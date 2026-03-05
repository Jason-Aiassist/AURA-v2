/**
 * Graph Traversal Search
 * Implements graph traversal to find connected concepts through relationships
 */

import neo4j from "neo4j-driver";
import type { Neo4jDriver } from "../../adapters/kg-storage/types.js";
import { createLogger } from "../../shared/debug-logger.js";
import type { SemanticRelationship } from "../ontology/types.js";
import type {
  TraversalQuery,
  TraversalResult,
  Subgraph,
  GraphEntity,
  GraphRelationship,
  GraphPath,
  TraversalConfig,
} from "./types.js";

const logger = createLogger("GraphTraversalSearch");

/**
 * Default traversal configuration
 */
const DEFAULT_CONFIG: TraversalConfig = {
  defaultMaxDepth: 2,
  defaultMinConfidence: 0.7,
  maxPathsPerEntity: 50,
  detectCycles: true,
};

/**
 * Graph traversal search implementation
 */
export class GraphTraversalSearch {
  private driver: Neo4jDriver;
  private config: TraversalConfig;
  private database: string;

  constructor(driver: Neo4jDriver, config: Partial<TraversalConfig> = {}, database = "neo4j") {
    this.driver = driver;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.database = database;
  }

  /**
   * Find connected subgraph from starting entities
   * @param query - Traversal parameters
   * @returns Traversal result with subgraph
   */
  async findConnectedSubgraph(query: TraversalQuery): Promise<TraversalResult> {
    const startTime = Date.now();
    const correlationId = `traverse-${Date.now()}`;

    logger.start("findConnectedSubgraph", {
      correlationId,
      entityNames: query.entityNames,
      maxDepth: query.maxDepth,
      minConfidence: query.minConfidence,
    });

    try {
      // Validate query
      if (query.entityNames.length === 0) {
        throw new Error("At least one start entity required");
      }

      if (query.maxDepth < 1 || query.maxDepth > 3) {
        throw new Error("maxDepth must be 1, 2, or 3");
      }

      // Build and execute Cypher query
      logger.progress("building-cypher", { maxDepth: query.maxDepth });
      const cypherQuery = this.buildTraversalQuery(query);

      logger.progress("executing-query", {
        startEntities: query.entityNames.length,
      });

      const session = this.driver.session({ database: this.database });
      let records;

      try {
        const result = await session.run(cypherQuery, {
          entityNames: query.entityNames,
          minConfidence: query.minConfidence,
          limit: neo4j.int(Math.floor(query.limit || this.config.maxPathsPerEntity)),
        });
        records = result.records;
      } finally {
        await session.close();
      }

      logger.progress("query-complete", { records: records.length });

      // Transform results to subgraph
      const subgraph = this.transformToSubgraph(records, query);

      const durationMs = Date.now() - startTime;

      logger.success({
        correlationId,
        entitiesFound: subgraph.entities.length,
        relationshipsFound: subgraph.relationships.length,
        pathsFound: subgraph.paths.length,
        durationMs,
      });

      return {
        success: true,
        subgraph,
        metrics: {
          durationMs,
          pathsExplored: subgraph.paths.length,
          entitiesFound: subgraph.entities.length,
        },
      };
    } catch (error) {
      logger.error(error as Error, {
        correlationId,
        query,
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        subgraph: {
          entities: [],
          relationships: [],
          paths: [],
          query,
        },
        metrics: {
          durationMs: Date.now() - startTime,
          pathsExplored: 0,
          entitiesFound: 0,
        },
      };
    }
  }

  /**
   * Build Cypher traversal query
   * @param query - Traversal parameters
   * @returns Cypher query string
   */
  private buildTraversalQuery(query: TraversalQuery): string {
    const { maxDepth, relationshipTypes } = query;

    // Build relationship type filter
    const relFilter = relationshipTypes ? `:${relationshipTypes.join("|")}` : "";

    // DEBUG: Log what we're looking for
    logger.progress("building-cypher-debug", {
      entityNames: query.entityNames,
      relFilter: relFilter || "(any)",
      maxDepth,
    });

    // Build variable-length path query - look for BOTH directions
    // The issue: Steve's relationships might be INCOMING, not outgoing
    return `
      MATCH path = (start:Entity)-[r${relFilter}*1..${maxDepth}]-(connected:Entity)
      WHERE start.name IN $entityNames
      WITH connected, path, start,
           relationships(path) as rels,
           nodes(path) as nodes
      WHERE ALL(rel IN rels WHERE rel.confidence >= $minConfidence OR rel.confidence IS NULL)
      WITH connected, start, rels, nodes,
           reduce(conf = 1.0, rel IN rels | conf * COALESCE(rel.confidence, 1.0)) as pathConfidence
      WHERE pathConfidence >= $minConfidence
      RETURN connected, rels, nodes, start, pathConfidence
      ORDER BY pathConfidence DESC
      LIMIT $limit
    `;
  }

  /**
   * Transform Neo4j records to subgraph
   * @param records - Neo4j query results
   * @param query - Original query
   * @returns Subgraph
   */
  private transformToSubgraph(records: any[], query: TraversalQuery): Subgraph {
    const entities = new Map<string, GraphEntity>();
    const relationships = new Map<string, GraphRelationship>();
    const paths: GraphPath[] = [];

    for (const record of records) {
      const connected = record.get("connected");
      const rels = record.get("rels");
      const nodes = record.get("nodes");
      const pathConfidence = record.get("pathConfidence");

      if (!connected || !rels || !nodes) continue;

      // Extract path entities
      const pathEntities: string[] = nodes.map((n: any) => n.properties.name);

      // Add entities
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const name = node.properties.name;

        if (!entities.has(name)) {
          entities.set(name, {
            name,
            type: node.properties.type,
            aliases: node.properties.aliases,
            depth: i,
            paths: [],
          });
        }
      }

      // Add relationships
      const relTypes: SemanticRelationship[] = [];
      for (const rel of rels) {
        const from = nodes[rels.indexOf(rel)].properties.name;
        const to = nodes[rels.indexOf(rel) + 1]?.properties.name;

        if (!from || !to) continue;

        const relKey = `${from}-${rel.type}-${to}`;
        // Cast rel.type to SemanticRelationship - Neo4j returns strings
        relTypes.push(rel.type as SemanticRelationship);

        if (!relationships.has(relKey)) {
          relationships.set(relKey, {
            from,
            to,
            type: rel.type as SemanticRelationship,
            confidence: rel.properties.confidence,
            fact: rel.properties.fact,
          });
        }
      }

      // Build path
      const startEntity = pathEntities[0];
      const endEntity = pathEntities[pathEntities.length - 1];

      const path: GraphPath = {
        start: startEntity,
        end: endEntity,
        hops: pathEntities.length - 1,
        confidence: pathConfidence,
        relationships: relTypes,
        entities: pathEntities,
      };

      paths.push(path);

      // Add path to end entity
      const endGraphEntity = entities.get(endEntity);
      if (endGraphEntity) {
        endGraphEntity.paths.push(path);
      }
    }

    return {
      entities: Array.from(entities.values()),
      relationships: Array.from(relationships.values()),
      paths,
      query,
    };
  }

  /**
   * Find entities related to a query entity
   * @param entityName - Entity name to find relations for
   * @param relationshipType - Optional relationship type filter
   * @param maxDepth - Maximum traversal depth
   * @returns Related entities
   */
  async findRelated(
    entityName: string,
    relationshipType?: string,
    maxDepth: 1 | 2 | 3 = 2,
  ): Promise<GraphEntity[]> {
    const result = await this.findConnectedSubgraph({
      entityNames: [entityName],
      maxDepth,
      minConfidence: this.config.defaultMinConfidence,
      relationshipTypes: relationshipType ? [relationshipType as any] : undefined,
    });

    if (!result.success) {
      return [];
    }

    // Exclude the start entity
    return result.subgraph.entities.filter((e) => e.name !== entityName);
  }

  /**
   * Find paths between two entities
   * @param fromEntity - Start entity
   * @param toEntity - Target entity
   * @param maxDepth - Maximum path length
   * @returns Paths found
   */
  async findPaths(
    fromEntity: string,
    toEntity: string,
    maxDepth: 1 | 2 | 3 = 3,
  ): Promise<GraphPath[]> {
    const result = await this.findConnectedSubgraph({
      entityNames: [fromEntity],
      maxDepth,
      minConfidence: this.config.defaultMinConfidence,
    });

    if (!result.success) {
      return [];
    }

    // Filter paths that end at target entity
    return result.subgraph.paths.filter((p) => p.end === toEntity);
  }

  /**
   * Check if two entities are connected
   * @param entity1 - First entity
   * @param entity2 - Second entity
   * @param maxDepth - Maximum path length to check
   * @returns Whether connected
   */
  async areConnected(entity1: string, entity2: string, maxDepth: 1 | 2 | 3 = 3): Promise<boolean> {
    const paths = await this.findPaths(entity1, entity2, maxDepth);
    return paths.length > 0;
  }

  /**
   * Get traversal configuration
   * @returns Current config
   */
  getConfig(): TraversalConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   * @param config - Partial config to update
   */
  updateConfig(config: Partial<TraversalConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * Create graph traversal search instance
 * @param driver - Neo4j driver
 * @param config - Optional configuration
 * @param database - Database name
 * @returns GraphTraversalSearch instance
 */
export function createGraphTraversalSearch(
  driver: Neo4jDriver,
  config?: Partial<TraversalConfig>,
  database?: string,
): GraphTraversalSearch {
  return new GraphTraversalSearch(driver, config, database);
}

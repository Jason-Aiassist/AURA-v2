/**
 * Relationship Store
 * Creates and manages semantic relationships in Neo4j
 */

import { SEMANTIC_RELATIONSHIPS } from "../../graph/ontology/constants.js";
import { createLogger } from "../../shared/debug-logger.js";
import type {
  Neo4jDriver,
  CreateRelationshipParams,
  RelationshipResult,
  KGStorageConfig,
  KGStorageDependencies,
} from "./types.js";

/**
 * Relationship store for Neo4j
 */
export class RelationshipStore {
  private driver: Neo4jDriver;
  private config: Required<KGStorageConfig>;
  private deps: KGStorageDependencies;
  private logger = createLogger("RelationshipStore");

  constructor(deps: KGStorageDependencies, config: KGStorageConfig = {}) {
    this.driver = deps.driver;
    this.deps = deps;
    this.config = {
      database: "neo4j",
      debug: false,
      ...config,
    };
  }

  /**
   * Create or update a semantic relationship
   * @param params - Relationship parameters
   * @returns Creation result
   */
  async createRelationship(params: CreateRelationshipParams): Promise<RelationshipResult> {
    const correlationId = params.correlationId || `rel-${Date.now()}`;

    this.logger.start("createRelationship", {
      fromEntity: params.fromEntity,
      toEntity: params.toEntity,
      type: params.type,
      confidence: params.confidence,
      correlationId,
    });

    // Validate relationship type
    if (!(params.type in SEMANTIC_RELATIONSHIPS)) {
      const error = `Invalid relationship type: ${params.type}`;
      this.logger.error(new Error(error), { type: params.type });
      return { success: false, error, action: "unchanged" };
    }

    const session = this.driver.session({ database: this.config.database });

    try {
      this.logger.progress("executing-cypher", { relationshipType: params.type });

      // Build aliases for both entities
      const fromAliases = this.buildAliases(params.fromEntity);
      const toAliases = this.buildAliases(params.toEntity);

      // Cypher query: Merge entities, create/update relationship
      const result = await session.run(
        `
        // Merge source entity with aliases
        MERGE (from:Entity {name: $fromEntity})
        ON CREATE SET 
          from.createdAt = datetime(),
          from.mentionCount = 1,
          from.aliases = $fromAliases
        ON MATCH SET 
          from.mentionCount = coalesce(from.mentionCount, 0) + 1,
          from.lastSeen = datetime(),
          from.aliases = coalesce(from.aliases, []) + [a IN $fromAliases WHERE NOT a IN coalesce(from.aliases, [])]
        
        // Merge target entity with aliases
        MERGE (to:Entity {name: $toEntity})
        ON CREATE SET 
          to.createdAt = datetime(),
          to.mentionCount = 1,
          to.aliases = $toAliases
        ON MATCH SET 
          to.mentionCount = coalesce(to.mentionCount, 0) + 1,
          to.lastSeen = datetime(),
          to.aliases = coalesce(to.aliases, []) + [a IN $toAliases WHERE NOT a IN coalesce(to.aliases, [])]
        
        // Merge relationship
        MERGE (from)-[r:${params.type}]->(to)
        ON CREATE SET 
          r.confidence = $confidence,
          r.createdAt = datetime(),
          r.fact = $fact
        ON MATCH SET 
          r.confidence = CASE 
            WHEN r.confidence < $confidence THEN $confidence 
            ELSE r.confidence 
          END,
          r.fact = coalesce(r.fact, $fact),
          r.lastUpdated = datetime()
        
        // Link to episode if provided
        ${
          params.episodeUuid
            ? `
        WITH from, to, r
        MATCH (ep:Episode {uuid: $episodeUuid})
        MERGE (from)-[m1:MENTIONED_IN]->(ep)
        MERGE (to)-[m2:MENTIONED_IN]->(ep)
        `
            : ""
        }
        
        RETURN 
          from.name as fromName,
          to.name as toName,
          r.confidence as confidence,
          r.createdAt as createdAt
        `,
        {
          fromEntity: params.fromEntity,
          toEntity: params.toEntity,
          fromAliases,
          toAliases,
          confidence: params.confidence,
          fact: params.fact || null,
          episodeUuid: params.episodeUuid || null,
        },
      );

      // Determine if created or updated
      const record = result.records[0];
      const action: RelationshipResult["action"] = record?.get("createdAt") ? "created" : "updated";

      this.logger.success({
        action,
        fromName: record?.get("fromName"),
        toName: record?.get("toName"),
        confidence: record?.get("confidence"),
      });

      // Audit log
      if (this.deps.auditLog) {
        await this.deps.auditLog({
          operation: "create_relationship",
          correlationId,
          metadata: {
            fromEntity: params.fromEntity,
            toEntity: params.toEntity,
            type: params.type,
            action,
          },
        });
      }

      return {
        success: true,
        action,
        confidence: record?.get("confidence") as number,
      };
    } catch (error) {
      this.logger.error(error as Error, {
        fromEntity: params.fromEntity,
        toEntity: params.toEntity,
        type: params.type,
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        action: "unchanged",
      };
    } finally {
      await session.close();
      this.logger.progress("session-closed");
    }
  }

  /**
   * Create multiple relationships in batch
   * @param relationships - Array of relationship parameters
   * @param correlationId - Optional correlation ID
   * @returns Array of results
   */
  async createRelationships(
    relationships: CreateRelationshipParams[],
    correlationId?: string,
  ): Promise<RelationshipResult[]> {
    this.logger.start("createRelationships", {
      count: relationships.length,
      correlationId,
    });

    const results: RelationshipResult[] = [];

    for (let i = 0; i < relationships.length; i++) {
      const result = await this.createRelationship({
        ...relationships[i],
        correlationId: correlationId || `batch-${Date.now()}-${i}`,
      });
      results.push(result);
    }

    const successCount = results.filter((r) => r.success).length;
    this.logger.success({
      total: relationships.length,
      successful: successCount,
      failed: relationships.length - successCount,
    });

    return results;
  }

  /**
   * Get existing relationship
   * @param fromEntity - Source entity name
   * @param toEntity - Target entity name
   * @param type - Relationship type
   * @returns Relationship data or null
   */
  async getRelationship(
    fromEntity: string,
    toEntity: string,
    type: string,
  ): Promise<{ confidence: number; fact?: string; createdAt?: string } | null> {
    const session = this.driver.session({ database: this.config.database });

    try {
      const result = await session.run(
        `
        MATCH (from:Entity {name: $fromEntity})-[r:${type}]->(to:Entity {name: $toEntity})
        RETURN r.confidence as confidence, r.fact as fact, r.createdAt as createdAt
        `,
        { fromEntity, toEntity },
      );

      if (result.records.length === 0) {
        return null;
      }

      const record = result.records[0];
      return {
        confidence: record.get("confidence") as number,
        fact: record.get("fact") as string | undefined,
        createdAt: record.get("createdAt") as string | undefined,
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Delete a relationship
   * @param fromEntity - Source entity name
   * @param toEntity - Target entity name
   * @param type - Relationship type
   * @returns Success status
   */
  async deleteRelationship(fromEntity: string, toEntity: string, type: string): Promise<boolean> {
    const session = this.driver.session({ database: this.config.database });

    try {
      const result = await session.run(
        `
        MATCH (from:Entity {name: $fromEntity})-[r:${type}]->(to:Entity {name: $toEntity})
        DELETE r
        RETURN count(r) as deleted
        `,
        { fromEntity, toEntity },
      );

      const deleted = result.records[0]?.get("deleted") as number;
      return deleted > 0;
    } finally {
      await session.close();
    }
  }

  /**
   * Build default aliases for an entity
   * @param entityName - Entity name
   * @returns Array of aliases
   */
  private buildAliases(entityName: string): string[] {
    const aliases = [entityName.toLowerCase()];

    // Add common pronoun aliases for "Steve" (the user)
    if (entityName.toLowerCase() === "steve") {
      aliases.push("steve", "user", "me", "i", "myself");
    }

    return [...new Set(aliases)]; // Remove duplicates
  }
}

/**
 * Create relationship store
 * @param deps - Dependencies
 * @param config - Configuration
 * @returns Relationship store instance
 */
export function createRelationshipStore(
  deps: KGStorageDependencies,
  config?: KGStorageConfig,
): RelationshipStore {
  return new RelationshipStore(deps, config);
}

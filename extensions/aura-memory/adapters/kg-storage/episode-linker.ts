/**
 * Episode Linker
 * Links episodes to entities and creates relationships
 */

import { createLogger } from "../../shared/debug-logger.js";
import { AliasStore } from "./alias-store.js";
import { RelationshipStore } from "./relationship-store.js";
import type {
  Neo4jDriver,
  LinkEpisodeParams,
  EpisodeLinkResult,
  KGStorageConfig,
  KGStorageDependencies,
} from "./types.js";

/**
 * Episode linker for Neo4j
 */
export class EpisodeLinker {
  private driver: Neo4jDriver;
  private config: Required<KGStorageConfig>;
  private deps: KGStorageDependencies;
  private relationshipStore: RelationshipStore;
  private aliasStore: AliasStore;
  private logger = createLogger("EpisodeLinker");

  constructor(deps: KGStorageDependencies, config: KGStorageConfig = {}) {
    this.driver = deps.driver;
    this.deps = deps;
    this.config = {
      database: "neo4j",
      debug: false,
      ...config,
    };
    this.relationshipStore = new RelationshipStore(deps, config);
    this.aliasStore = new AliasStore(deps, config);
  }

  /**
   * Link episode to entities and create relationships
   * @param params - Link parameters
   * @returns Link result
   */
  async linkEpisode(params: LinkEpisodeParams): Promise<EpisodeLinkResult> {
    const correlationId = params.correlationId || `link-${Date.now()}`;

    this.logger.start("linkEpisode", {
      episodeUuid: params.episodeUuid,
      entityCount: params.entities.length,
      relationshipCount: params.relationships?.length || 0,
      correlationId,
    });

    let entitiesLinked = 0;
    let relationshipsCreated = 0;

    try {
      // Step 1: Create/update entities and link to episode
      this.logger.progress("linking-entities");
      for (const entity of params.entities) {
        const aliasResult = await this.aliasStore.updateAliases({
          entityName: entity.name,
          entityType: entity.type,
          aliases: entity.aliases || [],
          correlationId,
        });

        if (aliasResult.success) {
          entitiesLinked++;

          // Create MENTIONED_IN relationship
          await this.createMentionedInRelationship(params.episodeUuid, entity.name, correlationId);
        }
      }

      // Step 2: Create semantic relationships
      if (params.relationships && params.relationships.length > 0) {
        this.logger.progress("creating-relationships", {
          count: params.relationships.length,
        });

        for (const rel of params.relationships) {
          const result = await this.relationshipStore.createRelationship({
            fromEntity: rel.from,
            toEntity: rel.to,
            type: rel.type,
            confidence: rel.confidence,
            fact: rel.fact,
            episodeUuid: params.episodeUuid,
            correlationId,
          });

          if (result.success && result.action === "created") {
            relationshipsCreated++;
          }
        }
      }

      this.logger.success({
        episodeUuid: params.episodeUuid,
        entitiesLinked,
        relationshipsCreated,
      });

      // Audit log
      if (this.deps.auditLog) {
        await this.deps.auditLog({
          operation: "link_episode",
          correlationId,
          metadata: {
            episodeUuid: params.episodeUuid,
            entitiesLinked,
            relationshipsCreated,
          },
        });
      }

      return {
        success: true,
        episodeUuid: params.episodeUuid,
        entitiesLinked,
        relationshipsCreated,
      };
    } catch (error) {
      this.logger.error(error as Error, {
        episodeUuid: params.episodeUuid,
        entitiesLinked,
        relationshipsCreated,
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        episodeUuid: params.episodeUuid,
        entitiesLinked,
        relationshipsCreated,
      };
    }
  }

  /**
   * Create MENTIONED_IN relationship between entity and episode
   * @param episodeUuid - Episode UUID
   * @param entityName - Entity name
   * @param correlationId - Correlation ID
   */
  private async createMentionedInRelationship(
    episodeUuid: string,
    entityName: string,
    correlationId: string,
  ): Promise<void> {
    const session = this.driver.session({ database: this.config.database });

    try {
      await session.run(
        `
        MATCH (e:Entity {name: $entityName})
        MATCH (ep:Episode {uuid: $episodeUuid})
        MERGE (e)-[r:MENTIONED_IN]->(ep)
        ON CREATE SET r.firstMention = datetime()
        SET r.lastMention = datetime()
        `,
        { entityName, episodeUuid },
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Get all entities linked to an episode
   * @param episodeUuid - Episode UUID
   * @returns Array of entity names
   */
  async getEpisodeEntities(episodeUuid: string): Promise<string[]> {
    const session = this.driver.session({ database: this.config.database });

    try {
      const result = await session.run(
        `
        MATCH (e:Entity)-[:MENTIONED_IN]->(ep:Episode {uuid: $episodeUuid})
        RETURN e.name as name
        ORDER BY e.name
        `,
        { episodeUuid },
      );

      return result.records.map((r) => r.get("name") as string);
    } finally {
      await session.close();
    }
  }

  /**
   * Get all relationships in an episode
   * @param episodeUuid - Episode UUID
   * @returns Array of relationship data
   */
  async getEpisodeRelationships(episodeUuid: string): Promise<
    Array<{
      from: string;
      to: string;
      type: string;
      confidence: number;
    }>
  > {
    const session = this.driver.session({ database: this.config.database });

    try {
      const result = await session.run(
        `
        MATCH (from:Entity)-[r]->(to:Entity)
        WHERE from.name IN (
          MATCH (e:Entity)-[:MENTIONED_IN]->(ep:Episode {uuid: $episodeUuid})
          RETURN e.name as name
        )
        RETURN from.name as from, to.name as to, type(r) as type, r.confidence as confidence
        `,
        { episodeUuid },
      );

      return result.records.map((r) => ({
        from: r.get("from") as string,
        to: r.get("to") as string,
        type: r.get("type") as string,
        confidence: r.get("confidence") as number,
      }));
    } finally {
      await session.close();
    }
  }

  /**
   * Unlink episode from all entities
   * @param episodeUuid - Episode UUID
   * @returns Number of relationships removed
   */
  async unlinkEpisode(episodeUuid: string): Promise<number> {
    this.logger.start("unlinkEpisode", { episodeUuid });

    const session = this.driver.session({ database: this.config.database });

    try {
      const result = await session.run(
        `
        MATCH (e:Entity)-[r:MENTIONED_IN]->(ep:Episode {uuid: $episodeUuid})
        DELETE r
        RETURN count(r) as removed
        `,
        { episodeUuid },
      );

      const removed = (result.records[0]?.get("removed") as number) || 0;
      this.logger.success({ removed });

      return removed;
    } finally {
      await session.close();
    }
  }

  /**
   * Batch link multiple episodes
   * @param episodes - Array of link parameters
   * @returns Array of results
   */
  async linkEpisodes(episodes: LinkEpisodeParams[]): Promise<EpisodeLinkResult[]> {
    this.logger.start("linkEpisodes", { count: episodes.length });

    const results: EpisodeLinkResult[] = [];

    for (let i = 0; i < episodes.length; i++) {
      const result = await this.linkEpisode({
        ...episodes[i],
        correlationId: episodes[i].correlationId || `batch-${Date.now()}-${i}`,
      });
      results.push(result);
    }

    const successCount = results.filter((r) => r.success).length;
    this.logger.success({
      total: episodes.length,
      successful: successCount,
      failed: episodes.length - successCount,
    });

    return results;
  }
}

/**
 * Create episode linker
 * @param deps - Dependencies
 * @param config - Configuration
 * @returns Episode linker instance
 */
export function createEpisodeLinker(
  deps: KGStorageDependencies,
  config?: KGStorageConfig,
): EpisodeLinker {
  return new EpisodeLinker(deps, config);
}

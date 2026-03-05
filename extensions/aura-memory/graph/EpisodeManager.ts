/**
 * Episode Manager - Empty Content Handling
 * Sprint 2 - AC2.2: Empty Content Handling
 *
 * Handles episodes with empty bodies for Warm/Cold tiers
 * while maintaining entity traversability
 */

import { Logger, MetricsCollector, generateCorrelationId } from "../../utils/logger";
import { EpisodeLinkCache, type EpisodeLink } from "./EpisodeLinkCache";
import type { Neo4jClient } from "./Neo4jClient";
import type { AddEpisodeInput, GraphitiEpisode, Tier } from "./types";

export interface EmptyEpisodeOptions {
  memoryId: string;
  entityRefs: string[];
  tier: Tier;
  referenceTime?: Date;
  metadata?: Record<string, unknown>;
}

export interface EnrichOptions {
  uuid: string;
  content: string;
  preserveMetadata?: boolean;
}

export interface EpisodeManagerStats {
  totalCreated: number;
  totalEnriched: number;
  errors: number;
}

export class EpisodeManager {
  private client: Neo4jClient;
  private cache: EpisodeLinkCache;
  private logger: Logger;
  private metrics: MetricsCollector;
  private stats: EpisodeManagerStats = {
    totalCreated: 0,
    totalEnriched: 0,
    errors: 0,
  };

  constructor(client: Neo4jClient, correlationId?: string) {
    this.client = client;
    this.cache = new EpisodeLinkCache();
    this.logger = new Logger("EpisodeManager", correlationId || generateCorrelationId());
    this.metrics = new MetricsCollector();
  }

  async createWithEmptyBody(options: EmptyEpisodeOptions): Promise<string> {
    const startTime = performance.now();
    const { memoryId, entityRefs, tier, referenceTime = new Date(), metadata = {} } = options;

    this.logger.debug("Creating episode with empty body", {
      memoryId,
      tier,
      entityCount: entityRefs.length,
      entityRefs,
    });

    try {
      const sourceDescription = JSON.stringify({
        memoryId,
        tier,
        entityRefs,
        contentLocation: tier === "HOT" ? "inline" : `${tier.toLowerCase()}_tier`,
        ...metadata,
      });

      const episodeInput: AddEpisodeInput = {
        name: `memory:${memoryId}`,
        body: "",
        sourceDescription,
        referenceTime,
        metadata: {
          memoryId,
          tier,
          entityCount: entityRefs.length,
          hasFullContent: false,
          ...metadata,
        },
      };

      const episode = await this.client.addEpisode(episodeInput);
      const uuid = episode.uuid;

      const link: EpisodeLink = {
        memoryId,
        episodeUuid: uuid,
        tier,
        entityRefs: [...entityRefs],
        hasContent: false,
      };
      this.cache.set(link);
      this.stats.totalCreated++;

      await this.createEntityReferences(uuid, entityRefs);

      const duration = performance.now() - startTime;
      this.metrics.recordDuration("createWithEmptyBody", duration);
      this.logger.info("Episode created with empty body", {
        memoryId,
        uuid,
        tier,
        duration,
        entityCount: entityRefs.length,
      });

      return uuid;
    } catch (error) {
      this.stats.errors++;
      this.logger.error("Failed to create episode with empty body", error as Error, {
        memoryId,
        tier,
        entityCount: entityRefs.length,
      });
      throw error;
    }
  }

  async enrichWithContent(options: EnrichOptions): Promise<void> {
    const startTime = performance.now();
    const { uuid, content, preserveMetadata = true } = options;

    this.logger.debug("Enriching episode with content", { uuid, contentLength: content.length });

    try {
      const existing = await this.client.getEpisode(uuid);
      if (!existing) {
        throw new Error(`Episode not found: ${uuid}`);
      }

      let sourceData: Record<string, unknown>;
      try {
        sourceData = JSON.parse(existing.source_description);
      } catch {
        sourceData = { originalSource: existing.source_description };
      }

      const updatedSource = JSON.stringify({
        ...sourceData,
        contentLocation: "inline",
        enrichedAt: new Date().toISOString(),
      });

      await this.client.updateEpisode(uuid, {
        body: content,
        sourceDescription: updatedSource,
        metadata: {
          ...existing.metadata,
          hasFullContent: true,
          enrichedAt: new Date().toISOString(),
        },
      });

      const cached = this.cache.getByEpisodeUuid(uuid);
      if (cached) {
        cached.hasContent = true;
        this.cache.set(cached);
      }

      this.stats.totalEnriched++;
      const duration = performance.now() - startTime;
      this.metrics.recordDuration("enrichWithContent", duration);
      this.logger.info("Episode enriched with content", {
        uuid,
        duration,
        contentLength: content.length,
      });
    } catch (error) {
      this.stats.errors++;
      this.logger.error("Failed to enrich episode with content", error as Error, {
        uuid,
        contentLength: content.length,
      });
      throw error;
    }
  }

  async hasFullContent(uuid: string): Promise<boolean> {
    const cached = this.cache.getByEpisodeUuid(uuid);
    if (cached) {
      this.metrics.incrementCounter("cache_hit");
      return cached.hasContent;
    }
    this.metrics.incrementCounter("cache_miss");

    const episode = await this.client.getEpisode(uuid);
    if (!episode) return false;

    try {
      const metadata =
        typeof episode.metadata === "string" ? JSON.parse(episode.metadata) : episode.metadata;
      return metadata?.hasFullContent === true || episode.body.length > 0;
    } catch {
      return episode.body.length > 0;
    }
  }

  async getEntityRefs(uuid: string): Promise<string[]> {
    const cached = this.cache.getByEpisodeUuid(uuid);
    if (cached?.entityRefs) return [...cached.entityRefs];

    const episode = await this.client.getEpisode(uuid);
    if (!episode) return [];

    try {
      const sourceData = JSON.parse(episode.source_description);
      return (sourceData.entityRefs as string[]) || [];
    } catch {
      return [];
    }
  }

  async getTier(uuid: string): Promise<Tier | null> {
    const cached = this.cache.getByEpisodeUuid(uuid);
    if (cached?.tier) return cached.tier;

    const episode = await this.client.getEpisode(uuid);
    if (!episode) return null;

    try {
      const sourceData = JSON.parse(episode.source_description);
      return (sourceData.tier as Tier) || null;
    } catch {
      return null;
    }
  }

  async findByEntityRef(entityName: string): Promise<GraphitiEpisode[]> {
    const startTime = performance.now();
    this.logger.debug("Finding episodes by entity ref", { entityName });

    const query = `MATCH (e:Episode) WHERE e.source_description CONTAINS $entityName RETURN e`;
    const results = await this.client.runQuery(query, { entityName });
    const episodes = results.map((r: { e: GraphitiEpisode }) => r.e);

    const duration = performance.now() - startTime;
    this.metrics.recordDuration("findByEntityRef", duration);
    this.logger.info("Found episodes by entity ref", {
      entityName,
      count: episodes.length,
      duration,
    });

    return episodes;
  }

  private async createEntityReferences(episodeUuid: string, entityRefs: string[]): Promise<void> {
    this.logger.debug("Creating entity references", {
      episodeUuid,
      entityCount: entityRefs.length,
    });

    for (const entity of entityRefs) {
      const query = `
        MATCH (e:Episode {uuid: $episodeUuid})
        MERGE (ent:Entity {name: $entityName})
        ON CREATE SET ent.created_at = datetime()
        MERGE (e)-[:MENTIONS]->(ent)
        RETURN ent
      `;
      await this.client.runQuery(query, { episodeUuid, entityName: entity });
    }
  }

  async getMemoryId(uuid: string): Promise<string | null> {
    const cached = this.cache.getByEpisodeUuid(uuid);
    if (cached?.memoryId) return cached.memoryId;

    const episode = await this.client.getEpisode(uuid);
    if (!episode) return null;

    try {
      const sourceData = JSON.parse(episode.source_description);
      return (sourceData.memoryId as string) || null;
    } catch {
      const match = episode.name.match(/memory:(.+)/);
      return match?.[1] || null;
    }
  }

  clearCache(): void {
    this.cache.clear();
  }

  getCacheStats() {
    return this.cache.getStats();
  }

  getStats(): EpisodeManagerStats {
    return { ...this.stats };
  }

  getMetrics(): Record<string, unknown> {
    return {
      ...this.metrics.getSummary(),
      cacheStats: this.getCacheStats(),
      operationStats: this.getStats(),
    };
  }
}

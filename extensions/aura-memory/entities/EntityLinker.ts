/**
 * Entity Linker
 * Story 3.3: Knowledge Graph Entity Extraction
 *
 * Handles deduplication and creation of relationships in Neo4j
 */

import type {
  ExtractedEntity,
  EntityRelationship,
  EntityLinkerConfig,
  EntityLinkerDependencies,
  Neo4jEntityClient,
  BatchProcessingResult,
  EntityCacheEntry,
  EntityType,
} from "./types.js";

/**
 * Default linker configuration
 */
const DEFAULT_CONFIG: EntityLinkerConfig = {
  minConfidence: 0.5,
  batchSize: 100,
  cacheTtlMs: 300000, // 5 minutes
  debug: false,
};

/**
 * Entity Linker
 *
 * Manages entity deduplication and relationship creation in Neo4j.
 * Uses caching for efficient deduplication and batch operations for performance.
 */
export class EntityLinker {
  private config: EntityLinkerConfig;
  private deps: EntityLinkerDependencies;
  private entityCache: Map<string, EntityCacheEntry>;
  private pendingBatches: {
    entities: Map<string, ExtractedEntity>;
    mentions: Array<{ episodeUuid: string; entityName: string }>;
    relationships: EntityRelationship[];
  };

  constructor(deps: EntityLinkerDependencies, config?: Partial<EntityLinkerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.deps = deps;
    this.entityCache = new Map();
    this.pendingBatches = {
      entities: new Map(),
      mentions: [],
      relationships: [],
    };
  }

  /**
   * Process extracted entities for a memory/episode
   * Creates/updates entities and establishes MENTIONS relationships
   *
   * @param episodeUuid - UUID of the episode/memory
   * @param entities - Extracted entities from content
   * @returns Number of entities processed
   */
  async processEntities(episodeUuid: string, entities: ExtractedEntity[]): Promise<number> {
    const correlationId = this.deps.generateId();
    const startTime = this.deps.now();
    let processed = 0;

    try {
      // Filter by confidence threshold
      const validEntities = entities.filter((e) => e.confidence >= this.config.minConfidence);

      // Process each entity
      for (const entity of validEntities) {
        const normalizedName = this.normalizeEntityName(entity.name);

        // Check cache first for deduplication
        const cached = this.getCachedEntity(normalizedName);

        if (!cached || !cached.existsInDb) {
          // Create or update entity in Neo4j
          await this.upsertEntity(entity);
          this.cacheEntity(normalizedName, entity.type, true);
        }

        // Create MENTIONS relationship
        await this.createMentions(episodeUuid, normalizedName);

        processed++;

        // Add to pending batch for potential bulk operations
        this.pendingBatches.entities.set(normalizedName, entity);
      }

      // Log success
      await this.deps.auditLog({
        operation: "entity_linking",
        correlationId,
        metadata: {
          episodeUuid,
          entitiesProcessed: processed,
          durationMs: this.deps.now() - startTime,
        },
      });

      return processed;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown linking error";

      await this.deps.auditLog({
        operation: "entity_linking_failed",
        correlationId,
        metadata: {
          episodeUuid,
          error: errorMessage,
          durationMs: this.deps.now() - startTime,
        },
      });

      throw error;
    }
  }

  /**
   * Process entity relationships
   * Creates RELATES_TO relationships between entities
   *
   * @param relationships - Relationships to create
   * @returns Number of relationships created
   */
  async processRelationships(relationships: EntityRelationship[]): Promise<number> {
    const correlationId = this.deps.generateId();
    const startTime = this.deps.now();
    let created = 0;

    try {
      // Filter by confidence threshold
      const validRelationships = relationships.filter(
        (r) => r.confidence >= this.config.minConfidence,
      );

      // Process each relationship
      for (const rel of validRelationships) {
        const fromName = this.normalizeEntityName(rel.from);
        const toName = this.normalizeEntityName(rel.to);

        // Ensure both entities exist
        await this.ensureEntityExists(fromName);
        await this.ensureEntityExists(toName);

        // Create relationship
        const fact = this.relationshipToFact(rel);
        await this.deps.neo4jClient.addRelationship(fromName, toName, fact);

        created++;
      }

      // Log success
      await this.deps.auditLog({
        operation: "relationship_linking",
        correlationId,
        metadata: {
          relationshipsCreated: created,
          durationMs: this.deps.now() - startTime,
        },
      });

      return created;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown relationship error";

      await this.deps.auditLog({
        operation: "relationship_linking_failed",
        correlationId,
        metadata: {
          error: errorMessage,
          durationMs: this.deps.now() - startTime,
        },
      });

      throw error;
    }
  }

  /**
   * Process entities and relationships together
   * More efficient than calling separately
   *
   * @param episodeUuid - UUID of the episode/memory
   * @param entities - Extracted entities
   * @param relationships - Relationships between entities
   * @returns Batch processing result
   */
  async processBatch(
    episodeUuid: string,
    entities: ExtractedEntity[],
    relationships: EntityRelationship[],
  ): Promise<BatchProcessingResult> {
    const startTime = this.deps.now();
    let errors = 0;

    // Process entities
    let entitiesProcessed = 0;
    try {
      entitiesProcessed = await this.processEntities(episodeUuid, entities);
    } catch {
      errors++;
    }

    // Process relationships
    let relationshipsCreated = 0;
    try {
      relationshipsCreated = await this.processRelationships(relationships);
    } catch {
      errors++;
    }

    return {
      entitiesProcessed,
      relationshipsCreated,
      errors,
      durationMs: this.deps.now() - startTime,
    };
  }

  /**
   * Process multiple episodes in batch for efficiency
   *
   * @param episodes - Array of episode data
   * @returns Summary of all operations
   */
  async processMultipleEpisodes(
    episodes: Array<{
      episodeUuid: string;
      entities: ExtractedEntity[];
      relationships: EntityRelationship[];
    }>,
  ): Promise<{
    totalEntities: number;
    totalRelationships: number;
    durationMs: number;
  }> {
    const startTime = this.deps.now();
    let totalEntities = 0;
    let totalRelationships = 0;

    // Collect all unique entities first
    const allEntities = new Map<string, ExtractedEntity>();
    for (const episode of episodes) {
      for (const entity of episode.entities) {
        const normalizedName = this.normalizeEntityName(entity.name);
        if (!allEntities.has(normalizedName)) {
          allEntities.set(normalizedName, entity);
        }
      }
    }

    // Batch upsert all entities
    const entityArray = Array.from(allEntities.values());
    for (let i = 0; i < entityArray.length; i += this.config.batchSize) {
      const batch = entityArray.slice(i, i + this.config.batchSize);
      await this.batchUpsertEntities(batch);
    }

    // Process mentions for each episode
    for (const episode of episodes) {
      for (const entity of episode.entities) {
        const normalizedName = this.normalizeEntityName(entity.name);
        await this.createMentions(episode.episodeUuid, normalizedName);
        totalEntities++;
      }
    }

    // Collect and batch process all relationships
    const allRelationships: EntityRelationship[] = [];
    for (const episode of episodes) {
      allRelationships.push(...episode.relationships);
    }

    // Deduplicate relationships
    const uniqueRelationships = this.deduplicateRelationships(allRelationships);

    // Batch create relationships
    for (let i = 0; i < uniqueRelationships.length; i += this.config.batchSize) {
      const batch = uniqueRelationships.slice(i, i + this.config.batchSize);
      await this.batchCreateRelationships(batch);
      totalRelationships += batch.length;
    }

    return {
      totalEntities,
      totalRelationships,
      durationMs: this.deps.now() - startTime,
    };
  }

  /**
   * Check if entity exists (with caching)
   *
   * @param name - Entity name
   * @returns Whether entity exists in database
   */
  async entityExists(name: string): Promise<boolean> {
    const normalizedName = this.normalizeEntityName(name);

    // Check cache first
    const cached = this.getCachedEntity(normalizedName);
    if (cached) {
      return cached.existsInDb;
    }

    // Query database
    try {
      const entity = await this.deps.neo4jClient.getEntity(normalizedName);
      const exists = entity !== null;

      // Cache result
      this.cacheEntity(normalizedName, "Concept", exists); // Type unknown at this point

      return exists;
    } catch {
      return false;
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    hits: number;
    misses: number;
    hitRate: number;
  } {
    // This is a simplified version - real implementation would track hits/misses
    return {
      size: this.entityCache.size,
      hits: 0,
      misses: 0,
      hitRate: 0,
    };
  }

  /**
   * Clear entity cache
   */
  clearCache(): void {
    this.entityCache.clear();
  }

  /**
   * Get current configuration
   */
  getConfig(): EntityLinkerConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<EntityLinkerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Normalize entity name for consistent deduplication
   */
  private normalizeEntityName(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, " "); // Normalize whitespace
  }

  /**
   * Upsert a single entity to Neo4j
   */
  private async upsertEntity(entity: ExtractedEntity): Promise<void> {
    const normalizedName = this.normalizeEntityName(entity.name);
    const summary = entity.summary || `${entity.type} entity`;

    await this.deps.neo4jClient.addEntity(normalizedName, entity.type, summary);
  }

  /**
   * Batch upsert multiple entities
   */
  private async batchUpsertEntities(entities: ExtractedEntity[]): Promise<void> {
    // Process in parallel with limited concurrency
    const CONCURRENCY = 10;
    for (let i = 0; i < entities.length; i += CONCURRENCY) {
      const batch = entities.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map((e) => this.upsertEntity(e)));
    }
  }

  /**
   * Create MENTIONS relationship
   */
  private async createMentions(episodeUuid: string, entityName: string): Promise<void> {
    await this.deps.neo4jClient.addMentions(episodeUuid, entityName);
  }

  /**
   * Ensure entity exists in database
   * Creates a minimal entity if it doesn't exist
   */
  private async ensureEntityExists(name: string): Promise<void> {
    const normalizedName = this.normalizeEntityName(name);

    // Check cache first
    const cached = this.getCachedEntity(normalizedName);
    if (cached?.existsInDb) {
      return;
    }

    // Check database
    const exists = await this.entityExists(normalizedName);
    if (!exists) {
      // Create placeholder entity
      await this.deps.neo4jClient.addEntity(normalizedName, "Concept", "Referenced entity");
      this.cacheEntity(normalizedName, "Concept", true);
    }
  }

  /**
   * Convert relationship to fact string for Neo4j
   */
  private relationshipToFact(rel: EntityRelationship): string {
    return `${rel.from} ${rel.type.replace(/_/g, " ")} ${rel.to}`;
  }

  /**
   * Batch create relationships
   */
  private async batchCreateRelationships(relationships: EntityRelationship[]): Promise<void> {
    const CONCURRENCY = 10;
    for (let i = 0; i < relationships.length; i += CONCURRENCY) {
      const batch = relationships.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map((r) => {
          const fact = this.relationshipToFact(r);
          return this.deps.neo4jClient.addRelationship(r.from, r.to, fact);
        }),
      );
    }
  }

  /**
   * Deduplicate relationships
   */
  private deduplicateRelationships(relationships: EntityRelationship[]): EntityRelationship[] {
    const seen = new Set<string>();
    const unique: EntityRelationship[] = [];

    for (const rel of relationships) {
      const key = `${rel.from}|${rel.type}|${rel.to}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(rel);
      }
    }

    return unique;
  }

  /**
   * Get cached entity entry
   */
  private getCachedEntity(name: string): EntityCacheEntry | null {
    const cached = this.entityCache.get(name);
    if (!cached) return null;

    // Check if expired
    if (this.deps.now() - cached.timestamp > this.config.cacheTtlMs) {
      this.entityCache.delete(name);
      return null;
    }

    return cached;
  }

  /**
   * Cache entity entry
   */
  private cacheEntity(name: string, type: EntityType, existsInDb: boolean): void {
    this.entityCache.set(name, {
      name,
      type,
      timestamp: this.deps.now(),
      existsInDb,
    });

    // Prevent cache from growing too large
    if (this.entityCache.size > 10000) {
      const firstKey = this.entityCache.keys().next().value;
      if (firstKey !== undefined) {
        this.entityCache.delete(firstKey);
      }
    }
  }
}

/**
 * Factory function to create entity linker
 */
export function createEntityLinker(
  deps: EntityLinkerDependencies,
  config?: Partial<EntityLinkerConfig>,
): EntityLinker {
  return new EntityLinker(deps, config);
}

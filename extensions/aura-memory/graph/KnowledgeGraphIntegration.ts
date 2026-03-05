/**
 * Knowledge Graph Integration Service
 * Wires graph operations to memory storage
 */

import type { ConcreteKnowledgeGraphAdapter } from "../adapters/ConcreteKnowledgeGraph.js";
import type { CategorizedMemory } from "../categories/types.js";
import type { EncryptionService } from "../encryption/EncryptionService.js";
import type { EntityExtractor } from "../entities/EntityExtractor.js";
import type { EntityLinker } from "../entities/EntityLinker.js";
import type { EntityExtractionResult } from "../entities/types.js";
import type { EpisodeManager } from "../graph/EpisodeManager.js";
import type { Logger } from "../types.js";

export interface KnowledgeGraphIntegrationConfig {
  enabled: boolean;
  createEpisodes: boolean;
  extractEntities: boolean;
  linkEntities: boolean;
}

export interface KnowledgeGraphIntegrationDependencies {
  knowledgeGraph: ConcreteKnowledgeGraphAdapter;
  entityExtractor: EntityExtractor;
  entityLinker: EntityLinker;
  log: Logger;
  /** Encryption service for decrypting User category memories */
  encryptionService?: EncryptionService;
}

/**
 * Integrates Knowledge Graph with memory storage
 * Creates episodes and entities when memories are stored
 */
export class KnowledgeGraphIntegration {
  private config: KnowledgeGraphIntegrationConfig;
  private deps: KnowledgeGraphIntegrationDependencies;

  constructor(
    config: KnowledgeGraphIntegrationConfig,
    deps: KnowledgeGraphIntegrationDependencies,
  ) {
    this.config = config;
    this.deps = deps;
  }

  /**
   * Process a memory through the knowledge graph pipeline
   * Called when a memory is stored
   */
  async processMemory(memory: CategorizedMemory): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    const correlationId = memory.correlationId || `kg-${Date.now()}`;

    this.deps.log.info("[KnowledgeGraph] Processing memory", {
      memoryId: memory.memoryId,
      category: memory.category,
      correlationId,
    });

    try {
      // Step 1: Extract entities from memory content
      let entities: EntityExtractionResult | null = null;

      if (this.config.extractEntities) {
        entities = await this.extractEntities(memory, correlationId);
      }

      // Step 2: Create episode in knowledge graph
      if (this.config.createEpisodes) {
        await this.createEpisode(memory, entities, correlationId);
      }

      // Step 3: Link entities to memory
      if (this.config.linkEntities && entities && entities.entities.length > 0) {
        await this.linkEntities(memory, entities, correlationId);
      }

      this.deps.log.info("[KnowledgeGraph] Memory processing complete", {
        memoryId: memory.memoryId,
        entityCount: entities?.entities.length || 0,
        correlationId,
      });
    } catch (error) {
      this.deps.log.error("[KnowledgeGraph] Failed to process memory", error as Error, {
        memoryId: memory.memoryId,
        correlationId,
      });
      // Don't throw - knowledge graph is best-effort, shouldn't block storage
    }
  }

  /**
   * Extract entities from memory content
   */
  private async extractEntities(
    memory: CategorizedMemory,
    correlationId: string,
  ): Promise<EntityExtractionResult> {
    this.deps.log.debug("[KnowledgeGraph] Extracting entities", {
      memoryId: memory.memoryId,
      correlationId,
    });

    try {
      const result = await this.deps.entityExtractor.extract(memory.content);

      this.deps.log.debug("[KnowledgeGraph] Entities extracted", {
        memoryId: memory.memoryId,
        entityCount: result.entities.length,
        correlationId,
      });

      return result;
    } catch (error) {
      this.deps.log.warn("[KnowledgeGraph] Entity extraction failed", {
        memoryId: memory.memoryId,
        error: error instanceof Error ? error.message : "Unknown",
        correlationId,
      });

      // Return empty result on failure
      return {
        entities: [],
        relationships: [],
        durationMs: 0,
        tokensUsed: { input: 0, output: 0 },
      };
    }
  }

  /**
   * Create episode in knowledge graph
   */
  private async createEpisode(
    memory: CategorizedMemory,
    entities: EntityExtractionResult | null,
    correlationId: string,
  ): Promise<void> {
    this.deps.log.debug("[KnowledgeGraph] Creating episode", {
      memoryId: memory.memoryId,
      correlationId,
    });

    // Extract entity names for linking
    const entityNames = entities?.entities.map((e) => e.name) || [];

    // Create episode via knowledge graph adapter
    await this.deps.knowledgeGraph.createEpisode({
      memoryId: memory.memoryId,
      content: memory.content,
      timestamp: memory.timestamp || Date.now(),
      category: memory.category,
    });

    // Link entities if we have them
    if (entityNames.length > 0) {
      const entityRefs = entities!.entities.map((e) => ({
        type: e.type,
        name: e.name,
        confidence: e.confidence,
      }));

      await this.deps.knowledgeGraph.linkEntities({
        episodeUuid: memory.memoryId, // Using memoryId as episode reference
        entities: entityRefs,
      });
    }

    this.deps.log.debug("[KnowledgeGraph] Episode created", {
      memoryId: memory.memoryId,
      entityCount: entityNames.length,
      correlationId,
    });
  }

  /**
   * Link entities to memory for cross-referencing
   */
  private async linkEntities(
    memory: CategorizedMemory,
    entities: EntityExtractionResult,
    correlationId: string,
  ): Promise<void> {
    this.deps.log.debug("[KnowledgeGraph] Linking entities", {
      memoryId: memory.memoryId,
      entityCount: entities.entities.length,
      correlationId,
    });

    // Use entity linker to process entities and create MENTIONS relationships
    try {
      await this.deps.entityLinker.processEntities(memory.memoryId, entities.entities);
    } catch (error) {
      this.deps.log.warn("[KnowledgeGraph] Failed to process entities", {
        memoryId: memory.memoryId,
        error: error instanceof Error ? error.message : "Unknown",
        correlationId,
      });
    }

    // Process relationships if any exist
    if (entities.relationships && entities.relationships.length > 0) {
      try {
        await this.deps.entityLinker.processRelationships(entities.relationships);
      } catch (error) {
        this.deps.log.warn("[KnowledgeGraph] Failed to process relationships", {
          memoryId: memory.memoryId,
          error: error instanceof Error ? error.message : "Unknown",
          correlationId,
        });
      }
    }
  }

  /**
   * Search for related memories by entities
   * Decrypts encrypted User category memories if encryption service is available
   */
  async searchRelated(params: { entityNames: string[]; limit: number }): Promise<
    Array<{
      memoryId: string;
      relevance: number;
      content: string;
    }>
  > {
    if (!this.config.enabled) {
      return [];
    }

    const results = await this.deps.knowledgeGraph.searchRelated({
      entityNames: params.entityNames,
      limit: Math.floor(params.limit),
    });

    // Decrypt encrypted memories if encryption service is available
    if (this.deps.encryptionService) {
      const decryptedResults = await Promise.all(
        results.map(async (result) => ({
          ...result,
          content: await this.decryptIfNeeded(result.content, result.memoryId),
        })),
      );
      return decryptedResults;
    }

    return results;
  }

  /**
   * Decrypt content if it appears to be encrypted JSON
   */
  private async decryptIfNeeded(content: string, memoryId: string): Promise<string> {
    // Check if content looks like encrypted JSON
    if (!content || !content.trim().startsWith('{"ciphertext":')) {
      return content;
    }

    if (!this.deps.encryptionService) {
      console.warn(
        `[KnowledgeGraph] Encrypted content found but no encryption service available for ${memoryId}`,
      );
      return "[Encrypted: no decryption service available]";
    }

    try {
      const encryptedData = JSON.parse(content);

      // Verify it has the expected structure
      if (!encryptedData.ciphertext || !encryptedData.iv) {
        return content; // Not valid encrypted format
      }

      const decryptResult = await this.deps.encryptionService.decrypt({
        encrypted: encryptedData,
        category: "User",
        memoryId,
      });

      if (decryptResult.success && decryptResult.plaintext) {
        return decryptResult.plaintext;
      } else {
        return `[Encrypted: ${decryptResult.error || "decryption failed"}]`;
      }
    } catch {
      return "[Encrypted: parse error]";
    }
  }

  /**
   * Get the Neo4j driver for graph traversal operations
   */
  getDriver() {
    return this.deps.knowledgeGraph.getDriver();
  }

  /**
   * Process a relationship between entities
   * Creates the relationship in the knowledge graph
   */
  async processRelationship(relationship: {
    from: string;
    to: string;
    type: string;
    confidence: number;
  }): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    this.deps.log.debug("[KnowledgeGraph] Processing relationship", {
      from: relationship.from,
      to: relationship.to,
      type: relationship.type,
    });

    try {
      // Use entity linker to create the relationship
      await this.deps.entityLinker.createRelationship({
        fromEntity: relationship.from,
        toEntity: relationship.to,
        relationshipType: relationship.type,
        confidence: relationship.confidence,
        source: "extraction",
      });

      this.deps.log.debug("[KnowledgeGraph] Relationship created", {
        from: relationship.from,
        to: relationship.to,
        type: relationship.type,
      });
    } catch (error) {
      this.deps.log.warn("[KnowledgeGraph] Failed to create relationship", {
        from: relationship.from,
        to: relationship.to,
        type: relationship.type,
        error: error instanceof Error ? error.message : "Unknown",
      });
      // Don't throw - relationship creation is best-effort
    }
  }
}

/**
 * Factory function to create Knowledge Graph integration
 */
export function createKnowledgeGraphIntegration(
  deps: KnowledgeGraphIntegrationDependencies,
): KnowledgeGraphIntegration {
  return new KnowledgeGraphIntegration(
    {
      enabled: true,
      createEpisodes: true,
      extractEntities: true,
      linkEntities: true,
    },
    deps,
  );
}

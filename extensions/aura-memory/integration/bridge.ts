/**
 * Semantic Extraction Bridge
 * Integrates Phase 1 semantic extraction into production workflow
 *
 * This bridge sits between AgentOrchestrator and KnowledgeGraphIntegration,
 * adding semantic relationship extraction and storage.
 */

import { SemanticExtractor } from "../extraction/semantic/extractor.js";
import { createLogger } from "../shared/debug-logger.js";
import { FeatureFlagProvider } from "./feature-flags.js";
import type {
  BridgeConfig,
  BridgeDependencies,
  BridgeExtractionInput,
  BridgeExtractionOutput,
  FeatureFlagConfig,
} from "./types.js";

/**
 * Default bridge configuration
 */
const DEFAULT_CONFIG: BridgeConfig = {
  enabled: process.env.AURA_SEMANTIC_EXTRACTION === "true",
  debug: process.env.DEBUG?.includes("aura:bridge") || false,
  minConfidence: 0.7,
  maxEntities: 20,
  maxRelationships: 30,
};

/**
 * Semantic Extraction Bridge
 *
 * Orchestrates the flow:
 * 1. Receives messages + memories from AgentOrchestrator
 * 2. Extracts semantic entities and relationships
 * 3. Stores relationships in Neo4j
 * 4. Updates entity aliases
 */
export class SemanticExtractionBridge {
  private extractor: SemanticExtractor;
  private deps: BridgeDependencies;
  private config: BridgeConfig;
  private featureFlags: FeatureFlagProvider;
  private logger = createLogger("SemanticExtractionBridge");

  constructor(deps: BridgeDependencies, config: Partial<BridgeConfig> = {}) {
    this.deps = deps;
    this.config = { ...DEFAULT_CONFIG, ...config };
    // Use injected feature flags or create new instance
    this.featureFlags = (config.featureFlags as FeatureFlagProvider) || new FeatureFlagProvider();

    // Initialize semantic extractor with same LLM
    this.extractor = new SemanticExtractor({
      llm: deps.llm,
      maxTokens: 2000,
      temperature: 0.3,
      maxEntities: this.config.maxEntities,
      maxRelationships: this.config.maxRelationships,
      attemptRepair: true,
    });

    this.logger.start("constructor", {
      enabled: this.config.enabled,
      featureFlags: this.featureFlags.getAll(),
    });
  }

  /**
   * Process messages and extract/store semantic relationships
   * This is the main entry point called by AgentOrchestrator
   *
   * @param input - Messages and context
   * @returns Extraction and storage results
   */
  async process(input: BridgeExtractionInput): Promise<BridgeExtractionOutput> {
    const correlationId = input.correlationId;
    const startTime = this.deps.now();

    this.logger.start("process", {
      correlationId,
      messageCount: input.messages.length,
      memoryCount: input.memories.length,
      enabled: this.isEnabled(),
    });

    // Check if enabled
    if (!this.isEnabled()) {
      this.logger.progress("disabled", { reason: "Feature flag off" });
      return this.createDisabledOutput(startTime);
    }

    try {
      // Step 1: Extract semantic entities and relationships
      this.logger.progress("extracting");
      const extractionStart = this.deps.now();

      const extractionResult = await this.extractor.extract({
        messages: input.messages,
        maxEntities: this.config.maxEntities,
        maxRelationships: this.config.maxRelationships,
        minConfidence: this.config.minConfidence,
      });

      const extractionMs = this.deps.now() - extractionStart;

      this.logger.progress("extraction-complete", {
        entityCount: extractionResult.entities.length,
        relationshipCount: extractionResult.relationships.length,
        extractionMs,
        success: extractionResult.success,
      });

      if (!extractionResult.success) {
        this.logger.error(new Error(extractionResult.error || "Extraction failed"), {
          phase: "extraction",
        });
        return {
          success: false,
          error: extractionResult.error,
          entities: [],
          relationships: [],
          storage: { relationshipsStored: 0, entitiesUpdated: 0, failures: 1 },
          metrics: { extractionMs, storageMs: 0, tokensUsed: extractionResult.tokensUsed.total },
        };
      }

      // Step 2: Store relationships and aliases
      this.logger.progress("storing");
      const storageStart = this.deps.now();

      const storageResult = await this.storeResults(
        extractionResult,
        input.episodeUuid,
        correlationId,
      );

      const storageMs = this.deps.now() - storageStart;
      const totalMs = this.deps.now() - startTime;

      this.logger.success({
        correlationId,
        entitiesExtracted: extractionResult.entities.length,
        relationshipsExtracted: extractionResult.relationships.length,
        relationshipsStored: storageResult.relationshipsStored,
        entitiesUpdated: storageResult.entitiesUpdated,
        extractionMs,
        storageMs,
        totalMs,
        tokensUsed: extractionResult.tokensUsed.total,
      });

      // Audit log
      if (this.deps.auditLog) {
        await this.deps.auditLog({
          operation: "semantic_extraction_bridge",
          correlationId,
          metadata: {
            entities: extractionResult.entities.length,
            relationships: extractionResult.relationships.length,
            stored: storageResult.relationshipsStored,
            failed: storageResult.failures,
            durationMs: totalMs,
          },
        });
      }

      return {
        success: true,
        entities: extractionResult.entities,
        relationships: extractionResult.relationships,
        storage: storageResult,
        metrics: {
          extractionMs,
          storageMs,
          tokensUsed: extractionResult.tokensUsed.total,
        },
      };
    } catch (error) {
      this.logger.error(error as Error, {
        correlationId,
        phase: "process",
        inputSample: input.messages.slice(0, 2).map((m) => ({
          role: m.role,
          preview: m.content.substring(0, 50),
        })),
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        entities: [],
        relationships: [],
        storage: { relationshipsStored: 0, entitiesUpdated: 0, failures: 1 },
        metrics: { extractionMs: 0, storageMs: 0, tokensUsed: 0 },
      };
    }
  }

  /**
   * Store extraction results in Neo4j
   * @param extraction - Extraction output
   * @param episodeUuid - Optional episode UUID for linking
   * @param correlationId - Correlation ID
   * @returns Storage statistics
   */
  private async storeResults(
    extraction: { entities: any[]; relationships: any[] },
    episodeUuid: string | undefined,
    correlationId: string,
  ): Promise<{ relationshipsStored: number; entitiesUpdated: number; failures: number }> {
    let relationshipsStored = 0;
    let entitiesUpdated = 0;
    let failures = 0;

    // Store entity aliases
    if (this.featureFlags.isEnabled("aliasUpdates")) {
      this.logger.progress("updating-aliases", { entityCount: extraction.entities.length });

      for (const entity of extraction.entities) {
        try {
          const result = await this.deps.aliasStore.updateAliases({
            entityName: entity.name,
            entityType: entity.type,
            aliases: entity.aliases || [],
            correlationId,
          });

          if (result.success) {
            entitiesUpdated++;
          } else {
            this.logger.progress("alias-update-failed", {
              entity: entity.name,
              error: result.error,
            });
            failures++;
          }
        } catch (error) {
          this.logger.error(error as Error, { phase: "alias-update", entity: entity.name });
          failures++;
        }
      }
    }

    // Store relationships
    if (this.featureFlags.isEnabled("relationshipStorage")) {
      this.logger.progress("storing-relationships", {
        count: extraction.relationships.length,
      });

      for (const rel of extraction.relationships) {
        // Skip if confidence too low
        if (rel.confidence < this.config.minConfidence) {
          this.logger.progress("skipping-low-confidence", {
            from: rel.from,
            to: rel.to,
            confidence: rel.confidence,
          });
          continue;
        }

        try {
          // Check for dry-run mode
          if (this.featureFlags.isEnabled("dryRun")) {
            this.logger.progress("dry-run", {
              from: rel.from,
              to: rel.to,
              type: rel.type,
              confidence: rel.confidence,
            });
            relationshipsStored++;
            continue;
          }

          const result = await this.deps.relationshipStore.createRelationship({
            fromEntity: rel.from,
            toEntity: rel.to,
            type: rel.type,
            confidence: rel.confidence,
            fact: rel.fact,
            episodeUuid,
            correlationId,
          });

          if (result.success) {
            relationshipsStored++;
          } else {
            this.logger.progress("relationship-store-failed", {
              from: rel.from,
              to: rel.to,
              error: result.error,
            });
            failures++;
          }
        } catch (error) {
          this.logger.error(error as Error, {
            phase: "relationship-store",
            relationship: `${rel.from} ${rel.type} ${rel.to}`,
          });
          failures++;
        }
      }
    }

    return { relationshipsStored, entitiesUpdated, failures };
  }

  /**
   * Check if bridge is enabled
   * @returns Whether enabled
   */
  isEnabled(): boolean {
    return this.config.enabled && this.featureFlags.isEnabled("semanticExtraction");
  }

  /**
   * Get bridge configuration
   * @returns Current config
   */
  getConfig(): BridgeConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   * @param config - New configuration
   */
  updateConfig(config: Partial<BridgeConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.progress("config-updated", this.config);
  }

  /**
   * Create output for disabled state
   * @param startTime - Start timestamp
   * @returns Disabled output
   */
  private createDisabledOutput(startTime: number): BridgeExtractionOutput {
    return {
      success: true,
      entities: [],
      relationships: [],
      storage: { relationshipsStored: 0, entitiesUpdated: 0, failures: 0 },
      metrics: {
        extractionMs: 0,
        storageMs: 0,
        tokensUsed: 0,
      },
    };
  }
}

/**
 * Create bridge instance
 * @param deps - Dependencies
 * @param config - Optional configuration
 * @returns Bridge instance
 */
export function createSemanticExtractionBridge(
  deps: BridgeDependencies,
  config?: Partial<BridgeConfig>,
): SemanticExtractionBridge {
  return new SemanticExtractionBridge(deps, config);
}

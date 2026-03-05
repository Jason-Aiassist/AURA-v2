/**
 * Consolidated Context Injector for AURA
 *
 * Single, unified context injection pipeline with optional pre-processing modules:
 *
 * User Query
 *     ↓
 * [Optional Pre-Processing]
 *   - QueryEntityResolver: "me" → "Steve"
 *   - RelationshipExpander: Find related entities via graph
 *     ↓
 * STAGE 1: Query Analysis (LLM) + Knowledge Graph Search
 *     ↓
 * STAGE 2: Hybrid Search (scoped to Stage 1 results)
 *     ↓
 * STAGE 3: REPL Filter (General/Moderate/Focused based on intent)
 *     ↓
 * Format & Inject
 *
 * This replaces the three competing implementations:
 * - Base ContextInjector (kept as core)
 * - EnhancedContextInjector (integrated as optional modules)
 * - GraphContextInjector (removed - functionality in base)
 */

import type { DatabaseSync } from "better-sqlite3";
import type { TieredMemoryStore } from "../adapters/TieredMemoryStore.js";
import { getUserName } from "../config/user-config.js";
import { ThreeStageContextBuilder } from "../context/builders/three-stage-builder.js";
import { createContextDeduplicator, ContextDeduplicator } from "../context/ContextDeduplicator.js";
import { ContextFormatter } from "../context/formatters/context-formatter.js";
import type { BuiltContext, ContextBuildOptions, SearchLevel } from "../context/models.js";
// Optional pre-processing modules
import { createQueryEntityResolver, QueryEntityResolver } from "../context/QueryEntityResolver.js";
import {
  createRelationshipAwareSearcher,
  RelationshipAwareSearcher,
} from "../context/RelationshipAwareSearcher.js";
import { QueryEmbeddingService } from "../context/services/QueryEmbeddingService.js";
import type { EmbeddingService } from "../embeddings/EmbeddingService.js";
import type { EncryptionService } from "../encryption/EncryptionService.js";
import {
  createRecallDetectionService,
  RecallDetectionService,
} from "../extraction/RecallDetectionService.js";
import type { KnowledgeGraphIntegration } from "../graph/KnowledgeGraphIntegration.js";
import { GraphTraversalSearch } from "../graph/traversal/traversal-search.js";
import { QueryAnalyzer, type QueryAnalysis } from "./QueryAnalyzer.js";

/**
 * Configuration for consolidated context injector
 */
export interface ContextInjectorConfig {
  /** SQLite database for hybrid search */
  db: DatabaseSync;
  /** Knowledge Graph integration (optional) */
  knowledgeGraph?: KnowledgeGraphIntegration;
  /** Tiered memory store (optional) */
  memoryStore?: TieredMemoryStore;
  /** Provider model for embeddings */
  providerModel?: string;
  /** Default token limit for context */
  defaultTokenLimit?: number;
  /** Core files to always include */
  coreFiles?: string[];
  /** Enable query analysis caching */
  enableCache?: boolean;
  /** Minimum query length to trigger analysis */
  minQueryLength?: number;
  /** Maximum context build time in ms */
  maxBuildTimeMs?: number;
  /** Embedding service for query vectorization (enables semantic search) */
  embeddingService?: EmbeddingService;
  /** Encryption service for decrypting User category memories */
  encryptionService?: EncryptionService;
  /** Graph traversal for Stage 1 entity relationship search */
  graphTraversal?: GraphTraversalSearch;

  // Optional pre-processing modules
  /** Enable query entity resolution (e.g., "me" → "Steve") */
  enableQueryResolution?: boolean;
  /** Enable relationship-aware search expansion */
  enableRelationshipSearch?: boolean;
  /** User name for pronoun resolution */
  userName?: string;
}

/**
 * Injection result for hook return
 * PRESERVED: Exact same interface as before to maintain compatibility
 */
export interface InjectionResult {
  /** Prepend context to add before user messages */
  prependContext?: string;
  /** System prompt addition */
  systemPrompt?: string;
  /** Metadata about the injection */
  metadata: {
    /** Whether context was found and injected */
    hasContext: boolean;
    /** Number of memories retrieved */
    memoryCount: number;
    /** Build time in ms */
    buildTimeMs: number;
    /** Analysis intent detected */
    intent?: string;
    /** Entities extracted */
    entities?: string[];
    /** Memory IDs that were injected (for recall detection) */
    memoryIds?: string[];
    /** Enhanced metadata (optional, for debugging) */
    enhanced?: {
      originalQuery?: string;
      resolvedQuery?: string;
      resolvedEntities?: Array<{
        original: string;
        resolved: string;
        confidence: number;
      }>;
      usedRelationshipSearch?: boolean;
    };
  };
}

/**
 * Token budgets by depth level
 */
const TOKEN_BUDGETS: Record<SearchLevel, number> = {
  general: 4000,
  moderate: 2500,
  focused: 1000,
};

/**
 * Consolidated Context Injector
 *
 * Single implementation with optional pre-processing modules.
 * Replaces: Base ContextInjector + EnhancedContextInjector + GraphContextInjector
 */
export class ContextInjector {
  private queryAnalyzer: QueryAnalyzer;
  private contextBuilder: ThreeStageContextBuilder;
  private config: ContextInjectorConfig;
  private formatter: ContextFormatter;
  private queryEmbeddingService?: QueryEmbeddingService;
  private graphTraversal?: GraphTraversalSearch;
  private graphContextBuilder?: ReturnType<
    typeof import("../context/builder/graph-context-builder.js").createGraphContextBuilder
  >;
  private deduplicator: ContextDeduplicator;
  private recallDetector: RecallDetectionService;

  // Optional pre-processing modules
  private queryResolver?: QueryEntityResolver;
  private relationshipSearcher?: RelationshipAwareSearcher;

  constructor(config: ContextInjectorConfig) {
    this.config = {
      defaultTokenLimit: 4000,
      minQueryLength: 3,
      maxBuildTimeMs: 1000,
      enableCache: true,
      enableQueryResolution: true,
      enableRelationshipSearch: true,
      userName: getUserName(),
      ...config,
    };

    this.queryAnalyzer = new QueryAnalyzer({
      enableCache: this.config.enableCache,
    });

    // Create query embedding service if embedding service provided
    if (config.embeddingService) {
      this.queryEmbeddingService = new QueryEmbeddingService({
        embeddingService: config.embeddingService,
        enableCache: true,
        maxCacheSize: 100,
      });
    }

    this.contextBuilder = new ThreeStageContextBuilder({
      db: config.db,
      knowledgeGraph: config.knowledgeGraph,
      memoryStore: config.memoryStore,
      providerModel: config.providerModel,
      defaultTokenLimit: this.config.defaultTokenLimit,
      coreFiles: config.coreFiles,
      queryEmbeddingService: this.queryEmbeddingService,
      graphTraversal: config.graphTraversal,
      encryptionService: config.encryptionService,
    });

    this.formatter = new ContextFormatter({
      tokenLimit: this.config.defaultTokenLimit ?? 4000,
      coreFiles: config.coreFiles,
    });

    // Initialize runtime deduplicator
    this.deduplicator = createContextDeduplicator({
      similarityThreshold: 0.85,
      preferHigherRelevance: true,
      preferMoreRecent: true,
    });

    // Initialize recall detection service
    this.recallDetector = createRecallDetectionService({
      similarityThreshold: 0.75,
      minNovelContentRatio: 0.3,
      checkRecentContext: true,
      contextWindowMs: 5 * 60 * 1000, // 5 minutes
    });

    // Initialize GraphTraversalSearch if Knowledge Graph available
    if (config.knowledgeGraph) {
      try {
        this.graphTraversal = new GraphTraversalSearch(
          config.knowledgeGraph.getDriver(),
          {}, // TraversalConfig - use defaults
        );
      } catch (graphError) {
        console.error("[ContextInjector] Failed to initialize GraphTraversalSearch:", graphError);
        this.graphTraversal = undefined;
      }
    }

    // Initialize optional pre-processing modules
    this.initializePreProcessingModules();
  }

  /**
   * Initialize optional pre-processing modules
   */
  private initializePreProcessingModules(): void {
    // Query Entity Resolver (pronoun resolution)
    if (this.config.enableQueryResolution && this.config.knowledgeGraph) {
      this.queryResolver = createQueryEntityResolver(
        { userName: this.config.userName ?? getUserName() },
        this.config.knowledgeGraph,
        undefined, // No logger to reduce noise
      );
    }

    // Relationship-Aware Searcher (entity expansion)
    if (
      this.config.enableRelationshipSearch &&
      this.config.knowledgeGraph &&
      this.config.memoryStore
    ) {
      this.relationshipSearcher = createRelationshipAwareSearcher(
        {
          maxResults: 10,
          minRelevanceScore: 0.5,
          boostRelationshipMatches: true,
          relationshipBoostFactor: 1.5,
        },
        this.config.knowledgeGraph,
        this.config.memoryStore,
        undefined, // No logger to reduce noise
      );
    }
  }

  /**
   * Main entry point: analyze query and build context
   * PRESERVED: Same interface and behavior as original
   */
  async inject(query: string): Promise<InjectionResult> {
    const startTime = Date.now();

    // Skip short queries
    if (!query || query.trim().length < (this.config.minQueryLength ?? 3)) {
      return {
        metadata: {
          hasContext: false,
          memoryCount: 0,
          buildTimeMs: Date.now() - startTime,
        },
      };
    }

    // Store original query for metadata
    const originalQuery = query;
    let resolvedQuery = query;
    let resolvedEntities: Array<{ original: string; resolved: string; confidence: number }> = [];
    let usedRelationshipSearch = false;

    try {
      // ==========================================
      // OPTIONAL PRE-PROCESSING
      // ==========================================

      // Step 1: Query Entity Resolution (pronoun resolution)
      if (this.queryResolver) {
        const resolution = await this.queryResolver.resolveQuery(query);
        if (resolution && resolution.resolvedQuery !== query) {
          resolvedQuery = resolution.resolvedQuery;
          resolvedEntities = resolution.resolvedEntities.map((r) => ({
            original: r.queryReference,
            resolved: r.canonicalEntity,
            confidence: r.confidence,
          }));
        }
      }

      // Step 2: Relationship-Aware Search (entity expansion)
      let expandedEntities: string[] | undefined;
      if (this.relationshipSearcher) {
        // Build ResolvedQuery object for relationship searcher
        const resolvedQueryObj = {
          originalQuery: originalQuery,
          resolvedQuery: resolvedQuery,
          resolvedEntities: resolvedEntities.map((r) => ({
            queryReference: r.original,
            canonicalEntity: r.resolved,
            confidence: r.confidence,
            resolutionReasoning: "pronoun resolution",
          })),
          inferredRelationships: [],
        };
        const relationshipResults = await this.relationshipSearcher.search(resolvedQueryObj);
        if (relationshipResults.length > 0) {
          expandedEntities = relationshipResults.map((r) => r.memoryId);
          usedRelationshipSearch = true;
        }
      }

      // ==========================================
      // STAGE 1: Query Analysis
      // ==========================================
      const analysis = await this.queryAnalyzer.analyze(resolvedQuery);

      // Skip if no memory needed
      if (analysis.intent === "none") {
        return {
          metadata: {
            hasContext: false,
            memoryCount: 0,
            buildTimeMs: Date.now() - startTime,
            intent: analysis.intent,
          },
        };
      }

      // ==========================================
      // STAGE 2: Determine search parameters
      // ==========================================
      const buildOptions = this.mapAnalysisToOptions(analysis);

      // ==========================================
      // STAGE 3: Build context using 3-stage pipeline
      // ==========================================
      const builtContext = await Promise.race([
        this.contextBuilder.buildContext(resolvedQuery, {
          ...buildOptions,
          entities: expandedEntities ?? analysis.entities,
        }),
        new Promise<BuiltContext>((_, reject) =>
          setTimeout(() => reject(new Error("Context build timeout")), this.config.maxBuildTimeMs),
        ),
      ]);

      const buildTimeMs = Date.now() - startTime;

      // ==========================================
      // STAGE 4: Knowledge Graph Traversal (for additional context)
      // ==========================================
      let kgContext = "";
      if (this.graphTraversal && analysis.entities && analysis.entities.length > 0) {
        try {
          const subgraphs: import("../graph/traversal/types.js").Subgraph[] = [];
          for (const entity of analysis.entities) {
            const subgraph = await this.graphTraversal.findConnectedSubgraph({
              entityNames: [entity],
              maxDepth: 2,
              minConfidence: 0.7,
            });
            if (
              subgraph?.success &&
              subgraph.subgraph?.relationships &&
              subgraph.subgraph.relationships.length > 0
            ) {
              subgraphs.push(subgraph.subgraph);
            }
          }

          if (subgraphs.length > 0) {
            // Merge subgraphs
            const mergedSubgraph: import("../graph/traversal/types.js").Subgraph = {
              entities: [],
              relationships: [],
              paths: [],
              query: {
                entityNames: analysis.entities,
                maxDepth: 2,
                minConfidence: 0.7,
              },
            };
            for (const sg of subgraphs) {
              mergedSubgraph.entities.push(...sg.entities);
              mergedSubgraph.relationships.push(...sg.relationships);
              mergedSubgraph.paths.push(...sg.paths);
            }

            // Filter out meaningless entities for display
            const meaninglessEntities = new Set([
              "what",
              "do",
              "you",
              "know",
              "about",
              "the",
              "is",
              "this",
              "that",
            ]);
            const meaningfulEntities = analysis.entities.filter((e) => !meaninglessEntities.has(e));
            const resolvedEntity =
              meaningfulEntities.length > 0 ? meaningfulEntities.join(", ") : analysis.entities[0];

            // Build KG context using GraphContextBuilder (lazy load)
            if (!this.graphContextBuilder) {
              const { createGraphContextBuilder } =
                await import("../context/builder/graph-context-builder.js");
              this.graphContextBuilder = createGraphContextBuilder("moderate");
            }
            const kgResult = await this.graphContextBuilder.build(
              mergedSubgraph,
              [],
              resolvedQuery,
              resolvedEntity,
            );

            if (kgResult.success) {
              kgContext = kgResult.formatted;
            }
          }
        } catch (error) {
          // Silently continue - KG traversal is optional enhancement
        }
      }

      // ==========================================
      // STAGE 5: Format for injection
      // ==========================================
      if (!builtContext.content && !kgContext) {
        return {
          metadata: {
            hasContext: false,
            memoryCount: 0,
            buildTimeMs,
            intent: analysis.intent,
            entities: analysis.entities,
          },
        };
      }

      const formattedContext = this.formatForInjection(builtContext, analysis, kgContext);

      return {
        prependContext: formattedContext,
        metadata: {
          hasContext: true,
          memoryCount: builtContext.sources.length,
          buildTimeMs,
          intent: analysis.intent,
          entities: analysis.entities,
          memoryIds: builtContext.sources,
          enhanced: {
            originalQuery,
            resolvedQuery,
            resolvedEntities,
            usedRelationshipSearch,
          },
        },
      };
    } catch (error) {
      const buildTimeMs = Date.now() - startTime;
      console.error(`[ContextInjector] Pipeline failed:`, error);

      // Return empty result on failure - don't block the agent
      return {
        metadata: {
          hasContext: false,
          memoryCount: 0,
          buildTimeMs,
        },
      };
    }
  }

  /**
   * Map query analysis to context build options
   */
  private mapAnalysisToOptions(analysis: QueryAnalysis): ContextBuildOptions {
    const searchLevelMap: Record<QueryAnalysis["depth"], SearchLevel> = {
      terse: "focused",
      summary: "moderate",
      full: "general",
    };

    return {
      searchLevel: searchLevelMap[analysis.depth],
      tokenLimit: TOKEN_BUDGETS[searchLevelMap[analysis.depth]],
      minRelevance: analysis.confidenceThreshold,
      maxResults: analysis.depth === "full" ? 50 : analysis.depth === "summary" ? 30 : 10,
    };
  }

  /**
   * Format built context for injection into prompt
   * PRESERVED: Same formatting logic as original
   */
  private formatForInjection(
    context: BuiltContext,
    analysis: QueryAnalysis,
    kgContext?: string,
  ): string {
    const sections: string[] = [];

    // Header based on depth
    const headerMap: Record<QueryAnalysis["depth"], string> = {
      terse: "## Quick Context",
      summary: "## Relevant Context",
      full: "## Full Context",
    };
    sections.push(headerMap[analysis.depth]);

    // Add Knowledge Graph context first (if available)
    if (kgContext && kgContext.length > 0) {
      sections.push(kgContext);
      sections.push(""); // Separator
    }

    // Add episode context content (if available)
    if (context.content && context.content.length > 0) {
      sections.push("## Recent Memories");
      sections.push(context.content);
    }

    // Add citations footer if full context
    if (analysis.depth === "full" && context.sources.length > 0) {
      sections.push("");
      sections.push("---");
      sections.push(
        `Sources: ${context.sources.slice(0, 5).join(", ")}${context.sources.length > 5 ? "..." : ""}`,
      );
    }

    sections.push("");

    return sections.join("\n");
  }

  /**
   * Get pipeline statistics
   */
  getStats(): {
    analyzerReady: boolean;
    builderReady: boolean;
    stageStats: ReturnType<ThreeStageContextBuilder["getStats"]>;
    preProcessingModules: {
      queryResolver: boolean;
      relationshipSearcher: boolean;
    };
  } {
    return {
      analyzerReady: true,
      builderReady: true,
      stageStats: this.contextBuilder.getStats(),
      preProcessingModules: {
        queryResolver: !!this.queryResolver,
        relationshipSearcher: !!this.relationshipSearcher,
      },
    };
  }

  /**
   * Clear all caches
   */
  clearCaches(): void {
    this.queryAnalyzer.clearCache();
  }

  /**
   * Record context injection for recall detection
   */
  recordInjection(
    sessionId: string,
    memories: Array<{ content: string; memoryId?: string }>,
    entities: string[],
  ): void {
    this.recallDetector.recordContextInjection(sessionId, memories, entities);
  }

  /**
   * Check if a message should be skipped as recall
   */
  checkForRecall(
    messageContent: string,
    sessionId: string,
    messageRole: "user" | "assistant" | "system" = "assistant",
  ): {
    isRecall: boolean;
    reason: string;
    confidence: number;
  } {
    return this.recallDetector.isRecallResponse(messageContent, sessionId, messageRole);
  }

  /**
   * Get the recall detector instance
   */
  getRecallDetector(): RecallDetectionService {
    return this.recallDetector;
  }
}

/**
 * Create a context injector instance
 * PRESERVED: Same factory function as original
 */
export function createContextInjector(config: ContextInjectorConfig): ContextInjector {
  return new ContextInjector(config);
}

/**
 * Singleton instance
 */
let globalInjector: ContextInjector | null = null;

/**
 * Initialize the global context injector
 * PRESERVED: Same initialization pattern as original
 */
export function initializeContextInjector(config: ContextInjectorConfig): ContextInjector {
  globalInjector = createContextInjector(config);
  return globalInjector;
}

/**
 * Get the global context injector (throws if not initialized)
 * PRESERVED: Same getter as original
 */
export function getContextInjector(): ContextInjector {
  if (!globalInjector) {
    throw new Error("ContextInjector not initialized. Call initializeContextInjector first.");
  }
  return globalInjector;
}

/**
 * Check if injector is initialized
 * PRESERVED: Same check as original
 */
export function isContextInjectorInitialized(): boolean {
  return globalInjector !== null;
}

/**
 * Get graph context for a user query (for system prompt integration)
 * PRESERVED: Same function as original
 */
export async function getGraphContextForQuery(query: string): Promise<string | null> {
  if (!globalInjector) {
    return null;
  }

  try {
    const result = await globalInjector.inject(query);
    if (result.metadata.hasContext && result.prependContext) {
      return result.prependContext;
    }
    return null;
  } catch (error) {
    console.error("[AURA] Failed to get graph context:", error);
    return null;
  }
}

/**
 * Three-Stage Context Builder - Orchestrator
 *
 * TRUE 3-STAGE PIPELINE:
 * 1. Knowledge Graph Search (entity-based topic identification)
 * 2. Hybrid Search (vector + BM25 scoped to Stage 1's identified memories)
 * 3. REPL Filtering (G/M/F levels)
 *
 * Each stage feeds into the next - no parallel fallback
 */

import type { DatabaseSync } from "better-sqlite3";
import type { TieredMemoryStore } from "../../adapters/TieredMemoryStore.js";
import type { EncryptionService } from "../../encryption/EncryptionService.js";
import type { KnowledgeGraphIntegration } from "../../graph/KnowledgeGraphIntegration.js";
import type { GraphTraversalSearch } from "../../graph/traversal/traversal-search.js";
import { createContextDeduplicator } from "../ContextDeduplicator.js";
import {
  debugContextBuildStart,
  debugContextBuildComplete,
  debugStage1Fallback,
  trackPerformance,
} from "../debug-utils.js";
import { ContextFormatter } from "../formatters/context-formatter.js";
import type { SearchResult, BuiltContext, ContextBuildOptions } from "../models.js";
import { RelevanceScorer } from "../relevance-scorer.js";
import type { QueryEmbeddingService } from "../services/QueryEmbeddingService.js";
import { Stage1KnowledgeGraphSearch } from "../stages/stage1-knowledge-graph.js";
import { Stage2HybridSearch } from "../stages/stage2-hybrid-search.js";
import { Stage3REPLFilter } from "../stages/stage3-repl-filter.js";

export interface ThreeStageBuilderConfig {
  /** SQLite database for hybrid search */
  db: DatabaseSync;
  /** Knowledge Graph integration */
  knowledgeGraph?: KnowledgeGraphIntegration;
  /** Tiered memory store */
  memoryStore?: TieredMemoryStore;
  /** Default token limit */
  defaultTokenLimit?: number;
  /** Core files to always include */
  coreFiles?: string[];
  /** Provider model for embeddings */
  providerModel?: string;
  /** Query embedding service for semantic search */
  queryEmbeddingService?: QueryEmbeddingService;
  /** Encryption service for decrypting User category memories */
  encryptionService?: EncryptionService;
  /** Graph traversal for Stage 1 entity relationship search */
  graphTraversal?: GraphTraversalSearch;
}

export class ThreeStageContextBuilder {
  private stage1: Stage1KnowledgeGraphSearch | null = null;
  private stage2: Stage2HybridSearch;
  private stage3: Stage3REPLFilter;
  private formatter: ContextFormatter;
  private relevanceScorer: RelevanceScorer;
  private deduplicator: ReturnType<typeof createContextDeduplicator>;
  private defaultTokenLimit: number;

  // Stage constants
  private static readonly STAGE1_MAX_RESULTS = 50;
  private static readonly STAGE2_MAX_RESULTS = 50;
  private static readonly STAGE1_MIN_RELEVANCE = 0.3;
  private static readonly STAGE2_MIN_RELEVANCE = 0.1;

  constructor(config: ThreeStageBuilderConfig) {
    this.defaultTokenLimit = config.defaultTokenLimit ?? 8000;

    // Initialize Stage 1 (if KG available)
    if (config.knowledgeGraph) {
      this.stage1 = new Stage1KnowledgeGraphSearch({
        knowledgeGraph: config.knowledgeGraph,
        maxResults: ThreeStageContextBuilder.STAGE1_MAX_RESULTS,
        minRelevance: ThreeStageContextBuilder.STAGE1_MIN_RELEVANCE,
        graphTraversal: config.graphTraversal, // Pass graph traversal for entity relationship search
        traversalDepth: 2,
        minConfidence: 0.7,
      });
    }

    // Initialize Stage 2 (always available)
    this.stage2 = new Stage2HybridSearch({
      db: config.db,
      providerModel: config.providerModel ?? "default",
      maxResults: ThreeStageContextBuilder.STAGE2_MAX_RESULTS,
      minRelevance: ThreeStageContextBuilder.STAGE2_MIN_RELEVANCE,
      queryEmbeddingService: config.queryEmbeddingService,
      encryptionService: config.encryptionService,
    });

    // Initialize Stage 3 (always available)
    this.stage3 = new Stage3REPLFilter();

    // Initialize formatter
    this.formatter = new ContextFormatter({
      tokenLimit: this.defaultTokenLimit,
      coreFiles: config.coreFiles,
    });

    // Initialize relevance scorer
    this.relevanceScorer = new RelevanceScorer();

    // Initialize deduplicator
    this.deduplicator = createContextDeduplicator({
      similarityThreshold: 0.85,
      preferHigherRelevance: true,
      preferMoreRecent: true,
    });
  }

  /**
   * Execute three-stage pipeline
   *
   * TRUE PIPELINE: Stage 1 → Stage 2 → Stage 3
   * Stage 2 is scoped to memories identified by Stage 1
   */
  
  async buildContext(
    query: string,
    options: ContextBuildOptions & { entities?: string[] } = {},
  ): Promise<BuiltContext> {
    const tokenLimit = options.tokenLimit ?? this.defaultTokenLimit;
    const searchLevel = options.searchLevel ?? "general";
    const entities = options.entities; // From QueryAnalyzer
    const startTimestamp = debugContextBuildStart(query, tokenLimit);
    const startTime = Date.now();

    try {
      // Execute true sequential pipeline
      const results = await this.executePipeline(query, searchLevel, entities);

      // Deduplicate results BEFORE formatting
      const dedupeInput = results.map((r) => ({
        memoryId: r.memoryId,
        content: r.content,
        relevanceScore: r.score,
        timestamp: Date.now(), // Stage 2/3 don't have timestamps, use current
      }));
      const deduplicated = this.deduplicator.deduplicate(dedupeInput);

      // Convert back to SearchResult format
      const deduplicatedResults: SearchResult[] = deduplicated.map((d) => ({
        memoryId: d.memoryId,
        content: d.content,
        score: d.relevanceScore || 0.5,
        metadata: {},
      }));

      // Format final context
      const context = this.formatter.format(deduplicatedResults);
      context.buildTimeMs = Date.now() - startTime;

      debugContextBuildComplete(context, startTimestamp);
      return context;
    } catch (error) {
      return this.createEmptyContext(startTime);
    }
  }

  /**
   * Execute TRUE sequential pipeline:
   *
   * Stage 1: KG identifies relevant memory topics/areas via entity relationships
   * Stage 2: Hybrid search drills down INTO those specific areas (scoped search)
   * Stage 3: REPL filters to G/M/F level
   *
   * @param entities - Pre-extracted entities from QueryAnalyzer (passed to Stage 1)
   */
  private async executePipeline(
    query: string,
    searchLevel: "general" | "moderate" | "focused",
    entities?: string[],
  ): Promise<SearchResult[]> {
    let stage1Results: SearchResult[] = [];

    // ========== STAGE 1: Knowledge Graph (Topic Identification) ==========
    if (this.stage1?.isAvailable()) {
      const stage1Result = await this.stage1.execute(query, entities);

      if (stage1Result.success) {
        stage1Results = stage1Result.results;
      } else {
        debugStage1Fallback(stage1Result.error?.message ?? "Unknown error");
      }
    }

    // ========== STAGE 2: Hybrid Search (Drill-down into Stage 1 areas) ==========
    let stage2Results: SearchResult[];

    if (stage1Results.length > 0) {
      // TRUE PIPELINE: Hybrid search is SCOPED to Stage 1's identified memories
      const stage2Result = await this.stage2.execute(query, stage1Results);

      if (stage2Result.success) {
        stage2Results = stage2Result.results;
      } else {
        // Fallback: use Stage 1 results directly if Stage 2 fails
        stage2Results = stage1Results;
      }
    } else {
      // No Stage 1 results: do unconstrained hybrid search as fallback
      const stage2Result = await this.stage2.execute(query);

      if (stage2Result.success) {
        stage2Results = stage2Result.results;
      } else {
        stage2Results = [];
      }
    }

    // Score relevance across all results
    const scoredResults = this.relevanceScorer.scoreResults(stage2Results, query);

    // ========== STAGE 3: REPL Filtering (G/M/F) ==========
    const stage3Result = this.stage3.execute(scoredResults, { level: searchLevel });

    return stage3Result.results;
  }

  /**
   * Create empty context on failure
   */
  private createEmptyContext(startTime: number): BuiltContext {
    return {
      content: "",
      tokenCount: 0,
      sources: [],
      relevanceScore: 0,
      buildTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Get pipeline statistics
   */
  getStats(): {
    stage1Available: boolean;
    stage2Available: boolean;
    stage3Available: boolean;
    stage2Stats: ReturnType<Stage2HybridSearch["getStats"]>;
  } {
    return {
      stage1Available: this.stage1?.isAvailable() ?? false,
      stage2Available: this.stage2.isAvailable(),
      stage3Available: this.stage3.isAvailable(),
      stage2Stats: this.stage2.getStats(),
    };
  }
}

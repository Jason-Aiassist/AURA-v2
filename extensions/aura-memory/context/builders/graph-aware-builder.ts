/**
 * Three-Stage Context Builder v2 - Graph-Aware Pipeline
 *
 * Integrates EntityResolver and GraphTraversalSearch for
 * semantic relationship-aware context building.
 *
 * Stage 1: Entity Resolution + Graph Traversal → Entity subgraph
 * Stage 2: Hybrid Search scoped to subgraph entities
 * Stage 3: REPL Filtering with graph distance scoring
 */

import type { DatabaseSync } from "better-sqlite3";
import type { ConcreteKnowledgeGraph } from "../../adapters/ConcreteKnowledgeGraph.js";
import type { Neo4jDriver } from "../../adapters/kg-storage/types.js";
import type { TieredMemoryStore } from "../../adapters/TieredMemoryStore.js";
import type { EncryptionService } from "../../encryption/EncryptionService.js";
import { EntityResolver } from "../../graph/entity-resolution/EntityResolver.js";
import type { KnowledgeGraphIntegration } from "../../graph/KnowledgeGraphIntegration.js";
import { GraphTraversalSearch } from "../../graph/traversal/traversal-search.js";
import {
  debugContextBuildStart,
  debugContextBuildComplete,
  trackPerformance,
} from "../debug-utils.js";
import { ContextFormatter } from "../formatters/context-formatter.js";
import type { SearchResult, BuiltContext, ContextBuildOptions } from "../models.js";
import { RelevanceScorer } from "../relevance-scorer.js";
import type { QueryEmbeddingService } from "../services/QueryEmbeddingService.js";
import { Stage1KnowledgeGraphSearch } from "../stages/stage1-knowledge-graph-v2.js";
import { Stage2HybridSearch } from "../stages/stage2-hybrid-search.js";
import { Stage3REPLFilter } from "../stages/stage3-repl-filter.js";

export interface GraphAwareBuilderConfig {
  /** SQLite database for hybrid search */
  db: DatabaseSync;
  /** Knowledge Graph integration */
  knowledgeGraph?: KnowledgeGraphIntegration;
  /** Neo4j driver for graph operations */
  neo4jDriver?: Neo4jDriver;
  /** Tiered memory store */
  memoryStore?: TieredMemoryStore;
  /** Default token limit */
  defaultTokenLimit?: number;
  /** Core files to always include */
  coreFiles?: string[];
  /** Provider model for embeddings */
  providerModel?: string;
  /** Query embedding service */
  queryEmbeddingService?: QueryEmbeddingService;
  /** Encryption service */
  encryptionService?: EncryptionService;
  /** Enable graph traversal (default: true) */
  enableTraversal?: boolean;
  /** Max traversal depth (default: 2) */
  maxTraversalDepth?: number;
}

export class GraphAwareContextBuilder {
  private stage1: Stage1KnowledgeGraphSearch | null = null;
  private stage2: Stage2HybridSearch;
  private stage3: Stage3REPLFilter;
  private formatter: ContextFormatter;
  private relevanceScorer: RelevanceScorer;
  private defaultTokenLimit: number;
  private enableTraversal: boolean;

  // Stage constants
  private static readonly STAGE1_MAX_RESULTS = 50;
  private static readonly STAGE2_MAX_RESULTS = 50;
  private static readonly STAGE1_MIN_RELEVANCE = 0.3;
  private static readonly STAGE2_MIN_RELEVANCE = 0.1;
  private static readonly DEFAULT_TRAVERSAL_DEPTH = 2;

  constructor(config: GraphAwareBuilderConfig) {
    this.defaultTokenLimit = config.defaultTokenLimit ?? 8000;
    this.enableTraversal = config.enableTraversal ?? true;

    // Initialize Stage 1 with graph-aware components
    if (config.knowledgeGraph && config.neo4jDriver) {
      const entityResolver = new EntityResolver(config.neo4jDriver);
      const graphTraversal = new GraphTraversalSearch({
        driver: config.neo4jDriver,
        concreteKG: config.knowledgeGraph as unknown as ConcreteKnowledgeGraph,
      });

      this.stage1 = new Stage1KnowledgeGraphSearch({
        knowledgeGraph: config.knowledgeGraph,
        maxResults: GraphAwareContextBuilder.STAGE1_MAX_RESULTS,
        minRelevance: GraphAwareContextBuilder.STAGE1_MIN_RELEVANCE,
        entityResolver,
        graphTraversal,
        enableTraversal: this.enableTraversal,
      });
    } else {
      if (config.knowledgeGraph) {
        // Fallback to basic Stage 1
        this.stage1 = new Stage1KnowledgeGraphSearch({
          knowledgeGraph: config.knowledgeGraph,
          maxResults: GraphAwareContextBuilder.STAGE1_MAX_RESULTS,
          minRelevance: GraphAwareContextBuilder.STAGE1_MIN_RELEVANCE,
        });
      }
    }

    // Initialize Stage 2
    this.stage2 = new Stage2HybridSearch({
      db: config.db,
      providerModel: config.providerModel ?? "default",
      maxResults: GraphAwareContextBuilder.STAGE2_MAX_RESULTS,
      minRelevance: GraphAwareContextBuilder.STAGE2_MIN_RELEVANCE,
      queryEmbeddingService: config.queryEmbeddingService,
      encryptionService: config.encryptionService,
    });

    // Initialize Stage 3
    this.stage3 = new Stage3REPLFilter();

    // Initialize formatter
    this.formatter = new ContextFormatter({
      tokenLimit: this.defaultTokenLimit,
      coreFiles: config.coreFiles,
    });

    // Initialize relevance scorer
    this.relevanceScorer = new RelevanceScorer();
  }

  /**
   * Execute graph-aware three-stage pipeline
   */
  @trackPerformance("graph-aware-context-build")
  async buildContext(
    query: string,
    options: ContextBuildOptions & { entities?: string[] } = {},
  ): Promise<BuiltContext & { graphInfo?: any }> {
    const tokenLimit = options.tokenLimit ?? this.defaultTokenLimit;
    const searchLevel = options.searchLevel ?? "general";
    const entities = options.entities;
    const startTimestamp = debugContextBuildStart(query, tokenLimit);
    const startTime = Date.now();

    try {
      // Execute pipeline
      const { results, graphInfo } = await this.executePipeline(query, searchLevel, entities);

      // Format context
      const context = this.formatter.format(results);
      context.buildTimeMs = Date.now() - startTime;

      debugContextBuildComplete(context, startTimestamp);

      return {
        ...context,
        graphInfo,
      };
    } catch (error) {
      return this.createEmptyContext(startTime);
    }
  }

  /**
   * Execute pipeline with graph awareness
   */
  private async executePipeline(
    query: string,
    searchLevel: "general" | "moderate" | "focused",
    entities?: string[],
  ): Promise<{ results: SearchResult[]; graphInfo?: any }> {
    let stage1Results: SearchResult[] = [];
    let resolvedEntities: any;

    // Stage 1: Entity resolution and graph traversal
    if (this.stage1?.isAvailable()) {
      const stage1Result = await this.stage1.execute(query, entities);

      if (stage1Result.success) {
        stage1Results = stage1Result.results;
        resolvedEntities = stage1Result.resolvedEntities;
      }
    }

    // Stage 2: Hybrid search
    let stage2Results: SearchResult[];

    if (stage1Results.length > 0) {
      const stage2Result = await this.stage2.execute(query, stage1Results);
      stage2Results = stage2Result.success ? stage2Result.results : stage1Results;
    } else {
      const stage2Result = await this.stage2.execute(query);
      stage2Results = stage2Result.success ? stage2Result.results : [];
    }

    // Score relevance
    const scoredResults = this.relevanceScorer.scoreResults(stage2Results, query);

    // Stage 3: REPL filtering
    const stage3Result = this.stage3.execute(scoredResults, { level: searchLevel });

    return {
      results: stage3Result.results,
      graphInfo: resolvedEntities
        ? {
            resolved: resolvedEntities.resolved,
            connected: resolvedEntities.connected,
            traversalUsed: this.enableTraversal && this.stage1?.isTraversalAvailable(),
          }
        : undefined,
    };
  }

  /**
   * Create empty context
   */
  private createEmptyContext(startTime: number): BuiltContext & { graphInfo?: any } {
    return {
      content: "",
      tokenCount: 0,
      sources: [],
      relevanceScore: 0,
      buildTimeMs: Date.now() - startTime,
      graphInfo: { error: "Pipeline failed" },
    };
  }

  /**
   * Get pipeline statistics
   */
  getStats(): {
    stage1Available: boolean;
    stage1TraversalAvailable: boolean;
    stage2Available: boolean;
    stage3Available: boolean;
  } {
    return {
      stage1Available: this.stage1?.isAvailable() ?? false,
      stage1TraversalAvailable: this.stage1?.isTraversalAvailable() ?? false,
      stage2Available: this.stage2.isAvailable(),
      stage3Available: this.stage3.isAvailable(),
    };
  }
}

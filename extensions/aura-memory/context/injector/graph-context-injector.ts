/**
 * Graph-Aware Context Injector
 * Injects structured graph context into LLM prompts
 */

import type { Subgraph } from "../../graph/traversal/types.js";
import { createLogger } from "../../shared/debug-logger.js";
import { GraphContextBuilder } from "../builder/graph-context-builder.js";
import type { GraphContext } from "../builder/types.js";
import type { SearchLevel } from "../models.js";

const logger = createLogger("GraphContextInjector");

/**
 * Injection input
 */
export interface GraphInjectionInput {
  /** Original user query */
  query: string;
  /** Resolved entity name */
  resolvedEntity?: string;
  /** Graph subgraph from traversal */
  subgraph: Subgraph;
  /** Related memories */
  memories: Array<{
    id: string;
    content: string;
    timestamp: number;
    relevance: number;
  }>;
  /** Search level */
  level: SearchLevel;
  /** Optional query analysis */
  queryAnalysis?: {
    intent: string;
    entities: string[];
    confidence: number;
  };
}

/**
 * Injection result
 */
export interface GraphInjectionResult {
  /** Success status */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Context that was injected */
  context: GraphContext;
  /** Formatted context string */
  formattedContext: string;
  /** Original query with context prepended */
  enhancedQuery: string;
  /** Token usage */
  tokens: {
    contextTokens: number;
    totalTokens: number;
    remainingBudget: number;
  };
  /** Performance metrics */
  metrics: {
    durationMs: number;
    entitiesIncluded: number;
    factsIncluded: number;
    hintsIncluded: number;
  };
}

/**
 * Context budget by level
 */
const CONTEXT_BUDGETS: Record<SearchLevel, number> = {
  focused: 1000,
  moderate: 2500,
  general: 4000,
};

/**
 * Graph-Aware Context Injector
 * Replaces flat text injection with structured graph context
 */
export class GraphContextInjector {
  private builder: GraphContextBuilder;
  private logger = createLogger("GraphContextInjector");
  private level: SearchLevel;

  constructor(level: SearchLevel = "moderate") {
    this.level = level;
    this.builder = new GraphContextBuilder(level);
    this.logger.start("constructor", { level });
  }

  /**
   * Inject graph context into query
   * @param input - Injection parameters
   * @returns Injection result
   */
  async inject(input: GraphInjectionInput): Promise<GraphInjectionResult> {
    const startTime = Date.now();

    this.logger.start("inject", {
      query: input.query.substring(0, 50),
      entityCount: input.subgraph.entities.length,
      memoryCount: input.memories.length,
      level: input.level,
    });

    try {
      // Step 1: Build structured context
      this.logger.progress("building-context");
      const buildResult = await this.builder.build(
        input.subgraph,
        input.memories,
        input.query,
        input.resolvedEntity,
      );

      if (!buildResult.success) {
        throw new Error(buildResult.error || "Context build failed");
      }

      this.logger.progress("context-built", {
        tokenEstimate: buildResult.tokens.used,
        entityCount: buildResult.context.metadata.entityCount,
        factCount: buildResult.context.knownFacts.length,
        hintCount: buildResult.context.reasoningPaths.length,
      });

      // Step 2: Check token budget
      const budget = CONTEXT_BUDGETS[input.level];
      const contextTokens = buildResult.tokens.used;

      if (contextTokens > budget) {
        this.logger.progress("truncating-context", {
          originalTokens: contextTokens,
          budget,
        });
        // Builder already handles truncation, but we could do more here
      }

      // Step 3: Format enhanced query
      this.logger.progress("formatting-query");
      const enhancedQuery = this.formatEnhancedQuery(input.query, buildResult.formatted);

      const totalTokens = this.estimateTokens(enhancedQuery);

      this.logger.success({
        contextTokens,
        totalTokens,
        entitiesIncluded: buildResult.context.metadata.entityCount,
        factsIncluded: buildResult.context.knownFacts.length,
        hintsIncluded: buildResult.context.reasoningPaths.length,
        durationMs: Date.now() - startTime,
      });

      return {
        success: true,
        context: buildResult.context,
        formattedContext: buildResult.formatted,
        enhancedQuery,
        tokens: {
          contextTokens,
          totalTokens,
          remainingBudget: Math.max(0, budget - contextTokens),
        },
        metrics: {
          durationMs: Date.now() - startTime,
          entitiesIncluded: buildResult.context.metadata.entityCount,
          factsIncluded: buildResult.context.knownFacts.length,
          hintsIncluded: buildResult.context.reasoningPaths.length,
        },
      };
    } catch (error) {
      this.logger.error(error as Error, {
        phase: "inject",
        query: input.query.substring(0, 50),
      });

      // Return empty context on failure (don't break the pipeline)
      return {
        success: false,
        error: error instanceof Error ? error.message : "Injection failed",
        context: {
          entityResolution: [],
          knownFacts: [],
          reasoningPaths: [],
          entityDetails: [],
          relatedMemories: [],
          metadata: {
            entityCount: 0,
            relationshipCount: 0,
            reasoningHintCount: 0,
            tokenEstimate: 0,
          },
        },
        formattedContext: "",
        enhancedQuery: input.query, // Return original query
        tokens: {
          contextTokens: 0,
          totalTokens: this.estimateTokens(input.query),
          remainingBudget: CONTEXT_BUDGETS[input.level],
        },
        metrics: {
          durationMs: Date.now() - startTime,
          entitiesIncluded: 0,
          factsIncluded: 0,
          hintsIncluded: 0,
        },
      };
    }
  }

  /**
   * Format enhanced query with context prepended
   */
  private formatEnhancedQuery(originalQuery: string, context: string): string {
    const lines: string[] = [];

    lines.push(context);
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push(originalQuery);

    return lines.join("\n");
  }

  /**
   * Estimate token count
   */
  private estimateTokens(text: string): number {
    // Approximate: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  /**
   * Get current configuration
   */
  getConfig(): { level: SearchLevel; budget: number } {
    return {
      level: this.level,
      budget: CONTEXT_BUDGETS[this.level],
    };
  }
}

/**
 * Create graph context injector
 */
export function createGraphContextInjector(level: SearchLevel = "moderate"): GraphContextInjector {
  return new GraphContextInjector(level);
}

/**
 * Quick inject helper
 */
export async function injectGraphContext(
  input: GraphInjectionInput,
): Promise<GraphInjectionResult> {
  const injector = createGraphContextInjector(input.level);
  return injector.inject(input);
}

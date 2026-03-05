/**
 * Graph Context Builder
 * Builds structured context from graph subgraphs for LLM consumption
 */

import { generateReasoningHints } from "../../graph/traversal/reasoning-hints.js";
import type { Subgraph, GraphRelationship, ReasoningHint } from "../../graph/traversal/types.js";
import { createLogger } from "../../shared/debug-logger.js";
import type {
  GraphContext,
  ContextBuilderConfig,
  TokenBudget,
  FormatOptions,
  ContextBuildResult,
  RelatedMemory,
  ContextSection,
} from "./types.js";
import { LEVEL_CONFIGS } from "./types.js";

const logger = createLogger("GraphContextBuilder");

/**
 * Approximate tokens per character (conservative estimate)
 */
const TOKENS_PER_CHAR = 0.25;

/**
 * Graph Context Builder
 */
export class GraphContextBuilder {
  private config: ContextBuilderConfig;
  private logger = createLogger("GraphContextBuilder");

  constructor(level: "focused" | "moderate" | "general" = "moderate") {
    this.config = LEVEL_CONFIGS[level];
    this.logger.start("constructor", { level, maxTokens: this.config.maxTokens });
  }

  /**
   * Build structured context from subgraph
   * @param subgraph - Traversal subgraph
   * @param memories - Related memories
   * @param query - Original query
   * @param resolvedEntity - Resolved entity name
   * @returns Build result
   */
  async build(
    subgraph: Subgraph,
    memories: RelatedMemory[],
    query: string,
    resolvedEntity?: string,
  ): Promise<ContextBuildResult> {
    const startTime = Date.now();

    this.logger.start("build", {
      query: query.substring(0, 50),
      entityCount: subgraph.entities.length,
      relationshipCount: subgraph.relationships.length,
      memoryCount: memories.length,
    });

    try {
      // Initialize token budget
      const budget = this.initializeBudget();
      this.logger.progress("budget-initialized", {
        total: budget.total,
        sections: Object.keys(budget.allocated).length,
      });

      // Build context sections
      this.logger.progress("building-sections");
      const context: GraphContext = {
        entityResolution: resolvedEntity
          ? [
              {
                original: query,
                resolved: resolvedEntity,
                confidence: 0.95,
                method: "entity_resolution",
              },
            ]
          : [],
        knownFacts: this.buildKnownFacts(subgraph),
        reasoningPaths: this.buildReasoningPaths(subgraph),
        entityDetails: this.buildEntityDetails(subgraph),
        relatedMemories: this.buildRelatedMemories(memories),
        metadata: {
          entityCount: subgraph.entities.length,
          relationshipCount: subgraph.relationships.length,
          reasoningHintCount: 0,
          tokenEstimate: 0,
        },
      };

      // Calculate token estimates
      this.logger.progress("calculating-tokens");
      const tokenEstimate = this.estimateTokens(context);
      context.metadata.tokenEstimate = tokenEstimate;

      // Format output
      this.logger.progress("formatting-output");
      const formatted = this.formatContext(context);
      const actualTokens = this.countTokens(formatted);

      this.logger.success({
        entityCount: context.metadata.entityCount,
        relationshipCount: context.metadata.relationshipCount,
        reasoningHintCount: context.reasoningPaths.length,
        tokenEstimate,
        actualTokens,
        durationMs: Date.now() - startTime,
      });

      return {
        success: true,
        context,
        formatted,
        tokens: {
          used: actualTokens,
          total: this.config.maxTokens,
          bySection: this.calculateSectionTokens(context),
        },
        metrics: {
          durationMs: Date.now() - startTime,
          entitiesProcessed: subgraph.entities.length,
          relationshipsProcessed: subgraph.relationships.length,
        },
      };
    } catch (error) {
      this.logger.error(error as Error, {
        phase: "build",
        query: query.substring(0, 50),
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
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
        formatted: "",
        tokens: {
          used: 0,
          total: this.config.maxTokens,
          bySection: {} as Record<ContextSection, number>,
        },
        metrics: {
          durationMs: Date.now() - startTime,
          entitiesProcessed: 0,
          relationshipsProcessed: 0,
        },
      };
    }
  }

  /**
   * Build known facts section
   */
  private buildKnownFacts(subgraph: Subgraph): GraphContext["knownFacts"] {
    this.logger.progress("building-known-facts", {
      relationshipCount: subgraph.relationships.length,
    });

    return subgraph.relationships
      .filter((rel) => rel.confidence >= this.config.minFactConfidence)
      .map((rel) => ({
        statement: `${rel.from} ${rel.type} ${rel.to}`,
        confidence: rel.confidence,
        source: rel.fact || "Extracted from conversation",
      }))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 10); // Limit to top 10 facts
  }

  /**
   * Build reasoning paths section
   */
  private buildReasoningPaths(subgraph: Subgraph): GraphContext["reasoningPaths"] {
    this.logger.progress("building-reasoning-paths", { pathCount: subgraph.paths.length });

    const hints = generateReasoningHints(subgraph);

    return hints
      .filter((hint) => hint.confidence >= this.config.minFactConfidence)
      .map((hint) => ({
        hint: hint.statement,
        confidence: hint.confidence,
        pattern: hint.pattern,
      }))
      .slice(0, 5); // Limit to top 5 hints
  }

  /**
   * Build entity details section
   */
  private buildEntityDetails(subgraph: Subgraph): GraphContext["entityDetails"] {
    this.logger.progress("building-entity-details", { entityCount: subgraph.entities.length });

    return subgraph.entities
      .filter((entity) => this.config.includeSummaries || entity.depth <= 1)
      .map((entity) => ({
        name: entity.name,
        type: entity.type,
        aliases: entity.aliases || [],
        summary: entity.paths?.length ? `Connected via ${entity.paths.length} paths` : undefined,
      }));
  }

  /**
   * Build related memories section
   */
  private buildRelatedMemories(memories: RelatedMemory[]): GraphContext["relatedMemories"] {
    this.logger.progress("building-related-memories", { memoryCount: memories.length });

    return memories
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 5) // Limit to top 5 memories
      .map((mem) => ({
        memoryId: mem.id,
        content: mem.content.substring(0, 200), // Truncate long content
        timestamp: mem.timestamp,
        relevance: mem.relevance,
      }));
  }

  /**
   * Initialize token budget
   */
  private initializeBudget(): TokenBudget {
    const allocated: Record<ContextSection, number> = {
      entity_resolution: 0,
      known_facts: 0,
      reasoning_paths: 0,
      entity_details: 0,
      related_memories: 0,
    };

    // Allocate based on priority
    const totalPriority = Object.values(this.config.sectionPriority).reduce((sum, p) => sum + p, 0);

    for (const section of this.config.sections) {
      const priority = this.config.sectionPriority[section];
      allocated[section] = Math.floor((this.config.maxTokens * priority) / totalPriority);
    }

    return {
      total: this.config.maxTokens,
      allocated,
      used: { ...allocated },
      remaining: this.config.maxTokens,
    };
  }

  /**
   * Estimate tokens for context
   */
  private estimateTokens(context: GraphContext): number {
    const json = JSON.stringify(context);
    return Math.ceil(json.length * TOKENS_PER_CHAR);
  }

  /**
   * Count actual tokens in formatted string
   */
  private countTokens(text: string): number {
    // Simple approximation: ~4 chars per token
    return Math.ceil(text.length / 4);
  }

  /**
   * Calculate tokens used by section
   */
  private calculateSectionTokens(context: GraphContext): Record<ContextSection, number> {
    return {
      entity_resolution: context.entityResolution.length * 10,
      known_facts: context.knownFacts.length * 15,
      reasoning_paths: context.reasoningPaths.length * 25,
      entity_details: context.entityDetails.length * 20,
      related_memories: context.relatedMemories.length * 50,
    };
  }

  /**
   * Format context for output
   */
  private formatContext(context: GraphContext): string {
    const lines: string[] = [];

    lines.push("<knowledge_graph_context>");

    // Entity Resolution
    if (context.entityResolution.length > 0) {
      lines.push("\n## Entity Resolution");
      for (const res of context.entityResolution) {
        lines.push(`Query "${res.original}" → Resolved to "${res.resolved}"`);
      }
    }

    // Known Facts
    if (context.knownFacts.length > 0) {
      lines.push("\n## Known Facts");
      for (const fact of context.knownFacts) {
        lines.push(`- ${fact.statement} (confidence: ${fact.confidence.toFixed(2)})`);
      }
    }

    // Reasoning Paths
    if (context.reasoningPaths.length > 0) {
      lines.push("\n## Reasoning Paths");
      for (const path of context.reasoningPaths) {
        lines.push(`- ${path.hint}`);
      }
    }

    // Entity Details
    if (context.entityDetails.length > 0 && this.config.includeSummaries) {
      lines.push("\n## Entity Details");
      for (const entity of context.entityDetails) {
        lines.push(`- ${entity.name} (${entity.type})`);
        if (entity.aliases.length > 0) {
          lines.push(`  Aliases: ${entity.aliases.join(", ")}`);
        }
      }
    }

    // Related Memories
    if (context.relatedMemories.length > 0) {
      lines.push("\n## Related Memories");
      for (const mem of context.relatedMemories) {
        lines.push(`- ${mem.content.substring(0, 150)}...`);
      }
    }

    lines.push("\n</knowledge_graph_context>");

    return lines.join("\n");
  }

  /**
   * Get configuration
   */
  getConfig(): ContextBuilderConfig {
    return { ...this.config };
  }
}

/**
 * Create context builder
 */
export function createGraphContextBuilder(
  level: "focused" | "moderate" | "general" = "moderate",
): GraphContextBuilder {
  return new GraphContextBuilder(level);
}

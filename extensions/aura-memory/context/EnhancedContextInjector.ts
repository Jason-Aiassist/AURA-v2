/**
 * Enhanced Context Injector Integration
 *
 * Integrates Phase 2 components (QueryEntityResolver, RelationshipAwareSearcher)
 * into the existing ContextInjector workflow.
 */

import type { TieredMemoryStore } from "../adapters/TieredMemoryStore.js";
import type {
  ContextInjector,
  ContextInjectorConfig,
  InjectionResult,
} from "../agents/ContextInjector.js";
import { getUserName } from "../config/user-config.js";
import type { EmbeddingService } from "../embeddings/EmbeddingService.js";
import type { KnowledgeGraphIntegration } from "../graph/KnowledgeGraphIntegration.js";
import type { Logger } from "../types.js";
import {
  createQueryEntityResolver,
  QueryEntityResolver,
  ResolvedQuery,
} from "./QueryEntityResolver.js";
import {
  createRelationshipAwareSearcher,
  RelationshipAwareSearcher,
} from "./RelationshipAwareSearcher.js";

export interface EnhancedInjectorConfig {
  enabled: boolean;
  useQueryResolution: boolean;
  useRelationshipSearch: boolean;
  userName: string;
}

export interface EnhancedInjectionResult extends InjectionResult {
  enhancedMetadata?: {
    originalQuery: string;
    resolvedQuery: string;
    resolvedEntities: Array<{
      original: string;
      resolved: string;
      confidence: number;
    }>;
    inferredRelationships: Array<{
      type: string;
      entity?: string;
    }>;
    usedRelationshipSearch: boolean;
  };
}

/**
 * Enhanced Context Injector
 * Wraps the base ContextInjector with Phase 2 enhancements
 */
export class EnhancedContextInjector {
  private baseInjector: ContextInjector;
  private config: EnhancedInjectorConfig;
  private queryResolver?: QueryEntityResolver;
  private relationshipSearcher?: RelationshipAwareSearcher;
  private log?: Logger;

  constructor(
    baseInjector: ContextInjector,
    config: Partial<EnhancedInjectorConfig>,
    kg?: KnowledgeGraphIntegration,
    memoryStore?: TieredMemoryStore,
    log?: Logger,
  ) {
    this.baseInjector = baseInjector;
    this.config = {
      enabled: true,
      useQueryResolution: true,
      useRelationshipSearch: true,
      userName: getUserName(),
      ...config,
    };
    this.log = log;

    // Initialize Phase 2 components if enabled
    if (this.config.enabled) {
      if (this.config.useQueryResolution) {
        this.queryResolver = createQueryEntityResolver({ userName: this.config.userName }, kg, log);
        this.log?.info("[EnhancedInjector] QueryEntityResolver initialized");
      }

      if (this.config.useRelationshipSearch) {
        this.relationshipSearcher = createRelationshipAwareSearcher(
          {
            maxResults: 10,
            minRelevanceScore: 0.5,
            boostRelationshipMatches: true,
            relationshipBoostFactor: 1.5,
          },
          kg,
          memoryStore,
          log,
        );
        this.log?.info("[EnhancedInjector] RelationshipAwareSearcher initialized");
      }
    }
  }

  /**
   * Enhanced inject method
   * Resolves query entities and uses relationship-aware search
   */
  async inject(query: string): Promise<EnhancedInjectionResult> {
    const startTime = Date.now();

    // If Phase 2 is disabled, just use base injector
    if (!this.config.enabled) {
      return this.baseInjector.inject(query);
    }

    this.log?.debug("[EnhancedInjector] Starting enhanced injection", { query });

    try {
      // Step 1: Resolve query entities (Phase 2)
      let resolvedQuery: ResolvedQuery | undefined;

      if (this.config.useQueryResolution && this.queryResolver) {
        resolvedQuery = await this.queryResolver.resolveQuery(query);

        this.log?.debug("[EnhancedInjector] Query resolved", {
          original: resolvedQuery.originalQuery,
          resolved: resolvedQuery.resolvedQuery,
          entities: resolvedQuery.resolvedEntities.length,
          relationships: resolvedQuery.inferredRelationships.length,
        });
      }

      // Step 2: Use relationship-aware search if available (Phase 2)
      let relationshipResults: Awaited<ReturnType<RelationshipAwareSearcher["search"]>> | undefined;

      if (this.config.useRelationshipSearch && this.relationshipSearcher && resolvedQuery) {
        // Only use relationship search if we have inferred relationships
        if (resolvedQuery.inferredRelationships.length > 0) {
          this.log?.debug("[EnhancedInjector] Using relationship-aware search");
          relationshipResults = await this.relationshipSearcher.search(resolvedQuery);

          this.log?.debug("[EnhancedInjector] Relationship search complete", {
            results: relationshipResults.length,
          });
        }
      }

      // Step 3: Use base injector with potentially enhanced query
      const searchQuery = resolvedQuery?.resolvedQuery || query;
      const baseResult = await this.baseInjector.inject(searchQuery);

      // Step 4: Merge relationship search results if available
      let finalResult: EnhancedInjectionResult = baseResult;

      if (relationshipResults && relationshipResults.length > 0) {
        finalResult = this.mergeWithRelationshipResults(
          baseResult,
          relationshipResults,
          resolvedQuery,
        );
      }

      // Add enhanced metadata
      if (resolvedQuery) {
        finalResult.enhancedMetadata = {
          originalQuery: resolvedQuery.originalQuery,
          resolvedQuery: resolvedQuery.resolvedQuery,
          resolvedEntities: resolvedQuery.resolvedEntities.map((e) => ({
            original: e.queryReference,
            resolved: e.canonicalEntity,
            confidence: e.confidence,
          })),
          inferredRelationships: resolvedQuery.inferredRelationships.map((r) => ({
            type: r.relationshipType,
            entity: r.to,
          })),
          usedRelationshipSearch: !!relationshipResults && relationshipResults.length > 0,
        };
      }

      const duration = Date.now() - startTime;
      this.log?.info("[EnhancedInjector] Enhanced injection complete", {
        duration,
        hasContext: finalResult.metadata.hasContext,
        memoryCount: finalResult.metadata.memoryCount,
        resolvedEntities: resolvedQuery?.resolvedEntities.length || 0,
      });

      return finalResult;
    } catch (error) {
      this.log?.error("[EnhancedInjector] Enhanced injection failed, falling back to base", {
        error: error instanceof Error ? error.message : String(error),
      });

      // Fallback to base injector on error
      return this.baseInjector.inject(query);
    }
  }

  /**
   * Merge base injector results with relationship search results
   */
  private mergeWithRelationshipResults(
    baseResult: InjectionResult,
    relationshipResults: Awaited<ReturnType<RelationshipAwareSearcher["search"]>>,
    resolvedQuery?: ResolvedQuery,
  ): EnhancedInjectionResult {
    // If base result has no context, use relationship results
    if (!baseResult.metadata.hasContext || !baseResult.prependContext) {
      // Format relationship results as context
      const formattedContext = this.formatRelationshipResults(relationshipResults);

      return {
        ...baseResult,
        prependContext: formattedContext,
        metadata: {
          ...baseResult.metadata,
          hasContext: true,
          memoryCount: relationshipResults.length,
        },
      };
    }

    // Both have results - merge intelligently
    // For now, keep base result but note that relationship search was used
    // In a full implementation, we'd deduplicate and merge the actual memories

    return {
      ...baseResult,
      metadata: {
        ...baseResult.metadata,
        // Note: In full implementation, this would include relationship results count
      },
    };
  }

  /**
   * Format relationship search results as context string
   */
  private formatRelationshipResults(
    results: Awaited<ReturnType<RelationshipAwareSearcher["search"]>>,
  ): string {
    if (results.length === 0) {
      return "";
    }

    const lines: string[] = ["## Related Memories", ""];

    for (const result of results.slice(0, 5)) {
      lines.push(
        `- ${result.content.substring(0, 200)}${result.content.length > 200 ? "..." : ""}`,
      );
    }

    return lines.join("\n");
  }

  /**
   * Get current configuration
   */
  getConfig(): EnhancedInjectorConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<EnhancedInjectorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get base injector (for direct access if needed)
   */
  getBaseInjector(): ContextInjector {
    return this.baseInjector;
  }

  /**
   * Clear caches
   */
  clearCaches(): void {
    this.queryResolver?.clearCache();
  }
}

// Factory function
export function createEnhancedContextInjector(
  baseInjector: ContextInjector,
  config?: Partial<EnhancedInjectorConfig>,
  kg?: KnowledgeGraphIntegration,
  memoryStore?: TieredMemoryStore,
  log?: Logger,
): EnhancedContextInjector {
  return new EnhancedContextInjector(baseInjector, config, kg, memoryStore, log);
}

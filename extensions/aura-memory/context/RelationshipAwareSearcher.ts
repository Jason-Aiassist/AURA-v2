/**
 * Relationship-Aware Searcher
 *
 * Searches memories using relationship information, not just entity names.
 * Finds memories about "my dad" even if query doesn't mention "Ken".
 */

import type { TieredMemoryStore } from "../adapters/TieredMemoryStore.js";
import type { KnowledgeGraphIntegration } from "../graph/KnowledgeGraphIntegration.js";
import type { Logger } from "../types.js";
import type { ResolvedQuery } from "./QueryEntityResolver.js";

export interface SearchResult {
  memoryId: string;
  content: string;
  relevanceScore: number;
  entities: string[];
  timestamp?: number;
  tier?: string;
  source?: string;
}

export interface RelationshipSearchStrategy {
  name: string;
  execute(query: ResolvedQuery, limit: number): Promise<SearchResult[]>;
  priority: number;
}

export interface RelationshipAwareSearchConfig {
  maxResults: number;
  minRelevanceScore: number;
  combineStrategies: "union" | "intersection" | "weighted";
  boostRelationshipMatches: boolean;
  relationshipBoostFactor: number;
}

export class RelationshipAwareSearcher {
  private config: RelationshipAwareSearchConfig;
  private kg?: KnowledgeGraphIntegration;
  private memoryStore?: TieredMemoryStore;
  private log?: Logger;
  private strategies: RelationshipSearchStrategy[] = [];

  constructor(
    config: Partial<RelationshipAwareSearchConfig>,
    kg?: KnowledgeGraphIntegration,
    memoryStore?: TieredMemoryStore,
    log?: Logger,
  ) {
    this.config = {
      maxResults: 10,
      minRelevanceScore: 0.5,
      combineStrategies: "weighted",
      boostRelationshipMatches: true,
      relationshipBoostFactor: 1.5,
      ...config,
    };
    this.kg = kg;
    this.memoryStore = memoryStore;
    this.log = log;

    // Register default strategies
    this.registerDefaultStrategies();
  }

  /**
   * Main search method
   */
  async search(resolvedQuery: ResolvedQuery): Promise<SearchResult[]> {
    this.log?.debug("[RelationshipSearch] Starting search", {
      original: resolvedQuery.originalQuery,
      resolved: resolvedQuery.resolvedQuery,
      entities: resolvedQuery.resolvedEntities.length,
      relationships: resolvedQuery.inferredRelationships.length,
    });

    // Execute all search strategies
    const strategyResults = await Promise.all(
      this.strategies.map(async (strategy) => {
        try {
          const results = await strategy.execute(
            resolvedQuery,
            this.config.maxResults * 2, // Get extra for merging
          );
          return { strategy: strategy.name, results, priority: strategy.priority };
        } catch (error) {
          this.log?.warn(`[RelationshipSearch] Strategy ${strategy.name} failed`, {
            error: error instanceof Error ? error.message : String(error),
          });
          return { strategy: strategy.name, results: [], priority: strategy.priority };
        }
      }),
    );

    // Combine results based on configuration
    let combinedResults: SearchResult[];

    switch (this.config.combineStrategies) {
      case "union":
        combinedResults = this.mergeUnion(strategyResults);
        break;
      case "intersection":
        combinedResults = this.mergeIntersection(strategyResults);
        break;
      case "weighted":
      default:
        combinedResults = this.mergeWeighted(strategyResults);
        break;
    }

    // Apply relationship boosts
    if (this.config.boostRelationshipMatches) {
      combinedResults = this.boostRelationshipMatches(
        combinedResults,
        resolvedQuery.inferredRelationships,
      );
    }

    // Sort by relevance and limit
    combinedResults = combinedResults
      .filter((r) => r.relevanceScore >= this.config.minRelevanceScore)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, this.config.maxResults);

    this.log?.debug("[RelationshipSearch] Search complete", {
      results: combinedResults.length,
      topScore: combinedResults[0]?.relevanceScore,
    });

    return combinedResults;
  }

  /**
   * Register default search strategies
   */
  private registerDefaultStrategies(): void {
    // Strategy 1: Direct entity search
    this.strategies.push({
      name: "entity_direct",
      priority: 1,
      execute: async (query, limit) => {
        const entities = query.resolvedEntities.map((e) => e.canonicalEntity);
        return this.searchByEntities(entities, limit);
      },
    });

    // Strategy 2: Relationship-based search
    this.strategies.push({
      name: "relationship_based",
      priority: 2,
      execute: async (query, limit) => {
        if (query.inferredRelationships.length === 0) {
          return [];
        }
        return this.searchByRelationships(query.inferredRelationships, limit);
      },
    });

    // Strategy 3: Text search (fallback)
    this.strategies.push({
      name: "text_fallback",
      priority: 3,
      execute: async (query, limit) => {
        return this.searchByText(query.resolvedQuery, limit);
      },
    });
  }

  /**
   * Search by entity names
   */
  private async searchByEntities(entities: string[], limit: number): Promise<SearchResult[]> {
    if (!this.memoryStore || entities.length === 0) {
      return [];
    }

    this.log?.debug("[RelationshipSearch] Entity search", { entities, limit });

    // Query memory store for memories containing these entities
    const results: SearchResult[] = [];

    for (const entity of entities) {
      try {
        // Search in hot tier first
        const hotTier = this.memoryStore.getHotTier?.();
        if (hotTier) {
          const memories = await hotTier.searchByEntity?.(
            entity,
            Math.ceil(limit / entities.length),
          );
          if (memories) {
            results.push(
              ...memories.map((m) => ({
                memoryId: m.memoryId,
                content: m.content,
                relevanceScore: 0.8, // Base score for entity match
                entities: m.entities || [],
                timestamp: m.timestamp,
                tier: "hot",
              })),
            );
          }
        }

        // Also query Knowledge Graph for episodes mentioning this entity
        if (this.kg) {
          const kgResults = await this.queryKGForEntity(entity, Math.ceil(limit / entities.length));
          results.push(...kgResults);
        }
      } catch (error) {
        this.log?.warn("[RelationshipSearch] Entity search failed", {
          entity,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return this.deduplicateResults(results);
  }

  /**
   * Search by relationships
   */
  private async searchByRelationships(
    relationships: Array<{ from: string; to?: string; relationshipType: string }>,
    limit: number,
  ): Promise<SearchResult[]> {
    if (!this.kg || relationships.length === 0) {
      return [];
    }

    this.log?.debug("[RelationshipSearch] Relationship search", {
      relationships: relationships.length,
      limit,
    });

    const results: SearchResult[] = [];

    for (const rel of relationships) {
      try {
        // Query KG for memories related to this relationship
        const kgResults = await this.queryKGForRelationship(
          rel,
          Math.ceil(limit / relationships.length),
        );
        results.push(...kgResults);

        // Also search for the related entity if known
        if (rel.to) {
          const entityResults = await this.searchByEntities([rel.to], Math.ceil(limit / 2));
          // Boost scores for relationship matches
          results.push(
            ...entityResults.map((r) => ({
              ...r,
              relevanceScore: Math.min(1.0, r.relevanceScore * this.config.relationshipBoostFactor),
            })),
          );
        }
      } catch (error) {
        this.log?.warn("[RelationshipSearch] Relationship search failed", {
          relationship: rel.relationshipType,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return this.deduplicateResults(results);
  }

  /**
   * Text-based search (fallback)
   */
  private async searchByText(query: string, limit: number): Promise<SearchResult[]> {
    if (!this.memoryStore) {
      return [];
    }

    this.log?.debug("[RelationshipSearch] Text search", { query: query.substring(0, 100), limit });

    try {
      // Use FTS if available
      const hotTier = this.memoryStore.getHotTier?.();
      if (hotTier?.searchFts) {
        const results = await hotTier.searchFts(query, limit);
        return results.map((r) => ({
          memoryId: r.memoryId,
          content: r.content,
          relevanceScore: r.relevanceScore || 0.5,
          entities: r.entities || [],
          timestamp: r.timestamp,
          tier: "hot",
        }));
      }

      // Fallback: simple text search
      // This would be implemented based on your storage capabilities
      return [];
    } catch (error) {
      this.log?.warn("[RelationshipSearch] Text search failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Query Knowledge Graph for entity-related memories
   */
  private async queryKGForEntity(entity: string, limit: number): Promise<SearchResult[]> {
    // This would execute Cypher queries against Neo4j
    // Example: MATCH (e:Entity {name: $entity})-[:MENTIONED_IN]->(ep:Episode) RETURN ep

    this.log?.debug("[RelationshipSearch] KG entity query", { entity, limit });

    // Placeholder - implement based on actual KG API
    return [];
  }

  /**
   * Query Knowledge Graph for relationship-related memories
   */
  private async queryKGForRelationship(
    relationship: { from: string; to?: string; relationshipType: string },
    limit: number,
  ): Promise<SearchResult[]> {
    // This would execute Cypher queries
    // Example:
    // MATCH (e1:Entity {name: $from})-[r:$type]->(e2:Entity)
    // WHERE $to IS NULL OR e2.name = $to
    // MATCH (e1)-[:MENTIONED_IN]->(ep:Episode)
    // RETURN ep

    this.log?.debug("[RelationshipSearch] KG relationship query", {
      from: relationship.from,
      type: relationship.relationshipType,
      to: relationship.to,
      limit,
    });

    // Placeholder - implement based on actual KG API
    return [];
  }

  /**
   * Boost scores for results matching inferred relationships
   */
  private boostRelationshipMatches(
    results: SearchResult[],
    relationships: Array<{ from: string; to?: string; relationshipType: string }>,
  ): SearchResult[] {
    if (relationships.length === 0) {
      return results;
    }

    return results.map((result) => {
      let boost = 1.0;

      // Check if result content mentions relationship targets
      for (const rel of relationships) {
        if (rel.to && result.content.toLowerCase().includes(rel.to.toLowerCase())) {
          boost *= this.config.relationshipBoostFactor;
        }
        if (result.entities.includes(rel.from) || (rel.to && result.entities.includes(rel.to))) {
          boost *= this.config.relationshipBoostFactor;
        }
      }

      return {
        ...result,
        relevanceScore: Math.min(1.0, result.relevanceScore * boost),
      };
    });
  }

  /**
   * Deduplicate search results by memory ID
   */
  private deduplicateResults(results: SearchResult[]): SearchResult[] {
    const seen = new Map<string, SearchResult>();

    for (const result of results) {
      const existing = seen.get(result.memoryId);
      if (!existing || result.relevanceScore > existing.relevanceScore) {
        seen.set(result.memoryId, result);
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Merge results using union (all unique results)
   */
  private mergeUnion(
    strategyResults: Array<{ strategy: string; results: SearchResult[]; priority: number }>,
  ): SearchResult[] {
    const allResults = strategyResults.flatMap((s) => s.results);
    return this.deduplicateResults(allResults);
  }

  /**
   * Merge results using intersection (only results found by all strategies)
   */
  private mergeIntersection(
    strategyResults: Array<{ strategy: string; results: SearchResult[]; priority: number }>,
  ): SearchResult[] {
    if (strategyResults.length === 0) return [];

    // Find memory IDs present in all strategies
    const idSets = strategyResults.map((s) => new Set(s.results.map((r) => r.memoryId)));
    const intersection = idSets.reduce((acc, set) => {
      return new Set([...acc].filter((x) => set.has(x)));
    });

    // Get highest scoring version of each intersection result
    const allResults = strategyResults.flatMap((s) => s.results);
    return this.deduplicateResults(allResults.filter((r) => intersection.has(r.memoryId)));
  }

  /**
   * Merge results using weighted scoring
   */
  private mergeWeighted(
    strategyResults: Array<{ strategy: string; results: SearchResult[]; priority: number }>,
  ): SearchResult[] {
    const scoreMap = new Map<string, { result: SearchResult; totalScore: number; count: number }>();

    for (const { results, priority } of strategyResults) {
      const weight = 1.0 / priority; // Higher priority = higher weight

      for (const result of results) {
        const existing = scoreMap.get(result.memoryId);
        if (existing) {
          existing.totalScore += result.relevanceScore * weight;
          existing.count += 1;
        } else {
          scoreMap.set(result.memoryId, {
            result,
            totalScore: result.relevanceScore * weight,
            count: 1,
          });
        }
      }
    }

    // Calculate final scores and return
    return Array.from(scoreMap.values()).map(({ result, totalScore, count }) => ({
      ...result,
      relevanceScore: Math.min(1.0, totalScore / count),
    }));
  }

  /**
   * Add a custom search strategy
   */
  addStrategy(strategy: RelationshipSearchStrategy): void {
    this.strategies.push(strategy);
    // Re-sort by priority
    this.strategies.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Get current configuration
   */
  getConfig(): RelationshipAwareSearchConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<RelationshipAwareSearchConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// Factory function
export function createRelationshipAwareSearcher(
  config?: Partial<RelationshipAwareSearchConfig>,
  kg?: KnowledgeGraphIntegration,
  memoryStore?: TieredMemoryStore,
  log?: Logger,
): RelationshipAwareSearcher {
  return new RelationshipAwareSearcher(config, kg, memoryStore, log);
}

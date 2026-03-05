/**
 * Stage 1: Knowledge Graph Search with Entity Resolution
 *
 * Integrates EntityResolver for pronoun resolution and
 * GraphTraversalSearch for semantic relationship discovery.
 */

import type { EntityResolver } from "../../graph/entity-resolution/EntityResolver.js";
import type { KnowledgeGraphIntegration } from "../../graph/KnowledgeGraphIntegration.js";
import type { GraphTraversalSearch } from "../../graph/traversal/traversal-search.js";
import { debugStage1Start, debugStage1Complete } from "../debug-utils.js";
import type { SearchResult } from "../models.js";

export interface Stage1Config {
  knowledgeGraph: KnowledgeGraphIntegration;
  maxResults: number;
  minRelevance: number;
  entityResolver?: EntityResolver;
  graphTraversal?: GraphTraversalSearch;
  enableTraversal?: boolean;
}

export interface ResolvedEntities {
  original: string[];
  resolved: Array<{
    original: string;
    name: string;
    confidence: number;
    method: string;
  }>;
  connected: string[];
}

export class Stage1KnowledgeGraphSearch {
  private knowledgeGraph: KnowledgeGraphIntegration;
  private entityResolver?: EntityResolver;
  private graphTraversal?: GraphTraversalSearch;
  private maxResults: number;
  private minRelevance: number;
  private enableTraversal: boolean;

  constructor(config: Stage1Config) {
    this.knowledgeGraph = config.knowledgeGraph;
    this.entityResolver = config.entityResolver;
    this.graphTraversal = config.graphTraversal;
    this.maxResults = config.maxResults;
    this.minRelevance = config.minRelevance;
    this.enableTraversal = config.enableTraversal ?? true;
  }

  /**
   * Execute Stage 1 with entity resolution and graph traversal
   */
  async execute(
    query: string,
    entities?: string[],
  ): Promise<{
    results: SearchResult[];
    success: boolean;
    error?: Error;
    resolvedEntities?: ResolvedEntities;
  }> {
    debugStage1Start(query, 0);
    const startTime = Date.now();

    try {
      // Step 1: Get entities from QueryAnalyzer or extract
      const rawEntities =
        entities && entities.length > 0 ? entities : this.extractEntitiesFromQuery(query);

      if (rawEntities.length === 0) {
        return { results: [], success: true };
      }

      // Step 2: Resolve entities (pronouns → canonical names)
      const resolved = await this.resolveEntities(rawEntities);

      // Step 3: Find connected entities via graph traversal
      let connectedEntities: string[] = [];
      if (this.enableTraversal && this.graphTraversal) {
        connectedEntities = await this.findConnectedEntities(resolved.resolved.map((r) => r.name));
      }

      // Combine all entity names for search
      const allEntityNames = [
        ...new Set([...resolved.resolved.map((r) => r.name), ...connectedEntities]),
      ];

      // Step 4: Search Knowledge Graph
      const memories = await this.knowledgeGraph.searchRelated({
        entityNames: allEntityNames,
        limit: Math.floor(this.maxResults),
      });

      // Convert to SearchResult format
      const results: SearchResult[] = memories
        .filter((m) => (m.relevance ?? 0) >= this.minRelevance)
        .map((m) => ({
          memoryId: m.memoryId,
          content: m.content ?? "",
          score: m.relevance ?? 0.5,
          metadata: {
            sourceEntities: allEntityNames,
            traversalUsed: connectedEntities.length > 0,
          },
        }));

      const durationMs = Date.now() - startTime;
      debugStage1Complete(results.length, durationMs);

      return {
        results,
        success: true,
        resolvedEntities: {
          original: rawEntities,
          resolved: resolved.resolved,
          connected: connectedEntities,
        },
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      console.error(`[Stage1] Search failed after ${durationMs}ms:`, error);

      return {
        results: [],
        success: false,
        error: error as Error,
      };
    }
  }

  /**
   * Resolve entities using EntityResolver
   */
  private async resolveEntities(entities: string[]): Promise<ResolvedEntities> {
    const resolved: ResolvedEntities["resolved"] = [];

    if (!this.entityResolver) {
      // No resolver available, pass through as-is
      return {
        original: entities,
        resolved: entities.map((e) => ({
          original: e,
          name: e,
          confidence: 1.0,
          method: "passthrough",
        })),
        connected: [],
      };
    }

    for (const entity of entities) {
      const result = await this.entityResolver.resolve(entity);

      if (result) {
        resolved.push({
          original: entity,
          name: result.name,
          confidence: result.confidence,
          method: result.method,
        });
      } else {
        // Entity not found in KG, use as-is
        resolved.push({
          original: entity,
          name: entity,
          confidence: 0.5,
          method: "unresolved",
        });
      }
    }

    return {
      original: entities,
      resolved,
      connected: [],
    };
  }

  /**
   * Find connected entities via graph traversal
   */
  private async findConnectedEntities(entityNames: string[]): Promise<string[]> {
    if (!this.graphTraversal) return [];

    const connected = new Set<string>();

    for (const entityName of entityNames) {
      try {
        const subgraph = await this.graphTraversal.findConnectedSubgraph({
          entityNames: [entityName],
          maxDepth: 2,
          minConfidence: 0.7,
        });

        // Add connected entities
        for (const entity of subgraph.subgraph.entities) {
          if (entity.name !== entityName) {
            connected.add(entity.name);
          }
        }
      } catch (error) {
        // Silently continue on traversal error
      }
    }

    return Array.from(connected);
  }

  /**
   * Check availability
   */
  isAvailable(): boolean {
    return this.knowledgeGraph !== undefined;
  }

  /**
   * Check if traversal is available
   */
  isTraversalAvailable(): boolean {
    return this.graphTraversal !== undefined && this.enableTraversal;
  }

  /**
   * Extract entities from query (fallback when QueryAnalyzer not available)
   */
  private extractEntitiesFromQuery(query: string): string[] {
    const words = query.split(/\s+/);
    const cleanQuery = query
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .trim();

    // Extract capitalized words
    const capitalizedEntities = words
      .filter((w) => w.length > 2 && w[0] === w[0].toUpperCase())
      .map((w) => w.toLowerCase().replace(/[^\w]/g, ""));

    // Check for first-person pronouns
    const firstPersonPronouns = ["me", "my", "myself", "i"];
    const hasFirstPerson = firstPersonPronouns.some((p) => {
      const regex = new RegExp(`\\b${p}\\b`);
      return regex.test(cleanQuery);
    });

    if (hasFirstPerson) {
      capitalizedEntities.push("steve", "user");
    }

    return [...new Set(capitalizedEntities)].filter((e) => e.length > 0);
  }
}

/**
 * Stage 1: Knowledge Graph Search + Traversal
 *
 * INTEGRATED ARCHITECTURE:
 * - Finds entities from query
 * - Searches for episodes connected to those entities (MENTIONED_IN)
 * - Traverses entity-entity relationships (formerly Step 3b)
 * - Finds episodes connected to related entities
 * - Returns unified SearchResult[] for Stage 2
 */

import type { KnowledgeGraphIntegration } from "../../graph/KnowledgeGraphIntegration.js";
import type { GraphTraversalSearch } from "../../graph/traversal/traversal-search.js";
import { debugStage1Start, debugStage1Complete } from "../debug-utils.js";
import type { SearchResult } from "../models.js";

export interface Stage1Config {
  knowledgeGraph: KnowledgeGraphIntegration;
  maxResults: number;
  minRelevance: number;
  /** Graph traversal for finding related entities (integrated from Step 3b) */
  graphTraversal?: GraphTraversalSearch;
  /** Maximum depth for entity traversal (1-3) */
  traversalDepth?: number;
  /** Minimum confidence for relationships */
  minConfidence?: number;
}

export class Stage1KnowledgeGraphSearch {
  private knowledgeGraph: KnowledgeGraphIntegration;
  private maxResults: number;
  private minRelevance: number;
  private graphTraversal?: GraphTraversalSearch;
  private traversalDepth: number;
  private minConfidence: number;

  constructor(config: Stage1Config) {
    this.knowledgeGraph = config.knowledgeGraph;
    this.maxResults = config.maxResults;
    this.minRelevance = config.minRelevance;
    this.graphTraversal = config.graphTraversal;
    this.traversalDepth = config.traversalDepth ?? 2;
    this.minConfidence = config.minConfidence ?? 0.7;
  }

  /**
   * Execute Stage 1: Knowledge Graph entity search
   *
   * @param query - The search query
   * @param entities - Optional pre-extracted entities from QueryAnalyzer
   */
  async execute(
    query: string,
    entities?: string[],
  ): Promise<{
    results: SearchResult[];
    success: boolean;
    error?: Error;
  }> {
    debugStage1Start(query, 0);
    const startTime = Date.now();

    try {
      // Use provided entities from QueryAnalyzer, or extract if not provided/empty
      const rawEntities =
        entities && entities.length > 0 ? entities : this.extractEntitiesFromQuery(query);
      const searchEntities = [...new Set(this.validateEntities(rawEntities))];

      debugStage1Start(query, searchEntities.length);

      if (searchEntities.length === 0) {
        return {
          results: [],
          success: true,
        };
      }

      // ========== STAGE 1A: Direct Entity-Episode Search ==========
      const directMemories = await this.knowledgeGraph.searchRelated({
        entityNames: searchEntities,
        limit: Math.floor(this.maxResults),
      });

      // ========== STAGE 1B: Entity Traversal (formerly Step 3b) ==========
      let traversedMemoryIds = new Set<string>();

      if (this.graphTraversal && searchEntities.length > 0) {
        for (const entity of searchEntities) {
          try {
            const subgraph = await this.graphTraversal.findConnectedSubgraph({
              entityNames: [entity],
              maxDepth: this.traversalDepth as 1 | 2 | 3,
              minConfidence: this.minConfidence,
            });

            if (subgraph?.success && subgraph.subgraph?.entities) {
              // Get related entity names
              const relatedEntities = subgraph.subgraph.entities
                .map((e) => e.name)
                .filter((name) => !searchEntities.includes(name.toLowerCase()));

              if (relatedEntities.length > 0) {
                // Search for episodes connected to related entities
                const relatedMemories = await this.knowledgeGraph.searchRelated({
                  entityNames: relatedEntities,
                  limit: Math.floor(this.maxResults / 2), // Smaller limit for traversed entities
                });

                // Add to traversed set
                for (const mem of relatedMemories) {
                  traversedMemoryIds.add(mem.memoryId);
                }
              }
            }
          } catch (error) {
            // Silently continue on traversal error for this entity
          }
        }
      }

      // ========== STAGE 1C: Merge Results ==========
      // Start with direct memories
      const allMemoryIds = new Map<
        string,
        { memoryId: string; content: string; relevance: number }
      >();

      // Add direct memories first (higher priority)
      for (const mem of directMemories) {
        if ((mem.relevance ?? 0) >= this.minRelevance) {
          allMemoryIds.set(mem.memoryId, mem);
        }
      }

      // Add traversed memories if not already present
      for (const memId of traversedMemoryIds) {
        if (!allMemoryIds.has(memId)) {
          // Need to fetch content for traversed memories
          // For now, add with lower relevance score
          allMemoryIds.set(memId, {
            memoryId: memId,
            content: "", // Will be fetched by Stage 2
            relevance: 0.3, // Lower relevance for traversed memories
          });
        }
      }

      // Convert to SearchResult format
      const results: SearchResult[] = Array.from(allMemoryIds.values()).map((m) => ({
        memoryId: m.memoryId,
        content: m.content ?? "",
        score: m.relevance ?? 0.5,
        metadata: {},
      }));

      const durationMs = Date.now() - startTime;
      debugStage1Complete(results.length, durationMs);

      return {
        results,
        success: true,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      console.error(`[Stage1] Knowledge Graph search failed after ${durationMs}ms:`, error);

      return {
        results: [],
        success: false,
        error: error as Error,
      };
    }
  }

  /**
   * Check if this stage is available
   */
  isAvailable(): boolean {
    return this.knowledgeGraph !== undefined;
  }

  /**
   * Common stop words to filter out from entity extraction
   */
  private readonly STOP_WORDS = new Set([
    "what",
    "is",
    "this",
    "that",
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "by",
  ]);

  /**
   * Validate and filter entities
   */
  private validateEntities(entities: string[]): string[] {
    return entities
      .filter((e) => e && e.trim().length > 0) // Remove null/undefined/empty
      .filter((e) => !/^\s*$/.test(e)) // Remove whitespace-only
      .filter((e) => !this.STOP_WORDS.has(e.toLowerCase())) // Remove stop words
      .map((e) => e.trim().toLowerCase()) // Normalize
      .filter((e) => e.length > 0); // Remove empty after trim
  }

  /**
   * Extract entities from query (capitalized words + pronouns)
   */
  private extractEntitiesFromQuery(query: string): string[] {
    // Strip punctuation for pronoun detection
    const cleanQuery = query
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Extract capitalized words (names, proper nouns)
    const words = query.split(/\s+/);
    const capitalizedEntities = words
      .filter((w) => w.length > 2 && w[0] === w[0].toUpperCase())
      .map((w) => w.toLowerCase().replace(/[^\w]/g, ""));

    // Check for first-person pronouns (user asking about themselves)
    const firstPersonPronouns = ["me", "my", "myself", "i"];
    const hasFirstPerson = firstPersonPronouns.some((p) => {
      const regex = new RegExp(`\\b${p}\\b`);
      return regex.test(cleanQuery);
    });

    // If user is asking about themselves, add user identity entities
    if (hasFirstPerson) {
      capitalizedEntities.push("steve", "user");
    }

    // Validate, deduplicate, and return
    const validated = this.validateEntities(capitalizedEntities);
    return [...new Set(validated)]; // Deduplicate
  }
}

/**
 * Query Entity Resolver
 *
 * Resolves pronouns and relationship references in user queries.
 * "my dad" → "Ken", "how's my sister?" → searches for Sally
 */

import { getUserName, getUserAliases } from "../config/user-config.js";
import type { KnowledgeGraphIntegration } from "../graph/KnowledgeGraphIntegration.js";
import type { Logger } from "../types.js";

export interface ResolvedEntity {
  queryReference: string;
  canonicalEntity: string;
  entityType?: string;
  confidence: number;
  resolutionReasoning: string;
}

export interface ResolvedQuery {
  originalQuery: string;
  resolvedQuery: string;
  resolvedEntities: ResolvedEntity[];
  inferredRelationships: Array<{
    from: string;
    to?: string;
    relationshipType: string;
    confidence: number;
  }>;
}

export interface RelationshipPattern {
  regex: RegExp;
  relationshipType: string;
  bidirectional: boolean;
}

export const DEFAULT_RELATIONSHIP_PATTERNS: RelationshipPattern[] = [
  // Family relationships
  {
    regex: /\bmy (?:dad|father|pa|papa|old man)\b/i,
    relationshipType: "father",
    bidirectional: false,
  },
  {
    regex: /\bmy (?:mom|mother|mum|mama|old lady)\b/i,
    relationshipType: "mother",
    bidirectional: false,
  },
  { regex: /\bmy (?:sister|sis)\b/i, relationshipType: "sister", bidirectional: true },
  { regex: /\bmy (?:brother|bro)\b/i, relationshipType: "brother", bidirectional: true },
  { regex: /\bmy (?:wife|spouse|partner)\b/i, relationshipType: "spouse", bidirectional: true },
  { regex: /\bmy (?:husband|hubby)\b/i, relationshipType: "husband", bidirectional: true },
  { regex: /\bmy (?:son|boy)\b/i, relationshipType: "son", bidirectional: false },
  { regex: /\bmy (?:daughter|girl)\b/i, relationshipType: "daughter", bidirectional: false },
  { regex: /\bmy (?:parents|folks)\b/i, relationshipType: "parent", bidirectional: false },
  { regex: /\bmy (?:kids|children)\b/i, relationshipType: "child", bidirectional: false },
  {
    regex: /\bmy (?:grandma|grandmother|nana|granny)\b/i,
    relationshipType: "grandmother",
    bidirectional: false,
  },
  {
    regex: /\bmy (?:grandpa|grandfather|papa|pop)\b/i,
    relationshipType: "grandfather",
    bidirectional: false,
  },

  // Pet relationships
  { regex: /\bmy (?:dog|puppy|pooch)\b/i, relationshipType: "pet", bidirectional: false },
  { regex: /\bmy (?:cat|kitty|kitten)\b/i, relationshipType: "pet", bidirectional: false },
  { regex: /\bmy pet\b/i, relationshipType: "pet", bidirectional: false },

  // Work relationships
  { regex: /\bmy (?:boss|manager)\b/i, relationshipType: "manager", bidirectional: false },
  {
    regex: /\bmy (?:colleague|coworker| teammate)\b/i,
    relationshipType: "colleague",
    bidirectional: true,
  },
  { regex: /\bmy (?:employee|report)\b/i, relationshipType: "reports_to", bidirectional: false },

  // General possession/association
  { regex: /\bmy project\b/i, relationshipType: "works_on", bidirectional: false },
  { regex: /\bmy (?:car|vehicle|bike)\b/i, relationshipType: "owns", bidirectional: false },
  { regex: /\bmy house|home\b/i, relationshipType: "lives_at", bidirectional: false },
];

export interface QueryResolverConfig {
  userName: string;
  userAliases: string[];
  relationshipPatterns: RelationshipPattern[];
  caseSensitive: boolean;
}

export class QueryEntityResolver {
  private config: QueryResolverConfig;
  private kg?: KnowledgeGraphIntegration;
  private log?: Logger;
  private relationshipCache: Map<string, Array<{ entity: string; relationship: string }>> =
    new Map();

  constructor(config: Partial<QueryResolverConfig>, kg?: KnowledgeGraphIntegration, log?: Logger) {
    this.config = {
      userName: getUserName(),
      userAliases: getUserAliases(),
      relationshipPatterns: DEFAULT_RELATIONSHIP_PATTERNS,
      caseSensitive: false,
      ...config,
    };
    this.kg = kg;
    this.log = log;
  }

  /**
   * Main entry point: resolve a user query
   */
  async resolveQuery(query: string): Promise<ResolvedQuery> {
    this.log?.debug("[QueryResolver] Resolving query", { query });

    // Step 1: Resolve pronouns and user references
    const withPronouns = this.resolvePronouns(query);

    // Step 2: Resolve relationship references (if KG available)
    let resolvedEntities: ResolvedEntity[] = [];
    let inferredRelationships: Array<{
      from: string;
      to?: string;
      relationshipType: string;
      confidence: number;
    }> = [];

    if (this.kg) {
      const relationshipResult = await this.resolveRelationshipReferences(
        withPronouns.resolvedQuery,
      );
      resolvedEntities = relationshipResult.resolvedEntities;
      inferredRelationships = relationshipResult.inferredRelationships;
    }

    // Step 3: Build final resolved query
    let resolvedQuery = withPronouns.resolvedQuery;

    // Replace resolved entities in query for search
    for (const resolved of resolvedEntities) {
      if (resolved.confidence > 0.7) {
        resolvedQuery = resolvedQuery.replace(
          new RegExp(resolved.queryReference.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
          resolved.canonicalEntity,
        );
      }
    }

    const result: ResolvedQuery = {
      originalQuery: query,
      resolvedQuery,
      resolvedEntities,
      inferredRelationships,
    };

    this.log?.debug("[QueryResolver] Query resolved", {
      original: query,
      resolved: resolvedQuery,
      entities: resolvedEntities.length,
      relationships: inferredRelationships.length,
    });

    return result;
  }

  /**
   * Resolve pronouns and user references to canonical user name
   */
  resolvePronouns(query: string): {
    resolvedQuery: string;
    replacements: Array<{ from: string; to: string }>;
  } {
    const replacements: Array<{ from: string; to: string }> = [];
    let resolved = query;

    // Match whole words only
    for (const alias of this.config.userAliases) {
      const regex = new RegExp(`\\b${alias}\\b`, this.config.caseSensitive ? "g" : "gi");
      if (regex.test(resolved)) {
        replacements.push({ from: alias, to: this.config.userName });
        resolved = resolved.replace(regex, this.config.userName);
      }
    }

    return { resolvedQuery: resolved, replacements };
  }

  /**
   * Resolve relationship references using Knowledge Graph
   * "my dad" → "Ken"
   */
  async resolveRelationshipReferences(query: string): Promise<{
    resolvedEntities: ResolvedEntity[];
    inferredRelationships: Array<{
      from: string;
      to?: string;
      relationshipType: string;
      confidence: number;
    }>;
  }> {
    const resolvedEntities: ResolvedEntity[] = [];
    const inferredRelationships: Array<{
      from: string;
      to?: string;
      relationshipType: string;
      confidence: number;
    }> = [];

    if (!this.kg) {
      return { resolvedEntities, inferredRelationships };
    }

    // Check each relationship pattern
    for (const pattern of this.config.relationshipPatterns) {
      const matches = query.match(pattern.regex);

      if (matches) {
        for (const match of matches) {
          // Check cache first
          const cacheKey = `${this.config.userName}:${pattern.relationshipType}`;
          let relatedEntities = this.relationshipCache.get(cacheKey);

          // Query KG if not cached
          if (!relatedEntities) {
            relatedEntities = await this.queryRelationships(
              this.config.userName,
              pattern.relationshipType,
              pattern.bidirectional,
            );
            this.relationshipCache.set(cacheKey, relatedEntities);
          }

          if (relatedEntities.length > 0) {
            // Found related entity
            const primaryEntity = relatedEntities[0];

            resolvedEntities.push({
              queryReference: match,
              canonicalEntity: primaryEntity.entity,
              entityType: "Person", // Could query KG for actual type
              confidence: 0.9,
              resolutionReasoning: `${primaryEntity.entity} is ${this.config.userName}'s ${pattern.relationshipType} per Knowledge Graph`,
            });

            inferredRelationships.push({
              from: this.config.userName,
              to: primaryEntity.entity,
              relationshipType: pattern.relationshipType,
              confidence: 0.9,
            });
          } else {
            // No entity found, but we know the relationship type
            inferredRelationships.push({
              from: this.config.userName,
              relationshipType: pattern.relationshipType,
              confidence: 0.5, // Lower confidence without specific entity
            });

            this.log?.debug("[QueryResolver] No entity found for relationship", {
              relationship: pattern.relationshipType,
              query: match,
            });
          }
        }
      }
    }

    return { resolvedEntities, inferredRelationships };
  }

  /**
   * Query Knowledge Graph for relationships
   */
  private async queryRelationships(
    entityName: string,
    relationshipType: string,
    bidirectional: boolean,
  ): Promise<Array<{ entity: string; relationship: string }>> {
    try {
      // Try to use KG's query capabilities
      // This is a simplified version - actual implementation depends on KG API

      // Query pattern: (entity)-[relationship]->(related)
      // or bidirectional: (entity)-[relationship]-(related)

      const results: Array<{ entity: string; relationship: string }> = [];

      // For now, return empty - actual implementation would query Neo4j
      // Example Cypher:
      // MATCH (e:Entity {name: $entityName})-[r:$relationshipType]->(related:Entity)
      // RETURN related.name as entity, type(r) as relationship

      this.log?.debug("[QueryResolver] Querying KG for relationships", {
        entity: entityName,
        relationship: relationshipType,
        bidirectional,
      });

      // TODO: Implement actual KG query once API is available
      // const kgResults = await this.kg.query(...)

      return results;
    } catch (error) {
      this.log?.warn("[QueryResolver] Failed to query KG", {
        error: error instanceof Error ? error.message : String(error),
        entity: entityName,
        relationship: relationshipType,
      });
      return [];
    }
  }

  /**
   * Extract entities mentioned in query (simple keyword extraction)
   */
  extractQueryEntities(query: string): string[] {
    // Simple extraction: capitalize words that might be proper nouns
    // In practice, this would use NER or the LLM

    const potentialEntities: string[] = [];
    const words = query.split(/\s+/);

    for (let i = 0; i < words.length; i++) {
      const word = words[i].replace(/[^a-zA-Z]/g, "");

      // Capitalized words (potential proper nouns)
      if (word && word[0] === word[0].toUpperCase() && word.length > 2) {
        potentialEntities.push(word);
      }

      // Multi-word capitalized phrases
      if (i < words.length - 1) {
        const nextWord = words[i + 1].replace(/[^a-zA-Z]/g, "");
        if (nextWord && nextWord[0] === nextWord[0].toUpperCase()) {
          potentialEntities.push(`${word} ${nextWord}`);
        }
      }
    }

    return [...new Set(potentialEntities)];
  }

  /**
   * Clear the relationship cache
   */
  clearCache(): void {
    this.relationshipCache.clear();
  }

  /**
   * Add a custom relationship pattern
   */
  addPattern(pattern: RelationshipPattern): void {
    this.config.relationshipPatterns.push(pattern);
  }

  /**
   * Get current config
   */
  getConfig(): QueryResolverConfig {
    return { ...this.config };
  }
}

// Factory function
export function createQueryEntityResolver(
  config?: Partial<QueryResolverConfig>,
  kg?: KnowledgeGraphIntegration,
  log?: Logger,
): QueryEntityResolver {
  return new QueryEntityResolver(config, kg, log);
}

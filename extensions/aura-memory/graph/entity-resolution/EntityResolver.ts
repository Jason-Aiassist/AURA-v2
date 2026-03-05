/**
 * Entity Resolver
 * Resolves entity references including pronouns and aliases
 *
 * Implements Story 4: Entity Resolution with Aliases
 * - Exact match → case-insensitive → alias match → pronoun resolution
 * - Pronoun mapping: "me"/"I" → "User", "you" → "Aura"
 * - Caching: resolution results cached for 1 minute
 */

import type { Neo4jDriver } from "../../adapters/kg-storage/types.js";
import { createLogger } from "../../shared/debug-logger.js";

/**
 * Resolution method used
 */
export type ResolutionMethod =
  | "exact" // Exact case-sensitive match
  | "case_insensitive" // Case-insensitive match
  | "alias" // Matched via alias
  | "pronoun" // Resolved from pronoun
  | "fuzzy"; // Fuzzy/similar match

/**
 * Resolved entity result
 */
export interface ResolvedEntity {
  /** Entity name (canonical) */
  name: string;
  /** Entity type */
  type: string;
  /** Entity aliases */
  aliases: string[];
  /** Resolution confidence (0-1) */
  confidence: number;
  /** Resolution method used */
  method: ResolutionMethod;
  /** Original query */
  originalQuery: string;
}

/**
 * Cache entry with timestamp
 */
interface CacheEntry {
  result: ResolvedEntity | null;
  timestamp: number;
}

/**
 * Pronoun mappings
 * Maps pronouns to canonical entity names
 */
const PRONOUN_MAPPINGS: Record<string, string> = {
  // First person (user)
  me: "User",
  i: "User",
  myself: "User",
  my: "User",
  mine: "User",

  // Second person (assistant)
  you: "Aura",
  yourself: "Aura",
  yours: "Aura",

  // Third person common references
  user: "User",
};

/**
 * Entity Resolver
 *
 * Resolves entity references using multiple strategies:
 * 1. Exact match
 * 2. Case-insensitive match
 * 3. Alias match
 * 4. Pronoun resolution
 *
 * Results are cached for 1 minute to improve performance.
 */
export class EntityResolver {
  private driver: Neo4jDriver;
  private logger = createLogger("EntityResolver");
  private cache: Map<string, CacheEntry> = new Map();
  private readonly CACHE_TTL_MS = 60000; // 1 minute

  constructor(driver: Neo4jDriver) {
    this.driver = driver;
    this.logger.start("constructor", { cacheTtlMs: this.CACHE_TTL_MS });
  }

  /**
   * Resolve an entity reference
   *
   * Resolution order:
   * 1. Check cache
   * 2. Pronoun resolution
   * 3. Exact match
   * 4. Case-insensitive match
   * 5. Alias match
   *
   * @param queryEntity - Entity reference to resolve (e.g., "me", "Steve", "user")
   * @returns Resolved entity or null if not found
   */
  async resolve(queryEntity: string): Promise<ResolvedEntity | null> {
    this.logger.start("resolve", { queryEntity });

    // Check cache first
    const cached = this.getFromCache(queryEntity);
    if (cached !== undefined) {
      this.logger.progress("cache-hit", { queryEntity, found: cached !== null });
      return cached;
    }

    try {
      // Strategy 1: Pronoun resolution
      const pronounResult = this.resolvePronoun(queryEntity);
      if (pronounResult) {
        this.logger.success({ method: "pronoun", resolvedTo: pronounResult.name });
        this.setCache(queryEntity, pronounResult);
        return pronounResult;
      }

      // Strategy 2-4: Database lookups
      const dbResult = await this.resolveFromDatabase(queryEntity);

      if (dbResult) {
        this.logger.success({
          method: dbResult.method,
          resolvedTo: dbResult.name,
          confidence: dbResult.confidence,
        });
        this.setCache(queryEntity, dbResult);
        return dbResult;
      }

      // Not found
      this.logger.progress("not-found", { queryEntity });
      this.setCache(queryEntity, null);
      return null;
    } catch (error) {
      this.logger.error(error as Error, { queryEntity });
      return null;
    }
  }

  /**
   * Resolve multiple entities at once
   * @param queryEntities - Array of entity references
   * @returns Map of query to resolved entity
   */
  async resolveBatch(queryEntities: string[]): Promise<Map<string, ResolvedEntity | null>> {
    this.logger.start("resolveBatch", { count: queryEntities.length });

    const results = new Map<string, ResolvedEntity | null>();

    // Deduplicate while preserving order
    const uniqueQueries = [...new Set(queryEntities)];

    // Resolve all unique queries
    const resolved = await Promise.all(uniqueQueries.map((q) => this.resolve(q)));

    // Build result map
    uniqueQueries.forEach((query, index) => {
      results.set(query, resolved[index]);
    });

    this.logger.success({
      resolvedCount: resolved.filter((r) => r !== null).length,
      totalCount: queryEntities.length,
    });

    return results;
  }

  /**
   * Check if a query is a pronoun
   * @param query - Query to check
   * @returns Whether it's a pronoun
   */
  isPronoun(query: string): boolean {
    return query.toLowerCase() in PRONOUN_MAPPINGS;
  }

  /**
   * Get pronoun mapping
   * @param pronoun - Pronoun to lookup
   * @returns Canonical entity name or undefined
   */
  getPronounMapping(pronoun: string): string | undefined {
    return PRONOUN_MAPPINGS[pronoun.toLowerCase()];
  }

  /**
   * Clear the resolution cache
   */
  clearCache(): void {
    this.cache.clear();
    this.logger.progress("cache-cleared");
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; hitRate: number } {
    return {
      size: this.cache.size,
      hitRate: 0, // Would need to track hits/misses
    };
  }

  /**
   * Resolve pronoun to entity
   * @private
   */
  private resolvePronoun(query: string): ResolvedEntity | null {
    const normalizedQuery = query.toLowerCase().trim();
    const canonicalName = PRONOUN_MAPPINGS[normalizedQuery];

    if (!canonicalName) {
      return null;
    }

    // Pronouns map to well-known entities with fixed configurations
    if (canonicalName === "User") {
      return {
        name: "User",
        type: "Person",
        aliases: ["me", "I", "myself", "user", "steve"],
        confidence: 0.95,
        method: "pronoun",
        originalQuery: query,
      };
    }

    if (canonicalName === "Aura") {
      return {
        name: "Aura",
        type: "Assistant",
        aliases: ["you", "yourself", "assistant"],
        confidence: 0.95,
        method: "pronoun",
        originalQuery: query,
      };
    }

    return null;
  }

  /**
   * Resolve from Neo4j database
   * @private
   */
  private async resolveFromDatabase(query: string): Promise<ResolvedEntity | null> {
    const session = this.driver.session();

    try {
      // Strategy 2: Exact match
      const exactResult = await session.run(
        `
        MATCH (e:Entity)
        WHERE e.name = $query
        RETURN e.name as name, e.type as type, e.aliases as aliases
        LIMIT 1
        `,
        { query },
      );

      if (exactResult.records.length > 0) {
        const record = exactResult.records[0];
        return {
          name: record.get("name"),
          type: record.get("type"),
          aliases: record.get("aliases") || [],
          confidence: 1.0,
          method: "exact",
          originalQuery: query,
        };
      }

      // Strategy 3: Case-insensitive match
      const ciResult = await session.run(
        `
        MATCH (e:Entity)
        WHERE toLower(e.name) = toLower($query)
        RETURN e.name as name, e.type as type, e.aliases as aliases
        LIMIT 1
        `,
        { query },
      );

      if (ciResult.records.length > 0) {
        const record = ciResult.records[0];
        return {
          name: record.get("name"),
          type: record.get("type"),
          aliases: record.get("aliases") || [],
          confidence: 0.95,
          method: "case_insensitive",
          originalQuery: query,
        };
      }

      // Strategy 4: Alias match
      const aliasResult = await session.run(
        `
        MATCH (e:Entity)
        WHERE e.aliases IS NOT NULL
        AND ANY(alias IN e.aliases WHERE toLower(alias) = toLower($query))
        RETURN e.name as name, e.type as type, e.aliases as aliases
        LIMIT 1
        `,
        { query },
      );

      if (aliasResult.records.length > 0) {
        const record = aliasResult.records[0];
        return {
          name: record.get("name"),
          type: record.get("type"),
          aliases: record.get("aliases") || [],
          confidence: 0.9,
          method: "alias",
          originalQuery: query,
        };
      }

      return null;
    } finally {
      await session.close();
    }
  }

  /**
   * Get from cache
   * @private
   */
  private getFromCache(query: string): ResolvedEntity | null | undefined {
    const entry = this.cache.get(query);

    if (!entry) {
      return undefined; // Not in cache
    }

    // Check if expired
    if (Date.now() - entry.timestamp > this.CACHE_TTL_MS) {
      this.cache.delete(query);
      return undefined;
    }

    return entry.result;
  }

  /**
   * Set cache entry
   * @private
   */
  private setCache(query: string, result: ResolvedEntity | null): void {
    this.cache.set(query, {
      result,
      timestamp: Date.now(),
    });

    // Cleanup old entries if cache gets too large
    if (this.cache.size > 1000) {
      this.cleanupCache();
    }
  }

  /**
   * Cleanup expired cache entries
   * @private
   */
  private cleanupCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.CACHE_TTL_MS) {
        this.cache.delete(key);
      }
    }
  }
}

/**
 * Factory function to create resolver
 * @param driver - Neo4j driver
 * @returns EntityResolver instance
 */
export function createEntityResolver(driver: Neo4jDriver): EntityResolver {
  return new EntityResolver(driver);
}

/**
 * Type guard for checking if result is resolved
 * @param result - Resolution result
 * @returns Whether entity was resolved
 */
export function isResolved(result: ResolvedEntity | null): result is ResolvedEntity {
  return result !== null;
}

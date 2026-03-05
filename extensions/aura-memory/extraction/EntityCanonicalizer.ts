/**
 * Entity Canonicalizer
 *
 * Normalizes entity references to canonical forms.
 * Handles: Steve/User/user/USER/my/me/mine/steve → "Steve"
 */

import { getUserName, getUserAliases } from "../config/user-config.js";

export interface CanonicalizationResult {
  original: string;
  canonical: string;
  confidence: number;
  reasoning: string;
}

export interface CanonicalizationConfig {
  userCanonicalName: string;
  userAliases: string[];
  caseSensitive: boolean;
  fuzzyThreshold: number;
}

export class EntityCanonicalizer {
  private config: CanonicalizationConfig;
  private entityCache: Map<string, string> = new Map();
  private existingEntities: Set<string> = new Set();

  constructor(config?: Partial<CanonicalizationConfig>) {
    const userName = getUserName();
    const userAliases = getUserAliases();
    this.config = {
      userCanonicalName: userName,
      userAliases: [
        userName.toLowerCase(),
        "user",
        "USER",
        "my",
        "me",
        "mine",
        "myself",
        "I",
        "i",
        "my",
        "we",
        "our",
        "ours",
        ...userAliases,
      ],
      caseSensitive: false,
      fuzzyThreshold: 0.8,
      ...config,
    };
  }

  /**
   * Register known entities for fuzzy matching
   */
  registerEntities(entities: string[]): void {
    entities.forEach((e) => this.existingEntities.add(this.normalize(e)));
  }

  /**
   * Canonicalize a single entity reference
   */
  canonicalize(entity: string): CanonicalizationResult {
    const normalized = this.normalize(entity);

    // Check cache first
    if (this.entityCache.has(normalized)) {
      return {
        original: entity,
        canonical: this.entityCache.get(normalized)!,
        confidence: 1.0,
        reasoning: "Cache hit",
      };
    }

    // Check if it's a user alias
    if (this.isUserAlias(normalized)) {
      const result: CanonicalizationResult = {
        original: entity,
        canonical: this.config.userCanonicalName,
        confidence: 0.95,
        reasoning: `User alias match: "${entity}" → "${this.config.userCanonicalName}"`,
      };
      this.entityCache.set(normalized, result.canonical);
      return result;
    }

    // Check for fuzzy match against existing entities
    const fuzzyMatch = this.findFuzzyMatch(normalized);
    if (fuzzyMatch) {
      const result: CanonicalizationResult = {
        original: entity,
        canonical: fuzzyMatch.entity,
        confidence: fuzzyMatch.score,
        reasoning: `Fuzzy match: "${entity}" → "${fuzzyMatch.entity}" (${Math.round(fuzzyMatch.score * 100)}% similarity)`,
      };
      this.entityCache.set(normalized, result.canonical);
      return result;
    }

    // Return as-is with lower confidence
    return {
      original: entity,
      canonical: entity,
      confidence: 0.5,
      reasoning: "No canonicalization match found, using original",
    };
  }

  /**
   * Canonicalize multiple entities
   */
  canonicalizeMany(entities: string[]): CanonicalizationResult[] {
    return entities.map((e) => this.canonicalize(e));
  }

  /**
   * Canonicalize entities from LLM extraction output
   */
  canonicalizeExtraction(extraction: {
    entities?: string[];
    relationships?: Array<{
      from: string;
      to: string;
      type: string;
    }>;
  }): {
    entities: string[];
    entityMap: Map<string, string>;
    canonicalizedRelationships: Array<{
      from: string;
      to: string;
      type: string;
      originalFrom: string;
      originalTo: string;
    }>;
  } {
    const entityMap = new Map<string, string>();
    const canonicalEntities: string[] = [];

    // Canonicalize all entities
    const allEntityNames = new Set<string>();
    if (extraction.entities) {
      extraction.entities.forEach((e) => allEntityNames.add(e));
    }
    if (extraction.relationships) {
      extraction.relationships.forEach((r) => {
        allEntityNames.add(r.from);
        allEntityNames.add(r.to);
      });
    }

    allEntityNames.forEach((entity) => {
      const result = this.canonicalize(entity);
      entityMap.set(entity, result.canonical);
      if (!canonicalEntities.includes(result.canonical)) {
        canonicalEntities.push(result.canonical);
      }
    });

    // Canonicalize relationships
    const canonicalizedRelationships = (extraction.relationships || []).map((rel) => ({
      from: entityMap.get(rel.from) || rel.from,
      to: entityMap.get(rel.to) || rel.to,
      type: rel.type,
      originalFrom: rel.from,
      originalTo: rel.to,
    }));

    return {
      entities: canonicalEntities,
      entityMap,
      canonicalizedRelationships,
    };
  }

  /**
   * Check if entity is a user alias
   */
  private isUserAlias(entity: string): boolean {
    const normalized = this.normalize(entity);
    return this.config.userAliases.some((alias) => this.normalize(alias) === normalized);
  }

  /**
   * Normalize entity string for comparison
   */
  private normalize(entity: string): string {
    if (this.config.caseSensitive) {
      return entity.trim();
    }
    return entity.trim().toLowerCase();
  }

  /**
   * Find fuzzy match in existing entities
   */
  private findFuzzyMatch(entity: string): { entity: string; score: number } | null {
    let bestMatch: { entity: string; score: number } | null = null;

    for (const existing of this.existingEntities) {
      const score = this.calculateSimilarity(entity, existing);
      if (score >= this.config.fuzzyThreshold) {
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { entity: existing, score };
        }
      }
    }

    return bestMatch;
  }

  /**
   * Calculate string similarity (Levenshtein-based)
   */
  private calculateSimilarity(a: string, b: string): number {
    const distance = this.levenshteinDistance(a, b);
    const maxLength = Math.max(a.length, b.length);
    return maxLength === 0 ? 1.0 : 1.0 - distance / maxLength;
  }

  /**
   * Levenshtein distance calculation
   */
  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1,
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  /**
   * Clear the entity cache
   */
  clearCache(): void {
    this.entityCache.clear();
  }

  /**
   * Get canonical name for user
   */
  getUserCanonicalName(): string {
    return this.config.userCanonicalName;
  }
}

// Factory function
export function createEntityCanonicalizer(
  config?: Partial<CanonicalizationConfig>,
): EntityCanonicalizer {
  return new EntityCanonicalizer(config);
}

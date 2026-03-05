/**
 * Relevance scoring for AURA Context Injection
 * Ported from Python relevance_scorer.py to TypeScript
 */

import type { SearchResult } from "./models.js";

export class RelevanceScorer {
  /**
   * Score and sort results by relevance
   * Equivalent to Python: score_results(self, results, query)
   */
  scoreResults(results: SearchResult[], query: string): SearchResult[] {
    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter((t) => t.length > 2);

    for (const result of results) {
      // Base score from search
      let baseScore = result.score;

      // Boost for query terms in content
      const contentLower = result.content.toLowerCase();
      const termMatches = queryTerms.filter((term) => contentLower.includes(term)).length;
      const termBoost = Math.min(termMatches * 0.1, 0.3);

      // Boost for recent content
      let recencyBoost = 0;
      if (result.metadata?.modified && typeof result.metadata.modified === "number") {
        const ageDays = (Date.now() / 1000 - result.metadata.modified) / 86400;
        recencyBoost = Math.max(0, (30 - ageDays) / 30) * 0.2;
      }

      // Final score (cap at 1.0)
      result.score = Math.min(baseScore + termBoost + recencyBoost, 1.0);
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);
    return results;
  }

  /**
   * Calculate aggregate relevance score for a set of results
   */
  calculateAggregateRelevance(results: SearchResult[]): number {
    if (results.length === 0) return 0;
    const sum = results.reduce((acc, r) => acc + r.score, 0);
    return sum / results.length;
  }

  /**
   * Filter results by minimum relevance threshold
   */
  filterByThreshold(results: SearchResult[], threshold: number): SearchResult[] {
    return results.filter((r) => r.score >= threshold);
  }

  /**
   * Get top N results by relevance
   */
  getTopResults(results: SearchResult[], n: number): SearchResult[] {
    return results.slice(0, n);
  }
}

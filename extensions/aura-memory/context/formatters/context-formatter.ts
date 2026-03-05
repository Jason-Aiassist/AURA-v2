/**
 * Context Formatter
 * Single Responsibility: Format search results into final context
 */

import type { SearchResult, BuiltContext } from "../models.js";

export interface FormatterConfig {
  tokenLimit: number;
  coreFiles?: string[];
  separator?: string;
}

export class ContextFormatter {
  private tokenLimit: number;
  private coreFiles: string[];
  private separator: string;

  constructor(config: FormatterConfig) {
    this.tokenLimit = config.tokenLimit;
    this.coreFiles = config.coreFiles ?? [];
    this.separator = config.separator ?? "\n\n";
  }

  /**
   * Format search results into final context
   */
  format(results: SearchResult[]): BuiltContext {
    const sources: string[] = [];
    const parts: string[] = [];
    let tokenCount = 0;

    // Add core files first (if they exist in results)
    for (const coreFile of this.coreFiles) {
      const coreResult = results.find((r) => r.memoryId.includes(coreFile));
      if (coreResult) {
        const tokens = this.estimateTokens(coreResult.content);
        if (tokenCount + tokens <= this.tokenLimit) {
          parts.push(coreResult.content);
          tokenCount += tokens;
          sources.push(coreResult.memoryId);
        }
      }
    }

    // Add remaining results
    for (const result of results) {
      // Skip if already added as core file
      if (sources.includes(result.memoryId)) {
        continue;
      }

      const resultTokens = this.estimateTokens(result.content);

      if (tokenCount + resultTokens > this.tokenLimit) {
        break;
      }

      parts.push(result.content);
      tokenCount += resultTokens;
      sources.push(result.memoryId);
    }

    // Calculate aggregate relevance
    const relevanceScore =
      results.length > 0 ? results.reduce((sum, r) => sum + r.score, 0) / results.length : 0;

    return {
      content: parts.join(this.separator).trim(),
      tokenCount,
      sources,
      relevanceScore,
      buildTimeMs: 0, // Set by orchestrator
    };
  }

  /**
   * Estimate token count (~4 chars per token)
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Check if a result fits within token limit
   */
  wouldFit(result: SearchResult, currentTokenCount: number): boolean {
    const tokens = this.estimateTokens(result.content);
    return currentTokenCount + tokens <= this.tokenLimit;
  }
}

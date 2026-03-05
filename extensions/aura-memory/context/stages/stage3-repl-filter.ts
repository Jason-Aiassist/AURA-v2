/**
 * Stage 3: REPL Filtering
 * Single Responsibility: Apply General/Moderate/Focused search levels
 */

import { debugStage3Start, debugStage3Complete } from "../debug-utils.js";
import type { SearchResult, SearchLevel, Stage3Config } from "../models.js";

export interface Stage3Options {
  level: SearchLevel;
  maxResults?: number;
  threshold?: number;
}

export class Stage3REPLFilter {
  private defaultConfig: Record<SearchLevel, Stage3Config> = {
    focused: {
      level: "focused",
      threshold: 0.6,
      maxResults: 10,
      expandEntities: false,
    },
    moderate: {
      level: "moderate",
      threshold: 0.3,
      maxResults: 25,
      expandEntities: true,
    },
    general: {
      level: "general",
      threshold: 0.1,
      maxResults: 50,
      expandEntities: true,
    },
  };

  /**
   * Execute Stage 3: REPL filtering with tiered search levels
   */
  execute(
    results: SearchResult[],
    options: Stage3Options,
  ): {
    results: SearchResult[];
    filteredCount: number;
    config: Stage3Config;
  } {
    const config = {
      ...this.defaultConfig[options.level],
      maxResults: options.maxResults ?? this.defaultConfig[options.level].maxResults,
      threshold: options.threshold ?? this.defaultConfig[options.level].threshold,
    };

    const inputCount = results.length;
    debugStage3Start(config.level, inputCount);

    // Apply level-specific filtering FIRST (before threshold)
    let filtered = results;

    if (config.level === "focused") {
      // Keep top 30% for focused
      const topCount = Math.max(1, Math.ceil(results.length * 0.3));
      filtered = results.slice(0, topCount);
    } else if (config.level === "moderate") {
      // Keep top 60% for moderate
      const topCount = Math.max(1, Math.ceil(results.length * 0.6));
      filtered = results.slice(0, topCount);
    }
    // general keeps all results

    // Then filter by relevance threshold
    filtered = filtered.filter((r) => r.score >= config.threshold);

    // Limit to max results
    filtered = filtered.slice(0, config.maxResults);

    const filteredCount = inputCount - filtered.length;
    debugStage3Complete(filtered.length, config.threshold);

    return {
      results: filtered,
      filteredCount,
      config,
    };
  }

  /**
   * Get default configuration for a search level
   */
  getDefaultConfig(level: SearchLevel): Stage3Config {
    return this.defaultConfig[level];
  }

  /**
   * Check if this stage is available (always true)
   */
  isAvailable(): boolean {
    return true;
  }
}

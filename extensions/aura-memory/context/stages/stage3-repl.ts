/**
 * Stage 3: True REPL Search
 * Interactive Read-Eval-Print Loop for final result ranking
 *
 * Evaluates candidates against query context with level-specific weighting:
 * - Focused: High precision, strict thresholds
 * - Moderate: Balanced precision/recall
 * - General: Broad recall, permissive thresholds
 */

import { createLogger } from "../../../shared/debug-logger.js";
import type { Subgraph, GraphPath } from "../../graph/traversal/types.js";
import type { SearchResult, SearchLevel } from "../models.js";

const logger = createLogger("Stage3REPL");

/**
 * REPL evaluation context
 */
export interface REPLEvalContext {
  /** Original query */
  query: string;
  /** Resolved entity name */
  resolvedEntity?: string;
  /** Graph subgraph from Stage 1 */
  subgraph?: Subgraph;
  /** Search level */
  level: SearchLevel;
}

/**
 * Candidate result for evaluation
 */
export interface REPLCandidate extends SearchResult {
  /** Graph distance from query entity (0 = direct, 1 = 1 hop, etc.) */
  graphDistance?: number;
  /** Whether this memory is directly linked to a path */
  pathRelevance?: number;
  /** Entity overlap with subgraph */
  entityOverlap?: number;
  /** Combined score components */
  scores: {
    vector: number;
    bm25: number;
    recency: number;
    graph: number;
  };
}

/**
 * Level-specific weighting configuration
 */
export interface REPLWeightConfig {
  /** Vector similarity weight */
  vector: number;
  /** BM25 text match weight */
  bm25: number;
  /** Recency weight */
  recency: number;
  /** Graph proximity weight */
  graph: number;
  /** Minimum combined score threshold */
  minThreshold: number;
  /** Maximum results to return */
  maxResults: number;
  /** Whether to expand with related entities */
  expandContext: boolean;
}

/**
 * Weight configurations by search level
 */
const LEVEL_WEIGHTS: Record<SearchLevel, REPLWeightConfig> = {
  focused: {
    // High precision: prioritize exact matches and direct graph connections
    vector: 0.5,
    bm25: 0.3,
    recency: 0.1,
    graph: 0.1,
    minThreshold: 0.6,
    maxResults: 5,
    expandContext: false,
  },
  moderate: {
    // Balanced: consider graph proximity more
    vector: 0.4,
    bm25: 0.25,
    recency: 0.15,
    graph: 0.2,
    minThreshold: 0.4,
    maxResults: 15,
    expandContext: true,
  },
  general: {
    // Broad recall: emphasize graph exploration and recent items
    vector: 0.3,
    bm25: 0.2,
    recency: 0.2,
    graph: 0.3,
    minThreshold: 0.2,
    maxResults: 30,
    expandContext: true,
  },
};

/**
 * Stage 3: True REPL Implementation
 * Read-Eval-Print Loop for final search ranking
 */
export class Stage3REPL {
  private weights: REPLWeightConfig;
  private context: REPLEvalContext;
  private candidates: REPLCandidate[] = [];

  constructor(context: REPLEvalContext) {
    this.context = context;
    this.weights = LEVEL_WEIGHTS[context.level];

    logger.start("Stage3REPL", {
      level: context.level,
      query: context.query,
      resolvedEntity: context.resolvedEntity,
      subgraphEntities: context.subgraph?.entities.length ?? 0,
    });
  }

  /**
   * READ: Accept candidates into the REPL
   * @param candidates - Initial search results
   */
  read(candidates: REPLCandidate[]): void {
    this.candidates = candidates;

    logger.progress("read", {
      candidateCount: candidates.length,
    });
  }

  /**
   * EVAL: Evaluate and score all candidates
   * Applies level-specific weighting and calculates final scores
   */
  eval(): void {
    logger.progress("eval", { candidateCount: this.candidates.length });

    for (const candidate of this.candidates) {
      // Calculate graph proximity score
      const graphScore = this.calculateGraphScore(candidate);
      candidate.scores.graph = graphScore;

      // Calculate recency score (normalize to 0-1)
      candidate.scores.recency = this.calculateRecencyScore(candidate);

      // Calculate combined weighted score
      const weightedScore =
        candidate.scores.vector * this.weights.vector +
        candidate.scores.bm25 * this.weights.bm25 +
        candidate.scores.recency * this.weights.recency +
        candidate.scores.graph * this.weights.graph;

      // Update main score
      candidate.score = weightedScore;

      // Calculate graph distance for focused mode
      if (this.context.subgraph && candidate.entities) {
        candidate.graphDistance = this.calculateGraphDistance(candidate.entities);
      }

      logger.progress("eval-candidate", {
        id: candidate.id,
        vector: candidate.scores.vector.toFixed(3),
        bm25: candidate.scores.bm25.toFixed(3),
        recency: candidate.scores.recency.toFixed(3),
        graph: candidate.scores.graph.toFixed(3),
        weighted: weightedScore.toFixed(3),
      });
    }
  }

  /**
   * PRINT: Filter and return final results
   * Applies thresholds and limits based on search level
   */
  print(): {
    results: REPLCandidate[];
    stats: {
      totalEvaluated: number;
      aboveThreshold: number;
      returned: number;
      avgScore: number;
    };
  } {
    // Filter by threshold
    let filtered = this.candidates.filter((c) => c.score >= this.weights.minThreshold);

    const aboveThreshold = filtered.length;

    // Sort by score descending
    filtered.sort((a, b) => b.score - a.score);

    // Apply level-specific post-processing
    if (this.context.level === "focused") {
      // For focused: prioritize direct graph connections
      filtered = this.prioritizeDirectConnections(filtered);
      // Keep only top 30% of threshold-passing results
      const topCount = Math.max(1, Math.floor(filtered.length * 0.3));
      filtered = filtered.slice(0, topCount);
    } else if (this.context.level === "moderate") {
      // For moderate: balance graph distance and score
      filtered = this.balanceScoreAndDistance(filtered);
      // Keep top 60%
      const topCount = Math.max(1, Math.floor(filtered.length * 0.6));
      filtered = filtered.slice(0, topCount);
    }
    // General: keep all above threshold

    // Apply hard limit
    filtered = filtered.slice(0, this.weights.maxResults);

    const stats = {
      totalEvaluated: this.candidates.length,
      aboveThreshold,
      returned: filtered.length,
      avgScore:
        filtered.length > 0 ? filtered.reduce((sum, c) => sum + c.score, 0) / filtered.length : 0,
    };

    logger.success({
      level: this.context.level,
      totalEvaluated: stats.totalEvaluated,
      aboveThreshold: stats.aboveThreshold,
      returned: stats.returned,
      avgScore: stats.avgScore.toFixed(3),
    });

    return { results: filtered, stats };
  }

  /**
   * Execute full REPL cycle: READ → EVAL → PRINT
   */
  execute(candidates: REPLCandidate[]): {
    results: REPLCandidate[];
    stats: {
      totalEvaluated: number;
      aboveThreshold: number;
      returned: number;
      avgScore: number;
    };
  } {
    this.read(candidates);
    this.eval();
    return this.print();
  }

  /**
   * Calculate graph proximity score
   */
  private calculateGraphScore(candidate: REPLCandidate): number {
    if (!this.context.subgraph || !candidate.entities) {
      return 0;
    }

    // Check if candidate mentions entities from the subgraph
    let maxRelevance = 0;

    for (const entityName of candidate.entities) {
      const entity = this.context.subgraph.entities.find(
        (e) => e.name.toLowerCase() === entityName.toLowerCase(),
      );

      if (entity) {
        // Higher score for closer entities
        const distanceScore = 1 / (1 + entity.depth);
        maxRelevance = Math.max(maxRelevance, distanceScore);
      }
    }

    return maxRelevance;
  }

  /**
   * Calculate recency score
   */
  private calculateRecencyScore(candidate: REPLCandidate): number {
    if (!candidate.timestamp) {
      return 0.5; // Neutral if no timestamp
    }

    const ageMs = Date.now() - candidate.timestamp;
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    // Exponential decay: recent = high score
    // Half-life of 30 days
    return Math.exp(-ageDays / 30);
  }

  /**
   * Calculate minimum graph distance for candidate entities
   */
  private calculateGraphDistance(entityNames: string[]): number {
    if (!this.context.subgraph) {
      return Infinity;
    }

    let minDistance = Infinity;

    for (const name of entityNames) {
      const entity = this.context.subgraph.entities.find(
        (e) => e.name.toLowerCase() === name.toLowerCase(),
      );

      if (entity && entity.depth < minDistance) {
        minDistance = entity.depth;
      }
    }

    return minDistance === Infinity ? 99 : minDistance;
  }

  /**
   * Prioritize direct connections (for focused mode)
   */
  private prioritizeDirectConnections(candidates: REPLCandidate[]): REPLCandidate[] {
    // Sort by graph distance first, then by score
    return candidates.sort((a, b) => {
      const distA = a.graphDistance ?? 99;
      const distB = b.graphDistance ?? 99;

      if (distA !== distB) {
        return distA - distB; // Closer first
      }

      return b.score - a.score; // Higher score first
    });
  }

  /**
   * Balance score and distance (for moderate mode)
   */
  private balanceScoreAndDistance(candidates: REPLCandidate[]): REPLCandidate[] {
    return candidates.sort((a, b) => {
      // Combined ranking: score with distance penalty
      const distPenaltyA = (a.graphDistance ?? 2) * 0.1;
      const distPenaltyB = (b.graphDistance ?? 2) * 0.1;

      const adjustedA = a.score - distPenaltyA;
      const adjustedB = b.score - distPenaltyB;

      return adjustedB - adjustedA;
    });
  }

  /**
   * Get current weight configuration
   */
  getWeights(): REPLWeightConfig {
    return { ...this.weights };
  }

  /**
   * Get evaluation context
   */
  getContext(): REPLEvalContext {
    return { ...this.context };
  }
}

/**
 * Create REPL instance
 */
export function createStage3REPL(context: REPLEvalContext): Stage3REPL {
  return new Stage3REPL(context);
}

/**
 * Quick execute helper
 */
export function executeREPL(
  candidates: REPLCandidate[],
  context: REPLEvalContext,
): {
  results: REPLCandidate[];
  stats: {
    totalEvaluated: number;
    aboveThreshold: number;
    returned: number;
    avgScore: number;
  };
} {
  const repl = createStage3REPL(context);
  return repl.execute(candidates);
}

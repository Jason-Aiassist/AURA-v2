/**
 * Reasoning Hint Generator
 * Generates natural language reasoning from graph patterns
 */

import { createLogger } from "../../shared/debug-logger.js";
import type { Subgraph, GraphPath, ReasoningHint } from "./types.js";

const logger = createLogger("ReasoningHintGenerator");

/**
 * Pattern detectors for generating reasoning hints
 */
const PATTERN_DETECTORS = {
  /**
   * Pattern: Person ENJOYS Thing, Thing IS_A Category
   * → "Person enjoys Category-type things"
   */
  enjoysCategory: (path: GraphPath): boolean => {
    return (
      path.relationships.length === 2 &&
      path.relationships[0] === "ENJOYS" &&
      path.relationships[1] === "IS_A"
    );
  },

  /**
   * Pattern: Person WORKS_ON Project, Project USES Technology
   * → "Person works on a project that uses Technology"
   */
  worksOnUses: (path: GraphPath): boolean => {
    return (
      path.relationships.length === 2 &&
      path.relationships[0] === "WORKS_ON" &&
      path.relationships[1] === "USES"
    );
  },

  /**
   * Pattern: Person KNOWS Technology, Technology RELATED_TO OtherTech
   * → "Person knows Technology, which is related to OtherTech"
   */
  knowsRelated: (path: GraphPath): boolean => {
    return (
      path.relationships.length === 2 &&
      path.relationships[0] === "KNOWS" &&
      path.relationships[1] === "RELATED_TO"
    );
  },

  /**
   * Pattern: Person EXPERT_IN Domain
   * → "Person is an expert in Domain"
   */
  expertIn: (path: GraphPath): boolean => {
    return path.relationships.length === 1 && path.relationships[0] === "EXPERT_IN";
  },

  /**
   * Pattern: Project DEPENDS_ON Technology
   * → "Project depends on Technology"
   */
  dependsOn: (path: GraphPath): boolean => {
    return path.relationships.length === 1 && path.relationships[0] === "DEPENDS_ON";
  },

  /**
   * Pattern: Person LEARNING Technology
   * → "Person is learning Technology"
   */
  learning: (path: GraphPath): boolean => {
    return path.relationships.length === 1 && path.relationships[0] === "LEARNING";
  },
};

/**
 * Generate reasoning hints from subgraph
 * @param subgraph - Extracted subgraph
 * @returns Array of reasoning hints
 */
export function generateReasoningHints(subgraph: Subgraph): ReasoningHint[] {
  logger.start("generateReasoningHints", {
    entityCount: subgraph.entities.length,
    pathCount: subgraph.paths.length,
  });

  const hints: ReasoningHint[] = [];

  for (const path of subgraph.paths) {
    const hint = generateHintFromPath(path);
    if (hint) {
      hints.push(hint);
    }
  }

  // Remove duplicates (same statement)
  const uniqueHints = deduplicateHints(hints);

  logger.success({
    hintsGenerated: uniqueHints.length,
    patterns: uniqueHints.map((h) => h.pattern),
  });

  return uniqueHints;
}

/**
 * Generate hint from a single path
 * @param path - Graph path
 * @returns Reasoning hint or null if no pattern matched
 */
function generateHintFromPath(path: GraphPath): ReasoningHint | null {
  const [entityA, entityB, entityC] = path.entities;

  // Pattern: ENJOYS + IS_A
  if (PATTERN_DETECTORS.enjoysCategory(path)) {
    return {
      statement: `${entityA} ENJOYS ${entityB}, which IS_A ${entityC}. Therefore, ${entityA} enjoys ${entityC}-type things.`,
      confidence: path.confidence,
      path,
      pattern: "enjoys_category",
    };
  }

  // Pattern: WORKS_ON + USES
  if (PATTERN_DETECTORS.worksOnUses(path)) {
    return {
      statement: `${entityA} WORKS_ON ${entityB}, which USES ${entityC}.`,
      confidence: path.confidence,
      path,
      pattern: "works_on_uses",
    };
  }

  // Pattern: KNOWS + RELATED_TO
  if (PATTERN_DETECTORS.knowsRelated(path)) {
    return {
      statement: `${entityA} KNOWS ${entityB}, which is RELATED_TO ${entityC}.`,
      confidence: path.confidence,
      path,
      pattern: "knows_related",
    };
  }

  // Pattern: EXPERT_IN (single hop)
  if (PATTERN_DETECTORS.expertIn(path)) {
    return {
      statement: `${entityA} is an EXPERT_IN ${entityB}.`,
      confidence: path.confidence,
      path,
      pattern: "custom",
    };
  }

  // Pattern: DEPENDS_ON (single hop)
  if (PATTERN_DETECTORS.dependsOn(path)) {
    return {
      statement: `${entityA} DEPENDS_ON ${entityB}.`,
      confidence: path.confidence,
      path,
      pattern: "custom",
    };
  }

  // Pattern: LEARNING (single hop)
  if (PATTERN_DETECTORS.learning(path)) {
    return {
      statement: `${entityA} is LEARNING ${entityB}.`,
      confidence: path.confidence,
      path,
      pattern: "custom",
    };
  }

  // Generic 1-hop relationship
  if (path.relationships.length === 1) {
    const rel = path.relationships[0];
    return {
      statement: `${entityA} ${rel} ${entityB}.`,
      confidence: path.confidence,
      path,
      pattern: "custom",
    };
  }

  // Generic 2-hop relationship
  if (path.relationships.length === 2) {
    const [rel1, rel2] = path.relationships;
    return {
      statement: `${entityA} ${rel1} ${entityB}, which ${rel2} ${entityC}.`,
      confidence: path.confidence,
      path,
      pattern: "custom",
    };
  }

  return null;
}

/**
 * Deduplicate hints by statement
 * @param hints - Array of hints
 * @returns Deduplicated hints
 */
function deduplicateHints(hints: ReasoningHint[]): ReasoningHint[] {
  const seen = new Set<string>();
  const unique: ReasoningHint[] = [];

  for (const hint of hints) {
    const normalized = hint.statement.toLowerCase().trim();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      unique.push(hint);
    }
  }

  return unique;
}

/**
 * Format subgraph for display
 * @param subgraph - Subgraph to format
 * @returns Formatted string
 */
export function formatSubgraph(subgraph: Subgraph): string {
  const lines: string[] = [];

  lines.push("## Known Facts");
  for (const rel of subgraph.relationships) {
    lines.push(`- ${rel.from} ${rel.type} ${rel.to} (confidence: ${rel.confidence.toFixed(2)})`);
  }

  if (subgraph.paths.length > 0) {
    lines.push("\n## Reasoning Paths");
    const hints = generateReasoningHints(subgraph);
    for (const hint of hints) {
      lines.push(`- ${hint.statement}`);
    }
  }

  return lines.join("\n");
}

/**
 * Get interesting facts from subgraph
 * Returns the most confident relationships
 * @param subgraph - Subgraph
 * @param limit - Maximum facts to return
 * @returns Array of fact strings
 */
export function getInterestingFacts(subgraph: Subgraph, limit = 5): string[] {
  // Sort by confidence
  const sortedRels = [...subgraph.relationships].sort((a, b) => b.confidence - a.confidence);

  return sortedRels.slice(0, limit).map((rel) => {
    if (rel.fact) {
      return `${rel.from} ${rel.type} ${rel.to}: ${rel.fact}`;
    }
    return `${rel.from} ${rel.type} ${rel.to}`;
  });
}

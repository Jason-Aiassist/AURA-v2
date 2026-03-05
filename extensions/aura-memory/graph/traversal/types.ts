/**
 * Graph Traversal Types
 * Types for graph traversal and subgraph extraction
 */

import type { SemanticRelationship, EntityType } from "../ontology/types.js";

/**
 * Entity node in the graph
 */
export interface GraphEntity {
  /** Entity name */
  name: string;
  /** Entity type */
  type: EntityType;
  /** Entity aliases */
  aliases?: string[];
  /** Distance from start node (hops) */
  depth: number;
  /** All paths to this entity from start */
  paths: GraphPath[];
}

/**
 * Relationship in the graph
 */
export interface GraphRelationship {
  /** Source entity */
  from: string;
  /** Target entity */
  to: string;
  /** Relationship type */
  type: SemanticRelationship;
  /** Confidence score */
  confidence: number;
  /** Supporting fact */
  fact?: string;
}

/**
 * Path from start to end entity
 */
export interface GraphPath {
  /** Start entity */
  start: string;
  /** End entity */
  end: string;
  /** Number of hops */
  hops: number;
  /** Cumulative confidence (product of relationship confidences) */
  confidence: number;
  /** Relationship types in path */
  relationships: SemanticRelationship[];
  /** Entity names along the path */
  entities: string[];
}

/**
 * Subgraph extracted from traversal
 */
export interface Subgraph {
  /** Entities in subgraph */
  entities: GraphEntity[];
  /** Relationships in subgraph */
  relationships: GraphRelationship[];
  /** All paths from start entities */
  paths: GraphPath[];
  /** Query parameters used */
  query: TraversalQuery;
}

/**
 * Traversal query parameters
 */
export interface TraversalQuery {
  /** Starting entity names */
  entityNames: string[];
  /** Maximum traversal depth (1-3) */
  maxDepth: 1 | 2 | 3;
  /** Minimum path confidence */
  minConfidence: number;
  /** Filter by relationship types (optional) */
  relationshipTypes?: SemanticRelationship[];
  /** Maximum results to return */
  limit?: number;
}

/**
 * Raw Neo4j path record
 */
export interface Neo4jPathRecord {
  /** Path nodes */
  nodes: Array<{
    properties: {
      name: string;
      type: string;
      aliases?: string[];
    };
  }>;
  /** Path relationships */
  relationships: Array<{
    type: string;
    properties: {
      confidence: number;
      fact?: string;
    };
  }>;
}

/**
 * Traversal result with metadata
 */
export interface TraversalResult {
  /** Success status */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Extracted subgraph */
  subgraph: Subgraph;
  /** Performance metrics */
  metrics: {
    /** Execution time in ms */
    durationMs: number;
    /** Number of paths explored */
    pathsExplored: number;
    /** Number of entities found */
    entitiesFound: number;
  };
}

/**
 * Reasoning hint generated from graph patterns
 */
export interface ReasoningHint {
  /** Natural language statement */
  statement: string;
  /** Confidence in this reasoning */
  confidence: number;
  /** Supporting path */
  path: GraphPath;
  /** Pattern type detected */
  pattern: "enjoys_category" | "works_on_uses" | "knows_related" | "custom";
}

/**
 * Traversal configuration
 */
export interface TraversalConfig {
  /** Default max depth */
  defaultMaxDepth: 1 | 2 | 3;
  /** Default minimum confidence */
  defaultMinConfidence: number;
  /** Maximum paths to explore per entity */
  maxPathsPerEntity: number;
  /** Enable cycle detection */
  detectCycles: boolean;
}

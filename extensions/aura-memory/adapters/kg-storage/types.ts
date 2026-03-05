/**
 * KG Storage Types
 * Types for Knowledge Graph storage operations
 */

import type { Driver, Session, QueryResult, Record as Neo4jRecordType } from "neo4j-driver";
import type { SemanticRelationship } from "../../graph/ontology/types.js";

/**
 * Neo4j driver type - use actual neo4j-driver type
 */
export type Neo4jDriver = Driver;

/**
 * Neo4j session type - use actual neo4j-driver type
 */
export type Neo4jSession = Session;

/**
 * Neo4j query result type - use actual neo4j-driver type
 */
export type Neo4jResult = QueryResult;

/**
 * Neo4j record type - use actual neo4j-driver type
 */
export type Neo4jRecord = Neo4jRecordType;

/**
 * Neo4j summary
 */
export interface Neo4jSummary {
  counters: {
    updates: () => {
      nodesCreated?: number;
      nodesDeleted?: number;
      relationshipsCreated?: number;
      relationshipsDeleted?: number;
      propertiesSet?: number;
    };
  };
}

/**
 * Parameters for creating a semantic relationship
 */
export interface CreateRelationshipParams {
  /** Source entity name */
  fromEntity: string;
  /** Target entity name */
  toEntity: string;
  /** Relationship type */
  type: SemanticRelationship;
  /** Confidence score (0.0-1.0) */
  confidence: number;
  /** Supporting evidence text */
  fact?: string;
  /** Episode UUID that contains this relationship */
  episodeUuid?: string;
  /** Correlation ID for tracking */
  correlationId?: string;
}

/**
 * Parameters for creating/updating entity aliases
 */
export interface UpdateAliasesParams {
  /** Entity name */
  entityName: string;
  /** Entity type */
  entityType: string;
  /** Aliases to add */
  aliases: string[];
  /** Correlation ID for tracking */
  correlationId?: string;
}

/**
 * Parameters for linking episode to entities
 */
export interface LinkEpisodeParams {
  /** Episode UUID */
  episodeUuid: string;
  /** Entities mentioned in episode */
  entities: Array<{
    name: string;
    type: string;
    aliases?: string[];
  }>;
  /** Relationships in episode */
  relationships?: Array<{
    from: string;
    to: string;
    type: SemanticRelationship;
    confidence: number;
    fact?: string;
  }>;
  /** Correlation ID for tracking */
  correlationId?: string;
}

/**
 * Result of relationship creation
 */
export interface RelationshipResult {
  /** Success status */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Whether relationship was created or updated */
  action: "created" | "updated" | "unchanged";
  /** Confidence value (may be updated) */
  confidence?: number;
}

/**
 * Result of alias update
 */
export interface AliasResult {
  /** Success status */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Entity name */
  entityName: string;
  /** Aliases now associated with entity */
  aliases: string[];
  /** Whether entity was created new */
  isNewEntity: boolean;
}

/**
 * Result of episode linking
 */
export interface EpisodeLinkResult {
  /** Success status */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Episode UUID */
  episodeUuid: string;
  /** Number of entities linked */
  entitiesLinked: number;
  /** Number of relationships created */
  relationshipsCreated: number;
}

/**
 * Entity lookup result
 */
export interface EntityLookupResult {
  /** Whether entity was found */
  found: boolean;
  /** Entity name (original or resolved) */
  entityName?: string;
  /** Entity type */
  entityType?: string;
  /** Entity aliases */
  aliases?: string[];
  /** Resolution method if alias was used */
  resolutionMethod?: "exact" | "alias" | "case_insensitive";
}

/**
 * Storage configuration
 */
export interface KGStorageConfig {
  /** Neo4j database name (default: 'neo4j') */
  database?: string;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Storage dependencies
 */
export interface KGStorageDependencies {
  /** Neo4j driver */
  driver: Neo4jDriver;
  /** Audit logger */
  auditLog?: (event: {
    operation: string;
    correlationId: string;
    metadata: Record<string, unknown>;
  }) => Promise<void>;
  /** Timestamp provider */
  now?: () => number;
}

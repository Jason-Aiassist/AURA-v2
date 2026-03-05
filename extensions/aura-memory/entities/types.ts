/**
 * Entity Types and Interfaces
 * Story 3.3: Knowledge Graph Entity Extraction
 */

/**
 * Valid entity types for extraction
 */
export type EntityType =
  | "Person"
  | "Project"
  | "Technology"
  | "Organization"
  | "Location"
  | "Concept";

/**
 * All valid entity types
 */
export const ENTITY_TYPES: EntityType[] = [
  "Person",
  "Project",
  "Technology",
  "Organization",
  "Location",
  "Concept",
];

/**
 * Valid relationship types between entities
 */
export type RelationshipType =
  | "works_on"
  | "knows"
  | "uses"
  | "located_in"
  | "part_of"
  | "created_by"
  | "depends_on"
  | "related_to"
  | "manages"
  | "employs";

/**
 * All valid relationship types
 */
export const RELATIONSHIP_TYPES: RelationshipType[] = [
  "works_on",
  "knows",
  "uses",
  "located_in",
  "part_of",
  "created_by",
  "depends_on",
  "related_to",
  "manages",
  "employs",
];

/**
 * Full Entity node as stored in the Knowledge Graph
 */
export interface Entity {
  /** Entity UUID */
  id: string;
  /** Entity name (unique identifier) */
  name: string;
  /** Entity type classification */
  type: EntityType;
  /** Normalized entity name for deduplication */
  normalizedName: string;
  /** Confidence score (0.0-1.0) */
  confidence: number;
  /** First seen timestamp */
  firstSeen: number;
  /** Last seen timestamp */
  lastSeen: number;
  /** Number of times this entity has been mentioned */
  mentionCount: number;
  /** Optional aliases for flexible matching */
  aliases?: string[];
}

/**
 * Extracted entity from content
 */
export interface ExtractedEntity {
  /** Entity name (unique identifier) */
  name: string;
  /** Entity type classification */
  type: EntityType;
  /** Confidence score (0.0-1.0) */
  confidence: number;
  /** Optional character positions in text for highlighting */
  positions?: number[];
  /** Optional summary/description */
  summary?: string;
  /** Optional aliases for entity matching (e.g., "Steve" → ["steve", "user", "me", "i"]) */
  aliases?: string[];
}

/**
 * Relationship between two entities
 */
export interface EntityRelationship {
  /** Source entity ID */
  from: string;
  /** Target entity ID */
  to: string;
  /** Relationship type */
  type: RelationshipType;
  /** Confidence score (0.0-1.0) */
  confidence: number;
  /** Additional relationship properties (role, confidence, timestamp) */
  properties?: Record<string, unknown>;
}

/**
 * Complete entity extraction result
 */
export interface EntityExtractionResult {
  /** Extracted entities */
  entities: ExtractedEntity[];
  /** Relationships between entities */
  relationships: EntityRelationship[];
  /** Processing duration in milliseconds */
  durationMs: number;
  /** Token usage information */
  tokensUsed?: { input: number; output: number };
}

/**
 * Cache entry for deduplication
 */
export interface EntityCacheEntry {
  /** Entity name */
  name: string;
  /** Entity type */
  type: EntityType;
  /** When cached */
  timestamp: number;
  /** Whether entity exists in database */
  existsInDb: boolean;
}

/**
 * Entity linker configuration
 */
export interface EntityLinkerConfig {
  /** Minimum confidence threshold for entity storage (default: 0.5) */
  minConfidence: number;
  /** Maximum entities to process in a batch (default: 100) */
  batchSize: number;
  /** Cache TTL in milliseconds (default: 5 minutes) */
  cacheTtlMs: number;
  /** Enable debug logging */
  debug: boolean;
}

/**
 * Entity extractor configuration
 */
export interface EntityExtractorConfig {
  /** Maximum tokens for LLM call (default: 1500) */
  maxTokens: number;
  /** Temperature for LLM (default: 0.2) */
  temperature: number;
  /** Maximum entities to extract per memory (default: 20) */
  maxEntities: number;
  /** Enable output validation (default: true) */
  validateOutput: boolean;
  /** Minimum confidence threshold (default: 0.5) */
  minConfidence: number;
}

/**
 * Neo4j client interface for entity operations
 */
export interface Neo4jEntityClient {
  /** Add or update an entity */
  addEntity(
    name: string,
    entityType: string,
    summary: string,
  ): Promise<{
    uuid: string;
    name: string;
    entity_type: string;
    summary: string;
  }>;
  /** Create MENTIONS relationship from episode to entity */
  addMentions(episodeUuid: string, entityName: string): Promise<void>;
  /** Create RELATES_TO relationship between entities */
  addRelationship(fromEntity: string, toEntity: string, fact: string): Promise<void>;
  /** Check if entity exists */
  getEntity(name: string): Promise<{
    uuid: string;
    name: string;
    entity_type: string;
    summary: string;
  } | null>;
}

/**
 * LLM client interface for entity extraction
 */
export interface LLMClient {
  complete(params: { prompt: string; maxTokens: number; temperature: number }): Promise<{
    content: string;
    tokensUsed: { input: number; output: number };
  }>;
}

/**
 * Entity extractor dependencies
 */
export interface EntityExtractorDependencies {
  /** LLM client for extraction */
  llm: LLMClient;
  /** Audit logger */
  auditLog: (event: {
    operation: string;
    correlationId: string;
    metadata: Record<string, unknown>;
  }) => Promise<void>;
  /** Timestamp provider */
  now: () => number;
  /** ID generator */
  generateId: () => string;
}

/**
 * Entity linker dependencies
 */
export interface EntityLinkerDependencies {
  /** Neo4j client */
  neo4jClient: Neo4jEntityClient;
  /** Audit logger */
  auditLog: (event: {
    operation: string;
    correlationId: string;
    metadata: Record<string, unknown>;
  }) => Promise<void>;
  /** Timestamp provider */
  now: () => number;
  /** ID generator */
  generateId: () => string;
}

/**
 * Raw LLM entity extraction output (before validation)
 */
export interface RawEntityExtraction {
  entities?: Array<{
    name?: string;
    type?: string;
    confidence?: number;
    summary?: string;
  }>;
  relationships?: Array<{
    from?: string;
    to?: string;
    type?: string;
    confidence?: number;
  }>;
}

/**
 * Batch processing result
 */
export interface BatchProcessingResult {
  /** Number of entities processed */
  entitiesProcessed: number;
  /** Number of relationships created */
  relationshipsCreated: number;
  /** Number of errors */
  errors: number;
  /** Processing duration in milliseconds */
  durationMs: number;
}

/**
 * Validation error for entity extraction
 */
export interface EntityValidationError {
  field: string;
  message: string;
}

/**
 * Validation result for entity extraction
 */
export interface EntityValidationResult {
  valid: boolean;
  errors: EntityValidationError[];
  entities: ExtractedEntity[];
  relationships: EntityRelationship[];
}

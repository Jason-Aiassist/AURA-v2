/**
 * Entity Extraction Module
 * Story 3.3: Knowledge Graph Entity Extraction
 *
 * Public exports for the entity extraction system
 */

// Types
export type {
  Entity,
  EntityType,
  RelationshipType,
  ExtractedEntity,
  EntityRelationship,
  EntityExtractionResult,
  EntityCacheEntry,
  EntityLinkerConfig,
  EntityExtractorConfig,
  Neo4jEntityClient,
  LLMClient,
  EntityExtractorDependencies,
  EntityLinkerDependencies,
  RawEntityExtraction,
  BatchProcessingResult,
  EntityValidationError,
  EntityValidationResult,
} from "./types.js";

// Constants
export { ENTITY_TYPES, RELATIONSHIP_TYPES } from "./types.js";

// Entity Extractor
export { EntityExtractor, createEntityExtractor } from "./EntityExtractor.js";

// Entity Linker
export { EntityLinker, createEntityLinker } from "./EntityLinker.js";

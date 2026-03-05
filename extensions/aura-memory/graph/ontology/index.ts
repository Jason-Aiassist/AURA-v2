/**
 * Ontology Module
 * Semantic relationship ontology for knowledge graph
 *
 * @example
 * ```typescript
 * import {
 *   SEMANTIC_RELATIONSHIPS,
 *   getInverse,
 *   isValidRelationship
 * } from './ontology/index.js';
 *
 * // Get inverse relationship
 * const inverse = getInverse('ENJOYS'); // 'ENJOYED_BY'
 *
 * // Validate relationship
 * const isValid = isValidRelationship('Person', 'ENJOYS', 'Game'); // true
 * ```
 */

// Types
export type {
  EntityType,
  SemanticRelationship,
  RelationshipMetadata,
  RelationshipOntology,
  ValidatedRelationship,
  ValidationResult,
  ValidationError,
} from "./types.js";

// Constants
export {
  SEMANTIC_RELATIONSHIPS,
  RELATIONSHIP_TYPES,
  PREFERENCE_RELATIONSHIPS,
  WORK_RELATIONSHIPS,
  KNOWLEDGE_RELATIONSHIPS,
  SOCIAL_RELATIONSHIPS,
  TECHNICAL_RELATIONSHIPS,
  CATEGORIZATION_RELATIONSHIPS,
} from "./constants.js";

// Validators
export {
  getInverse,
  isSymmetric,
  getMetadata,
  isValidDomain,
  isValidRange,
  isValidRelationship,
  validateRelationship,
  getValidRelationshipsForDomain,
  getValidRelationshipsForRange,
  formatRelationship,
  getExamples,
  getTypicalConfidence,
} from "./validators.js";

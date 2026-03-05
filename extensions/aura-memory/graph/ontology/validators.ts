/**
 * Ontology Validators
 * Validation functions for semantic relationships
 */

import { SEMANTIC_RELATIONSHIPS } from "./constants.js";
import type {
  EntityType,
  SemanticRelationship,
  RelationshipMetadata,
  ValidationResult,
  ValidationError,
  ValidatedRelationship,
} from "./types.js";

/**
 * Get the inverse relationship type
 * @param relationship - The relationship type
 * @returns The inverse relationship type
 * @throws Error if relationship type is unknown
 */
export function getInverse(relationship: SemanticRelationship): SemanticRelationship {
  const metadata = SEMANTIC_RELATIONSHIPS[relationship];

  if (!metadata) {
    throw new Error(
      `Unknown relationship type: ${relationship}. ` +
        `Valid types: ${Object.keys(SEMANTIC_RELATIONSHIPS).join(", ")}`,
    );
  }

  return metadata.inverse;
}

/**
 * Check if a relationship is symmetric (its own inverse)
 * @param relationship - The relationship type
 * @returns True if symmetric
 */
export function isSymmetric(relationship: SemanticRelationship): boolean {
  const metadata = SEMANTIC_RELATIONSHIPS[relationship];

  if (!metadata) {
    throw new Error(`Unknown relationship type: ${relationship}`);
  }

  return metadata.symmetric;
}

/**
 * Get metadata for a relationship type
 * @param relationship - The relationship type
 * @returns Relationship metadata
 */
export function getMetadata(relationship: SemanticRelationship): RelationshipMetadata {
  const metadata = SEMANTIC_RELATIONSHIPS[relationship];

  if (!metadata) {
    throw new Error(
      `Unknown relationship type: ${relationship}. ` +
        `Valid types: ${Object.keys(SEMANTIC_RELATIONSHIPS).join(", ")}`,
    );
  }

  return metadata;
}

/**
 * Validate domain constraints
 * @param entityType - The entity type to check
 * @param relationship - The relationship type
 * @returns True if entity type is valid for relationship domain
 */
export function isValidDomain(entityType: EntityType, relationship: SemanticRelationship): boolean {
  const metadata = SEMANTIC_RELATIONSHIPS[relationship];

  if (!metadata) {
    return false;
  }

  return metadata.domain.includes(entityType);
}

/**
 * Validate range constraints
 * @param entityType - The entity type to check
 * @param relationship - The relationship type
 * @returns True if entity type is valid for relationship range
 */
export function isValidRange(entityType: EntityType, relationship: SemanticRelationship): boolean {
  const metadata = SEMANTIC_RELATIONSHIPS[relationship];

  if (!metadata) {
    return false;
  }

  return metadata.range.includes(entityType);
}

/**
 * Validate complete relationship (domain, range, confidence)
 * @param fromType - Source entity type
 * @param relationship - Relationship type
 * @param toType - Target entity type
 * @returns True if relationship is valid
 */
export function isValidRelationship(
  fromType: EntityType,
  relationship: SemanticRelationship,
  toType: EntityType,
): boolean {
  return isValidDomain(fromType, relationship) && isValidRange(toType, relationship);
}

/**
 * Validate a relationship instance with full error details
 * @param relationship - The relationship to validate
 * @returns Validation result with errors if invalid
 */
export function validateRelationship(
  relationship: Partial<ValidatedRelationship>,
  fromType?: EntityType,
  toType?: EntityType,
): ValidationResult {
  const errors: ValidationError[] = [];

  // Validate 'from' field
  if (!relationship.from || typeof relationship.from !== "string") {
    errors.push({
      field: "from",
      message: "from must be a non-empty string",
      value: relationship.from,
    });
  }

  // Validate 'to' field
  if (!relationship.to || typeof relationship.to !== "string") {
    errors.push({
      field: "to",
      message: "to must be a non-empty string",
      value: relationship.to,
    });
  }

  // Validate 'type' field
  if (!relationship.type) {
    errors.push({
      field: "type",
      message: "type is required",
      value: relationship.type,
    });
  } else if (!(relationship.type in SEMANTIC_RELATIONSHIPS)) {
    errors.push({
      field: "type",
      message: `Unknown relationship type: ${relationship.type}`,
      value: relationship.type,
    });
  }

  // Validate 'confidence' field
  if (relationship.confidence === undefined || relationship.confidence === null) {
    errors.push({
      field: "confidence",
      message: "confidence is required",
      value: relationship.confidence,
    });
  } else if (
    typeof relationship.confidence !== "number" ||
    relationship.confidence < 0 ||
    relationship.confidence > 1
  ) {
    errors.push({
      field: "confidence",
      message: "confidence must be a number between 0 and 1",
      value: relationship.confidence,
    });
  }

  // Validate domain/range if entity types provided
  if (fromType && relationship.type && relationship.type in SEMANTIC_RELATIONSHIPS) {
    if (!isValidDomain(fromType, relationship.type)) {
      const metadata = SEMANTIC_RELATIONSHIPS[relationship.type];
      errors.push({
        field: "type",
        message:
          `Invalid domain: ${fromType} cannot be source of ${relationship.type}. ` +
          `Valid domains: ${metadata.domain.join(", ")}`,
        value: { fromType, relationship: relationship.type },
      });
    }
  }

  if (toType && relationship.type && relationship.type in SEMANTIC_RELATIONSHIPS) {
    if (!isValidRange(toType, relationship.type)) {
      const metadata = SEMANTIC_RELATIONSHIPS[relationship.type];
      errors.push({
        field: "type",
        message:
          `Invalid range: ${toType} cannot be target of ${relationship.type}. ` +
          `Valid ranges: ${metadata.range.join(", ")}`,
        value: { toType, relationship: relationship.type },
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    relationship: errors.length === 0 ? (relationship as ValidatedRelationship) : undefined,
  };
}

/**
 * Get valid relationship types for a domain entity type
 * @param entityType - The entity type
 * @returns Array of valid relationship types
 */
export function getValidRelationshipsForDomain(entityType: EntityType): SemanticRelationship[] {
  return Object.entries(SEMANTIC_RELATIONSHIPS)
    .filter(([_, metadata]) => metadata.domain.includes(entityType))
    .map(([type, _]) => type as SemanticRelationship);
}

/**
 * Get valid relationship types for a range entity type
 * @param entityType - The entity type
 * @returns Array of valid relationship types
 */
export function getValidRelationshipsForRange(entityType: EntityType): SemanticRelationship[] {
  return Object.entries(SEMANTIC_RELATIONSHIPS)
    .filter(([_, metadata]) => metadata.range.includes(entityType))
    .map(([type, _]) => type as SemanticRelationship);
}

/**
 * Format relationship for display
 * @param relationship - The relationship to format
 * @returns Human-readable string
 */
export function formatRelationship(relationship: ValidatedRelationship): string {
  return (
    `${relationship.from} ${relationship.type} ${relationship.to} ` +
    `(confidence: ${relationship.confidence.toFixed(2)})`
  );
}

/**
 * Get example sentences for a relationship type (for LLM prompting)
 * @param relationship - The relationship type
 * @returns Array of example sentences
 */
export function getExamples(relationship: SemanticRelationship): string[] {
  const metadata = SEMANTIC_RELATIONSHIPS[relationship];

  if (!metadata) {
    throw new Error(`Unknown relationship type: ${relationship}`);
  }

  return metadata.examples;
}

/**
 * Get typical confidence threshold for a relationship type
 * @param relationship - The relationship type
 * @returns Typical confidence value
 */
export function getTypicalConfidence(relationship: SemanticRelationship): number {
  const metadata = SEMANTIC_RELATIONSHIPS[relationship];

  if (!metadata) {
    throw new Error(`Unknown relationship type: ${relationship}`);
  }

  return metadata.typicalConfidence;
}

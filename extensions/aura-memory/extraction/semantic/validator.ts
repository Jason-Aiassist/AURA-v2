/**
 * Semantic Extraction Validator
 * Validates extracted entities and relationships against ontology
 */

import { SEMANTIC_RELATIONSHIPS } from "../../graph/ontology/constants.js";
import type { EntityType, SemanticRelationship } from "../../graph/ontology/types.js";
import {
  isValidDomain,
  isValidRange,
  getTypicalConfidence,
} from "../../graph/ontology/validators.js";
import { createLogger } from "../../shared/debug-logger.js";
import type {
  SemanticExtractedEntity,
  SemanticExtractedRelationship,
  SemanticValidationResult,
  ValidationError,
} from "./types.js";

const logger = createLogger("SemanticValidator");

/**
 * Minimum confidence threshold
 */
const MIN_CONFIDENCE = 0.5;

/**
 * Maximum confidence threshold
 */
const MAX_CONFIDENCE = 1.0;

/**
 * Validate semantic extraction output
 * @param entities - Extracted entities
 * @param relationships - Extracted relationships
 * @returns Validation result
 */
export function validateSemanticExtraction(
  entities: SemanticExtractedEntity[],
  relationships: SemanticExtractedRelationship[],
): SemanticValidationResult {
  logger.start("validateSemanticExtraction", {
    entityCount: entities.length,
    relationshipCount: relationships.length,
  });

  const errors: ValidationError[] = [];

  // Validate entities
  const validEntities = validateEntities(entities, errors);
  logger.progress("entities-validated", {
    inputCount: entities.length,
    validCount: validEntities.length,
    errorCount: errors.filter((e) => e.type === "entity").length,
  });

  // Validate relationships (needs valid entities for context)
  const validRelationships = validateRelationships(relationships, validEntities, errors);
  logger.progress("relationships-validated", {
    inputCount: relationships.length,
    validCount: validRelationships.length,
    errorCount: errors.filter((e) => e.type === "relationship").length,
  });

  logger.success({
    validEntities: validEntities.length,
    validRelationships: validRelationships.length,
    totalErrors: errors.length,
  });

  return {
    valid: errors.length === 0,
    validEntities,
    validRelationships,
    errors,
  };
}

/**
 * Validate entities
 * @param entities - Entities to validate
 * @param errors - Error accumulator
 * @returns Valid entities
 */
function validateEntities(
  entities: SemanticExtractedEntity[],
  errors: ValidationError[],
): SemanticExtractedEntity[] {
  const valid: SemanticExtractedEntity[] = [];
  const seenNames = new Set<string>();

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    const entityErrors = validateSingleEntity(entity, i);

    if (entityErrors.length > 0) {
      errors.push(...entityErrors);
      continue;
    }

    // Check for duplicates (case-insensitive)
    const normalizedName = entity.name.toLowerCase();
    if (seenNames.has(normalizedName)) {
      errors.push({
        field: `entities[${i}].name`,
        message: `Duplicate entity name: ${entity.name}`,
        value: entity.name,
        type: "entity",
      });
      continue;
    }
    seenNames.add(normalizedName);

    valid.push(entity);
  }

  return valid;
}

/**
 * Validate single entity
 * @param entity - Entity to validate
 * @param index - Entity index
 * @returns Validation errors
 */
function validateSingleEntity(entity: SemanticExtractedEntity, index: number): ValidationError[] {
  const errors: ValidationError[] = [];

  // Validate name
  if (!entity.name || typeof entity.name !== "string") {
    errors.push({
      field: `entities[${index}].name`,
      message: "Entity name is required",
      value: entity.name,
      type: "entity",
    });
  } else if (entity.name.trim().length === 0) {
    errors.push({
      field: `entities[${index}].name`,
      message: "Entity name cannot be empty",
      value: entity.name,
      type: "entity",
    });
  }

  // Validate type
  if (!entity.type || typeof entity.type !== "string") {
    errors.push({
      field: `entities[${index}].type`,
      message: "Entity type is required",
      value: entity.type,
      type: "entity",
    });
  } else {
    const validTypes: string[] = [
      "Person",
      "Project",
      "Technology",
      "Activity",
      "Thing",
      "Category",
      "Domain",
      "Skill",
      "Game",
      "Location",
      "Organization",
    ];
    if (!validTypes.includes(entity.type)) {
      errors.push({
        field: `entities[${index}].type`,
        message: `Invalid entity type: ${entity.type}. Valid types: ${validTypes.join(", ")}`,
        value: entity.type,
        type: "entity",
      });
    }
  }

  // Validate confidence
  if (typeof entity.confidence !== "number") {
    errors.push({
      field: `entities[${index}].confidence`,
      message: "Entity confidence must be a number",
      value: entity.confidence,
      type: "entity",
    });
  } else if (entity.confidence < MIN_CONFIDENCE || entity.confidence > MAX_CONFIDENCE) {
    errors.push({
      field: `entities[${index}].confidence`,
      message: `Entity confidence must be between ${MIN_CONFIDENCE} and ${MAX_CONFIDENCE}`,
      value: entity.confidence,
      type: "entity",
    });
  }

  // Validate aliases if present
  if (entity.aliases !== undefined) {
    if (!Array.isArray(entity.aliases)) {
      errors.push({
        field: `entities[${index}].aliases`,
        message: "Entity aliases must be an array",
        value: entity.aliases,
        type: "entity",
      });
    } else {
      for (let j = 0; j < entity.aliases.length; j++) {
        if (typeof entity.aliases[j] !== "string") {
          errors.push({
            field: `entities[${index}].aliases[${j}]`,
            message: "Entity alias must be a string",
            value: entity.aliases[j],
            type: "entity",
          });
        }
      }
    }
  }

  return errors;
}

/**
 * Validate relationships
 * @param relationships - Relationships to validate
 * @param validEntities - Valid entities for context
 * @param errors - Error accumulator
 * @returns Valid relationships
 */
function validateRelationships(
  relationships: SemanticExtractedRelationship[],
  validEntities: SemanticExtractedEntity[],
  errors: ValidationError[],
): SemanticExtractedRelationship[] {
  const valid: SemanticExtractedRelationship[] = [];
  const entityNames = new Set(validEntities.map((e) => e.name.toLowerCase()));

  for (let i = 0; i < relationships.length; i++) {
    const relationship = relationships[i];
    const relationshipErrors = validateSingleRelationship(
      relationship,
      i,
      entityNames,
      validEntities,
    );

    if (relationshipErrors.length > 0) {
      errors.push(...relationshipErrors);
      continue;
    }

    valid.push(relationship);
  }

  return valid;
}

/**
 * Validate single relationship
 * @param relationship - Relationship to validate
 * @param index - Relationship index
 * @param entityNames - Valid entity names
 * @param validEntities - Valid entities for type lookup
 * @returns Validation errors
 */
function validateSingleRelationship(
  relationship: SemanticExtractedRelationship,
  index: number,
  entityNames: Set<string>,
  validEntities: SemanticExtractedEntity[],
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Validate from
  if (!relationship.from || typeof relationship.from !== "string") {
    errors.push({
      field: `relationships[${index}].from`,
      message: "Relationship from is required",
      value: relationship.from,
      type: "relationship",
    });
  } else if (!entityNames.has(relationship.from.toLowerCase())) {
    errors.push({
      field: `relationships[${index}].from`,
      message: `Relationship from entity not found: ${relationship.from}`,
      value: relationship.from,
      type: "relationship",
    });
  }

  // Validate to
  if (!relationship.to || typeof relationship.to !== "string") {
    errors.push({
      field: `relationships[${index}].to`,
      message: "Relationship to is required",
      value: relationship.to,
      type: "relationship",
    });
  } else if (!entityNames.has(relationship.to.toLowerCase())) {
    errors.push({
      field: `relationships[${index}].to`,
      message: `Relationship to entity not found: ${relationship.to}`,
      value: relationship.to,
      type: "relationship",
    });
  }

  // Validate type
  if (!relationship.type || typeof relationship.type !== "string") {
    errors.push({
      field: `relationships[${index}].type`,
      message: "Relationship type is required",
      value: relationship.type,
      type: "relationship",
    });
  } else if (!(relationship.type in SEMANTIC_RELATIONSHIPS)) {
    errors.push({
      field: `relationships[${index}].type`,
      message: `Invalid relationship type: ${relationship.type}`,
      value: relationship.type,
      type: "relationship",
    });
  } else {
    // Validate domain/range constraints
    const fromEntity = validEntities.find(
      (e) => e.name.toLowerCase() === relationship.from?.toLowerCase(),
    );
    const toEntity = validEntities.find(
      (e) => e.name.toLowerCase() === relationship.to?.toLowerCase(),
    );

    if (fromEntity && toEntity) {
      if (!isValidDomain(fromEntity.type, relationship.type)) {
        errors.push({
          field: `relationships[${index}].type`,
          message: `Invalid domain: ${fromEntity.type} cannot be source of ${relationship.type}`,
          value: { fromType: fromEntity.type, relationshipType: relationship.type },
          type: "relationship",
        });
      }

      if (!isValidRange(toEntity.type, relationship.type)) {
        errors.push({
          field: `relationships[${index}].type`,
          message: `Invalid range: ${toEntity.type} cannot be target of ${relationship.type}`,
          value: { toType: toEntity.type, relationshipType: relationship.type },
          type: "relationship",
        });
      }
    }
  }

  // Validate confidence
  if (typeof relationship.confidence !== "number") {
    errors.push({
      field: `relationships[${index}].confidence`,
      message: "Relationship confidence must be a number",
      value: relationship.confidence,
      type: "relationship",
    });
  } else if (relationship.confidence < MIN_CONFIDENCE || relationship.confidence > MAX_CONFIDENCE) {
    errors.push({
      field: `relationships[${index}].confidence`,
      message: `Relationship confidence must be between ${MIN_CONFIDENCE} and ${MAX_CONFIDENCE}`,
      value: relationship.confidence,
      type: "relationship",
    });
  }

  // Validate fact if present
  if (relationship.fact !== undefined && typeof relationship.fact !== "string") {
    errors.push({
      field: `relationships[${index}].fact`,
      message: "Relationship fact must be a string",
      value: relationship.fact,
      type: "relationship",
    });
  }

  return errors;
}

/**
 * Check if entity types are valid for relationship
 * @param fromType - Source entity type
 * @param toType - Target entity type
 * @param relationshipType - Relationship type
 * @returns Whether valid
 */
export function validateRelationshipTypes(
  fromType: EntityType,
  toType: EntityType,
  relationshipType: SemanticRelationship,
): boolean {
  return isValidDomain(fromType, relationshipType) && isValidRange(toType, relationshipType);
}

/**
 * Suggest relationship type for entities
 * @param fromType - Source entity type
 * @param toType - Target entity type
 * @returns Suggested relationship types
 */
export function suggestRelationshipTypes(
  fromType: EntityType,
  toType: EntityType,
): SemanticRelationship[] {
  const suggestions: SemanticRelationship[] = [];

  for (const type of Object.keys(SEMANTIC_RELATIONSHIPS) as SemanticRelationship[]) {
    if (validateRelationshipTypes(fromType, toType, type)) {
      suggestions.push(type);
    }
  }

  return suggestions;
}

/**
 * Get typical confidence for relationship type
 * @param relationshipType - Relationship type
 * @returns Typical confidence value
 */
export function getRelationshipTypicalConfidence(relationshipType: SemanticRelationship): number {
  try {
    return getTypicalConfidence(relationshipType);
  } catch {
    return 0.75; // Default
  }
}

/**
 * Ontology Types
 * TypeScript interfaces for semantic relationship ontology
 */

/**
 * Valid entity types in the knowledge graph
 */
export type EntityType =
  | "Person"
  | "Project"
  | "Technology"
  | "Activity"
  | "Thing"
  | "Category"
  | "Domain"
  | "Skill"
  | "Game"
  | "Location"
  | "Organization"
  | "Date";

/**
 * Valid semantic relationship types
 */
export type SemanticRelationship =
  // User preferences
  | "ENJOYS"
  | "ENJOYED_BY"
  | "DISLIKES"
  | "DISLIKED_BY"
  | "PREFERS"
  | "PREFERRED_BY"
  // Work/Projects
  | "WORKS_ON"
  | "WORKED_ON_BY"
  | "CREATED"
  | "CREATED_BY"
  | "MAINTAINS"
  | "MAINTAINED_BY"
  // Knowledge/Skills
  | "KNOWS"
  | "KNOWN_BY"
  | "EXPERT_IN"
  | "HAS_EXPERT"
  | "LEARNING"
  | "BEING_LEARNED_BY"
  // Social
  | "FRIENDS_WITH"
  | "COLLEAGUE_OF"
  // Technical
  | "DEPENDS_ON"
  | "DEPENDENCY_OF"
  | "USES"
  | "USED_BY"
  | "BUILT_WITH"
  | "USED_IN"
  // Categorization
  | "IS_A"
  | "HAS_INSTANCE"
  | "PART_OF"
  | "HAS_PART"
  | "RELATED_TO";

/**
 * Metadata for a semantic relationship type
 */
export interface RelationshipMetadata {
  /** Human-readable description */
  description: string;
  /** Valid domain entity types */
  domain: EntityType[];
  /** Valid range entity types */
  range: EntityType[];
  /** Inverse relationship type */
  inverse: SemanticRelationship;
  /** Whether the relationship is symmetric (its own inverse) */
  symmetric: boolean;
  /** Example sentences for LLM prompting */
  examples: string[];
  /** Typical confidence threshold for this relationship */
  typicalConfidence: number;
}

/**
 * Complete ontology definition
 */
export type RelationshipOntology = Record<SemanticRelationship, RelationshipMetadata>;

/**
 * Validated relationship instance
 */
export interface ValidatedRelationship {
  from: string;
  to: string;
  type: SemanticRelationship;
  confidence: number;
  fact?: string;
}

/**
 * Result of relationship validation
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  relationship?: ValidatedRelationship;
}

/**
 * Validation error details
 */
export interface ValidationError {
  field: "from" | "to" | "type" | "confidence";
  message: string;
  value: unknown;
}

/**
 * Ontology Constants
 * Semantic relationship definitions and metadata
 */

import type { RelationshipOntology, SemanticRelationship } from "./types.js";

/**
 * Complete semantic relationship ontology
 * Defines all valid relationship types with metadata
 */
export const SEMANTIC_RELATIONSHIPS: RelationshipOntology = {
  // ========== USER PREFERENCES ==========
  ENJOYS: {
    description: "Person enjoys an activity or thing",
    domain: ["Person"],
    range: ["Activity", "Thing", "Game"],
    inverse: "ENJOYED_BY",
    symmetric: false,
    examples: [
      "Steve ENJOYS Daggerheart",
      "User ENJOYS programming",
      "I ENJOYS playing board games",
    ],
    typicalConfidence: 0.85,
  },

  DISLIKES: {
    description: "Person dislikes an activity or thing",
    domain: ["Person"],
    range: ["Activity", "Thing", "Game"],
    inverse: "DISLIKED_BY",
    symmetric: false,
    examples: ["Steve DISLIKES waiting in lines", "User DISLIKES noisy environments"],
    typicalConfidence: 0.85,
  },

  PREFERS: {
    description: "Person prefers one thing over another",
    domain: ["Person"],
    range: ["Thing", "Activity", "Technology"],
    inverse: "PREFERRED_BY",
    symmetric: false,
    examples: ["Steve PREFERS Daggerheart over D&D", "User PREFERS Neo4j over PostgreSQL"],
    typicalConfidence: 0.8,
  },

  // ========== WORK/PROJECTS ==========
  WORKS_ON: {
    description: "Person works on a project",
    domain: ["Person"],
    range: ["Project"],
    inverse: "WORKED_ON_BY",
    symmetric: false,
    examples: ["Steve WORKS_ON AURA", "User WORKS_ON a memory system"],
    typicalConfidence: 0.9,
  },

  CREATED: {
    description: "Person created a thing or project",
    domain: ["Person"],
    range: ["Project", "Thing", "Technology"],
    inverse: "CREATED_BY",
    symmetric: false,
    examples: ["Steve CREATED the AURA project", "User CREATED a custom keyboard"],
    typicalConfidence: 0.92,
  },

  MAINTAINS: {
    description: "Person maintains a project or system",
    domain: ["Person"],
    range: ["Project", "Technology"],
    inverse: "MAINTAINED_BY",
    symmetric: false,
    examples: ["Steve MAINTAINS the Neo4j database", "User MAINTAINS the AURA deployment"],
    typicalConfidence: 0.88,
  },

  // ========== KNOWLEDGE/SKILLS ==========
  KNOWS: {
    description: "Person knows a technology or skill",
    domain: ["Person"],
    range: ["Technology", "Skill"],
    inverse: "KNOWN_BY",
    symmetric: false,
    examples: ["Steve KNOWS TypeScript", "User KNOWS Neo4j"],
    typicalConfidence: 0.85,
  },

  EXPERT_IN: {
    description: "Person is an expert in a domain",
    domain: ["Person"],
    range: ["Domain", "Technology"],
    inverse: "HAS_EXPERT",
    symmetric: false,
    examples: ["Steve EXPERT_IN knowledge graphs", "User EXPERT_IN distributed systems"],
    typicalConfidence: 0.88,
  },

  LEARNING: {
    description: "Person is learning a technology or skill",
    domain: ["Person"],
    range: ["Technology", "Skill"],
    inverse: "BEING_LEARNED_BY",
    symmetric: false,
    examples: ["Steve LEARNING Rust", "User LEARNING machine learning"],
    typicalConfidence: 0.82,
  },

  // ========== SOCIAL ==========
  FRIENDS_WITH: {
    description: "Person is friends with another person",
    domain: ["Person"],
    range: ["Person"],
    inverse: "FRIENDS_WITH",
    symmetric: true,
    examples: ["Steve FRIENDS_WITH Alice", "User FRIENDS_WITH their coworker"],
    typicalConfidence: 0.9,
  },

  COLLEAGUE_OF: {
    description: "Person is a colleague of another person",
    domain: ["Person"],
    range: ["Person"],
    inverse: "COLLEAGUE_OF",
    symmetric: true,
    examples: ["Steve COLLEAGUE_OF Bob", "User COLLEAGUE_OF their team members"],
    typicalConfidence: 0.85,
  },

  // ========== TECHNICAL ==========
  DEPENDS_ON: {
    description: "Project depends on a technology",
    domain: ["Project", "Technology"],
    range: ["Technology"],
    inverse: "DEPENDENCY_OF",
    symmetric: false,
    examples: ["AURA DEPENDS_ON Neo4j", "Project DEPENDS_ON Docker"],
    typicalConfidence: 0.95,
  },

  USES: {
    description: "Project or person uses a technology",
    domain: ["Project", "Person", "Technology"],
    range: ["Technology"],
    inverse: "USED_BY",
    symmetric: false,
    examples: ["AURA USES SQLite", "Steve USES VS Code"],
    typicalConfidence: 0.9,
  },

  BUILT_WITH: {
    description: "Project is built with a technology",
    domain: ["Project"],
    range: ["Technology"],
    inverse: "USED_IN",
    symmetric: false,
    examples: ["AURA BUILT_WITH TypeScript", "Project BUILT_WITH React"],
    typicalConfidence: 0.92,
  },

  // ========== CATEGORIZATION ==========
  IS_A: {
    description: "Thing is a category or type",
    domain: ["Thing", "Activity", "Game", "Project", "Technology"],
    range: ["Category"],
    inverse: "HAS_INSTANCE",
    symmetric: false,
    examples: ["Daggerheart IS_A TTRPG", "Neo4j IS_A graph database"],
    typicalConfidence: 0.95,
  },

  PART_OF: {
    description: "Thing is part of another thing",
    domain: ["Thing", "Project", "Technology"],
    range: ["Thing", "Project"],
    inverse: "HAS_PART",
    symmetric: false,
    examples: ["AURA-memory PART_OF AURA", "Frontend PART_OF fullstack app"],
    typicalConfidence: 0.88,
  },

  RELATED_TO: {
    description: "Thing is related to another thing",
    domain: ["Thing", "Project", "Technology", "Activity"],
    range: ["Thing", "Project", "Technology", "Activity"],
    inverse: "RELATED_TO",
    symmetric: true,
    examples: ["Daggerheart RELATED_TO D&D", "AURA RELATED_TO OpenClaw"],
    typicalConfidence: 0.75,
  },
};

/**
 * All valid relationship types as array
 */
export const RELATIONSHIP_TYPES: SemanticRelationship[] = Object.keys(
  SEMANTIC_RELATIONSHIPS,
) as SemanticRelationship[];

/**
 * User preference relationships
 */
export const PREFERENCE_RELATIONSHIPS: SemanticRelationship[] = ["ENJOYS", "DISLIKES", "PREFERS"];

/**
 * Work/project relationships
 */
export const WORK_RELATIONSHIPS: SemanticRelationship[] = ["WORKS_ON", "CREATED", "MAINTAINS"];

/**
 * Knowledge/skill relationships
 */
export const KNOWLEDGE_RELATIONSHIPS: SemanticRelationship[] = ["KNOWS", "EXPERT_IN", "LEARNING"];

/**
 * Social relationships
 */
export const SOCIAL_RELATIONSHIPS: SemanticRelationship[] = ["FRIENDS_WITH", "COLLEAGUE_OF"];

/**
 * Technical relationships
 */
export const TECHNICAL_RELATIONSHIPS: SemanticRelationship[] = ["DEPENDS_ON", "USES", "BUILT_WITH"];

/**
 * Categorization relationships
 */
export const CATEGORIZATION_RELATIONSHIPS: SemanticRelationship[] = [
  "IS_A",
  "PART_OF",
  "RELATED_TO",
];

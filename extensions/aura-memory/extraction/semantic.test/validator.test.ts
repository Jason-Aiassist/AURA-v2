/**
 * Validator Tests
 */

import { describe, it, expect } from "vitest";
import type { SemanticExtractedEntity, SemanticExtractedRelationship } from "../semantic/types.js";
import {
  validateSemanticExtraction,
  validateRelationshipTypes,
  suggestRelationshipTypes,
  getRelationshipTypicalConfidence,
} from "../semantic/validator.js";

describe("validateSemanticExtraction", () => {
  it("should validate complete extraction", () => {
    const entities: SemanticExtractedEntity[] = [
      { name: "Steve", type: "Person", confidence: 0.95 },
      { name: "Daggerheart", type: "Game", confidence: 0.9 },
    ];

    const relationships: SemanticExtractedRelationship[] = [
      { from: "Steve", to: "Daggerheart", type: "ENJOYS", confidence: 0.95 },
    ];

    const result = validateSemanticExtraction(entities, relationships);

    expect(result.valid).toBe(true);
    expect(result.validEntities).toHaveLength(2);
    expect(result.validRelationships).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
  });

  it("should reject invalid entity types", () => {
    const entities: SemanticExtractedEntity[] = [
      { name: "Steve", type: "InvalidType" as any, confidence: 0.95 },
    ];

    const result = validateSemanticExtraction(entities, []);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field.includes("type"))).toBe(true);
  });

  it("should reject confidence below threshold", () => {
    const entities: SemanticExtractedEntity[] = [
      { name: "Steve", type: "Person", confidence: 0.3 },
    ];

    const result = validateSemanticExtraction(entities, []);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("confidence"))).toBe(true);
  });

  it("should reject duplicate entity names", () => {
    const entities: SemanticExtractedEntity[] = [
      { name: "Steve", type: "Person", confidence: 0.95 },
      { name: "steve", type: "Person", confidence: 0.9 }, // Duplicate
    ];

    const result = validateSemanticExtraction(entities, []);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("Duplicate"))).toBe(true);
  });

  it("should reject relationship with missing entity", () => {
    const entities: SemanticExtractedEntity[] = [
      { name: "Steve", type: "Person", confidence: 0.95 },
    ];

    const relationships: SemanticExtractedRelationship[] = [
      { from: "Steve", to: "Unknown", type: "ENJOYS", confidence: 0.95 },
    ];

    const result = validateSemanticExtraction(entities, relationships);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("not found"))).toBe(true);
  });

  it("should reject invalid relationship domain", () => {
    const entities: SemanticExtractedEntity[] = [
      { name: "Neo4j", type: "Technology", confidence: 0.95 },
      { name: "Daggerheart", type: "Game", confidence: 0.9 },
    ];

    const relationships: SemanticExtractedRelationship[] = [
      { from: "Neo4j", to: "Daggerheart", type: "ENJOYS", confidence: 0.95 },
    ];

    const result = validateSemanticExtraction(entities, relationships);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("Invalid domain"))).toBe(true);
  });

  it("should reject invalid relationship range", () => {
    const entities: SemanticExtractedEntity[] = [
      { name: "Steve", type: "Person", confidence: 0.95 },
      { name: "Neo4j", type: "Technology", confidence: 0.9 },
    ];

    const relationships: SemanticExtractedRelationship[] = [
      { from: "Steve", to: "Neo4j", type: "IS_A", confidence: 0.95 },
    ];

    const result = validateSemanticExtraction(entities, relationships);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("Invalid range"))).toBe(true);
  });

  it("should accept valid relationship types", () => {
    const entities: SemanticExtractedEntity[] = [
      { name: "Steve", type: "Person", confidence: 0.95 },
      { name: "AURA", type: "Project", confidence: 0.9 },
    ];

    const relationships: SemanticExtractedRelationship[] = [
      { from: "Steve", to: "AURA", type: "WORKS_ON", confidence: 0.95 },
    ];

    const result = validateSemanticExtraction(entities, relationships);

    expect(result.valid).toBe(true);
  });

  it("should validate entity aliases", () => {
    const entities: SemanticExtractedEntity[] = [
      {
        name: "Steve",
        type: "Person",
        confidence: 0.95,
        aliases: ["steve", "me", "I"],
      },
    ];

    const result = validateSemanticExtraction(entities, []);

    expect(result.valid).toBe(true);
    expect(result.validEntities[0].aliases).toEqual(["steve", "me", "I"]);
  });

  it("should reject invalid aliases type", () => {
    const entities: SemanticExtractedEntity[] = [
      {
        name: "Steve",
        type: "Person",
        confidence: 0.95,
        aliases: "invalid" as any,
      },
    ];

    const result = validateSemanticExtraction(entities, []);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field.includes("aliases"))).toBe(true);
  });

  it("should reject missing entity name", () => {
    const entities: SemanticExtractedEntity[] = [{ name: "", type: "Person", confidence: 0.95 }];

    const result = validateSemanticExtraction(entities, []);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("name"))).toBe(true);
  });

  it("should validate relationship with fact", () => {
    const entities: SemanticExtractedEntity[] = [
      { name: "Steve", type: "Person", confidence: 0.95 },
      { name: "Neo4j", type: "Technology", confidence: 0.9 },
    ];

    const relationships: SemanticExtractedRelationship[] = [
      {
        from: "Steve",
        to: "Neo4j",
        type: "KNOWS",
        confidence: 0.95,
        fact: "Steve has used Neo4j for years",
      },
    ];

    const result = validateSemanticExtraction(entities, relationships);

    expect(result.valid).toBe(true);
  });
});

describe("validateRelationshipTypes", () => {
  it("should validate Person ENJOYS Game", () => {
    expect(validateRelationshipTypes("Person", "Game", "ENJOYS")).toBe(true);
  });

  it("should validate Person WORKS_ON Project", () => {
    expect(validateRelationshipTypes("Person", "Project", "WORKS_ON")).toBe(true);
  });

  it("should reject Technology ENJOYS Person", () => {
    expect(validateRelationshipTypes("Technology", "Person", "ENJOYS")).toBe(false);
  });

  it("should validate Project DEPENDS_ON Technology", () => {
    expect(validateRelationshipTypes("Project", "Technology", "DEPENDS_ON")).toBe(true);
  });
});

describe("suggestRelationshipTypes", () => {
  it("should suggest relationships for Person to Game", () => {
    const suggestions = suggestRelationshipTypes("Person", "Game");

    expect(suggestions).toContain("ENJOYS");
    expect(suggestions).toContain("DISLIKES");
  });

  it("should suggest relationships for Person to Technology", () => {
    const suggestions = suggestRelationshipTypes("Person", "Technology");

    expect(suggestions).toContain("KNOWS");
    expect(suggestions).toContain("USES");
  });

  it("should suggest relationships for Project to Technology", () => {
    const suggestions = suggestRelationshipTypes("Project", "Technology");

    expect(suggestions).toContain("DEPENDS_ON");
    expect(suggestions).toContain("USES");
  });
});

describe("getRelationshipTypicalConfidence", () => {
  it("should return typical confidence for ENJOYS", () => {
    expect(getRelationshipTypicalConfidence("ENJOYS")).toBe(0.85);
  });

  it("should return typical confidence for DEPENDS_ON", () => {
    expect(getRelationshipTypicalConfidence("DEPENDS_ON")).toBe(0.95);
  });

  it("should return default for unknown type", () => {
    expect(getRelationshipTypicalConfidence("UNKNOWN" as any)).toBe(0.75);
  });
});

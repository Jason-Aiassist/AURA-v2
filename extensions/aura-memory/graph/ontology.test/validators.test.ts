/**
 * Ontology Validators Tests
 * Validation function tests
 */

import { describe, it, expect } from "vitest";
import type { EntityType, SemanticRelationship, ValidatedRelationship } from "../ontology/types.js";
import {
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
} from "../ontology/validators.js";

describe("getInverse", () => {
  it("should return correct inverse for ENJOYS", () => {
    expect(getInverse("ENJOYS")).toBe("ENJOYED_BY");
  });

  it("should return correct inverse for WORKS_ON", () => {
    expect(getInverse("WORKS_ON")).toBe("WORKED_ON_BY");
  });

  it("should return correct inverse for IS_A", () => {
    expect(getInverse("IS_A")).toBe("HAS_INSTANCE");
  });

  it("should return symmetric relationship for FRIENDS_WITH", () => {
    expect(getInverse("FRIENDS_WITH")).toBe("FRIENDS_WITH");
  });

  it("should throw for unknown relationship type", () => {
    expect(() => getInverse("UNKNOWN" as SemanticRelationship)).toThrow(
      "Unknown relationship type",
    );
  });
});

describe("isSymmetric", () => {
  it("should return true for symmetric relationships", () => {
    expect(isSymmetric("FRIENDS_WITH")).toBe(true);
    expect(isSymmetric("COLLEAGUE_OF")).toBe(true);
    expect(isSymmetric("RELATED_TO")).toBe(true);
  });

  it("should return false for asymmetric relationships", () => {
    expect(isSymmetric("ENJOYS")).toBe(false);
    expect(isSymmetric("WORKS_ON")).toBe(false);
    expect(isSymmetric("IS_A")).toBe(false);
  });

  it("should throw for unknown relationship type", () => {
    expect(() => isSymmetric("UNKNOWN" as SemanticRelationship)).toThrow(
      "Unknown relationship type",
    );
  });
});

describe("getMetadata", () => {
  it("should return metadata for ENJOYS", () => {
    const metadata = getMetadata("ENJOYS");

    expect(metadata.description).toBe("Person enjoys an activity or thing");
    expect(metadata.domain).toContain("Person");
    expect(metadata.inverse).toBe("ENJOYED_BY");
    expect(metadata.typicalConfidence).toBe(0.85);
  });

  it("should throw for unknown relationship type", () => {
    expect(() => getMetadata("UNKNOWN" as SemanticRelationship)).toThrow(
      "Unknown relationship type",
    );
  });
});

describe("isValidDomain", () => {
  it("should validate Person for ENJOYS domain", () => {
    expect(isValidDomain("Person", "ENJOYS")).toBe(true);
  });

  it("should reject Technology for ENJOYS domain", () => {
    expect(isValidDomain("Technology", "ENJOYS")).toBe(false);
  });

  it("should validate Person for WORKS_ON domain", () => {
    expect(isValidDomain("Person", "WORKS_ON")).toBe(true);
  });

  it("should validate Project and Technology for DEPENDS_ON domain", () => {
    expect(isValidDomain("Project", "DEPENDS_ON")).toBe(true);
    expect(isValidDomain("Technology", "DEPENDS_ON")).toBe(true);
    expect(isValidDomain("Person", "DEPENDS_ON")).toBe(false);
  });

  it("should return false for unknown relationship type", () => {
    expect(isValidDomain("Person", "UNKNOWN" as SemanticRelationship)).toBe(false);
  });
});

describe("isValidRange", () => {
  it("should validate Activity for ENJOYS range", () => {
    expect(isValidRange("Activity", "ENJOYS")).toBe(true);
  });

  it("should validate Game for ENJOYS range", () => {
    expect(isValidRange("Game", "ENJOYS")).toBe(true);
  });

  it("should reject Person for ENJOYS range", () => {
    expect(isValidRange("Person", "ENJOYS")).toBe(false);
  });

  it("should validate Technology for DEPENDS_ON range", () => {
    expect(isValidRange("Technology", "DEPENDS_ON")).toBe(true);
  });

  it("should return false for unknown relationship type", () => {
    expect(isValidRange("Project", "UNKNOWN" as SemanticRelationship)).toBe(false);
  });
});

describe("isValidRelationship", () => {
  it("should validate Person ENJOYS Game", () => {
    expect(isValidRelationship("Person", "ENJOYS", "Game")).toBe(true);
  });

  it("should validate Person WORKS_ON Project", () => {
    expect(isValidRelationship("Person", "WORKS_ON", "Project")).toBe(true);
  });

  it("should reject Technology ENJOYS Person", () => {
    expect(isValidRelationship("Technology", "ENJOYS", "Person")).toBe(false);
  });

  it("should validate Project DEPENDS_ON Technology", () => {
    expect(isValidRelationship("Project", "DEPENDS_ON", "Technology")).toBe(true);
  });

  it("should validate Game IS_A Category", () => {
    expect(isValidRelationship("Game", "IS_A", "Category")).toBe(true);
  });
});

describe("validateRelationship", () => {
  it("should validate complete relationship", () => {
    const relationship: Partial<ValidatedRelationship> = {
      from: "Steve",
      to: "Daggerheart",
      type: "ENJOYS",
      confidence: 0.95,
    };

    const result = validateRelationship(relationship);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.relationship).toEqual(relationship);
  });

  it("should reject missing from", () => {
    const relationship: Partial<ValidatedRelationship> = {
      to: "Daggerheart",
      type: "ENJOYS",
      confidence: 0.95,
    };

    const result = validateRelationship(relationship);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: "from",
        message: "from must be a non-empty string",
      }),
    );
  });

  it("should reject missing to", () => {
    const relationship: Partial<ValidatedRelationship> = {
      from: "Steve",
      type: "ENJOYS",
      confidence: 0.95,
    };

    const result = validateRelationship(relationship);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: "to",
        message: "to must be a non-empty string",
      }),
    );
  });

  it("should reject missing type", () => {
    const relationship: Partial<ValidatedRelationship> = {
      from: "Steve",
      to: "Daggerheart",
      confidence: 0.95,
    };

    const result = validateRelationship(relationship);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: "type",
        message: "type is required",
      }),
    );
  });

  it("should reject unknown type", () => {
    const relationship: Partial<ValidatedRelationship> = {
      from: "Steve",
      to: "Daggerheart",
      type: "UNKNOWN" as SemanticRelationship,
      confidence: 0.95,
    };

    const result = validateRelationship(relationship);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: "type",
        message: "Unknown relationship type: UNKNOWN",
      }),
    );
  });

  it("should reject missing confidence", () => {
    const relationship: Partial<ValidatedRelationship> = {
      from: "Steve",
      to: "Daggerheart",
      type: "ENJOYS",
    };

    const result = validateRelationship(relationship);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: "confidence",
        message: "confidence is required",
      }),
    );
  });

  it("should reject confidence below 0", () => {
    const relationship: Partial<ValidatedRelationship> = {
      from: "Steve",
      to: "Daggerheart",
      type: "ENJOYS",
      confidence: -0.5,
    };

    const result = validateRelationship(relationship);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: "confidence",
        message: "confidence must be a number between 0 and 1",
      }),
    );
  });

  it("should reject confidence above 1", () => {
    const relationship: Partial<ValidatedRelationship> = {
      from: "Steve",
      to: "Daggerheart",
      type: "ENJOYS",
      confidence: 1.5,
    };

    const result = validateRelationship(relationship);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: "confidence",
        message: "confidence must be a number between 0 and 1",
      }),
    );
  });

  it("should validate domain constraints when provided", () => {
    const relationship: Partial<ValidatedRelationship> = {
      from: "Technology", // Technology is not valid for ENJOYS
      to: "Daggerheart",
      type: "ENJOYS",
      confidence: 0.95,
    };

    const result = validateRelationship(relationship, "Technology", "Game");

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: "type",
        message: expect.stringContaining("Invalid domain"),
      }),
    );
  });

  it("should validate range constraints when provided", () => {
    const relationship: Partial<ValidatedRelationship> = {
      from: "Steve",
      to: "Person",
      type: "ENJOYS",
      confidence: 0.95,
    };

    const result = validateRelationship(relationship, "Person", "Person");

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: "type",
        message: expect.stringContaining("Invalid range"),
      }),
    );
  });

  it("should collect multiple errors", () => {
    const relationship: Partial<ValidatedRelationship> = {
      type: "ENJOYS",
      confidence: 1.5,
    };

    const result = validateRelationship(relationship);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
    const errorFields = result.errors.map((e) => e.field);
    expect(errorFields).toContain("from");
    expect(errorFields).toContain("to");
    expect(errorFields).toContain("confidence");
  });
});

describe("getValidRelationshipsForDomain", () => {
  it("should return relationships valid for Person domain", () => {
    const relationships = getValidRelationshipsForDomain("Person");

    expect(relationships).toContain("ENJOYS");
    expect(relationships).toContain("WORKS_ON");
    expect(relationships).toContain("KNOWS");
    expect(relationships).toContain("FRIENDS_WITH");
  });

  it("should return relationships valid for Project domain", () => {
    const relationships = getValidRelationshipsForDomain("Project");

    expect(relationships).toContain("DEPENDS_ON");
    expect(relationships).toContain("USES");
    expect(relationships).toContain("IS_A");
  });

  it("should not return ENJOYS for Technology domain", () => {
    const relationships = getValidRelationshipsForDomain("Technology");

    expect(relationships).not.toContain("ENJOYS");
  });
});

describe("getValidRelationshipsForRange", () => {
  it("should return relationships valid for Technology range", () => {
    const relationships = getValidRelationshipsForRange("Technology");

    expect(relationships).toContain("DEPENDS_ON");
    expect(relationships).toContain("USES");
    expect(relationships).toContain("KNOWS");
  });

  it("should return relationships valid for Project range", () => {
    const relationships = getValidRelationshipsForRange("Project");

    expect(relationships).toContain("WORKS_ON");
    expect(relationships).toContain("CREATED");
    expect(relationships).toContain("PART_OF");
  });
});

describe("formatRelationship", () => {
  it("should format relationship with confidence", () => {
    const relationship: ValidatedRelationship = {
      from: "Steve",
      to: "Daggerheart",
      type: "ENJOYS",
      confidence: 0.95,
    };

    const formatted = formatRelationship(relationship);

    expect(formatted).toBe("Steve ENJOYS Daggerheart (confidence: 0.95)");
  });

  it("should format with 2 decimal places", () => {
    const relationship: ValidatedRelationship = {
      from: "User",
      to: "AURA",
      type: "WORKS_ON",
      confidence: 0.999,
    };

    const formatted = formatRelationship(relationship);

    expect(formatted).toBe("User WORKS_ON AURA (confidence: 1.00)");
  });
});

describe("getExamples", () => {
  it("should return examples for ENJOYS", () => {
    const examples = getExamples("ENJOYS");

    expect(examples.length).toBeGreaterThan(0);
    expect(examples.some((e) => e.includes("ENJOYS"))).toBe(true);
  });

  it("should throw for unknown relationship type", () => {
    expect(() => getExamples("UNKNOWN" as SemanticRelationship)).toThrow(
      "Unknown relationship type",
    );
  });
});

describe("getTypicalConfidence", () => {
  it("should return 0.85 for ENJOYS", () => {
    expect(getTypicalConfidence("ENJOYS")).toBe(0.85);
  });

  it("should return 0.95 for DEPENDS_ON", () => {
    expect(getTypicalConfidence("DEPENDS_ON")).toBe(0.95);
  });

  it("should throw for unknown relationship type", () => {
    expect(() => getTypicalConfidence("UNKNOWN" as SemanticRelationship)).toThrow(
      "Unknown relationship type",
    );
  });
});

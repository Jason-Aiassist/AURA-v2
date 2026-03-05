/**
 * Ontology Constants Tests
 * Relationship definition tests
 */

import { describe, it, expect } from "vitest";
import {
  SEMANTIC_RELATIONSHIPS,
  RELATIONSHIP_TYPES,
  PREFERENCE_RELATIONSHIPS,
  WORK_RELATIONSHIPS,
  KNOWLEDGE_RELATIONSHIPS,
  SOCIAL_RELATIONSHIPS,
  TECHNICAL_RELATIONSHIPS,
  CATEGORIZATION_RELATIONSHIPS,
} from "../ontology/constants.js";
import type { SemanticRelationship } from "../ontology/types.js";

describe("SEMANTIC_RELATIONSHIPS", () => {
  it("should have 17 relationship types", () => {
    expect(Object.keys(SEMANTIC_RELATIONSHIPS)).toHaveLength(17);
  });

  it("should have all expected relationship keys", () => {
    const expectedKeys: SemanticRelationship[] = [
      "ENJOYS",
      "DISLIKES",
      "PREFERS",
      "WORKS_ON",
      "CREATED",
      "MAINTAINS",
      "KNOWS",
      "EXPERT_IN",
      "LEARNING",
      "FRIENDS_WITH",
      "COLLEAGUE_OF",
      "DEPENDS_ON",
      "USES",
      "BUILT_WITH",
      "IS_A",
      "PART_OF",
      "RELATED_TO",
    ];

    expectedKeys.forEach((key) => {
      expect(SEMANTIC_RELATIONSHIPS).toHaveProperty(key);
    });
  });

  it("should have complete metadata for ENJOYS", () => {
    const enjoys = SEMANTIC_RELATIONSHIPS.ENJOYS;

    expect(enjoys.description).toBe("Person enjoys an activity or thing");
    expect(enjoys.domain).toContain("Person");
    expect(enjoys.range).toContain("Activity");
    expect(enjoys.range).toContain("Thing");
    expect(enjoys.range).toContain("Game");
    expect(enjoys.inverse).toBe("ENJOYED_BY");
    expect(enjoys.symmetric).toBe(false);
    expect(enjoys.examples.length).toBeGreaterThan(0);
    expect(enjoys.typicalConfidence).toBe(0.85);
  });

  it("should have complete metadata for WORKS_ON", () => {
    const worksOn = SEMANTIC_RELATIONSHIPS.WORKS_ON;

    expect(worksOn.description).toBe("Person works on a project");
    expect(worksOn.domain).toContain("Person");
    expect(worksOn.range).toContain("Project");
    expect(worksOn.inverse).toBe("WORKED_ON_BY");
    expect(worksOn.symmetric).toBe(false);
    expect(worksOn.typicalConfidence).toBe(0.9);
  });

  it("should have symmetric relationships as their own inverse", () => {
    const friendsWith = SEMANTIC_RELATIONSHIPS.FRIENDS_WITH;
    expect(friendsWith.inverse).toBe("FRIENDS_WITH");
    expect(friendsWith.symmetric).toBe(true);

    const colleagueOf = SEMANTIC_RELATIONSHIPS.COLLEAGUE_OF;
    expect(colleagueOf.inverse).toBe("COLLEAGUE_OF");
    expect(colleagueOf.symmetric).toBe(true);

    const relatedTo = SEMANTIC_RELATIONSHIPS.RELATED_TO;
    expect(relatedTo.inverse).toBe("RELATED_TO");
    expect(relatedTo.symmetric).toBe(true);
  });

  it("should have asymmetric relationships with different inverses", () => {
    expect(SEMANTIC_RELATIONSHIPS.ENJOYS.inverse).toBe("ENJOYED_BY");
    expect(SEMANTIC_RELATIONSHIPS.WORKS_ON.inverse).toBe("WORKED_ON_BY");
    expect(SEMANTIC_RELATIONSHIPS.CREATED.inverse).toBe("CREATED_BY");
    expect(SEMANTIC_RELATIONSHIPS.IS_A.inverse).toBe("HAS_INSTANCE");
  });

  it("should have typical confidence values between 0 and 1", () => {
    Object.values(SEMANTIC_RELATIONSHIPS).forEach((metadata) => {
      expect(metadata.typicalConfidence).toBeGreaterThan(0);
      expect(metadata.typicalConfidence).toBeLessThanOrEqual(1);
    });
  });

  it("should have at least one example for each relationship", () => {
    Object.values(SEMANTIC_RELATIONSHIPS).forEach((metadata) => {
      expect(metadata.examples.length).toBeGreaterThan(0);
    });
  });

  it("should have non-empty domains for all relationships", () => {
    Object.values(SEMANTIC_RELATIONSHIPS).forEach((metadata) => {
      expect(metadata.domain.length).toBeGreaterThan(0);
    });
  });

  it("should have non-empty ranges for all relationships", () => {
    Object.values(SEMANTIC_RELATIONSHIPS).forEach((metadata) => {
      expect(metadata.range.length).toBeGreaterThan(0);
    });
  });
});

describe("RELATIONSHIP_TYPES array", () => {
  it("should contain all relationship types", () => {
    expect(RELATIONSHIP_TYPES).toHaveLength(17);

    RELATIONSHIP_TYPES.forEach((type) => {
      expect(SEMANTIC_RELATIONSHIPS).toHaveProperty(type);
    });
  });
});

describe("Relationship category arrays", () => {
  it("should categorize PREFERENCE_RELATIONSHIPS correctly", () => {
    expect(PREFERENCE_RELATIONSHIPS).toHaveLength(3);
    expect(PREFERENCE_RELATIONSHIPS).toContain("ENJOYS");
    expect(PREFERENCE_RELATIONSHIPS).toContain("DISLIKES");
    expect(PREFERENCE_RELATIONSHIPS).toContain("PREFERS");
  });

  it("should categorize WORK_RELATIONSHIPS correctly", () => {
    expect(WORK_RELATIONSHIPS).toHaveLength(3);
    expect(WORK_RELATIONSHIPS).toContain("WORKS_ON");
    expect(WORK_RELATIONSHIPS).toContain("CREATED");
    expect(WORK_RELATIONSHIPS).toContain("MAINTAINS");
  });

  it("should categorize KNOWLEDGE_RELATIONSHIPS correctly", () => {
    expect(KNOWLEDGE_RELATIONSHIPS).toHaveLength(3);
    expect(KNOWLEDGE_RELATIONSHIPS).toContain("KNOWS");
    expect(KNOWLEDGE_RELATIONSHIPS).toContain("EXPERT_IN");
    expect(KNOWLEDGE_RELATIONSHIPS).toContain("LEARNING");
  });

  it("should categorize SOCIAL_RELATIONSHIPS correctly", () => {
    expect(SOCIAL_RELATIONSHIPS).toHaveLength(2);
    expect(SOCIAL_RELATIONSHIPS).toContain("FRIENDS_WITH");
    expect(SOCIAL_RELATIONSHIPS).toContain("COLLEAGUE_OF");
  });

  it("should categorize TECHNICAL_RELATIONSHIPS correctly", () => {
    expect(TECHNICAL_RELATIONSHIPS).toHaveLength(3);
    expect(TECHNICAL_RELATIONSHIPS).toContain("DEPENDS_ON");
    expect(TECHNICAL_RELATIONSHIPS).toContain("USES");
    expect(TECHNICAL_RELATIONSHIPS).toContain("BUILT_WITH");
  });

  it("should categorize CATEGORIZATION_RELATIONSHIPS correctly", () => {
    expect(CATEGORIZATION_RELATIONSHIPS).toHaveLength(3);
    expect(CATEGORIZATION_RELATIONSHIPS).toContain("IS_A");
    expect(CATEGORIZATION_RELATIONSHIPS).toContain("PART_OF");
    expect(CATEGORIZATION_RELATIONSHIPS).toContain("RELATED_TO");
  });

  it("should have no overlap between categories", () => {
    const allCategories = [
      ...PREFERENCE_RELATIONSHIPS,
      ...WORK_RELATIONSHIPS,
      ...KNOWLEDGE_RELATIONSHIPS,
      ...SOCIAL_RELATIONSHIPS,
      ...TECHNICAL_RELATIONSHIPS,
      ...CATEGORIZATION_RELATIONSHIPS,
    ];

    const uniqueCategories = new Set(allCategories);
    expect(uniqueCategories.size).toBe(allCategories.length);
  });
});

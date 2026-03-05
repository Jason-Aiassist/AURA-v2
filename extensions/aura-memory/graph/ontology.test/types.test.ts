/**
 * Ontology Types Tests
 * Type definition tests
 */

import { describe, it, expect } from "vitest";
import type { EntityType, SemanticRelationship, RelationshipMetadata } from "../types.js";

describe("Type definitions", () => {
  it("should have valid EntityType union", () => {
    const validEntityTypes: EntityType[] = [
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
      "Date",
    ];

    expect(validEntityTypes).toHaveLength(12);
  });

  it("should have valid SemanticRelationship union", () => {
    const validRelationships: SemanticRelationship[] = [
      // Preferences
      "ENJOYS",
      "DISLIKES",
      "PREFERS",
      // Work
      "WORKS_ON",
      "CREATED",
      "MAINTAINS",
      // Knowledge
      "KNOWS",
      "EXPERT_IN",
      "LEARNING",
      // Social
      "FRIENDS_WITH",
      "COLLEAGUE_OF",
      // Technical
      "DEPENDS_ON",
      "USES",
      "BUILT_WITH",
      // Categorization
      "IS_A",
      "PART_OF",
      "RELATED_TO",
    ];

    expect(validRelationships).toHaveLength(17);
  });

  it("should define complete RelationshipMetadata interface", () => {
    const metadata: RelationshipMetadata = {
      description: "Test relationship",
      domain: ["Person"],
      range: ["Thing"],
      inverse: "ENJOYED_BY",
      symmetric: false,
      examples: ["Example 1", "Example 2"],
      typicalConfidence: 0.85,
    };

    expect(metadata.description).toBe("Test relationship");
    expect(metadata.domain).toContain("Person");
    expect(metadata.range).toContain("Thing");
    expect(metadata.inverse).toBe("ENJOYED_BY");
    expect(metadata.symmetric).toBe(false);
    expect(metadata.examples).toHaveLength(2);
    expect(metadata.typicalConfidence).toBe(0.85);
  });
});

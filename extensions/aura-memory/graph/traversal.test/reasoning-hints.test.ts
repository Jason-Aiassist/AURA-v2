/**
 * Reasoning Hints Tests
 */

import { describe, it, expect } from "vitest";
import {
  generateReasoningHints,
  formatSubgraph,
  getInterestingFacts,
} from "../traversal/reasoning-hints.js";
import type { Subgraph, GraphPath, GraphRelationship } from "../traversal/types.js";

describe("generateReasoningHints", () => {
  it("should generate enjoys_category pattern hint", () => {
    const subgraph: Subgraph = {
      entities: [
        { name: "Steve", type: "Person", depth: 0, paths: [] },
        { name: "Daggerheart", type: "Game", depth: 1, paths: [] },
        { name: "TTRPG", type: "Category", depth: 2, paths: [] },
      ],
      relationships: [
        { from: "Steve", to: "Daggerheart", type: "ENJOYS", confidence: 0.95 },
        { from: "Daggerheart", to: "TTRPG", type: "IS_A", confidence: 0.98 },
      ],
      paths: [
        {
          start: "Steve",
          end: "TTRPG",
          hops: 2,
          confidence: 0.931,
          relationships: ["ENJOYS", "IS_A"],
          entities: ["Steve", "Daggerheart", "TTRPG"],
        },
      ],
      query: {
        entityNames: ["Steve"],
        maxDepth: 2,
        minConfidence: 0.7,
      },
    };

    const hints = generateReasoningHints(subgraph);

    expect(hints).toHaveLength(1);
    expect(hints[0].pattern).toBe("enjoys_category");
    expect(hints[0].statement).toContain("Steve ENJOYS Daggerheart");
    expect(hints[0].statement).toContain("IS_A TTRPG");
    expect(hints[0].statement).toContain("enjoys TTRPG-type things");
  });

  it("should generate works_on_uses pattern hint", () => {
    const subgraph: Subgraph = {
      entities: [
        { name: "Steve", type: "Person", depth: 0, paths: [] },
        { name: "AURA", type: "Project", depth: 1, paths: [] },
        { name: "Neo4j", type: "Technology", depth: 2, paths: [] },
      ],
      relationships: [
        { from: "Steve", to: "AURA", type: "WORKS_ON", confidence: 0.95 },
        { from: "AURA", to: "Neo4j", type: "USES", confidence: 0.9 },
      ],
      paths: [
        {
          start: "Steve",
          end: "Neo4j",
          hops: 2,
          confidence: 0.855,
          relationships: ["WORKS_ON", "USES"],
          entities: ["Steve", "AURA", "Neo4j"],
        },
      ],
      query: {
        entityNames: ["Steve"],
        maxDepth: 2,
        minConfidence: 0.7,
      },
    };

    const hints = generateReasoningHints(subgraph);

    expect(hints).toHaveLength(1);
    expect(hints[0].pattern).toBe("works_on_uses");
    expect(hints[0].statement).toContain("WORKS_ON AURA");
    expect(hints[0].statement).toContain("USES Neo4j");
  });

  it("should generate expert_in hint", () => {
    const subgraph: Subgraph = {
      entities: [
        { name: "Steve", type: "Person", depth: 0, paths: [] },
        { name: "Knowledge Graphs", type: "Domain", depth: 1, paths: [] },
      ],
      relationships: [
        { from: "Steve", to: "Knowledge Graphs", type: "EXPERT_IN", confidence: 0.9 },
      ],
      paths: [
        {
          start: "Steve",
          end: "Knowledge Graphs",
          hops: 1,
          confidence: 0.9,
          relationships: ["EXPERT_IN"],
          entities: ["Steve", "Knowledge Graphs"],
        },
      ],
      query: {
        entityNames: ["Steve"],
        maxDepth: 1,
        minConfidence: 0.7,
      },
    };

    const hints = generateReasoningHints(subgraph);

    expect(hints).toHaveLength(1);
    expect(hints[0].statement).toContain("EXPERT_IN");
    expect(hints[0].statement).toContain("Knowledge Graphs");
  });

  it("should deduplicate duplicate hints", () => {
    const subgraph: Subgraph = {
      entities: [
        { name: "Steve", type: "Person", depth: 0, paths: [] },
        { name: "Daggerheart", type: "Game", depth: 1, paths: [] },
      ],
      relationships: [{ from: "Steve", to: "Daggerheart", type: "ENJOYS", confidence: 0.95 }],
      paths: [
        {
          start: "Steve",
          end: "Daggerheart",
          hops: 1,
          confidence: 0.95,
          relationships: ["ENJOYS"],
          entities: ["Steve", "Daggerheart"],
        },
        {
          start: "Steve",
          end: "Daggerheart",
          hops: 1,
          confidence: 0.95,
          relationships: ["ENJOYS"],
          entities: ["Steve", "Daggerheart"],
        },
      ],
      query: {
        entityNames: ["Steve"],
        maxDepth: 1,
        minConfidence: 0.7,
      },
    };

    const hints = generateReasoningHints(subgraph);

    // Should deduplicate identical hints
    expect(hints).toHaveLength(1);
  });

  it("should handle empty subgraph", () => {
    const subgraph: Subgraph = {
      entities: [],
      relationships: [],
      paths: [],
      query: {
        entityNames: ["Steve"],
        maxDepth: 1,
        minConfidence: 0.7,
      },
    };

    const hints = generateReasoningHints(subgraph);

    expect(hints).toHaveLength(0);
  });

  it("should return hints sorted by confidence", () => {
    const subgraph: Subgraph = {
      entities: [
        { name: "Steve", type: "Person", depth: 0, paths: [] },
        { name: "A", type: "Game", depth: 1, paths: [] },
        { name: "B", type: "Technology", depth: 1, paths: [] },
      ],
      relationships: [
        { from: "Steve", to: "A", type: "ENJOYS", confidence: 0.9 },
        { from: "Steve", to: "B", type: "KNOWS", confidence: 0.8 },
      ],
      paths: [
        {
          start: "Steve",
          end: "B",
          hops: 1,
          confidence: 0.8,
          relationships: ["KNOWS"],
          entities: ["Steve", "B"],
        },
        {
          start: "Steve",
          end: "A",
          hops: 1,
          confidence: 0.9,
          relationships: ["ENJOYS"],
          entities: ["Steve", "A"],
        },
      ],
      query: {
        entityNames: ["Steve"],
        maxDepth: 1,
        minConfidence: 0.7,
      },
    };

    const hints = generateReasoningHints(subgraph);

    expect(hints).toHaveLength(2);
    // Higher confidence first (based on path order)
    expect(hints[0].confidence).toBe(0.8);
    expect(hints[1].confidence).toBe(0.9);
  });
});

describe("formatSubgraph", () => {
  it("should format subgraph for display", () => {
    const subgraph: Subgraph = {
      entities: [
        { name: "Steve", type: "Person", depth: 0, paths: [] },
        { name: "Daggerheart", type: "Game", depth: 1, paths: [] },
      ],
      relationships: [{ from: "Steve", to: "Daggerheart", type: "ENJOYS", confidence: 0.95 }],
      paths: [
        {
          start: "Steve",
          end: "Daggerheart",
          hops: 1,
          confidence: 0.95,
          relationships: ["ENJOYS"],
          entities: ["Steve", "Daggerheart"],
        },
      ],
      query: {
        entityNames: ["Steve"],
        maxDepth: 1,
        minConfidence: 0.7,
      },
    };

    const formatted = formatSubgraph(subgraph);

    expect(formatted).toContain("## Known Facts");
    expect(formatted).toContain("Steve ENJOYS Daggerheart");
    expect(formatted).toContain("## Reasoning Paths");
  });

  it("should handle subgraph without paths", () => {
    const subgraph: Subgraph = {
      entities: [{ name: "Steve", type: "Person", depth: 0, paths: [] }],
      relationships: [],
      paths: [],
      query: {
        entityNames: ["Steve"],
        maxDepth: 1,
        minConfidence: 0.7,
      },
    };

    const formatted = formatSubgraph(subgraph);

    expect(formatted).toContain("## Known Facts");
    expect(formatted).not.toContain("## Reasoning Paths");
  });
});

describe("getInterestingFacts", () => {
  it("should return facts sorted by confidence", () => {
    const relationships: GraphRelationship[] = [
      { from: "Steve", to: "A", type: "ENJOYS", confidence: 0.9 },
      { from: "Steve", to: "B", type: "KNOWS", confidence: 0.95 },
      { from: "Steve", to: "C", type: "USES", confidence: 0.8 },
    ];

    const subgraph: Subgraph = {
      entities: [],
      relationships,
      paths: [],
      query: {
        entityNames: ["Steve"],
        maxDepth: 1,
        minConfidence: 0.7,
      },
    };

    const facts = getInterestingFacts(subgraph, 2);

    expect(facts).toHaveLength(2);
    // Highest confidence first
    expect(facts[0]).toContain("KNOWS");
  });

  it("should include fact text when available", () => {
    const relationships: GraphRelationship[] = [
      {
        from: "Steve",
        to: "Daggerheart",
        type: "ENJOYS",
        confidence: 0.95,
        fact: "Steve plays Daggerheart every weekend",
      },
    ];

    const subgraph: Subgraph = {
      entities: [],
      relationships,
      paths: [],
      query: {
        entityNames: ["Steve"],
        maxDepth: 1,
        minConfidence: 0.7,
      },
    };

    const facts = getInterestingFacts(subgraph);

    expect(facts[0]).toContain("Steve plays Daggerheart every weekend");
  });

  it("should respect limit parameter", () => {
    const relationships: GraphRelationship[] = [
      { from: "Steve", to: "A", type: "ENJOYS", confidence: 0.9 },
      { from: "Steve", to: "B", type: "KNOWS", confidence: 0.95 },
      { from: "Steve", to: "C", type: "USES", confidence: 0.8 },
      { from: "Steve", to: "D", type: "CREATED", confidence: 0.85 },
    ];

    const subgraph: Subgraph = {
      entities: [],
      relationships,
      paths: [],
      query: {
        entityNames: ["Steve"],
        maxDepth: 1,
        minConfidence: 0.7,
      },
    };

    const facts = getInterestingFacts(subgraph, 2);

    expect(facts).toHaveLength(2);
  });
});

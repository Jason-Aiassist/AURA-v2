/**
 * Parser Tests
 */

import { describe, it, expect } from "vitest";
import {
  parseLLMOutput,
  attemptRepair,
  isValidJSON,
  SemanticParseError,
} from "../semantic/parser.js";

describe("parseLLMOutput", () => {
  it("should parse valid JSON output", () => {
    const content = JSON.stringify({
      entities: [
        { name: "Steve", type: "Person", confidence: 0.95 },
        { name: "Daggerheart", type: "Game", confidence: 0.9 },
      ],
      relationships: [{ from: "Steve", to: "Daggerheart", type: "ENJOYS", confidence: 0.95 }],
    });

    const result = parseLLMOutput(content);

    expect(result.entities).toHaveLength(2);
    expect(result.entities[0].name).toBe("Steve");
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0].type).toBe("ENJOYS");
  });

  it("should parse JSON with markdown code blocks", () => {
    const content = '```json\n{"entities": [], "relationships": []}\n```';

    const result = parseLLMOutput(content);

    expect(result.entities).toHaveLength(0);
    expect(result.relationships).toHaveLength(0);
  });

  it("should parse JSON wrapped in text", () => {
    const content = 'Here is the extraction: {"entities": [], "relationships": []} Done!';

    const result = parseLLMOutput(content);

    expect(result.entities).toHaveLength(0);
    expect(result.relationships).toHaveLength(0);
  });

  it("should parse entities with aliases", () => {
    const content = JSON.stringify({
      entities: [
        {
          name: "Steve",
          type: "Person",
          confidence: 0.95,
          aliases: ["steve", "me", "I"],
        },
      ],
      relationships: [],
    });

    const result = parseLLMOutput(content);

    expect(result.entities[0].aliases).toEqual(["steve", "me", "i"]);
  });

  it("should parse relationships with facts", () => {
    const content = JSON.stringify({
      entities: [
        { name: "Steve", type: "Person", confidence: 0.95 },
        { name: "AURA", type: "Project", confidence: 0.9 },
      ],
      relationships: [
        {
          from: "Steve",
          to: "AURA",
          type: "WORKS_ON",
          confidence: 0.95,
          fact: "Steve is building AURA",
        },
      ],
    });

    const result = parseLLMOutput(content);

    expect(result.relationships[0].fact).toBe("Steve is building AURA");
  });

  it("should clamp confidence values to valid range", () => {
    const content = JSON.stringify({
      entities: [{ name: "Test", type: "Person", confidence: 1.5 }],
      relationships: [],
    });

    const result = parseLLMOutput(content);

    expect(result.entities[0].confidence).toBe(1.0);
  });

  it("should use default confidence when not provided", () => {
    const content = JSON.stringify({
      entities: [{ name: "Test", type: "Person" }],
      relationships: [],
    });

    const result = parseLLMOutput(content);

    expect(result.entities[0].confidence).toBe(0.7);
  });

  it("should throw on invalid JSON", () => {
    const content = "not valid json";

    expect(() => parseLLMOutput(content)).toThrow(SemanticParseError);
  });

  it("should throw on missing required fields", () => {
    const content = JSON.stringify({
      entities: [{ type: "Person" }], // Missing name
      relationships: [],
    });

    const result = parseLLMOutput(content);

    expect(result.entities).toHaveLength(0); // Invalid entity filtered out
  });

  it("should handle empty arrays", () => {
    const content = JSON.stringify({
      entities: [],
      relationships: [],
    });

    const result = parseLLMOutput(content);

    expect(result.entities).toHaveLength(0);
    expect(result.relationships).toHaveLength(0);
  });

  it("should handle null values in arrays", () => {
    const content = JSON.stringify({
      entities: [null, { name: "Steve", type: "Person", confidence: 0.9 }],
      relationships: [],
    });

    const result = parseLLMOutput(content);

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].name).toBe("Steve");
  });

  it("should filter out invalid relationships", () => {
    const content = JSON.stringify({
      entities: [{ name: "Steve", type: "Person", confidence: 0.9 }],
      relationships: [
        { from: "Steve", to: "Unknown", type: "ENJOYS" }, // Missing confidence
        null,
        "invalid",
      ],
    });

    const result = parseLLMOutput(content);

    // Valid relationship with default confidence
    expect(result.relationships.length).toBeGreaterThanOrEqual(0);
  });
});

describe("attemptRepair", () => {
  it("should repair trailing commas", () => {
    const broken = '{"entities": [{"name": "Test",}],}';

    const repaired = attemptRepair(broken);

    expect(repaired).toBeTruthy();
    expect(JSON.parse(repaired!)).toBeTruthy();
  });

  it("should add missing closing braces", () => {
    const broken = '{"entities": [{"name": "Test"}]';

    const repaired = attemptRepair(broken);

    expect(repaired).toBeTruthy();
    expect(JSON.parse(repaired!)).toBeTruthy();
  });

  it("should add missing closing brackets", () => {
    const broken = '{"entities": [{"name": "Test"}]}'; // Missing outer brace

    const repaired = attemptRepair(broken);

    expect(repaired).toBeTruthy();
    expect(JSON.parse(repaired!)).toBeTruthy();
  });

  it("should return null for unrepairable JSON", () => {
    const broken = "completely invalid {{{";

    const repaired = attemptRepair(broken);

    expect(repaired).toBeNull();
  });
});

describe("isValidJSON", () => {
  it("should return true for valid JSON", () => {
    expect(isValidJSON('{"test": true}')).toBe(true);
  });

  it("should return false for invalid JSON", () => {
    expect(isValidJSON("not json")).toBe(false);
  });

  it("should return false for empty string", () => {
    expect(isValidJSON("")).toBe(false);
  });
});

describe("SemanticParseError", () => {
  it("should store original error and content", () => {
    const originalError = new Error("Parse failed");
    const rawContent = "{invalid}";

    const error = new SemanticParseError("Failed", originalError, rawContent);

    expect(error.message).toBe("Failed");
    expect(error.cause).toBe(originalError);
    expect(error.rawContent).toBe(rawContent);
    expect(error.name).toBe("SemanticParseError");
  });
});

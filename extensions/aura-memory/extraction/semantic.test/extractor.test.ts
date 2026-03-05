/**
 * Extractor Tests
 */

import { describe, it, expect, vi } from "vitest";
import {
  SemanticExtractor,
  createSemanticExtractor,
  extractSemantic,
} from "../semantic/extractor.js";
import type { SemanticExtractionInput } from "../semantic/types.js";

// Mock LLM client
const createMockLLM = (responseContent: string) => ({
  complete: vi.fn().mockResolvedValue({
    content: responseContent,
    tokensUsed: { input: 100, output: 50 },
  }),
});

describe("SemanticExtractor", () => {
  it("should extract entities and relationships successfully", async () => {
    const mockResponse = JSON.stringify({
      entities: [
        { name: "Steve", type: "Person", confidence: 0.95 },
        { name: "Daggerheart", type: "Game", confidence: 0.9 },
      ],
      relationships: [{ from: "Steve", to: "Daggerheart", type: "ENJOYS", confidence: 0.95 }],
    });

    const extractor = new SemanticExtractor({
      llm: createMockLLM(mockResponse),
    });

    const input: SemanticExtractionInput = {
      messages: [
        {
          id: "1",
          role: "user",
          content: "Steve enjoys playing Daggerheart",
          timestamp: Date.now(),
        },
      ],
    };

    const result = await extractor.extract(input);

    expect(result.success).toBe(true);
    expect(result.entities).toHaveLength(2);
    expect(result.relationships).toHaveLength(1);
    expect(result.entities[0].name).toBe("Steve");
  });

  it("should return error on invalid JSON", async () => {
    const extractor = new SemanticExtractor({
      llm: createMockLLM("invalid json"),
      attemptRepair: false,
    });

    const input: SemanticExtractionInput = {
      messages: [{ id: "1", role: "user", content: "Test", timestamp: Date.now() }],
    };

    const result = await extractor.extract(input);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.entities).toHaveLength(0);
  });

  it("should attempt repair when enabled", async () => {
    // Broken JSON with trailing comma
    const brokenResponse =
      '{"entities": [{"name": "Steve", "type": "Person", "confidence": 0.95},], "relationships": []}';

    const extractor = new SemanticExtractor({
      llm: createMockLLM(brokenResponse),
      attemptRepair: true,
    });

    const input: SemanticExtractionInput = {
      messages: [{ id: "1", role: "user", content: "Test", timestamp: Date.now() }],
    };

    const result = await extractor.extract(input);

    expect(result.success).toBe(true);
    expect(result.entities).toHaveLength(1);
  });

  it("should filter out invalid entities during validation", async () => {
    const mockResponse = JSON.stringify({
      entities: [
        { name: "Steve", type: "Person", confidence: 0.95 },
        { name: "", type: "Person", confidence: 0.9 }, // Invalid - empty name
        { name: "Invalid", type: "InvalidType", confidence: 0.8 }, // Invalid type
      ],
      relationships: [],
    });

    const extractor = new SemanticExtractor({
      llm: createMockLLM(mockResponse),
    });

    const input: SemanticExtractionInput = {
      messages: [{ id: "1", role: "user", content: "Test", timestamp: Date.now() }],
    };

    const result = await extractor.extract(input);

    expect(result.success).toBe(true);
    expect(result.entities).toHaveLength(1); // Only Steve is valid
    expect(result.entities[0].name).toBe("Steve");
  });

  it("should track token usage", async () => {
    const mockResponse = JSON.stringify({
      entities: [{ name: "Test", type: "Person", confidence: 0.9 }],
      relationships: [],
    });

    const extractor = new SemanticExtractor({
      llm: createMockLLM(mockResponse),
    });

    const input: SemanticExtractionInput = {
      messages: [{ id: "1", role: "user", content: "Test", timestamp: Date.now() }],
    };

    const result = await extractor.extract(input);

    expect(result.tokensUsed.input).toBe(100);
    expect(result.tokensUsed.output).toBe(50);
    expect(result.tokensUsed.total).toBe(150);
  });

  it("should track duration", async () => {
    const mockResponse = JSON.stringify({
      entities: [{ name: "Test", type: "Person", confidence: 0.9 }],
      relationships: [],
    });

    const extractor = new SemanticExtractor({
      llm: createMockLLM(mockResponse),
    });

    const input: SemanticExtractionInput = {
      messages: [{ id: "1", role: "user", content: "Test", timestamp: Date.now() }],
    };

    const startTime = Date.now();
    const result = await extractor.extract(input);
    const endTime = Date.now();

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.durationMs).toBeLessThanOrEqual(endTime - startTime + 10); // Allow small margin
  });

  it("should mark as validated", async () => {
    const mockResponse = JSON.stringify({
      entities: [{ name: "Test", type: "Person", confidence: 0.9 }],
      relationships: [],
    });

    const extractor = new SemanticExtractor({
      llm: createMockLLM(mockResponse),
    });

    const input: SemanticExtractionInput = {
      messages: [{ id: "1", role: "user", content: "Test", timestamp: Date.now() }],
    };

    const result = await extractor.extract(input);

    expect(result.wasValidated).toBe(true);
  });

  it("should check availability", () => {
    const withLLM = new SemanticExtractor({
      llm: createMockLLM("{}"),
    });

    expect(withLLM.isAvailable()).toBe(true);
  });

  it("should get configuration", () => {
    const extractor = new SemanticExtractor({
      llm: createMockLLM("{}"),
      maxTokens: 1500,
      temperature: 0.5,
    });

    const config = extractor.getConfig();

    expect(config.maxTokens).toBe(1500);
    expect(config.temperature).toBe(0.5);
  });
});

describe("createSemanticExtractor", () => {
  it("should create extractor with defaults", () => {
    const extractor = createSemanticExtractor(createMockLLM("{}"));

    expect(extractor).toBeInstanceOf(SemanticExtractor);
    expect(extractor.isAvailable()).toBe(true);
  });
});

describe("extractSemantic", () => {
  it("should extract using convenience function", async () => {
    const mockResponse = JSON.stringify({
      entities: [{ name: "Steve", type: "Person", confidence: 0.95 }],
      relationships: [],
    });

    const input: SemanticExtractionInput = {
      messages: [{ id: "1", role: "user", content: "Test", timestamp: Date.now() }],
    };

    const result = await extractSemantic(input, createMockLLM(mockResponse));

    expect(result.success).toBe(true);
    expect(result.entities[0].name).toBe("Steve");
  });
});

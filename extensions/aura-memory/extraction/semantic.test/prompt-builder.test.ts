/**
 * Prompt Builder Tests
 */

import { describe, it, expect } from "vitest";
import {
  buildSemanticExtractionPrompt,
  buildFocusedExtractionPrompt,
  getDefaultPromptVariables,
  formatMessages,
} from "../semantic/prompt-builder.js";
import type { SemanticPromptVariables } from "../semantic/types.js";

describe("buildSemanticExtractionPrompt", () => {
  it("should include all relationship types in prompt", () => {
    const variables: SemanticPromptVariables = {
      messages: "Test message",
      maxEntities: 10,
      maxRelationships: 15,
      relationshipOntology: "",
      entityTypes: "",
      currentTime: new Date().toISOString(),
    };

    const prompt = buildSemanticExtractionPrompt(variables);

    expect(prompt).toContain("ENJOYS");
    expect(prompt).toContain("WORKS_ON");
    expect(prompt).toContain("KNOWS");
    expect(prompt).toContain("IS_A");
  });

  it("should include entity types section", () => {
    const variables = getDefaultPromptVariables("Test");
    const prompt = buildSemanticExtractionPrompt(variables);

    expect(prompt).toContain("Person");
    expect(prompt).toContain("Project");
    expect(prompt).toContain("Technology");
  });

  it("should include extraction limits", () => {
    const variables: SemanticPromptVariables = {
      messages: "Test",
      maxEntities: 20,
      maxRelationships: 30,
      relationshipOntology: "",
      entityTypes: "",
      currentTime: new Date().toISOString(),
    };

    const prompt = buildSemanticExtractionPrompt(variables);

    expect(prompt).toContain("Maximum 20 entities");
    expect(prompt).toContain("Maximum 30 relationships");
  });

  it("should include output format", () => {
    const variables = getDefaultPromptVariables("Test");
    const prompt = buildSemanticExtractionPrompt(variables);

    expect(prompt).toContain("OUTPUT FORMAT (JSON)");
    expect(prompt).toContain('"entities"');
    expect(prompt).toContain('"relationships"');
  });

  it("should include conversation messages", () => {
    const variables: SemanticPromptVariables = {
      messages: "[2024-01-01] USER: Hello\n[2024-01-01] ASSISTANT: Hi there",
      maxEntities: 10,
      maxRelationships: 15,
      relationshipOntology: "",
      entityTypes: "",
      currentTime: new Date().toISOString(),
    };

    const prompt = buildSemanticExtractionPrompt(variables);

    expect(prompt).toContain("CONVERSATION TO ANALYZE");
    expect(prompt).toContain("USER: Hello");
    expect(prompt).toContain("ASSISTANT: Hi there");
  });

  it("should include examples for relationships", () => {
    const variables = getDefaultPromptVariables("Test");
    const prompt = buildSemanticExtractionPrompt(variables);

    expect(prompt).toContain("Examples:");
    expect(prompt).toContain("Steve ENJOYS Daggerheart");
  });
});

describe("buildFocusedExtractionPrompt", () => {
  it("should use lower limits for focused mode", () => {
    const variables: SemanticPromptVariables = {
      messages: "Test",
      maxEntities: 20,
      maxRelationships: 30,
      relationshipOntology: "",
      entityTypes: "",
      currentTime: new Date().toISOString(),
    };

    const prompt = buildFocusedExtractionPrompt(variables);

    expect(prompt).toContain("FOCUSED MODE");
    expect(prompt).toContain("Maximum 10 entities");
    expect(prompt).toContain("Maximum 15 relationships");
  });
});

describe("getDefaultPromptVariables", () => {
  it("should set default values", () => {
    const variables = getDefaultPromptVariables("Test messages");

    expect(variables.messages).toBe("Test messages");
    expect(variables.maxEntities).toBe(20);
    expect(variables.maxRelationships).toBe(30);
    expect(variables.currentTime).toBeDefined();
  });
});

describe("formatMessages", () => {
  it("should format messages with timestamps", () => {
    const messages = [
      {
        id: "1",
        role: "user",
        content: "Hello",
        timestamp: new Date("2024-01-01T12:00:00Z").getTime(),
      },
      {
        id: "2",
        role: "assistant",
        content: "Hi there",
        timestamp: new Date("2024-01-01T12:01:00Z").getTime(),
      },
    ];

    const formatted = formatMessages(messages);

    expect(formatted).toContain("[2024-01-01T12:00:00.000Z] USER: Hello");
    expect(formatted).toContain("[2024-01-01T12:01:00.000Z] ASSISTANT: Hi there");
  });

  it("should escape special characters in content", () => {
    const messages = [
      {
        id: "1",
        role: "user",
        content: 'Say "hello" and \\test',
        timestamp: Date.now(),
      },
    ];

    const formatted = formatMessages(messages);

    expect(formatted).toContain('\\"hello\\"');
    expect(formatted).toContain("\\\\test");
  });

  it("should limit content length", () => {
    const longContent = "a".repeat(3000);
    const messages = [
      {
        id: "1",
        role: "user",
        content: longContent,
        timestamp: Date.now(),
      },
    ];

    const formatted = formatMessages(messages);

    expect(formatted.length).toBeLessThan(2500);
  });
});

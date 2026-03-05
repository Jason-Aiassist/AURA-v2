/**
 * Semantic Extraction Prompt Builder
 * Builds prompts for LLM-based semantic relationship extraction
 */

import { SEMANTIC_RELATIONSHIPS, RELATIONSHIP_TYPES } from "../../graph/ontology/constants.js";
import { getExamples } from "../../graph/ontology/validators.js";
import type { SemanticPromptVariables } from "./types.js";

/**
 * Build semantic extraction prompt
 * @param variables - Prompt variables
 * @returns Complete prompt string
 */
export function buildSemanticExtractionPrompt(variables: SemanticPromptVariables): string {
  return `${SEMATIC_EXTRACTION_INTRO}

${buildRelationshipOntologySection()}

${buildEntityTypesSection()}

${buildInstructionsSection(variables)}

CONVERSATION TO ANALYZE:
${variables.messages}

${buildOutputFormatSection(variables)}

REMEMBER: Output ONLY valid JSON. No markdown code blocks, no explanations before or after.`;
}

/**
 * Prompt introduction
 */
const SEMATIC_EXTRACTION_INTRO = `You are a semantic extraction assistant. Analyze the conversation and extract entities and their relationships.

Your task:
1. Identify all important entities (people, projects, technologies, etc.)
2. Extract semantic relationships between these entities
3. Provide confidence scores for each extraction`;

/**
 * Build relationship ontology section
 */
function buildRelationshipOntologySection(): string {
  const relationshipDescriptions = RELATIONSHIP_TYPES.map((type) => {
    const meta = SEMANTIC_RELATIONSHIPS[type];
    const examples = meta.examples.slice(0, 2).join("; ");
    return `- ${type}: ${meta.description}
  Domain: ${meta.domain.join(", ")}
  Range: ${meta.range.join(", ")}
  Examples: "${examples}"`;
  }).join("\n\n");

  return `RELATIONSHIP TYPES:

${relationshipDescriptions}`;
}

/**
 * Build entity types section
 */
function buildEntityTypesSection(): string {
  return `ENTITY TYPES:

- Person: Human individuals (e.g., "Steve", "Alice")
- Project: Software projects, initiatives (e.g., "AURA", "OpenClaw")
- Technology: Tools, frameworks, languages (e.g., "Neo4j", "TypeScript")
- Activity: Actions, hobbies (e.g., "programming", "hiking")
- Thing: Physical or conceptual objects
- Game: Games, sports (e.g., "Daggerheart", "chess")
- Category: Classifications (e.g., "TTRPG", "database")
- Organization: Companies, groups (e.g., "OpenAI", "team")
- Location: Places (e.g., "London", "office")
- Domain: Knowledge areas (e.g., "machine learning", "web dev")
- Skill: Abilities (e.g., "public speaking", "debugging")

ENTITY ALIASES:
For Person entities, include common aliases:
- "Steve" might have aliases: ["steve", "user", "me", "I"]
- These help with pronoun resolution later`;
}

/**
 * Build instructions section
 */
function buildInstructionsSection(variables: SemanticPromptVariables): string {
  return `EXTRACTION INSTRUCTIONS:

1. ENTITIES:
   - Extract up to ${variables.maxEntities} important entities
   - Include people, projects, technologies, activities mentioned
   - For the main user (often "Steve"), include aliases like ["me", "I", "user"]
   - Assign appropriate entity types
   - Confidence scoring:
     * 0.9-1.0: Explicitly named, clear context
     * 0.75-0.89: Strongly implied, consistent references
     * 0.5-0.74: Mentioned but context unclear
     * Below 0.5: Skip

2. RELATIONSHIPS:
   - Extract up to ${variables.maxRelationships} semantic relationships
   - Use ONLY the relationship types listed above
   - Ensure entities in relationships are also in the entities list
   - Confidence scoring same as entities
   - Include "fact" field with supporting text evidence

3. IMPORTANT RULES:
   - Only extract facts stated or strongly implied in conversation
   - Do not infer beyond what's supported by text
   - Use exact entity names (match entities list)
   - Validate relationship types match domain/range constraints`;
}

/**
 * Build output format section
 */
function buildOutputFormatSection(variables: SemanticPromptVariables): string {
  return `OUTPUT FORMAT (JSON):

{
  "entities": [
    {
      "name": "Entity Name",
      "type": "Person|Project|Technology|...",
      "confidence": 0.95,
      "aliases": ["alias1", "alias2"],
      "summary": "Brief description (optional)"
    }
  ],
  "relationships": [
    {
      "from": "Source Entity Name",
      "to": "Target Entity Name",
      "type": "ENJOYS|WORKS_ON|KNOWS|...",
      "confidence": 0.90,
      "fact": "Evidence text from conversation"
    }
  ]
}

EXTRACTION LIMITS:
- Maximum ${variables.maxEntities} entities
- Maximum ${variables.maxRelationships} relationships
- Minimum confidence: 0.5 (skip lower)`;
}

/**
 * Build focused extraction prompt (fewer entities, higher precision)
 * @param variables - Prompt variables
 * @returns Focused prompt
 */
export function buildFocusedExtractionPrompt(variables: SemanticPromptVariables): string {
  const focusedVars = {
    ...variables,
    maxEntities: Math.min(variables.maxEntities, 10),
    maxRelationships: Math.min(variables.maxRelationships, 15),
  };

  return (
    buildSemanticExtractionPrompt(focusedVars) +
    `

FOCUSED MODE: Prioritize high-confidence extractions only (0.8+).`
  );
}

/**
 * Get default prompt variables
 * @param messages - Formatted messages
 * @returns Default variables
 */
export function getDefaultPromptVariables(messages: string): SemanticPromptVariables {
  return {
    messages,
    maxEntities: 20,
    maxRelationships: 30,
    relationshipOntology: "", // Generated in builder
    entityTypes: "", // Generated in builder
    currentTime: new Date().toISOString(),
  };
}

/**
 * Format messages for prompt
 * @param messages - Raw messages
 * @returns Formatted string
 */
export function formatMessages(
  messages: Array<{ id: string; role: string; content: string; timestamp: number }>,
): string {
  return messages
    .map(
      (m) =>
        `[${new Date(m.timestamp).toISOString()}] ${m.role.toUpperCase()}: ${escapeContent(
          m.content,
        )}`,
    )
    .join("\n");
}

/**
 * Escape content to prevent prompt injection
 * @param content - Raw content
 * @returns Escaped content
 */
function escapeContent(content: string): string {
  // Remove control characters and escape quotes
  return content
    .replace(/[\x00-\x1F\x7F]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .substring(0, 2000); // Limit length
}

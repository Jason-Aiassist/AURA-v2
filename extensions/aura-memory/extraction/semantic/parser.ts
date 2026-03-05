/**
 * Semantic Extraction Parser
 * Parses LLM output into structured semantic extraction results
 */

import { createLogger } from "../../shared/debug-logger.js";
import type {
  RawSemanticExtractionOutput,
  SemanticExtractedEntity,
  SemanticExtractedRelationship,
  SemanticExtractionResult,
} from "./types.js";

const logger = createLogger("SemanticParser");

/**
 * Parse LLM response content
 * @param content - Raw LLM output
 * @returns Parsed extraction result
 */
export function parseLLMOutput(content: string): SemanticExtractionResult {
  logger.start("parseLLMOutput", { contentLength: content.length });

  try {
    // Clean up markdown code blocks if present
    const cleaned = cleanupMarkdown(content);
    logger.progress("cleaned-content", { cleanedLength: cleaned.length });

    // Parse JSON
    const parsed = JSON.parse(cleaned) as RawSemanticExtractionOutput;
    logger.progress("parsed-json", {
      entityCount: parsed.entities?.length ?? 0,
      relationshipCount: parsed.relationships?.length ?? 0,
    });

    // Transform to structured format
    const result = transformParsedOutput(parsed);
    logger.success({
      entitiesExtracted: result.entities.length,
      relationshipsExtracted: result.relationships.length,
    });

    return result;
  } catch (error) {
    logger.error(error as Error, {
      contentPreview: content.substring(0, 200),
      errorType: error instanceof SyntaxError ? "json_parse" : "unknown",
    });
    throw new SemanticParseError("Failed to parse LLM output", error as Error, content);
  }
}

/**
 * Clean up markdown code blocks and extra content
 * @param content - Raw content
 * @returns Cleaned JSON string
 */
function cleanupMarkdown(content: string): string {
  // Remove markdown code block markers
  let cleaned = content
    .replace(/```json\s*/gi, "")
    .replace(/```\s*$/gi, "")
    .replace(/```/g, "");

  // Trim whitespace
  cleaned = cleaned.trim();

  // Extract JSON object if wrapped in text
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    cleaned = jsonMatch[0];
  }

  return cleaned;
}

/**
 * Transform raw parsed output to structured format
 * @param parsed - Raw parsed output
 * @returns Structured extraction result
 */
function transformParsedOutput(parsed: RawSemanticExtractionOutput): SemanticExtractionResult {
  const entities = parseEntities(parsed.entities ?? []);
  const relationships = parseRelationships(parsed.relationships ?? []);

  return {
    entities,
    relationships,
    metadata: {
      durationMs: 0, // Will be set by caller
      tokensUsed: { input: 0, output: 0, total: 0 }, // Will be set by caller
      wasValidated: false, // Will be set by validator
    },
  };
}

/**
 * Parse entity array
 * @param rawEntities - Raw entity array
 * @returns Parsed entities
 */
function parseEntities(
  rawEntities: RawSemanticExtractionOutput["entities"],
): SemanticExtractedEntity[] {
  if (!Array.isArray(rawEntities)) {
    logger.progress("parse-entities", { warning: "entities is not an array" });
    return [];
  }

  return rawEntities
    .map((e, index) => parseSingleEntity(e, index))
    .filter((e): e is SemanticExtractedEntity => e !== null);
}

/**
 * Parse single entity
 * @param raw - Raw entity
 * @param index - Entity index for logging
 * @returns Parsed entity or null if invalid
 */
function parseSingleEntity(
  raw: RawSemanticExtractionOutput["entities"][0],
  index: number,
): SemanticExtractedEntity | null {
  if (!raw || typeof raw !== "object") {
    logger.progress("parse-entity", { index, error: "not an object" });
    return null;
  }

  // Validate required fields
  if (!raw.name || typeof raw.name !== "string") {
    logger.progress("parse-entity", { index, error: "missing or invalid name" });
    return null;
  }

  if (!raw.type || typeof raw.type !== "string") {
    logger.progress("parse-entity", { index, error: "missing or invalid type" });
    return null;
  }

  // Parse confidence with default
  let confidence = 0.7;
  if (typeof raw.confidence === "number") {
    confidence = Math.max(0, Math.min(1, raw.confidence));
  }

  // Parse aliases
  const aliases = parseAliases(raw.aliases);

  return {
    name: raw.name.trim(),
    type: raw.type.trim() as SemanticExtractedEntity["type"],
    confidence,
    aliases: aliases.length > 0 ? aliases : undefined,
    summary: raw.summary?.trim() || undefined,
  };
}

/**
 * Parse aliases array
 * @param rawAliases - Raw aliases
 * @returns Parsed aliases
 */
function parseAliases(rawAliases: unknown): string[] {
  if (!Array.isArray(rawAliases)) {
    return [];
  }

  return rawAliases
    .filter((a): a is string => typeof a === "string")
    .map((a) => a.trim().toLowerCase())
    .filter((a) => a.length > 0);
}

/**
 * Parse relationship array
 * @param rawRelationships - Raw relationship array
 * @returns Parsed relationships
 */
function parseRelationships(
  rawRelationships: RawSemanticExtractionOutput["relationships"],
): SemanticExtractedRelationship[] {
  if (!Array.isArray(rawRelationships)) {
    logger.progress("parse-relationships", { warning: "relationships is not an array" });
    return [];
  }

  return rawRelationships
    .map((r, index) => parseSingleRelationship(r, index))
    .filter((r): r is SemanticExtractedRelationship => r !== null);
}

/**
 * Parse single relationship
 * @param raw - Raw relationship
 * @param index - Relationship index for logging
 * @returns Parsed relationship or null if invalid
 */
function parseSingleRelationship(
  raw: RawSemanticExtractionOutput["relationships"][0],
  index: number,
): SemanticExtractedRelationship | null {
  if (!raw || typeof raw !== "object") {
    logger.progress("parse-relationship", { index, error: "not an object" });
    return null;
  }

  // Validate required fields
  if (!raw.from || typeof raw.from !== "string") {
    logger.progress("parse-relationship", { index, error: "missing or invalid from" });
    return null;
  }

  if (!raw.to || typeof raw.to !== "string") {
    logger.progress("parse-relationship", { index, error: "missing or invalid to" });
    return null;
  }

  if (!raw.type || typeof raw.type !== "string") {
    logger.progress("parse-relationship", { index, error: "missing or invalid type" });
    return null;
  }

  // Parse confidence with default
  let confidence = 0.7;
  if (typeof raw.confidence === "number") {
    confidence = Math.max(0, Math.min(1, raw.confidence));
  }

  return {
    from: raw.from.trim(),
    to: raw.to.trim(),
    type: raw.type.trim() as SemanticExtractedRelationship["type"],
    confidence,
    fact: raw.fact?.trim() || undefined,
  };
}

/**
 * Custom parse error with context
 */
export class SemanticParseError extends Error {
  constructor(
    message: string,
    public readonly cause: Error,
    public readonly rawContent: string,
  ) {
    super(message);
    this.name = "SemanticParseError";
  }
}

/**
 * Check if output is valid JSON structure
 * @param content - Content to check
 * @returns Validation result
 */
export function isValidJSON(content: string): boolean {
  try {
    JSON.parse(content);
    return true;
  } catch {
    return false;
  }
}

/**
 * Attempt to repair malformed JSON
 * @param content - Malformed content
 * @returns Repaired content or null
 */
export function attemptRepair(content: string): string | null {
  logger.start("attemptRepair", { contentLength: content.length });

  try {
    // Try removing trailing commas
    let repaired = content.replace(/,\s*([}\]])/g, "$1");

    // Try adding missing closing braces
    const openBraces = (repaired.match(/\{/g) || []).length;
    const closeBraces = (repaired.match(/\}/g) || []).length;
    if (openBraces > closeBraces) {
      repaired += "}".repeat(openBraces - closeBraces);
    }

    // Try adding missing closing brackets (before braces for proper nesting)
    const openBrackets = (repaired.match(/\[/g) || []).length;
    const closeBrackets = (repaired.match(/\]/g) || []).length;
    if (openBrackets > closeBrackets) {
      repaired += "]".repeat(openBrackets - closeBrackets);
    }

    // Re-count braces after adding brackets (content may have changed)
    const finalOpenBraces = (repaired.match(/\{/g) || []).length;
    const finalCloseBraces = (repaired.match(/\}/g) || []).length;
    if (finalOpenBraces > finalCloseBraces) {
      repaired += "}".repeat(finalOpenBraces - finalCloseBraces);
    }

    // Validate
    JSON.parse(repaired);
    logger.success({ repaired: true });
    return repaired;
  } catch (error) {
    logger.error(error as Error, { repairFailed: true });
    return null;
  }
}

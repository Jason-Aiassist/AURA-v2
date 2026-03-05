// Output Validator
// Story 3.1: LLM-Based Extraction Engine

import type { MemoryCategory } from "../categories/types.js";
import type { RawExtractionOutput, MemoryExtraction } from "./types.js";

/**
 * Validation error
 */
export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  data?: {
    memories: MemoryExtraction[];
    entities?: unknown[];
    relationships?: unknown[];
  };
}

/**
 * Valid memory categories
 */
const VALID_CATEGORIES: MemoryCategory[] = [
  "User",
  "FutureTask",
  "CurrentProject",
  "SelfImprovement",
  "KnowledgeBase",
];

/**
 * Validate raw LLM output
 */
export function validateRawOutput(raw: unknown, messageIds: Set<string>): ValidationResult {
  const errors: ValidationError[] = [];

  // Check if raw is an object
  if (!raw || typeof raw !== "object") {
    return {
      valid: false,
      errors: [{ field: "root", message: "Output must be an object" }],
    };
  }

  const rawObj = raw as RawExtractionOutput;

  // Check memories array exists
  if (!rawObj.memories || !Array.isArray(rawObj.memories)) {
    return {
      valid: false,
      errors: [{ field: "memories", message: "memories must be an array" }],
    };
  }

  // Validate each memory
  const validMemories: MemoryExtraction[] = [];

  for (let i = 0; i < rawObj.memories.length; i++) {
    const memory = rawObj.memories[i];
    const memoryErrors = validateMemory(memory, i, messageIds);

    if (memoryErrors.length === 0) {
      validMemories.push(memory as MemoryExtraction);
    } else {
      errors.push(...memoryErrors);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    data: {
      memories: validMemories,
      entities: rawObj.entities || [],
      relationships: rawObj.relationships || [],
    },
  };
}

/**
 * Validate a single memory extraction
 */
function validateMemory(
  memory: unknown,
  index: number,
  messageIds: Set<string>,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const prefix = `memories[${index}]`;

  if (!memory || typeof memory !== "object") {
    return [{ field: prefix, message: "Memory must be an object" }];
  }

  const m = memory as Record<string, unknown>;

  // Validate content
  if (!m.content || typeof m.content !== "string") {
    errors.push({
      field: `${prefix}.content`,
      message: "content is required and must be a string",
    });
  } else {
    if (m.content.length < 5) {
      errors.push({ field: `${prefix}.content`, message: "content must be at least 5 characters" });
    }
    if (m.content.length > 500) {
      errors.push({
        field: `${prefix}.content`,
        message: "content must be at most 500 characters",
      });
    }
  }

  // Validate category
  if (!m.category || typeof m.category !== "string") {
    errors.push({ field: `${prefix}.category`, message: "category is required" });
  } else if (!VALID_CATEGORIES.includes(m.category as MemoryCategory)) {
    errors.push({
      field: `${prefix}.category`,
      message: `category must be one of: ${VALID_CATEGORIES.join(", ")}`,
    });
  }

  // Validate confidence
  if (typeof m.confidence !== "number") {
    errors.push({
      field: `${prefix}.confidence`,
      message: "confidence is required and must be a number",
    });
  } else if (m.confidence < 0 || m.confidence > 1) {
    errors.push({ field: `${prefix}.confidence`, message: "confidence must be between 0 and 1" });
  }

  // Validate reasoning (optional but recommended)
  if (m.reasoning && typeof m.reasoning !== "string") {
    errors.push({
      field: `${prefix}.reasoning`,
      message: "reasoning must be a string if provided",
    });
  }

  // Validate sourceMessageIds
  if (!m.sourceMessageIds || !Array.isArray(m.sourceMessageIds)) {
    errors.push({
      field: `${prefix}.sourceMessageIds`,
      message: "sourceMessageIds must be an array",
    });
  } else {
    // Check that all referenced message IDs exist
    for (const msgId of m.sourceMessageIds) {
      if (typeof msgId !== "string") {
        errors.push({
          field: `${prefix}.sourceMessageIds`,
          message: "all sourceMessageIds must be strings",
        });
        break;
      }
      if (!messageIds.has(msgId)) {
        errors.push({
          field: `${prefix}.sourceMessageIds`,
          message: `referenced message ID "${msgId}" not found in input`,
        });
      }
    }
  }

  return errors;
}

/**
 * Sanitize and repair common LLM output issues
 * Handles markdown code blocks, trailing commas, and common LLM formatting quirks
 */
export function sanitizeOutput(raw: string): string {
  let cleaned = raw;

  // Step 1: Extract content from markdown code blocks
  // Match ```json ... ``` or ``` ... ``` patterns with multiline support
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/;
  const match = cleaned.match(codeBlockRegex);
  if (match && match[1]) {
    cleaned = match[1].trim();
  }

  // Step 2: Remove any remaining backtick fences (in case of malformed blocks)
  cleaned = cleaned.replace(/^```[a-z]*\s*/gim, "");
  cleaned = cleaned.replace(/```\s*$/gim, "");
  cleaned = cleaned.replace(/```/g, "");

  // Step 3: Remove common LLM prefixes/suffixes
  cleaned = cleaned.replace(/^\s*Here is the JSON:\s*/i, "");
  cleaned = cleaned.replace(/^\s*Output:\s*/i, "");
  cleaned = cleaned.replace(/^\s*Response:\s*/i, "");
  cleaned = cleaned.replace(/\s*\(end of response\)\s*$/i, "");

  // Step 4: Remove leading/trailing whitespace
  cleaned = cleaned.trim();

  // Step 5: Fix common JSON syntax issues
  // Remove trailing commas before } or ]
  cleaned = cleaned.replace(/,\s*([}\]])/g, "$1");
  // Fix missing commas between objects in arrays
  cleaned = cleaned.replace(/}\s*{/g, "},{");
  // Fix single quotes to double quotes (common LLM mistake)
  cleaned = cleaned.replace(/'([^']*)':/g, '"$1":');
  cleaned = cleaned.replace(/: '([^']*)'/g, ': "$1"');

  return cleaned;
}

/**
 * Parse LLM output with error handling
 */
export function parseLLMOutput(raw: string): { success: boolean; data?: unknown; error?: string } {
  try {
    const sanitized = sanitizeOutput(raw);
    const parsed = JSON.parse(sanitized);
    return { success: true, data: parsed };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to parse JSON",
    };
  }
}

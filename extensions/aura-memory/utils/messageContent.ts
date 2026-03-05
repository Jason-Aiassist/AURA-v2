/**
 * Message Content Utilities
 *
 * Handles extraction of text content from messages in various formats.
 * OpenClaw core may change message formats, this provides a stable interface.
 */

/**
 * Content part from array-based message content
 */
export interface ContentPart {
  type: string;
  text?: string;
  thinking?: string;
  toolCall?: unknown;
  toolResult?: unknown;
}

/**
 * Extract text content from a message content field.
 * Handles multiple formats:
 * - String: "Hello world"
 * - Array: [{type: "text", text: "Hello"}, {type: "thinking", ...}]
 * - Object with text property
 *
 * @param content - The message content (string, array, or object)
 * @param options - Extraction options
 * @returns Extracted text or null if no valid content
 */
export function extractTextContent(
  content: unknown,
  options: {
    /** Skip thinking blocks (internal reasoning) */
    skipThinking?: boolean;
    /** Skip tool calls/results */
    skipTools?: boolean;
    /** Join character for multiple text parts */
    joinChar?: string;
  } = {},
): string | null {
  const { skipThinking = true, skipTools = true, joinChar = " " } = options;

  // Handle string content (traditional format)
  if (typeof content === "string") {
    return content.trim() || null;
  }

  // Handle array content (new OpenClaw format)
  if (Array.isArray(content)) {
    const texts: string[] = [];

    for (const part of content) {
      if (!part || typeof part !== "object") {
        continue;
      }

      const partType = (part as ContentPart).type;

      // Skip thinking blocks if requested
      if (skipThinking && partType === "thinking") {
        continue;
      }

      // Skip tool calls/results if requested
      if (skipTools && (partType === "toolCall" || partType === "toolResult")) {
        continue;
      }

      // Extract text from text parts
      if (partType === "text") {
        const text = (part as ContentPart).text;
        if (text && typeof text === "string") {
          texts.push(text);
        }
      }
    }

    return texts.join(joinChar).trim() || null;
  }

  // Handle object with text property
  if (content && typeof content === "object" && "text" in content) {
    const text = (content as { text: unknown }).text;
    if (typeof text === "string") {
      return text.trim() || null;
    }
  }

  // Handle null/undefined
  return null;
}

/**
 * Format a message for extraction/conversation context.
 * Handles the conversion from internal message format to extraction text.
 *
 * @param role - Message role (user, assistant, system)
 * @param content - Message content
 * @returns Formatted line like "user: message text" or null if no content
 */
export function formatMessageForExtraction(role: string, content: unknown): string | null {
  const text = extractTextContent(content);
  if (!text) {
    return null;
  }
  return `${role}: ${text}`;
}

/**
 * Build conversation text from an array of messages.
 * Filters out messages with no extractable content.
 *
 * @param messages - Array of messages with role and content
 * @returns Combined conversation text
 */
export function buildConversationText(messages: Array<{ role: string; content: unknown }>): string {
  const lines: string[] = [];

  for (const message of messages) {
    const formatted = formatMessageForExtraction(message.role, message.content);
    if (formatted) {
      lines.push(formatted);
    }
  }

  return lines.join("\n\n");
}

/**
 * Detect if content is in the new array format.
 * Useful for logging/debugging format changes.
 *
 * @param content - The message content
 * @returns Object describing the format
 */
export function detectContentFormat(content: unknown): {
  format: "string" | "array" | "object" | "unknown";
  hasThinking: boolean;
  hasToolCalls: boolean;
  hasText: boolean;
  partCount: number;
} {
  const result = {
    format: "unknown" as const,
    hasThinking: false,
    hasToolCalls: false,
    hasText: false,
    partCount: 0,
  };

  if (typeof content === "string") {
    result.format = "string";
    result.hasText = content.length > 0;
    result.partCount = 1;
  } else if (Array.isArray(content)) {
    result.format = "array";
    result.partCount = content.length;

    for (const part of content) {
      if (part && typeof part === "object") {
        const partType = (part as ContentPart).type;
        if (partType === "thinking") {
          result.hasThinking = true;
        } else if (partType === "toolCall" || partType === "toolResult") {
          result.hasToolCalls = true;
        } else if (partType === "text") {
          result.hasText = true;
        }
      }
    }
  } else if (content && typeof content === "object") {
    result.format = "object";
    result.partCount = 1;
    result.hasText = "text" in content;
  }

  return result;
}

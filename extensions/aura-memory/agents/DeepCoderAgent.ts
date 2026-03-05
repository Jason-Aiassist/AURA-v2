// DeepCoderAgent - Core "Brain" of Memory System
// Implements PRD Section 3.1.3: Classification, Extraction, Duplicate Check, Summarize

import { createExtractionLLMClient, type LLMClient } from "../adapters/llmClient.js";
import type { MemoryCategory } from "../categories/types.js";
import { buildConversationText, detectContentFormat } from "../utils/messageContent.js";
import { extractTags } from "../utils/tagExtractor.js";

export interface ExtractedEntity {
  name: string;
  type: string;
  aliases?: string[];
}

export interface ExtractedRelationship {
  from: string;
  to: string;
  type: string;
  confidence: number;
}

export interface ExtractionResult {
  success: boolean;
  memories: Array<{
    id: string;
    content: string;
    category: MemoryCategory;
    confidence: number;
    importance: number;
    reasoning: string;
    sourceMessageIds: string[];
  }>;
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
  durationMs: number;
  tokensUsed?: { input: number; output: number };
}

export interface ClassificationResult {
  /** 6-category classification */
  category:
    | "User"
    | "Future Tasks"
    | "Current Tasks"
    | "Self Improvement"
    | "Knowledge Base"
    | "Uncategorized";
  /** Confidence 0.0-1.0 */
  confidence: number;
  /** Storage tier based on category */
  tier: "hot" | "warm" | "cold";
  /** Extracted entities */
  entities: Array<{ name: string; type: string }>;
  /** 1-2 sentence summary */
  summary: string;
}

export interface DeepCoderAgentConfig {
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Strip markdown code fences from LLM response
 * Handles ```json, ```, and other code fence formats
 */
function stripMarkdownFences(content: string): string {
  // Match code fences at start and end
  const fencePattern = /^\s*```(?:\w+)?\s*([\s\S]*?)\s*```\s*$/;
  const match = content.match(fencePattern);
  if (match) {
    return match[1].trim();
  }
  // Also try to extract from partial fences
  const partialStart = content.indexOf("```");
  const partialEnd = content.lastIndexOf("```");
  if (partialStart !== -1 && partialEnd !== -1 && partialStart < partialEnd) {
    const afterStart = content.indexOf("\n", partialStart);
    if (afterStart !== -1 && afterStart < partialEnd) {
      return content.substring(afterStart, partialEnd).trim();
    }
  }
  return content.trim();
}

/**
 * DeepCoderAgent - Core intelligence for memory system
 *
 * Responsibilities:
 * 1. Classify content into 6 categories (PRD 3.2)
 * 2. Extract entities semantically
 * 3. Check for duplicates
 * 4. Generate summaries
 */
export class DeepCoderAgent {
  private llmClient: LLMClient;

  constructor(config: DeepCoderAgentConfig = {}) {
    // Use extraction LLM client (code-weaver.co.uk endpoint)
    // Uses DEEPCODER_LLM_* environment variables
    this.llmClient = createExtractionLLMClient();
  }

  /**
   * Classify content into 6 categories per PRD Section 3.2
   */
  async classify(content: string): Promise<ClassificationResult> {
    const prompt = `Analyze this message and classify it into EXACTLY ONE category:

Categories:
1. User - Facts/preferences about Steve (e.g., "I like Python", "My birthday is...")
2. Future Tasks - Commitments/deadlines (e.g., "Call dentist Tuesday", "Meeting tomorrow")
3. Current Tasks - Active work (e.g., "Debugging Neo4j", "Working on project X")
4. Self Improvement - Feedback on assistant (e.g., "Be more concise", "Use bullet points")
5. Knowledge Base - Researched facts (e.g., "Kubernetes uses etcd", "Paris is in France")
6. Uncategorized - Low confidence or ambiguous

Message: "${content}"

Respond in JSON format:
{
  "category": "CategoryName",
  "confidence": 0.95,
  "tier": "hot|warm|cold",
  "entities": [{"name": "entity", "type": "Person|Place|Thing|Date"}],
  "summary": "1-2 sentence summary"
}

Rules:
- tier: User=hot, Current Tasks=hot, Future Tasks=warm, Self Improvement=hot, Knowledge Base=cold, Uncategorized=warm
- confidence: 0.0-1.0 based on clarity of classification
- entities: Extract key nouns, names, dates
- summary: Capture the key information in 1-2 sentences`;

    try {
      const response = await this.llmClient.complete({
        prompt,
        maxTokens: 500,
        temperature: 0.1, // Low temp for consistent classification
      });

      const cleanContent = stripMarkdownFences(response.content);
      const result = JSON.parse(cleanContent);

      return {
        category: result.category,
        confidence: result.confidence,
        tier: result.tier,
        entities: result.entities || [],
        summary: result.summary,
      };
    } catch (error) {
      // Fallback to Uncategorized on LLM failure
      console.error("[DeepCoderAgent] Classification failed:", error);
      return {
        category: "Uncategorized",
        confidence: 0.0,
        tier: "warm",
        entities: [],
        summary: content.substring(0, 100),
      };
    }
  }

  /**
   * Extract entities using LLM (semantic understanding)
   */
  async extractEntities(
    content: string,
  ): Promise<Array<{ name: string; type: string; confidence: number }>> {
    const prompt = `Extract named entities from this text:

Text: "${content}"

Extract:
- People (names)
- Places (locations)
- Organizations
- Dates/Time references
- Technical terms
- Projects

Respond in JSON:
{
  "entities": [
    {"name": "entity name", "type": "Person|Place|Organization|Date|TechTerm|Project", "confidence": 0.95}
  ]
}`;

    try {
      const response = await this.llmClient.complete({
        prompt,
        maxTokens: 300,
        temperature: 0.1,
      });

      const cleanContent = stripMarkdownFences(response.content);
      const result = JSON.parse(cleanContent);
      return result.entities || [];
    } catch (error) {
      console.error("[DeepCoderAgent] Entity extraction failed:", error);
      return [];
    }
  }

  /**
   * Check for semantic duplicates
   */
  async checkDuplicates(
    content: string,
    existingMemories: string[],
  ): Promise<{ isDuplicate: boolean; similarity: number; matchedMemory?: string }> {
    if (existingMemories.length === 0) {
      return { isDuplicate: false, similarity: 0 };
    }

    const prompt = `Compare this new memory to existing memories and check for semantic duplicates:

New Memory: "${content}"

Existing Memories:
${existingMemories.map((m, i) => `${i + 1}. "${m}"`).join("\n")}

Respond in JSON:
{
  "isDuplicate": true|false,
  "similarity": 0.0-1.0,
  "matchedMemory": "the matching memory text or null"
}

A duplicate means they convey the same core information, even if worded differently.`;

    try {
      const response = await this.llmClient.complete({
        prompt,
        maxTokens: 200,
        temperature: 0.1,
      });

      const cleanContent = stripMarkdownFences(response.content);
      const result = JSON.parse(cleanContent);
      return {
        isDuplicate: result.isDuplicate || false,
        similarity: result.similarity || 0,
        matchedMemory: result.matchedMemory,
      };
    } catch (error) {
      console.error("[DeepCoderAgent] Duplicate check failed:", error);
      return { isDuplicate: false, similarity: 0 };
    }
  }

  /**
   * Generate 1-2 sentence summary
   */
  async summarize(content: string): Promise<string> {
    const prompt = `Summarize this in 1-2 sentences:

${content}

Summary:`;

    try {
      const response = await this.llmClient.complete({
        prompt,
        maxTokens: 100,
        temperature: 0.3,
      });

      return response.content.trim();
    } catch (error) {
      console.error("[DeepCoderAgent] Summarization failed:", error);
      return content.substring(0, 100);
    }
  }

  /**
   * Extract memories from conversation messages
   * Used by AgentOrchestrator for the extraction pipeline
   */
  async extract(params: {
    messages: Array<{ id: string; role: string; content: string; timestamp: number }>;
    mode: string;
    userHint?: string;
    maxMemories?: number;
  }): Promise<ExtractionResult> {
    const startTime = Date.now();

    try {
      // Combine messages into a conversation context
      // Handle both string content and array content (OpenClaw format)
      const conversationText = params.messages
        .map((m) => {
          let content: string;
          if (typeof m.content === "string") {
            content = m.content;
          } else if (Array.isArray(m.content)) {
            // Extract text from array format
            content = m.content
              .filter((part: any) => part && part.type === "text" && part.text)
              .map((part: any) => part.text)
              .join(" ");
          } else {
            content = String(m.content);
          }
          return `${m.role}: ${content}`;
        })
        .join("\n\n");

      // Build extraction prompt
      const prompt = `Analyze this conversation and extract memorable information:

${conversationText}

Extract up to ${params.maxMemories || 5} important memories, plus entities and relationships.

For each memory:
- content: The factual information to remember
- category: One of [User, Future Tasks, Current Tasks, Self Improvement, Knowledge Base, Uncategorized]
- confidence: 0.0-1.0 score for certainty
- importance: 0.0-1.0 score for how much this matters for future interactions
- reasoning: Why this should be remembered
- sourceMessageIds: Which message IDs support this (use "msg-1", "msg-2", etc.)

For entities (people, projects, technologies, games, etc.):
- name: The entity name
- type: Person, Project, Technology, Game, Activity, or Thing
- aliases: Alternative names (optional)

For relationships between entities:
- from: Source entity name
- to: Target entity name
- type: Use SPECIFIC relationship types:
  * Family: FATHER, MOTHER, SISTER, BROTHER, SPOUSE, SON, DAUGHTER, PARENT, CHILD
  * Work: MANAGER, COLLEAGUE, REPORTS_TO, WORKS_WITH
  * Personal: ENJOYS, WORKS_ON, KNOWS, USES, CREATED, MAINTAINS, EXPERT_IN, LEARNING
  * Technical: BUILT_WITH, DEPENDS_ON, IS_A, PART_OF, RELATED_TO
- confidence: 0.0-1.0

IMPORTANT: For family relationships, use SPECIFIC types (FATHER, SISTER, etc.) not generic FRIENDS_WITH.
Example: If text says "my dad Ken", use type: "FATHER" not "FRIENDS_WITH".

Respond in JSON:
{
  "memories": [
    {
      "content": "memory content",
      "category": "CategoryName",
      "confidence": 0.95,
      "importance": 0.85,
      "reasoning": "why this matters",
      "sourceMessageIds": ["msg-id-1"]
    }
  ],
  "entities": [
    {
      "name": "Entity Name",
      "type": "Person|Project|Technology|Game|Activity|Thing",
      "aliases": ["alias1"]
    }
  ],
  "relationships": [
    {
      "from": "Source Entity",
      "to": "Target Entity",
      "type": "ENJOYS|WORKS_ON|KNOWS|etc",
      "confidence": 0.85
    }
  ]
}`;

      const response = await this.llmClient.complete({
        prompt,
        maxTokens: 2000,
        temperature: 0.3,
      });

      let result;
      try {
        const cleanContent = stripMarkdownFences(response.content);
        result = JSON.parse(cleanContent);
      } catch (parseError) {
        throw parseError;
      }

      const memories = (result.memories || []).map((m: Record<string, unknown>, idx: number) => ({
        id: `mem-${Date.now()}-${idx}`,
        content: String(m.content || ""),
        category: String(m.category || "Uncategorized") as MemoryCategory,
        confidence: Number(m.confidence || 0.5),
        importance: Number(m.importance || 0.5),
        reasoning: String(m.reasoning || ""),
        sourceMessageIds: Array.isArray(m.sourceMessageIds) ? m.sourceMessageIds.map(String) : [],
      }));

      // Parse entities
      const entities: ExtractedEntity[] = (result.entities || [])
        .filter((e: Record<string, unknown>) => e.name && String(e.name).trim().length > 0)
        .map((e: Record<string, unknown>) => ({
          name: String(e.name).trim(),
          type: String(e.type || "Thing"),
          aliases: Array.isArray(e.aliases) ? e.aliases.map(String) : [],
        }));

      // Parse relationships
      const relationships: ExtractedRelationship[] = (result.relationships || [])
        .filter((r: Record<string, unknown>) => r.from && r.to && r.type)
        .map((r: Record<string, unknown>) => ({
          from: String(r.from).trim(),
          to: String(r.to).trim(),
          type: String(r.type),
          confidence: Number(r.confidence || 0.8),
        }));

      return {
        success: true,
        memories,
        entities,
        relationships,
        durationMs: Date.now() - startTime,
        tokensUsed: response.tokensUsed || { input: 0, output: 0 },
      };
    } catch (error) {
      console.error("[DeepCoderAgent] Extraction failed:", error);
      return {
        success: false,
        memories: [],
        entities: [],
        relationships: [],
        durationMs: Date.now() - startTime,
      };
    }
  }
}

// Export singleton for easy use
export const deepCoderAgent = new DeepCoderAgent();

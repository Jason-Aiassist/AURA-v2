// Prompt Builder
// Story 3.1: LLM-Based Extraction Engine

import type { PromptVariables } from "./types.js";

/**
 * Default extraction prompt template
 */
const EXTRACTION_PROMPT_TEMPLATE = `CRITICAL: Output ONLY raw JSON. No markdown code blocks (\`\`\`json), no backticks, no explanations before or after.

You are a memory extraction assistant. Analyze the conversation below and extract memorable facts, preferences, tasks, and knowledge.

CONVERSATION:
{{messages}}

{{userHint}}

INSTRUCTIONS:
- Extract up to {{maxMemories}} memories from this conversation
- Only extract information that would be valuable to remember for future interactions
- Assign each memory to ONE category:
  - User: Personal preferences, facts about the user
  - FutureTask: Tasks, reminders, things to do later
  - CurrentProject: Active work, projects, ongoing context
  - SelfImprovement: Goals, habits, learning
  - KnowledgeBase: General facts, reference information

- Confidence scoring (0.0-1.0):
  - 0.9-1.0: Explicitly stated facts, clear preferences
  - 0.75-0.89: Strongly implied information, consistent patterns
  - 0.5-0.74: Suggested but not confirmed
  - Below 0.5: Do not extract

- Importance scoring (0.0-1.0):
  - 0.9-1.0: Critical user info (name, major preferences, important tasks)
  - 0.7-0.89: Useful context (projects, regular interests)
  - 0.4-0.69: Minor details (casual mentions)
  - Below 0.4: Not worth remembering

- Requirements for extraction:
  - Must have supporting evidence in conversation
  - Must be relevant for future interactions
  - Must be factual (not speculative)
  - CAN extract hobby lists, interests, and preferences even if presented casually
  - CAN extract multiple related facts from the same message (e.g., "I like X, Y, and Z" → 3 separate memories)
  - Personal interests/hobbies are valuable even if mentioned in passing

EXAMPLES OF GOOD EXTRactions:
- User mentions: "I enjoy archery, electronics, and TTRPGs" → Extract 3 User memories with hobbies
- User says: "Working on Daggerheart campaign" → Extract CurrentProject memory
- User lists interests: "Love hiking, baking, and sci-fi" → Extract 3 User preferences

ENTITY EXTRACTION:
Also extract ENTITIES mentioned in the conversation:
- name: The entity name (e.g., "Steve", "Daggerheart", "Neo4j")
- type: Entity type (Person, Project, Technology, Game, Activity, etc.)
- aliases: Alternative names or spellings (optional)

RELATIONSHIP EXTRACTION:
Extract RELATIONSHIPS between entities using these types:
- ENJOYS: Person enjoys an activity/thing (e.g., "Steve ENJOYS Daggerheart")
- DISLIKES: Person dislikes something
- PREFERS: Person prefers one thing over another
- WORKS_ON: Person works on a project
- CREATED: Person created something
- MAINTAINS: Person maintains a system
- KNOWS: Person knows a technology/skill
- EXPERT_IN: Person is expert in a domain
- LEARNING: Person is learning something
- USES: Person/Project uses a technology
- BUILT_WITH: Project built with technology
- DEPENDS_ON: Project depends on technology
- IS_A: Thing is a category/type
- PART_OF: Thing is part of another
- RELATED_TO: Thing is related to another

Relationship format:
- from: Source entity name
- to: Target entity name
- type: One of the types above
- confidence: 0.0-1.0

OUTPUT FORMAT (JSON):
{
  "memories": [
    {
      "content": "Clear, concise memory statement",
      "category": "User|FutureTask|CurrentProject|SelfImprovement|KnowledgeBase",
      "confidence": 0.85,
      "importance": 0.8,
      "reasoning": "Brief explanation of why this matters",
      "sourceMessageIds": ["msg-id-1", "msg-id-2"]
    }
  ],
  "entities": [
    {
      "name": "Entity Name",
      "type": "Person|Project|Technology|Game|Activity|Thing",
      "aliases": ["alias1", "alias2"]
    }
  ],
  "relationships": [
    {
      "from": "Source Entity",
      "to": "Target Entity",
      "type": "ENJOYS|WORKS_ON|KNOWS|USES|etc",
      "confidence": 0.85
    }
  ]
}

REMEMBER: Output ONLY raw JSON. No markdown code blocks (\`\`\`json), no backticks, no explanations. Extract {{maxMemories}} or fewer memories. Current time: {{currentTime}}`;

/**
 * Build extraction prompt from variables
 */
export function buildExtractionPrompt(variables: PromptVariables): string {
  let prompt = EXTRACTION_PROMPT_TEMPLATE;

  // Replace placeholders
  prompt = prompt.replace("{{messages}}", variables.messages);
  prompt = prompt.replace("{{maxMemories}}", String(variables.maxMemories));
  prompt = prompt.replace("{{currentTime}}", variables.currentTime);
  prompt = prompt.replace("{{categories}}", variables.categories);

  // Handle optional user hint
  if (variables.userHint) {
    prompt = prompt.replace("{{userHint}}", `USER HINT: ${variables.userHint}`);
  } else {
    prompt = prompt.replace("{{userHint}}", "");
  }

  return prompt;
}

/**
 * Format messages for prompt
 */
export function formatMessages(
  messages: Array<{ id: string; role: string; content: string; timestamp: number }>,
): string {
  return messages.map((m) => `[${m.id}] ${m.role}: ${m.content}`).join("\n");
}

/**
 * Escape user content to prevent prompt injection
 */
export function escapeUserContent(content: string): string {
  // Remove JSON control characters that could break parsing
  return content
    .replace(/[\x00-\x1F\x7F]/g, "") // Remove control characters
    .replace(/\\/g, "\\\\") // Escape backslashes
    .replace(/"/g, '\\"'); // Escape quotes
}

/**
 * Available categories string
 */
export function getCategoriesList(): string {
  return "User, FutureTask, CurrentProject, SelfImprovement, KnowledgeBase";
}

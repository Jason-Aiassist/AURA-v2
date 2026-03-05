/**
 * Search Strategy Generator
 *
 * Instead of hardcoding search terms, this teaches the LLM about the search system
 * and lets it generate optimal search strategies for each query.
 */

export interface SearchStrategy {
  /** Primary search approach */
  primaryMethod: "semantic" | "keyword" | "entity" | "tag" | "hybrid";
  /** Query to use for BM25/text search */
  textQuery?: string;
  /** Entities to search for */
  targetEntities?: string[];
  /** Tags to match */
  targetTags?: string[];
  /** Categories to include (empty = all) */
  categories?: string[];
  /** Whether to use vector/semantic search */
  useSemantic: boolean;
  /** Relevance threshold (0-1) */
  minRelevance: number;
  /** Maximum results to return */
  maxResults: number;
  /** Reasoning for this strategy */
  reasoning: string;
}

/**
 * Prompt that teaches the LLM about available search methods
 */
export const SEARCH_STRATEGY_PROMPT = `You are a search strategy optimizer for a memory retrieval system.

## Available Search Methods

1. **BM25 Text Search**
   - Full-text search on memory content
   - Good for: specific words, phrases, exact matches
   - Use when: User mentions specific terms

2. **Semantic/Vector Search**  
   - Meaning-based search using embeddings
   - Good for: conceptual similarity, synonyms
   - Use when: User asks about concepts, not specific words

3. **Tag Search**
   - Matches against pre-computed tags
   - Available tags: {availableTags}
   - Good for: categories, topics, types
   - Use when: User asks about a topic area

4. **Entity Search**
   - Finds memories mentioning specific entities
   - Known entities: {knownEntities}
   - Good for: people, places, things, projects
   - Use when: User mentions specific named entities

5. **Hybrid (Recommended)**
   - Combines multiple methods
   - Best overall results
   - Use for: Most queries

## Categories
- "User": Personal facts, preferences, identity
- "General": Objective knowledge, facts
- "System": Technical, configuration

## Search Strategy Format

Respond with JSON:
{
  "primaryMethod": "hybrid",
  "textQuery": "extracted keywords for text search",
  "targetEntities": ["entity1", "entity2"],
  "targetTags": ["tag1", "tag2"],
  "categories": ["User"],
  "useSemantic": true,
  "minRelevance": 0.3,
  "maxResults": 25,
  "reasoning": "Brief explanation of why this strategy"
}

## Examples

Query: "What do I like to eat?"
Strategy: {
  "primaryMethod": "hybrid",
  "textQuery": "like eat food enjoy taste favorite",
  "targetEntities": [],
  "targetTags": ["preference", "food", "likes"],
  "categories": ["User"],
  "useSemantic": true,
  "minRelevance": 0.4,
  "maxResults": 20,
  "reasoning": "Looking for personal food preferences across all content types"
}

Query: "What are my hobbies?"
Strategy: {
  "primaryMethod": "hybrid",
  "textQuery": "hobby hobbies activity activities enjoy free time",
  "targetEntities": [],
  "targetTags": ["hobby", "activity", "preference", "likes"],
  "categories": ["User"],
  "useSemantic": true,
  "minRelevance": 0.3,
  "maxResults": 25,
  "reasoning": "Searching for hobby-related content, using semantic search for 'activities I enjoy'"
}

Query: "Tell me about Project X"
Strategy: {
  "primaryMethod": "entity",
  "textQuery": "Project X",
  "targetEntities": ["Project X"],
  "targetTags": [],
  "categories": [],
  "useSemantic": false,
  "minRelevance": 0.5,
  "maxResults": 15,
  "reasoning": "Specific entity search for Project X"
}

Query: "{query}"
Generate search strategy:`;

/**
 * Dynamic search strategy generator
 * Uses LLM to understand query and generate optimal search approach
 */
export async function generateSearchStrategy(
  query: string,
  llmClient: {
    complete: (options: {
      prompt: string;
      temperature?: number;
      maxTokens?: number;
    }) => Promise<{ content: string }>;
  },
  context: {
    availableTags: string[];
    knownEntities: string[];
  },
): Promise<SearchStrategy> {
  const prompt = SEARCH_STRATEGY_PROMPT.replace(
    "{availableTags}",
    context.availableTags.slice(0, 20).join(", "),
  )
    .replace("{knownEntities}", context.knownEntities.slice(0, 10).join(", "))
    .replace("{query}", query);

  try {
    const response = await llmClient.complete({
      prompt,
      temperature: 0.2, // Low temp for consistent results
      maxTokens: 500,
    });

    const strategy = JSON.parse(response.content) as SearchStrategy;

    // Validate and set defaults
    return {
      primaryMethod: strategy.primaryMethod || "hybrid",
      textQuery: strategy.textQuery || query,
      targetEntities: strategy.targetEntities || [],
      targetTags: strategy.targetTags || [],
      categories: strategy.categories || [],
      useSemantic: strategy.useSemantic ?? true,
      minRelevance: strategy.minRelevance ?? 0.3,
      maxResults: strategy.maxResults ?? 25,
      reasoning: strategy.reasoning || "No reasoning provided",
    };
  } catch (error) {
    // Fallback to safe defaults
    return {
      primaryMethod: "hybrid",
      textQuery: query,
      targetEntities: [],
      targetTags: [],
      categories: [],
      useSemantic: true,
      minRelevance: 0.3,
      maxResults: 25,
      reasoning: "Fallback due to error: " + String(error),
    };
  }
}

/**
 * Get available tags from database for context
 */
export async function getAvailableTags(db: any): Promise<string[]> {
  try {
    // Get unique tags from all memories
    const rows = db.prepare("SELECT DISTINCT tags FROM hot_memories").all();
    const allTags = new Set<string>();

    for (const row of rows) {
      if (row.tags) {
        try {
          const tags = JSON.parse(row.tags) as string[];
          tags.forEach((tag) => allTags.add(tag));
        } catch {
          // Skip invalid JSON
        }
      }
    }

    return Array.from(allTags).sort();
  } catch {
    return ["User", "General", "System", "preference", "hobby", "work", "technical"];
  }
}

/**
 * Get known entities from Knowledge Graph
 */
export async function getKnownEntities(neo4jDriver: any): Promise<string[]> {
  try {
    const session = neo4jDriver.session();
    const result = await session.run(`
      MATCH (e:Entity)
      RETURN e.name as name
      ORDER BY e.mentionCount DESC
      LIMIT 50
    `);
    await session.close();

    return result.records.map((r) => r.get("name"));
  } catch {
    return ["Steve", "AURA", "OpenClaw", "Neo4j", "SQLite"];
  }
}

/**
 * Query Analyzer for AURA Context Injection
 *
 * Lightweight LLM-based analysis of user queries to determine:
 * - Intent (recall, entity_lookup, relational, none)
 * - Entities to search for
 * - Time window constraints
 * - Depth level (terse, summary, full)
 * - Confidence threshold
 *
 * Uses coder_fast (14B Qwen Coder 2.5) for speed.
 */

import { createContainerLLMClient, type LLMClient } from "../adapters/llmClient.js";

/**
 * Query analysis result
 */
export interface QueryAnalysis {
  /** Intent classification */
  intent: "recall" | "entity_lookup" | "relational" | "none";
  /** Extracted entities for KG search */
  entities: string[];
  /** Time window constraint */
  timeWindow: "recent" | "last_week" | "last_month" | "all_time" | string;
  /** Desired depth of response */
  depth: "terse" | "summary" | "full";
  /** Minimum confidence threshold for results */
  confidenceThreshold: number;
  /** Whether this is a complex multi-hop query */
  isComplex: boolean;
  /** Raw analysis confidence (0-1) */
  analysisConfidence: number;
}

/**
 * Configuration for query analyzer
 */
export interface QueryAnalyzerConfig {
  /** LLM model to use (default: coder_fast) */
  model: string;
  /** Temperature for analysis (default: 0.0) */
  temperature: number;
  /** Max tokens for response (default: 256) */
  maxTokens: number;
  /** Timeout in ms (default: 2000) */
  timeoutMs: number;
  /** Whether to use cache */
  enableCache: boolean;
  /** Cache TTL in ms (default: 5 minutes) */
  cacheTtlMs: number;
}

/**
 * Cached analysis entry
 */
interface CachedAnalysis {
  analysis: QueryAnalysis;
  timestamp: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: QueryAnalyzerConfig = {
  model: "coder_fast",
  temperature: 0.0,
  maxTokens: 256,
  timeoutMs: 10000, // Increased from 2000 to 10000ms (10 seconds) for local proxy
  enableCache: true,
  cacheTtlMs: 5 * 60 * 1000, // 5 minutes
};

/**
 * Patterns that indicate complex relational queries
 * These may benefit from the larger model (coder_deep)
 */
const COMPLEX_QUERY_PATTERNS = [
  /how (are|is|was|were).*related to/i,
  /what.*connects.*and/i,
  /explain the relationship between/i,
  /compare.*and.*contrast/i,
  /what.*in common.*between/i,
  /summarize everything.*know about/i,
  /what.*happened.*between.*and/i,
];

/**
 * Patterns that indicate no memory needed
 */
const NO_MEMORY_PATTERNS = [
  /^\s*(hi|hello|hey|yo)\s*$/i,
  /^\s*thanks?\s*$/i,
  /^\s*ok\s*$/i,
  /^\s*got it\s*$/i,
  /^\s*bye\s*$/i,
  /^\s*goodbye\s*$/i,
  /^(what can you do|who are you|help)/i,
];

/**
 * Simple LRU cache implementation
 */
class QueryCache {
  private cache = new Map<string, CachedAnalysis>();
  private config: QueryAnalyzerConfig;

  constructor(config: QueryAnalyzerConfig) {
    this.config = config;
  }

  get(query: string): QueryAnalysis | null {
    if (!this.config.enableCache) return null;

    const normalized = this.normalizeQuery(query);
    const cached = this.cache.get(normalized);

    if (!cached) return null;

    const isExpired = Date.now() - cached.timestamp > this.config.cacheTtlMs;
    if (isExpired) {
      this.cache.delete(normalized);
      return null;
    }

    return cached.analysis;
  }

  set(query: string, analysis: QueryAnalysis): void {
    if (!this.config.enableCache) return;

    const normalized = this.normalizeQuery(query);
    this.cache.set(normalized, {
      analysis,
      timestamp: Date.now(),
    });

    // Simple LRU: if cache grows too large, remove oldest entries
    if (this.cache.size > 100) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }
  }

  private normalizeQuery(query: string): string {
    return query.toLowerCase().trim().replace(/\s+/g, " ");
  }

  clear(): void {
    this.cache.clear();
  }
}

/**
 * Query Analyzer class
 */
export class QueryAnalyzer {
  private llm: LLMClient;
  private config: QueryAnalyzerConfig;
  private cache: QueryCache;

  constructor(config: Partial<QueryAnalyzerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.llm = createContainerLLMClient(this.config.model);
    this.cache = new QueryCache(this.config);
  }

  /**
   * Analyze a user query to determine retrieval parameters
   */
  async analyze(query: string): Promise<QueryAnalysis> {
    // Check cache first
    const cached = this.cache.get(query);
    if (cached) {
      return cached;
    }

    // Quick heuristic: check if query needs memory at all
    if (this.shouldSkipAnalysis(query)) {
      const result: QueryAnalysis = {
        intent: "none",
        entities: [],
        timeWindow: "all_time",
        depth: "terse",
        confidenceThreshold: 0.0,
        isComplex: false,
        analysisConfidence: 1.0,
      };
      this.cache.set(query, result);
      return result;
    }

    // Determine if complex query needs bigger model
    const isComplex = this.isComplexQuery(query);
    if (isComplex && this.config.model === "coder_fast") {
      // Temporarily switch to deep model for complex queries
      this.llm = createContainerLLMClient("coder_deep");
    }

    try {
      const analysis = await this.runLLMAnalysis(query);
      this.cache.set(query, analysis);
      return analysis;
    } finally {
      // Reset to fast model if we switched
      if (isComplex && this.config.model === "coder_fast") {
        this.llm = createContainerLLMClient(this.config.model);
      }
    }
  }

  /**
   * Run the actual LLM analysis
   */
  private async runLLMAnalysis(query: string): Promise<QueryAnalysis> {
    const prompt = this.buildAnalysisPrompt(query);

    try {
      const response = await Promise.race([
        this.llm.complete({
          prompt,
          maxTokens: this.config.maxTokens,
          temperature: this.config.temperature,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Query analysis timeout")), this.config.timeoutMs),
        ),
      ]);

      return this.parseAnalysisResponse(response.content, query);
    } catch (error) {
      // On timeout or error, fall back to heuristic extraction
      console.warn("[QueryAnalyzer] LLM analysis failed, using heuristic fallback:", error);
      return this.heuristicAnalysis(query);
    }
  }

  /**
   * Build the analysis prompt
   */
  private buildAnalysisPrompt(query: string): string {
    return `Analyze this user query for memory retrieval purposes.

Query: "${query}"

Extract the following and return as JSON:
{
  "intent": "recall" | "entity_lookup" | "relational" | "none",
  "entities": ["entity1", "entity2"],
  "timeWindow": "recent" | "last_week" | "last_month" | "all_time",
  "depth": "terse" | "summary" | "full",
  "confidenceThreshold": 0.0-1.0,
  "isComplex": true/false,
  "reasoning": "brief explanation"
}

Guidelines:
- intent: "recall" for remembering past discussions, "entity_lookup" for info about specific things, "relational" for connections between concepts, "none" for greetings/small talk
- entities: Extract proper nouns, project names, people's names, key concepts (lowercase)
- timeWindow: Use "recent" for "last conversation", "last_week" for "this week", etc.
- depth: "terse" for quick facts, "summary" for overview, "full" for detailed context
- confidenceThreshold: Higher (0.8+) for specific queries, lower (0.5+) for vague queries
- isComplex: true if query requires connecting multiple pieces of information

Return JSON only, no markdown.`;
  }

  /**
   * Parse the LLM response into QueryAnalysis
   */
  private parseAnalysisResponse(content: string, originalQuery: string): QueryAnalysis {
    try {
      // Extract JSON from potential markdown
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ||
        content.match(/```\s*([\s\S]*?)\s*```/) || [null, content];
      const jsonStr = jsonMatch[1] || content;

      const parsed = JSON.parse(jsonStr.trim());

      return {
        intent: this.validateIntent(parsed.intent),
        entities: Array.isArray(parsed.entities)
          ? parsed.entities.map((e: string) => String(e).toLowerCase())
          : [],
        timeWindow: this.validateTimeWindow(parsed.timeWindow),
        depth: this.validateDepth(parsed.depth),
        confidenceThreshold: Math.max(0, Math.min(1, parsed.confidenceThreshold ?? 0.7)),
        isComplex: Boolean(parsed.isComplex),
        analysisConfidence: 0.9, // High confidence for LLM-parsed results
      };
    } catch (error) {
      console.warn("[QueryAnalyzer] Failed to parse LLM response, using heuristic:", error);
      return this.heuristicAnalysis(originalQuery);
    }
  }

  /**
   * Heuristic analysis as fallback when LLM fails
   */
  private heuristicAnalysis(query: string): QueryAnalysis {
    const words = query.toLowerCase().split(/\s+/);

    // Extract capitalized words as entities
    const entities = query
      .split(/\s+/)
      .filter((w) => w.length > 2 && w[0] === w[0].toUpperCase())
      .map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ""));

    // Extract first-person pronouns (user asking about themselves)
    const firstPersonPronouns = ["me", "my", "myself", "i"];
    const cleanQuery = query
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const hasFirstPerson = firstPersonPronouns.some((p) => {
      const regex = new RegExp(`\\b${p}\\b`);
      return regex.test(cleanQuery);
    });

    // If user is asking about themselves, add user identity entities
    if (hasFirstPerson) {
      entities.push("steve", "user");
    }

    // Detect intent from keywords
    let intent: QueryAnalysis["intent"] = "recall";
    if (query.match(/\b(who is|what is|tell me about)\b/i)) {
      intent = "entity_lookup";
    } else if (query.match(/\b(how|compare|relate|connect|difference|similar)\b/i)) {
      intent = "relational";
    }

    // Detect time window
    let timeWindow: QueryAnalysis["timeWindow"] = "all_time";
    if (query.match(/\b(yesterday|today|recent|last conversation)\b/i)) {
      timeWindow = "recent";
    } else if (query.match(/\b(last week|this week)\b/i)) {
      timeWindow = "last_week";
    } else if (query.match(/\b(last month|this month)\b/i)) {
      timeWindow = "last_month";
    }

    // Detect depth from query length and keywords
    let depth: QueryAnalysis["depth"] = "summary";
    if (query.length < 30 || query.match(/\b(just|quick|brief)\b/i)) {
      depth = "terse";
    } else if (query.length > 100 || query.match(/\b(detail|explain|elaborate|everything)\b/i)) {
      depth = "full";
    }

    // Deduplicate entities using Array.from for ES5 compatibility
    const uniqueEntities: string[] = [];
    for (const entity of entities) {
      if (!uniqueEntities.includes(entity)) {
        uniqueEntities.push(entity);
      }
    }

    return {
      intent,
      entities: uniqueEntities,
      timeWindow,
      depth,
      confidenceThreshold: 0.6,
      isComplex: this.isComplexQuery(query),
      analysisConfidence: 0.6, // Lower confidence for heuristic
    };
  }

  /**
   * Check if query should skip LLM analysis entirely
   */
  private shouldSkipAnalysis(query: string): boolean {
    return NO_MEMORY_PATTERNS.some((pattern) => pattern.test(query));
  }

  /**
   * Check if query is complex (may need bigger model)
   */
  private isComplexQuery(query: string): boolean {
    return COMPLEX_QUERY_PATTERNS.some((pattern) => pattern.test(query));
  }

  /**
   * Validate intent string
   */
  private validateIntent(intent: string): QueryAnalysis["intent"] {
    const validIntents: QueryAnalysis["intent"][] = [
      "recall",
      "entity_lookup",
      "relational",
      "none",
    ];
    return validIntents.includes(intent as QueryAnalysis["intent"])
      ? (intent as QueryAnalysis["intent"])
      : "recall";
  }

  /**
   * Validate time window
   */
  private validateTimeWindow(window: string): QueryAnalysis["timeWindow"] {
    const validWindows: QueryAnalysis["timeWindow"][] = [
      "recent",
      "last_week",
      "last_month",
      "all_time",
    ];
    return validWindows.includes(window as QueryAnalysis["timeWindow"])
      ? (window as QueryAnalysis["timeWindow"])
      : "all_time";
  }

  /**
   * Validate depth
   */
  private validateDepth(depth: string): QueryAnalysis["depth"] {
    const validDepths: QueryAnalysis["depth"][] = ["terse", "summary", "full"];
    return validDepths.includes(depth as QueryAnalysis["depth"])
      ? (depth as QueryAnalysis["depth"])
      : "summary";
  }

  /**
   * Clear the analysis cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}

/**
 * Create a query analyzer instance
 */
export function createQueryAnalyzer(config?: Partial<QueryAnalyzerConfig>): QueryAnalyzer {
  return new QueryAnalyzer(config);
}

/**
 * Singleton instance for reuse
 */
let globalAnalyzer: QueryAnalyzer | null = null;

/**
 * Get or create global query analyzer
 */
export function getQueryAnalyzer(): QueryAnalyzer {
  if (!globalAnalyzer) {
    globalAnalyzer = createQueryAnalyzer();
  }
  return globalAnalyzer;
}

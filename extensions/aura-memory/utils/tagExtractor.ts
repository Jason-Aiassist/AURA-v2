/**
 * Tag Extractor
 *
 * Generates multiple tags from memory content and category.
 * Phase 1 of architecture upgrade: Tag-based categorization
 */

import type { MemoryCategory } from "../categories/types.js";

export interface TagExtractionResult {
  tags: string[];
  primaryCategory: MemoryCategory;
  confidence: number;
}

/**
 * Extract tags from memory content
 * Generates multiple relevant tags for flexible categorization
 */
export function extractTags(
  content: string,
  category: MemoryCategory,
  entities?: string[],
): TagExtractionResult {
  const tags: Set<string> = new Set();
  const lowerContent = content.toLowerCase();

  // Always include the primary category as a tag
  tags.add(category);

  // Add inferred tags based on content patterns
  const contentTags = inferContentTags(lowerContent);
  contentTags.forEach((tag) => tags.add(tag));

  // Add entity-based tags
  if (entities && entities.length > 0) {
    entities.forEach((entity) => {
      if (entity.length > 2) {
        // Avoid short words
        tags.add(entity.toLowerCase().replace(/\s+/g, "_"));
      }
    });
  }

  // Add relationship-based tags
  const relationshipTags = inferRelationshipTags(lowerContent);
  relationshipTags.forEach((tag) => tags.add(tag));

  // Calculate confidence based on tag diversity
  const confidence = Math.min(1.0, tags.size / 5); // More tags = higher confidence

  return {
    tags: Array.from(tags).slice(0, 10), // Max 10 tags
    primaryCategory: category,
    confidence,
  };
}

/**
 * Infer content-based tags from memory text
 */
function inferContentTags(content: string): string[] {
  const tags: string[] = [];

  // Preference indicators
  if (
    content.includes("like") ||
    content.includes("love") ||
    content.includes("enjoy") ||
    content.includes("favorite") ||
    content.includes("favourite") ||
    content.includes("prefer")
  ) {
    tags.push("preference");
    tags.push("likes");
  }

  // Hobby/Activity indicators
  if (
    content.includes("play") ||
    content.includes("game") ||
    content.includes("hobby") ||
    content.includes("activity") ||
    content.includes("sport")
  ) {
    tags.push("hobby");
    tags.push("activity");
  }

  // Work/Project indicators
  if (
    content.includes("work") ||
    content.includes("project") ||
    content.includes("job") ||
    content.includes("career") ||
    content.includes("develop") ||
    content.includes("build")
  ) {
    tags.push("work");
    tags.push("project");
  }

  // Technical indicators
  if (
    content.includes("code") ||
    content.includes("program") ||
    content.includes("system") ||
    content.includes("database") ||
    content.includes("api") ||
    content.includes("software")
  ) {
    tags.push("technical");
    tags.push("technology");
  }

  // Relationship indicators
  if (
    content.includes("friend") ||
    content.includes("family") ||
    content.includes("colleague") ||
    content.includes("partner") ||
    content.includes("team")
  ) {
    tags.push("relationship");
    tags.push("social");
  }

  // Goal/Plan indicators
  if (
    content.includes("goal") ||
    content.includes("plan") ||
    content.includes("want to") ||
    content.includes("need to") ||
    content.includes("will")
  ) {
    tags.push("goal");
    tags.push("plan");
  }

  // Knowledge/Learning indicators
  if (
    content.includes("learn") ||
    content.includes("study") ||
    content.includes("know") ||
    content.includes("understand") ||
    content.includes("research")
  ) {
    tags.push("knowledge");
    tags.push("learning");
  }

  // TTRPG/Game specific
  if (
    content.includes("ttrpg") ||
    content.includes("rpg") ||
    content.includes("dnd") ||
    content.includes("d&d") ||
    content.includes("tabletop") ||
    content.includes("dice")
  ) {
    tags.push("ttrpg");
    tags.push("gaming");
  }

  return tags;
}

/**
 * Infer relationship-based tags
 */
function inferRelationshipTags(content: string): string[] {
  const tags: string[] = [];

  // Direct relationships (Steve X something)
  const patterns = [
    { pattern: /\b(like|love|enjoy)s?\b/, tag: "positive_sentiment" },
    { pattern: /\b(hate|dislike|avoid)s?\b/, tag: "negative_sentiment" },
    { pattern: /\b(use|work with|build with)\b/, tag: "tool_usage" },
    { pattern: /\b(know|understand|familiar with)\b/, tag: "expertise" },
    { pattern: /\b(want|plan|goal|intend)\b/, tag: "intention" },
  ];

  patterns.forEach(({ pattern, tag }) => {
    if (pattern.test(content)) {
      tags.push(tag);
    }
  });

  return tags;
}

/**
 * Build search query from tags
 * Creates a query that matches memories with similar tags
 */
export function buildTagSearchQuery(tags: string[]): string {
  if (tags.length === 0) return "";

  // Build JSON containment query for SQLite
  // This finds memories where ANY of the provided tags match
  const tagConditions = tags.map((tag) => `json_extract(tags, '$') LIKE '%"${tag}"%'`);

  return tagConditions.join(" OR ");
}

/**
 * Calculate tag similarity between two tag sets
 * Returns score from 0 to 1
 */
export function calculateTagSimilarity(tags1: string[], tags2: string[]): number {
  if (tags1.length === 0 || tags2.length === 0) return 0;

  const set1 = new Set(tags1.map((t) => t.toLowerCase()));
  const set2 = new Set(tags2.map((t) => t.toLowerCase()));

  const intersection = new Set([...set1].filter((x) => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  return intersection.size / union.size; // Jaccard similarity
}

/**
 * Suggest related tags based on co-occurrence
 * For a given tag, what other tags commonly appear with it?
 */
export function suggestRelatedTags(
  targetTag: string,
  allMemories: Array<{ tags: string[] }>,
): string[] {
  const coOccurrence: Map<string, number> = new Map();

  allMemories.forEach((memory) => {
    if (memory.tags.includes(targetTag)) {
      memory.tags.forEach((tag) => {
        if (tag !== targetTag) {
          coOccurrence.set(tag, (coOccurrence.get(tag) || 0) + 1);
        }
      });
    }
  });

  // Return top 5 related tags
  return Array.from(coOccurrence.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag]) => tag);
}

// Confidence Scorer
// Story 3.1: LLM-Based Extraction Engine

import type { ConfidenceFactors, MemoryExtraction } from "./types.js";

/**
 * Default confidence weights
 */
const CONFIDENCE_WEIGHTS = {
  clarity: 0.3,
  importance: 0.3,
  specificity: 0.25,
  context: 0.15,
};

/**
 * Calculate overall confidence from factors
 */
export function calculateConfidence(factors: ConfidenceFactors): number {
  const weighted =
    factors.clarity * CONFIDENCE_WEIGHTS.clarity +
    factors.importance * CONFIDENCE_WEIGHTS.importance +
    factors.specificity * CONFIDENCE_WEIGHTS.specificity +
    factors.context * CONFIDENCE_WEIGHTS.context;

  // Round to 2 decimal places
  return Math.round(weighted * 100) / 100;
}

/**
 * Analyze extraction and return confidence factors
 */
export function analyzeConfidence(extraction: MemoryExtraction): ConfidenceFactors {
  return {
    clarity: scoreClarity(extraction.content),
    importance: scoreImportance(extraction.content, extraction.category),
    specificity: scoreSpecificity(extraction.content),
    context: scoreContext(extraction.sourceMessageIds, extraction.reasoning),
  };
}

/**
 * Score clarity (0-1)
 * Clear statements score higher than ambiguous ones
 */
function scoreClarity(content: string): number {
  // Penalize vague words
  const vagueWords = ["maybe", "perhaps", "possibly", "might", "could be", "sort of", "kind of"];
  const hasVagueWords = vagueWords.some((w) => content.toLowerCase().includes(w));

  // Penalize overly long content (may be unfocused)
  const isTooLong = content.length > 200;

  // Penalize questions
  const isQuestion = content.endsWith("?");

  let score = 1.0;
  if (hasVagueWords) score -= 0.2;
  if (isTooLong) score -= 0.1;
  if (isQuestion) score -= 0.3;

  return Math.max(0, score);
}

/**
 * Score importance (0-1)
 * Personal preferences and tasks score higher than general facts
 */
function scoreImportance(content: string, category: string): number {
  // User preferences are highly important
  if (category === "User") return 0.9;

  // Tasks have high importance
  if (category === "FutureTask") return 0.85;

  // Active projects are important
  if (category === "CurrentProject") return 0.8;

  // Self-improvement is moderately important
  if (category === "SelfImprovement") return 0.7;

  // General knowledge is less critical
  if (category === "KnowledgeBase") return 0.6;

  return 0.5;
}

/**
 * Score specificity (0-1)
 * Specific details score higher than general statements
 */
function scoreSpecificity(content: string): number {
  // Check for specific entities (names, dates, numbers)
  const hasNumbers = /\d/.test(content);
  const hasProperNouns = /[A-Z][a-z]+/.test(content);
  const hasDates =
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|tomorrow|yesterday|today|\d{1,2}[\/\-]\d{1,2})\b/i.test(
      content,
    );

  let score = 0.5; // Base score
  if (hasNumbers) score += 0.2;
  if (hasProperNouns) score += 0.15;
  if (hasDates) score += 0.15;

  // Penalize very short content (may be too vague)
  if (content.length < 20) score -= 0.2;

  return Math.min(1, Math.max(0, score));
}

/**
 * Score context support (0-1)
 * Memories with multiple source messages score higher
 */
function scoreContext(sourceMessageIds: string[], reasoning: string): number {
  const messageCount = sourceMessageIds.length;

  if (messageCount >= 3) return 1.0;
  if (messageCount === 2) return 0.9;
  if (messageCount === 1) return 0.75;

  // Check if reasoning mentions specific messages
  if (reasoning && reasoning.includes("[")) return 0.6;

  return 0.5;
}

/**
 * Validate that confidence score is within bounds
 */
export function isValidConfidence(confidence: number): boolean {
  return typeof confidence === "number" && confidence >= 0 && confidence <= 1;
}

/**
 * Get confidence tier label
 */
export function getConfidenceTier(confidence: number): "high" | "medium" | "low" {
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.6) return "medium";
  return "low";
}

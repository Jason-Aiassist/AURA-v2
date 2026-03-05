/**
 * Review Queue Types
 * Human-in-the-loop review for extracted memories
 */

import type { MemoryCategory } from "../categories/types.js";

/**
 * Review item status
 */
export type ReviewStatus = "pending" | "approved" | "rejected";

/**
 * Review queue item
 */
export interface ReviewItem {
  id: string;
  content: string;
  category: MemoryCategory;
  confidence: number;
  importance: number;
  reasoning: string;
  sourceMessageIds: string[];
  source: string;
  status: ReviewStatus;
  createdAt: number;
  reviewedAt?: number;
  reviewedBy?: string;
  correlationId: string;
}

/**
 * Review queue interface
 */
export interface IReviewQueue {
  /**
   * Add an item to the review queue
   */
  add(item: ReviewItem): Promise<void>;

  /**
   * Get all pending items
   */
  getPending(): Promise<ReviewItem[]>;

  /**
   * Get a specific item by ID
   */
  getById(id: string): Promise<ReviewItem | null>;

  /**
   * Approve an item
   */
  approve(id: string): Promise<void>;

  /**
   * Reject an item
   */
  reject(id: string): Promise<void>;

  /**
   * Get count of pending items
   */
  getPendingCount(): Promise<number>;
}

/**
 * Review queue configuration
 */
export interface ReviewQueueConfig {
  mode: "manual" | "automatic";
  autoApproveThreshold?: number;
  maxQueueSize?: number;
}

/**
 * Episode Link Cache
 * Sprint 2 - AC2.2: Empty Content Handling
 *
 * Manages bidirectional cache for memory_id ↔ episode_uuid lookups
 */

import type { Tier } from "./types";

export interface EpisodeLink {
  memoryId: string;
  episodeUuid: string;
  tier: Tier;
  entityRefs: string[];
  hasContent: boolean;
}

export interface CacheStats {
  size: number;
  memoryIds: number;
  episodeUuids: number;
}

export class EpisodeLinkCache {
  private cache: Map<string, EpisodeLink> = new Map();

  /**
   * Store a link in cache
   */
  set(link: EpisodeLink): void {
    this.cache.set(link.memoryId, link);
    this.cache.set(link.episodeUuid, link);
  }

  /**
   * Get link by memory_id
   */
  getByMemoryId(memoryId: string): EpisodeLink | undefined {
    return this.cache.get(memoryId);
  }

  /**
   * Get link by episode_uuid
   */
  getByEpisodeUuid(episodeUuid: string): EpisodeLink | undefined {
    return this.cache.get(episodeUuid);
  }

  /**
   * Check if memory_id exists in cache
   */
  hasMemoryId(memoryId: string): boolean {
    const link = this.cache.get(memoryId);
    return link?.memoryId === memoryId;
  }

  /**
   * Check if episode_uuid exists in cache
   */
  hasEpisodeUuid(episodeUuid: string): boolean {
    const link = this.cache.get(episodeUuid);
    return link?.episodeUuid === episodeUuid;
  }

  /**
   * Clear the cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const links = Array.from(this.cache.values());
    const uniqueLinks = links.filter(
      (link, index, arr) => arr.findIndex((l) => l.memoryId === link.memoryId) === index,
    );

    return {
      size: this.cache.size,
      memoryIds: uniqueLinks.length,
      episodeUuids: this.cache.size - uniqueLinks.length,
    };
  }
}

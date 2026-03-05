/**
 * LRU Cache Utility
 * PERF-OPT-1.2: Prevents memory exhaustion in long-running processes
 *
 * Usage: Replace unbounded Map with LRUCache for any cache that grows indefinitely
 */

export class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to front (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict least recently used (first item)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  get size(): number {
    return this.cache.size;
  }

  keys(): IterableIterator<K> {
    return this.cache.keys();
  }

  clear(): void {
    this.cache.clear();
  }
}

/**
 * Create an LRU cache with automatic eviction
 * @param maxSize Maximum number of entries before eviction
 * @returns LRUCache instance
 */
export function createLRUCache<K, V>(maxSize: number): LRUCache<K, V> {
  return new LRUCache<K, V>(maxSize);
}

import type { VFSCacheAdapter, VFSCacheEntry } from './adapter';

export interface MemoryCacheOptions {
  /**
   * Maximum number of items in cache (default: 200).
   */
  maxItems?: number;

  /**
   * Default TTL in seconds (default: 3600 = 1 hour, 0 for indefinite).
   */
  defaultTTL?: number;
}

export class MemoryCacheAdapter implements VFSCacheAdapter {
  private readonly store = new Map<string, VFSCacheEntry>();
  private readonly maxItems: number;
  private readonly defaultTTL: number;

  constructor(options: MemoryCacheOptions = {}) {
    this.maxItems = options.maxItems ?? 200;
    this.defaultTTL = options.defaultTTL ?? 3600;
  }

  private isExpired(entry: VFSCacheEntry): boolean {
    if (!entry.expiresAt) return false;
    return Date.now() > entry.expiresAt;
  }

  get(key: string): VFSCacheEntry | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (this.isExpired(entry)) {
      this.store.delete(key);
      return null;
    }

    // Refresh LRU order
    this.store.delete(key);
    this.store.set(key, entry);
    return entry;
  }

  set(key: string, entry: VFSCacheEntry, ttlSeconds?: number): void {
    const ttl = ttlSeconds ?? this.defaultTTL;
    const expiresAt = ttl > 0 ? Date.now() + ttl * 1000 : undefined;

    const clonedEntry: VFSCacheEntry = {
      ...entry,
      expiresAt,
    };

    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxItems) {
      // Evict oldest (first key in map)
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }

    this.store.set(key, clonedEntry);
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  has(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (this.isExpired(entry)) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  size(): number {
    return this.store.size;
  }
}

/**
 * Cache entry and adapter interfaces for isomorphic VFS caching.
 */

export interface VFSCacheEntry {
  data: Uint8Array;
  contentType?: string;
  name?: string;
  size: number;
  hash?: string;
  createdAt: number;
  expiresAt?: number;
}

export interface VFSCacheAdapter {
  get(key: string): Promise<VFSCacheEntry | null> | VFSCacheEntry | null;
  set(key: string, entry: VFSCacheEntry, ttlSeconds?: number): Promise<void> | void;
  delete(key: string): Promise<boolean> | boolean;
  clear(): Promise<void> | void;
  has(key: string): Promise<boolean> | boolean;
}

import type { VFSCacheAdapter } from './adapter';
import { MemoryCacheAdapter } from './memory';
import { BrowserCacheAdapter } from './browser';
import { FileSystemCacheAdapter } from './filesystem';

export * from './adapter';
export * from './memory';
export * from './browser';
export * from './filesystem';

/**
 * Creates the most suitable cache adapter for the current runtime environment.
 * - In Browser: Uses BrowserCacheAdapter (CacheStorage / IndexedDB / Memory fallback)
 * - In Node.js / Bun: Uses FileSystemCacheAdapter (or MemoryCacheAdapter if directory unwritable)
 * - Otherwise: Uses MemoryCacheAdapter
 */
export function createDefaultCache(): VFSCacheAdapter {
  if (typeof window !== 'undefined' && typeof window.caches !== 'undefined') {
    return new BrowserCacheAdapter();
  }

  if (typeof process !== 'undefined' && (process.versions?.node || process.versions?.bun)) {
    return new FileSystemCacheAdapter();
  }

  return new MemoryCacheAdapter();
}

import type { VFSCacheAdapter, VFSCacheEntry } from './adapter';
import { MemoryCacheAdapter } from './memory';

export interface BrowserCacheOptions {
  cacheName?: string;
  defaultTTL?: number;
}

export class BrowserCacheAdapter implements VFSCacheAdapter {
  private readonly cacheName: string;
  private readonly defaultTTL: number;
  private readonly fallback: MemoryCacheAdapter;

  constructor(options: BrowserCacheOptions = {}) {
    this.cacheName = options.cacheName ?? 'vfs-client-cache-v1';
    this.defaultTTL = options.defaultTTL ?? 3600;
    this.fallback = new MemoryCacheAdapter({ defaultTTL: this.defaultTTL });
  }

  private isAvailable(): boolean {
    return typeof window !== 'undefined' && typeof window.caches !== 'undefined';
  }

  private urlForKey(key: string): string {
    return `https://vfs-cache.internal/${encodeURIComponent(key)}`;
  }

  async get(key: string): Promise<VFSCacheEntry | null> {
    if (!this.isAvailable()) {
      return this.fallback.get(key);
    }

    try {
      const cache = await window.caches.open(this.cacheName);
      const res = await cache.match(this.urlForKey(key));
      if (!res) return null;

      const expiresHeader = res.headers.get('x-vfs-expires-at');
      if (expiresHeader) {
        const expiresAt = parseInt(expiresHeader, 10);
        if (!isNaN(expiresAt) && Date.now() > expiresAt) {
          await cache.delete(this.urlForKey(key));
          return null;
        }
      }

      const buffer = await res.arrayBuffer();
      const contentType = res.headers.get('content-type') || undefined;
      const name = res.headers.get('x-vfs-name') || undefined;
      const hash = res.headers.get('x-vfs-hash') || undefined;
      const createdAtHeader = res.headers.get('x-vfs-created-at');
      const createdAt = createdAtHeader ? parseInt(createdAtHeader, 10) : Date.now();
      const expiresAt = expiresHeader ? parseInt(expiresHeader, 10) : undefined;

      return {
        data: new Uint8Array(buffer),
        contentType,
        name,
        size: buffer.byteLength,
        hash,
        createdAt,
        expiresAt,
      };
    } catch {
      return this.fallback.get(key);
    }
  }

  async set(key: string, entry: VFSCacheEntry, ttlSeconds?: number): Promise<void> {
    if (!this.isAvailable()) {
      this.fallback.set(key, entry, ttlSeconds);
      return;
    }

    try {
      const ttl = ttlSeconds ?? this.defaultTTL;
      const expiresAt = ttl > 0 ? Date.now() + ttl * 1000 : undefined;

      const headers = new Headers();
      if (entry.contentType) headers.set('content-type', entry.contentType);
      if (entry.name) headers.set('x-vfs-name', entry.name);
      if (entry.hash) headers.set('x-vfs-hash', entry.hash);
      headers.set('x-vfs-created-at', String(entry.createdAt));
      if (expiresAt) headers.set('x-vfs-expires-at', String(expiresAt));

      const response = new Response(entry.data as any, { headers });
      const cache = await window.caches.open(this.cacheName);
      await cache.put(this.urlForKey(key), response);
    } catch {
      this.fallback.set(key, entry, ttlSeconds);
    }
  }

  async delete(key: string): Promise<boolean> {
    if (!this.isAvailable()) {
      return this.fallback.delete(key);
    }

    try {
      const cache = await window.caches.open(this.cacheName);
      return await cache.delete(this.urlForKey(key));
    } catch {
      return this.fallback.delete(key);
    }
  }

  async clear(): Promise<void> {
    if (!this.isAvailable()) {
      this.fallback.clear();
      return;
    }

    try {
      await window.caches.delete(this.cacheName);
    } catch {
      this.fallback.clear();
    }
  }

  async has(key: string): Promise<boolean> {
    const entry = await this.get(key);
    return entry !== null;
  }
}

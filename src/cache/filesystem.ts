import type { VFSCacheAdapter, VFSCacheEntry } from './adapter';
import { MemoryCacheAdapter } from './memory';

export interface FileSystemCacheOptions {
  /**
   * Directory to store cached files (default: "./.vfs-cache").
   */
  cacheDir?: string;

  /**
   * Default TTL in seconds (default: 3600 = 1 hour).
   */
  defaultTTL?: number;
}

interface StoredMeta {
  contentType?: string;
  name?: string;
  size: number;
  hash?: string;
  createdAt: number;
  expiresAt?: number;
}

export class FileSystemCacheAdapter implements VFSCacheAdapter {
  private readonly cacheDir: string;
  private readonly defaultTTL: number;
  private readonly fallback: MemoryCacheAdapter;
  private isNodeEnv: boolean;

  constructor(options: FileSystemCacheOptions = {}) {
    this.cacheDir = options.cacheDir ?? './.vfs-cache';
    this.defaultTTL = options.defaultTTL ?? 3600;
    this.fallback = new MemoryCacheAdapter({ defaultTTL: this.defaultTTL });
    this.isNodeEnv = typeof process !== 'undefined' && Boolean(process.versions?.node || process.versions?.bun);
  }

  private sanitizeKey(key: string): string {
    return encodeURIComponent(key).replace(/[*?:<>|"/\\%]/g, '_');
  }

  private async getFs() {
    if (!this.isNodeEnv) return null;
    try {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      return { fs, path };
    } catch {
      return null;
    }
  }

  private async ensureDir(): Promise<boolean> {
    const mods = await this.getFs();
    if (!mods) return false;
    try {
      await mods.fs.mkdir(this.cacheDir, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }

  async get(key: string): Promise<VFSCacheEntry | null> {
    const mods = await this.getFs();
    if (!mods) return this.fallback.get(key);

    const safeKey = this.sanitizeKey(key);
    const dataPath = mods.path.join(this.cacheDir, `${safeKey}.bin`);
    const metaPath = mods.path.join(this.cacheDir, `${safeKey}.json`);

    try {
      const metaRaw = await mods.fs.readFile(metaPath, 'utf8');
      const meta = JSON.parse(metaRaw) as StoredMeta;

      if (meta.expiresAt && Date.now() > meta.expiresAt) {
        await Promise.allSettled([mods.fs.unlink(dataPath), mods.fs.unlink(metaPath)]);
        return null;
      }

      const buffer = await mods.fs.readFile(dataPath);
      return {
        data: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
        contentType: meta.contentType,
        name: meta.name,
        size: meta.size,
        hash: meta.hash,
        createdAt: meta.createdAt,
        expiresAt: meta.expiresAt,
      };
    } catch {
      return null;
    }
  }

  async set(key: string, entry: VFSCacheEntry, ttlSeconds?: number): Promise<void> {
    const mods = await this.getFs();
    if (!mods) {
      this.fallback.set(key, entry, ttlSeconds);
      return;
    }

    if (!(await this.ensureDir())) {
      this.fallback.set(key, entry, ttlSeconds);
      return;
    }

    const ttl = ttlSeconds ?? this.defaultTTL;
    const expiresAt = ttl > 0 ? Date.now() + ttl * 1000 : undefined;
    const safeKey = this.sanitizeKey(key);
    const dataPath = mods.path.join(this.cacheDir, `${safeKey}.bin`);
    const metaPath = mods.path.join(this.cacheDir, `${safeKey}.json`);

    const meta: StoredMeta = {
      contentType: entry.contentType,
      name: entry.name,
      size: entry.size,
      hash: entry.hash,
      createdAt: entry.createdAt,
      expiresAt,
    };

    try {
      await Promise.all([
        mods.fs.writeFile(dataPath, entry.data),
        mods.fs.writeFile(metaPath, JSON.stringify(meta), 'utf8'),
      ]);
    } catch {
      this.fallback.set(key, entry, ttlSeconds);
    }
  }

  async delete(key: string): Promise<boolean> {
    const mods = await this.getFs();
    if (!mods) return this.fallback.delete(key);

    const safeKey = this.sanitizeKey(key);
    const dataPath = mods.path.join(this.cacheDir, `${safeKey}.bin`);
    const metaPath = mods.path.join(this.cacheDir, `${safeKey}.json`);

    try {
      await Promise.allSettled([mods.fs.unlink(dataPath), mods.fs.unlink(metaPath)]);
      return true;
    } catch {
      return false;
    }
  }

  async clear(): Promise<void> {
    const mods = await this.getFs();
    if (!mods) {
      this.fallback.clear();
      return;
    }

    try {
      const files = await mods.fs.readdir(this.cacheDir);
      await Promise.allSettled(files.map((file) => mods.fs.unlink(mods.path.join(this.cacheDir, file))));
    } catch {
      this.fallback.clear();
    }
  }

  async has(key: string): Promise<boolean> {
    const entry = await this.get(key);
    return entry !== null;
  }
}

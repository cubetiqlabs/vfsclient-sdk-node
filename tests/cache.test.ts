import { describe, expect, it } from 'bun:test';
import { MemoryCacheAdapter } from '../src/cache/memory';
import { FileSystemCacheAdapter } from '../src/cache/filesystem';
import { VFSClient } from '../src/client';

describe('VFS Caching Subsystem', () => {
  it('stores, retrieves, and expires items in MemoryCacheAdapter', async () => {
    const cache = new MemoryCacheAdapter({ defaultTTL: 1 }); // 1 second TTL
    const data = new TextEncoder().encode('cache test');

    cache.set('key1', {
      data,
      contentType: 'text/plain',
      size: data.byteLength,
      createdAt: Date.now(),
    });

    expect(cache.has('key1')).toBe(true);
    const item = cache.get('key1');
    expect(item).not.toBeNull();
    expect(new TextDecoder().decode(item?.data)).toBe('cache test');

    // Test TTL expiration
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(cache.get('key1')).toBeNull();
    expect(cache.has('key1')).toBe(false);
  });

  it('evicts oldest item on LRU capacity limit', () => {
    const cache = new MemoryCacheAdapter({ maxItems: 2 });
    const createEntry = (str: string) => ({
      data: new TextEncoder().encode(str),
      size: str.length,
      createdAt: Date.now(),
    });

    cache.set('a', createEntry('A'));
    cache.set('b', createEntry('B'));
    expect(cache.size()).toBe(2);

    // Access 'a' to make 'b' the oldest
    cache.get('a');

    // Add 'c' -> should evict 'b'
    cache.set('c', createEntry('C'));
    expect(cache.has('b')).toBe(false);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('c')).toBe(true);
  });

  it('persists and deletes files in FileSystemCacheAdapter', async () => {
    const tempDir = `./.test-vfs-cache-${Math.random().toString(36).slice(2)}`;
    const cache = new FileSystemCacheAdapter({ cacheDir: tempDir });
    const data = new TextEncoder().encode('file system cache content');

    await cache.set('my-doc', {
      data,
      name: 'doc.txt',
      contentType: 'text/plain',
      size: data.byteLength,
      createdAt: Date.now(),
    });

    const entry = await cache.get('my-doc');
    expect(entry).not.toBeNull();
    expect(new TextDecoder().decode(entry?.data)).toBe('file system cache content');
    expect(entry?.name).toBe('doc.txt');

    await cache.delete('my-doc');
    const afterDelete = await cache.get('my-doc');
    expect(afterDelete).toBeNull();

    await cache.clear();
  });

  it('getFile caches response and deleteFile invalidates cache', async () => {
    let fetchCount = 0;
    const mockData = new TextEncoder().encode('remote file bytes');

    const mockFetch: typeof fetch = async (url, init) => {
      const urlStr = String(url);
      if (urlStr.includes('/v/default/test-file')) {
        fetchCount++;
        return new Response(mockData, {
          status: 200,
          headers: {
            'Content-Type': 'text/plain',
            'Content-Disposition': 'inline; filename="test-file.txt"',
          },
        });
      }
      if (urlStr.includes('/api/upload/unlink/default/test-file') && init?.method === 'DELETE') {
        return new Response('', { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    };

    const client = new VFSClient({
      endpoint: 'https://vfs.example.com',
      fetch: mockFetch,
      cache: new MemoryCacheAdapter(),
    });

    // 1st request -> fetches over network
    const file1 = (await client.getFile('default', 'test-file', { responseType: 'text' })) as string;
    expect(file1).toBe('remote file bytes');
    expect(fetchCount).toBe(1);

    // 2nd request -> served from local cache!
    const file2 = (await client.getFile('default', 'test-file', { responseType: 'text' })) as string;
    expect(file2).toBe('remote file bytes');
    expect(fetchCount).toBe(1); // Network was not called!

    // Delete file -> invalidates cache
    await client.deleteFile('default', 'test-file');

    // 3rd request -> cache was cleared, fetches over network again!
    await client.getFile('default', 'test-file', { responseType: 'text' });
    expect(fetchCount).toBe(2);
  });
});

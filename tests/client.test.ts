import { describe, expect, it } from 'bun:test';
import { VFSClient } from '../src/client';
import { VFSError } from '../src/types/errors';
import { SDK_VERSION } from '../src/version';

describe('VFSClient Initialization & Authentication', () => {
  it('initializes with endpoint and apiKey', () => {
    const client = new VFSClient({
      endpoint: 'https://vfs.example.com/',
      apiKey: 'vfs_secret_123',
    });

    expect(client.http.getEndpoint()).toBe('https://vfs.example.com');
    expect(client.http.getApiKey()).toBe('vfs_secret_123');
    expect(client.http.getApiHash()).toBeUndefined();
    expect(client.defaultBucket).toBe('default');
  });

  it('initializes with apiHash', () => {
    const client = new VFSClient({
      endpoint: 'https://vfs.example.com',
      apiHash: 'hash_abc456',
      defaultBucket: 'media',
    });

    expect(client.http.getApiHash()).toBe('hash_abc456');
    expect(client.defaultBucket).toBe('media');
  });

  it('throws when endpoint is missing', () => {
    expect(() => new VFSClient({ endpoint: '' })).toThrow(VFSError);
  });

  it('generates public file URL with imgproxy options', () => {
    const client = new VFSClient({ endpoint: 'https://vfs.example.com' });
    const url = client.getFileUrl('photos', 'img-123.jpg', {
      download: true,
      imgproxy: {
        width: 800,
        height: 600,
        format: 'webp',
        quality: 85,
      },
    });

    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/v/photos/img-123.jpg');
    expect(parsed.searchParams.get('download')).toBe('true');
    expect(parsed.searchParams.get('w')).toBe('800');
    expect(parsed.searchParams.get('h')).toBe('600');
    expect(parsed.searchParams.get('fmt')).toBe('webp');
    expect(parsed.searchParams.get('q')).toBe('85');
  });

  it('generates hash-addressed file URL', () => {
    const client = new VFSClient({ endpoint: 'https://vfs.example.com' });
    const url = client.getFileUrlByHash('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(url).toBe('https://vfs.example.com/h/e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('sends authentication headers in requests', async () => {
    let capturedHeaders: Headers | undefined;

    const mockFetch: typeof fetch = async (_url, init) => {
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ allowed: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = new VFSClient({
      endpoint: 'https://vfs.example.com',
      apiKey: 'vfs_my_key',
      apiHash: 'vfs_my_hash',
      fetch: mockFetch,
    });

    await client.http.get('/api/test');

    expect(capturedHeaders).toBeDefined();
    expect(capturedHeaders?.get('x-api-key')).toBe('vfs_my_key');
    expect(capturedHeaders?.get('x-api-hash')).toBe('vfs_my_hash');
    expect(capturedHeaders?.get('User-Agent')).toContain('@cubis/vfsclient');
    expect(capturedHeaders?.get('User-Agent')).toContain(SDK_VERSION);
    expect(capturedHeaders?.get('x-user-agent')).toContain('@cubis/vfsclient');
  });

  it('correctly parses RFC 7807 problem details error responses', async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          type: 'https://vfs.internal/problems/quota-exceeded',
          title: 'Quota Exceeded',
          status: 400,
          detail: 'Bucket quota of 100MB has been reached',
          extensions: { trace_id: 'trace-12345', code: 'ERR_QUOTA' },
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/problem+json' },
        }
      );
    };

    const client = new VFSClient({
      endpoint: 'https://vfs.example.com',
      fetch: mockFetch,
    });

    try {
      await client.http.get('/api/test');
      expect(true).toBe(false); // Should not reach here
    } catch (err: any) {
      expect(err).toBeInstanceOf(VFSError);
      expect(err.status).toBe(400);
      expect(err.message).toBe('Bucket quota of 100MB has been reached');
      expect(err.code).toBe('ERR_QUOTA');
      expect(err.problem?.extensions?.trace_id).toBe('trace-12345');
      expect(err.is(400)).toBe(true);
    }
  });
});

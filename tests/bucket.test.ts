import { describe, expect, it } from 'bun:test';
import { VFSClient } from '../src/client';
import type { BucketStat, BucketStatSummary, BucketMetricsByDate, ObjectManifestResponse } from '../src/types';

describe('VFS Bucket Management & Metadata', () => {
  it('retrieves single bucket statistics', async () => {
    const mockStat: BucketStat = {
      bucket_id: 'product-images',
      total_size: 52428800,
      total_file: 150,
      total_dir: 12,
      total_read: 1200,
      total_write: 150,
      max_size_bytes: 1073741824,
      max_files: 5000,
      lifecycle_enabled: true,
      default_ttl_seconds: 2592000,
    };

    const mockFetch: typeof fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/bucket/stats/product-images')) {
        return new Response(JSON.stringify(mockStat), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not found', { status: 404 });
    };

    const client = new VFSClient({
      endpoint: 'https://vfs.example.com',
      fetch: mockFetch,
    });

    const stat = await client.getBucketStats('product-images');
    expect(stat.bucket_id).toBe('product-images');
    expect(stat.total_file).toBe(150);
    expect(stat.total_size).toBe(52428800);
    expect(stat.lifecycle_enabled).toBe(true);
  });

  it('retrieves system-wide bucket statistics summary', async () => {
    const mockSummary: BucketStatSummary = {
      total_buckets: 8,
      total_files: 4500,
      total_size: 10737418240,
    };

    const mockFetch: typeof fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/bucket/stats/summary')) {
        return new Response(JSON.stringify(mockSummary), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not found', { status: 404 });
    };

    const client = new VFSClient({
      endpoint: 'https://vfs.example.com',
      fetch: mockFetch,
    });

    const summary = await client.getBucketSummary();
    expect(summary.total_buckets).toBe(8);
    expect(summary.total_files).toBe(4500);
    expect(summary.total_size).toBe(10737418240);
  });

  it('retrieves bucket date metrics', async () => {
    const mockMetrics: BucketMetricsByDate[] = [
      { date: '2026-09-09', total_files: 100, total_size: 10000 },
      { date: '2026-09-10', total_files: 120, total_size: 12500 },
    ];

    const mockFetch: typeof fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/bucket/stats/default/metrics')) {
        return new Response(JSON.stringify(mockMetrics), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not found', { status: 404 });
    };

    const client = new VFSClient({
      endpoint: 'https://vfs.example.com',
      fetch: mockFetch,
    });

    const metrics = await client.getBucketMetrics('default');
    expect(metrics.length).toBe(2);
    expect(metrics[1].date).toBe('2026-09-10');
  });

  it('retrieves file metadata manifest as JSON object', async () => {
    const mockManifest: ObjectManifestResponse = {
      id: 'obj-id-99',
      bucket_id: 'default',
      file_id: 'file-report',
      file_hash: 'abc123hash',
      extension: 'pdf',
      name: 'financial_report.pdf',
      size: 204800,
      type: 'application/pdf',
      metadata: { department: 'Finance', year: 2026 },
      created_at: '2026-09-11T09:00:00Z',
      url: 'https://vfs.example.com/v/default/file-report.pdf',
      key: 'financial_report.pdf',
    };

    let acceptHeader: string | null = null;
    let queryOutput: string | null = null;

    const mockFetch: typeof fetch = async (url, init) => {
      const parsedUrl = new URL(String(url));
      queryOutput = parsedUrl.searchParams.get('output');
      acceptHeader = new Headers(init?.headers).get('accept');

      if (parsedUrl.pathname === '/v/default/file-report') {
        return new Response(JSON.stringify(mockManifest), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not found', { status: 404 });
    };

    const client = new VFSClient({
      endpoint: 'https://vfs.example.com',
      fetch: mockFetch,
    });

    const meta = await client.getFileMetadata('default', 'file-report');
    expect(queryOutput).toBe('json');
    expect(acceptHeader).toBe('application/json');
    expect(meta.name).toBe('financial_report.pdf');
    expect(meta.type).toBe('application/pdf');
    expect(meta.metadata?.department).toBe('Finance');
  });

  it('calls deleteFileById and deleteAllInBucket', async () => {
    const deletedPaths: string[] = [];

    const mockFetch: typeof fetch = async (url, init) => {
      if (init?.method === 'DELETE') {
        deletedPaths.push(new URL(String(url)).pathname);
        return new Response('', { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    };

    const client = new VFSClient({
      endpoint: 'https://vfs.example.com',
      fetch: mockFetch,
    });

    await client.deleteFileById('mongo-id-123');
    await client.deleteAllInBucket('temp-bucket');

    expect(deletedPaths).toContain('/api/upload/mongo-id-123');
    expect(deletedPaths).toContain('/api/upload/bucket/temp-bucket');
  });
});

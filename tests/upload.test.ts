import { describe, expect, it } from 'bun:test';
import { VFSClient } from '../src/client';
import type { AttachmentResponse } from '../src/types';

describe('VFS Uploads', () => {
  it('skips data transfer when preflight detects a duplicate file', async () => {
    const existingAttachment: AttachmentResponse = {
      id: 'existing-att-1',
      bucket_id: 'default',
      file_id: 'file-already-exists',
      file_hash: 'deduped-hash',
      extension: 'txt',
      name: 'notes.txt',
      size: 13,
      type: 'text/plain',
      created_at: '2026-09-11T10:00:00Z',
      url: 'https://vfs.example.com/v/default/file-already-exists.txt',
      key: 'notes.txt',
    };

    let uploadDataCalled = false;

    const mockFetch: typeof fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/upload/preflight')) {
        return new Response(
          JSON.stringify({
            allowed: true,
            bucket_id: 'default',
            size: 13,
            duplicate: existingAttachment,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
      if (urlStr.includes('/api/upload')) {
        uploadDataCalled = true;
        return new Response(JSON.stringify({ id: 'new' }), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    };

    const client = new VFSClient({
      endpoint: 'https://vfs.example.com',
      fetch: mockFetch,
    });

    const result = await client.upload({
      file: 'Hello, World!',
      name: 'notes.txt',
    });

    expect(uploadDataCalled).toBe(false);
    expect(result.file_id).toBe('file-already-exists');
    expect(result.name).toBe('notes.txt');
  });

  it('performs standard single upload with preflight', async () => {
    let preflightCalled = false;
    let uploadCalled = false;

    const uploadedAttachment: AttachmentResponse = {
      id: 'att-123',
      bucket_id: 'default',
      file_id: 'f-123',
      extension: 'png',
      name: 'avatar.png',
      size: 100,
      type: 'image/png',
      created_at: '2026-09-11T10:00:00Z',
      url: 'https://vfs.example.com/v/default/f-123.png',
      key: 'avatar.png',
    };

    const mockFetch: typeof fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/upload/preflight')) {
        preflightCalled = true;
        return new Response(
          JSON.stringify({
            allowed: true,
            bucket_id: 'default',
            size: 100,
            upload_token: 'token-xyz',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (urlStr.includes('/api/upload')) {
        uploadCalled = true;
        return new Response(JSON.stringify(uploadedAttachment), {
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

    const phases: string[] = [];
    const result = await client.upload({
      file: new Uint8Array(100),
      name: 'avatar.png',
      contentType: 'image/png',
      onProgress: (p) => phases.push(p.phase),
    });

    expect(preflightCalled).toBe(true);
    expect(uploadCalled).toBe(true);
    expect(result.file_id).toBe('f-123');
    expect(phases).toContain('hashing');
    expect(phases).toContain('preflight');
    expect(phases).toContain('uploading');
    expect(phases).toContain('complete');
  });

  it('executes chunked session upload', async () => {
    let sessionCreated = false;
    let chunksUploaded = 0;
    let finalized = false;

    const mockFetch: typeof fetch = async (url, init) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/upload/sessions') && init?.method === 'POST') {
        if (urlStr.includes('/finalize')) {
          finalized = true;
          return new Response(
            JSON.stringify({
              id: 'sess-123',
              name: 'large.bin',
              state: 'complete',
              offset: 200,
              size: 200,
              chunk_size: 100,
              attempts: 1,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        sessionCreated = true;
        return new Response(
          JSON.stringify({
            id: 'sess-123',
            name: 'large.bin',
            state: 'receiving',
            offset: 0,
            size: 200,
            chunk_size: 100,
            attempts: 0,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (urlStr.includes('/chunks/') && init?.method === 'PUT') {
        chunksUploaded++;
        const offset = parseInt(urlStr.split('/chunks/')[1], 10);
        return new Response(
          JSON.stringify({
            id: 'sess-123',
            name: 'large.bin',
            state: 'receiving',
            offset: offset + 100,
            size: 200,
            chunk_size: 100,
            attempts: 0,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response('Not found', { status: 404 });
    };

    const client = new VFSClient({
      endpoint: 'https://vfs.example.com',
      fetch: mockFetch,
    });

    const result = await client.upload({
      file: new Uint8Array(200),
      name: 'large.bin',
      resumable: true,
      chunkSize: 100,
    });

    expect(sessionCreated).toBe(true);
    expect(chunksUploaded).toBe(2);
    expect(finalized).toBe(true);
    expect(result.file_id).toBe('sess-123');
    expect(result.store).toBe('edge');
  });

  it('uploads multiple files in background with concurrency control', async () => {
    let activeUploads = 0;
    let maxConcurrency = 0;

    const mockFetch: typeof fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/upload/preflight')) {
        return new Response(JSON.stringify({ allowed: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (urlStr.includes('/api/upload')) {
        activeUploads++;
        maxConcurrency = Math.max(maxConcurrency, activeUploads);
        // Simulate transfer time
        await new Promise((resolve) => setTimeout(resolve, 30));
        activeUploads--;
        return new Response(
          JSON.stringify({
            id: 'id-' + Math.random(),
            file_id: 'f-' + Math.random(),
            bucket_id: 'default',
            extension: 'txt',
            name: 'doc.txt',
            size: 10,
            type: 'text/plain',
            created_at: new Date().toISOString(),
            url: 'https://vfs.example.com/v/default/doc.txt',
            key: 'doc.txt',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    };

    const client = new VFSClient({
      endpoint: 'https://vfs.example.com',
      fetch: mockFetch,
    });

    const files = [
      { file: 'file 1', name: 'f1.txt' },
      { file: 'file 2', name: 'f2.txt' },
      { file: 'file 3', name: 'f3.txt' },
      { file: 'file 4', name: 'f4.txt' },
      { file: 'file 5', name: 'f5.txt' },
    ];

    const results = await client.uploadMultiple({
      files,
      concurrency: 2,
    });

    expect(results.length).toBe(5);
    expect(maxConcurrency).toBeLessThanOrEqual(2);
  });
});

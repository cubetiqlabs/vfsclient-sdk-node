import type { HttpClient } from '../http/client';
import type { AttachmentResponse, UploadInput } from '../types';
import { normalizeUploadInput } from './normalizer';
import { executePreflight } from './preflight';
import { VFSError } from '../types/errors';
import { openUploadSource } from './source';

export async function uploadSingleFile(
  http: HttpClient,
  input: UploadInput,
  defaultBucket: string = 'default'
): Promise<AttachmentResponse> {
  const bucketId = input.bucketId || defaultBucket;

  input.onProgress?.({
    loaded: 0,
    total: 100,
    percent: 5,
    phase: 'hashing',
  });

  // A Node/Bun file path can use the server's streamed raw PUT endpoint. It hashes
  // in one pass and sends a fresh file stream in another, keeping memory bounded.
  if (typeof input.file === 'string' && typeof process !== 'undefined' && process.versions?.node) {
    const fs = await import('node:fs');
    const fsp = await import('node:fs/promises');
    try {
      if ((await fsp.stat(input.file)).isFile()) {
        const source = await openUploadSource(input);
        try {
          const preflight = input.preflight === false ? undefined : await executePreflight(http, {
            bucket_id: bucketId, name: source.name, size: source.size, content_type: source.contentType, file_hash: source.hash,
          }, input.signal);
          if (preflight?.duplicate) return preflight.duplicate;
          if (preflight && !preflight.allowed) throw new VFSError(preflight.reason || 'Upload rejected', { status: 400 });
          const key = `software-${crypto.randomUUID().replace(/-/g, '')}-${source.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
          const path = `/api/upload/${encodeURIComponent(bucketId)}/${encodeURIComponent(key)}`;
          const query = new URLSearchParams({ filename: source.name, file_hash: source.hash, skip_duplicate: 'true' });
          if (preflight?.upload_token) query.set('upload_token', preflight.upload_token);
          const { Readable } = await import('node:stream');
          const body = Readable.toWeb(fs.createReadStream(input.file)) as ReadableStream<Uint8Array>;
          const result = await http.put<AttachmentResponse>(`${path}?${query}`, body as BodyInit, {
            headers: { 'Content-Type': source.contentType }, signal: input.signal, timeout: 0,
          });
          return result.data;
        } finally {
          await source.close();
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  if (typeof Blob !== 'undefined' && input.file instanceof Blob) {
    const source = await openUploadSource(input);
    try {
      const preflight = input.preflight === false ? undefined : await executePreflight(http, {
        bucket_id: bucketId, name: source.name, size: source.size, content_type: source.contentType, file_hash: source.hash,
      }, input.signal);
      if (preflight?.duplicate) return preflight.duplicate;
      if (preflight && !preflight.allowed) throw new VFSError(preflight.reason || 'Upload rejected', { status: 400 });
      const data = new FormData();
      data.append('file', input.file, source.name);
      data.append('bucket_id', bucketId);
      data.append('file_hash', source.hash);
      if (preflight?.upload_token) data.append('upload_token', preflight.upload_token);
      const result = await http.post<AttachmentResponse>('/api/upload', data, { signal: input.signal, timeout: 0 });
      return result.data;
    } finally { await source.close(); }
  }

  const normalized = await normalizeUploadInput(input);

  // Preflight check
  let uploadToken: string | undefined;
  if (input.preflight !== false) {
    input.onProgress?.({
      loaded: 0,
      total: normalized.size,
      percent: 15,
      phase: 'preflight',
    });

    const preflight = await executePreflight(
      http,
      {
        bucket_id: bucketId,
        name: normalized.name,
        size: normalized.size,
        content_type: normalized.contentType,
        file_hash: normalized.hash,
      },
      input.signal
    );

    // If file already exists in bucket, return deduplicated attachment immediately!
    if (preflight.duplicate) {
      input.onProgress?.({
        loaded: normalized.size,
        total: normalized.size,
        percent: 100,
        phase: 'complete',
      });
      return preflight.duplicate;
    }

    if (!preflight.allowed) {
      throw new VFSError(preflight.reason || 'Upload rejected by server preflight check', {
        status: 400,
      });
    }

    uploadToken = preflight.upload_token;
  }

  // Upload bytes via multipart/form-data
  input.onProgress?.({
    loaded: 0,
    total: normalized.size,
    percent: 30,
    phase: 'uploading',
  });

  const formData = new FormData();
  // Wrap Uint8Array in Blob
  const blob = new Blob([normalized.bytes as any], { type: normalized.contentType });
  formData.append('file', blob, normalized.name);
  formData.append('bucket_id', bucketId);

  if (normalized.hash) {
    formData.append('file_hash', normalized.hash);
  }

  if (uploadToken) {
    formData.append('upload_token', uploadToken);
  }

  if (input.metadata && Object.keys(input.metadata).length > 0) {
    formData.append('metadata', JSON.stringify(input.metadata));
  }

  const res = await http.post<AttachmentResponse>('/api/upload', formData, {
    signal: input.signal,
  });

  input.onProgress?.({
    loaded: normalized.size,
    total: normalized.size,
    percent: 100,
    phase: 'complete',
  });

  return res.data;
}

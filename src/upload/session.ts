import type { HttpClient, HttpResponse } from '../http/client';
import type { AttachmentResponse, SessionView, UploadInput } from '../types';
import { openUploadSource } from './source';
import { calculateSHA256 } from '../crypto/hash';
import { VFSError } from '../types/errors';

const DEFAULT_CHUNK_SIZE = 1048576; // 1 MiB standard VFS chunk size
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function generateSessionId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

/**
 * Uploads a file using the VFS Resumable Chunked Session Upload Protocol.
 * Ideal for large files, unstable connections, and edge-distributed storage.
 */
export async function uploadSessionFile(
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

  const normalized = await openUploadSource(input);
  try {
  const sessionId = input.resumeId || generateSessionId();
  const chunkSize = input.chunkSize || DEFAULT_CHUNK_SIZE;

  input.onProgress?.({
    loaded: 0,
    total: normalized.size,
    percent: 10,
    phase: 'preflight',
  });

  // 1. Create or recover session
  let session: SessionView | undefined;
  let failures = 0;

  while (!session) {
    if (input.signal?.aborted) {
      throw new VFSError('Upload aborted', { status: 499 });
    }

    try {
      const res = await http.post<SessionView>(
        '/api/upload/sessions',
        JSON.stringify({
          id: sessionId,
          bucket_id: bucketId,
          name: normalized.name,
          size: normalized.size,
          file_hash: normalized.hash,
          content_type: normalized.contentType,
        }),
        {
          headers: { 'Content-Type': 'application/json' },
          signal: input.signal,
          timeout: 15000,
        }
      );
      session = res.data;
    } catch (err: unknown) {
      if (err instanceof VFSError) {
        if (err.status === 410) {
          throw new VFSError('The upload session has expired. Start a new session.', { status: 410, cause: err });
        }
        if ([400, 401, 403, 409, 413, 422, 503].includes(err.status)) {
          throw err;
        }
      }

      failures++;
      if (failures >= 5) {
        if (err instanceof VFSError) {
          throw err;
        }
        throw new VFSError(
          `Failed to initialize upload session: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err }
        );
      }

      await delay(500 * Math.pow(2, failures - 1));
    }
  }

  if (!session) {
    throw new VFSError('Failed to initialize upload session');
  }

  let currentSession: SessionView = session;

  // 2. Upload chunks
  failures = 0;
  let offset = currentSession.offset;

  while (['receiving', 'paused'].includes(currentSession.state) && offset < normalized.size) {
    if (input.signal?.aborted) {
      throw new VFSError('Upload aborted', { status: 499 });
    }

    const currentChunkSize = Math.min(currentSession.chunk_size || chunkSize, normalized.size - offset);
    const chunkBytes = await normalized.read(offset, currentChunkSize);
    const chunkHash = await calculateSHA256(chunkBytes);

    const percent = Math.min(95, 15 + Math.floor((offset / normalized.size) * 80));
    input.onProgress?.({
      loaded: offset,
      total: normalized.size,
      percent,
      phase: 'chunks',
    });

    try {
      const chunkRes: HttpResponse<SessionView> = await http.put<SessionView>(
        `/api/upload/sessions/${currentSession.id}/chunks/${offset}`,
        // Pass Uint8Array slice directly as binary body
        chunkBytes as unknown as BodyInit,
        {
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-Upload-SHA256': chunkHash,
          },
          signal: input.signal,
          timeout: 30000,
        }
      );

      currentSession = chunkRes.data;
      offset = currentSession.offset;
      failures = 0;
    } catch (err: unknown) {
      failures++;
      if (err instanceof VFSError && [400, 401, 403, 410, 413, 422].includes(err.status)) {
        throw err;
      }

      if (failures >= 6) {
        throw new VFSError(`Chunk upload failed at offset ${offset}: ${err instanceof Error ? err.message : 'Unknown error'}`, {
          cause: err,
        });
      }

      await delay(Math.min(500 * Math.pow(2, failures - 1), 8000));

      // Attempt to sync status from server
      try {
        const statusRes = await http.get<SessionView>(`/api/upload/sessions/${currentSession.id}`, {
          timeout: 10000,
          signal: input.signal,
        });
        currentSession = statusRes.data;
        offset = currentSession.offset;
      } catch {
        // Keep previous offset and retry same chunk
      }
    }
  }

  // 3. Finalize session
  input.onProgress?.({
    loaded: normalized.size,
    total: normalized.size,
    percent: 96,
    phase: 'finalizing',
  });

  if (currentSession.state !== 'complete') {
    for (let attempt = 0; attempt < 5; attempt++) {
      if (input.signal?.aborted) {
        throw new VFSError('Upload aborted', { status: 499 });
      }

      try {
        const finalRes = await http.post<SessionView>(
          `/api/upload/sessions/${currentSession.id}/finalize`,
          '{}',
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: 15000,
            signal: input.signal,
          }
        );
        currentSession = finalRes.data;
        break;
      } catch (err: unknown) {
        if (attempt >= 4) {
          throw new VFSError('Failed to finalize session upload', { cause: err });
        }
        await delay(1000);
      }
    }
  }

  // Poll until complete or max attempts
  let pollAttempts = 0;
  while (currentSession.state !== 'complete' && pollAttempts < 10) {
    await delay(1000);
    try {
      const statusRes = await http.get<SessionView>(`/api/upload/sessions/${currentSession.id}`, {
        timeout: 5000,
        signal: input.signal,
      });
      currentSession = statusRes.data;
      if (currentSession.state === 'complete') break;
    } catch {
      // Ignore transient polling failure
    }
    pollAttempts++;
  }

  input.onProgress?.({
    loaded: normalized.size,
    total: normalized.size,
    percent: 100,
    phase: 'complete',
  });

  // Construct standard AttachmentResponse
  const ext = normalized.name.split('.').pop() || '';
  const fileUrl = `${http.getEndpoint()}/v/${bucketId}/${currentSession.id}${ext ? `.${ext}` : ''}`;

  return {
    id: currentSession.id,
    bucket_id: bucketId,
    file_id: currentSession.id,
    file_hash: normalized.hash,
    extension: ext,
    name: normalized.name,
    size: normalized.size,
    type: normalized.contentType,
    metadata: input.metadata,
    created_at: new Date().toISOString(),
    url: fileUrl,
    key: `edge:${currentSession.id}`,
    store: 'edge',
    is_stat_synced: true,
  };
  } finally {
    await normalized.close();
  }
}

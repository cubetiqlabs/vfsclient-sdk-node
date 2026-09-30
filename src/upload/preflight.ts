import type { HttpClient } from '../http/client';
import type { PreflightRequest, PreflightResponse } from '../types/models';
import { VFSError } from '../types/errors';

/**
 * Checks metadata with VFS Server preflight endpoint before uploading data.
 * Detects quota violations, file size exceedance, and duplicate hits.
 */
export async function executePreflight(
  http: HttpClient,
  req: PreflightRequest,
  signal?: AbortSignal
): Promise<PreflightResponse> {
  try {
    const res = await http.post<PreflightResponse>('/api/upload/preflight', JSON.stringify(req), {
      headers: { 'Content-Type': 'application/json' },
      signal,
    });
    return res.data;
  } catch (err: unknown) {
    // If the server does not implement /preflight (404), fall back to standard upload
    if (err instanceof VFSError && err.status === 404) {
      return {
        allowed: true,
        bucket_id: req.bucket_id,
        size: req.size ?? 0,
        max_upload_bytes: 0,
      };
    }
    throw err;
  }
}

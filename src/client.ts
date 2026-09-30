import type {
  AttachmentResponse,
  BucketMetricsByDate,
  BucketStat,
  BucketStatSummary,
  BucketStatsListResponse,
  GetFileOptions,
  GetUrlOptions,
  ListFilesOptions,
  ObjectManifestResponse,
  UploadInput,
  UploadMultipleInput,
  VFSClientOptions,
} from './types';
import { VFSError } from './types/errors';
import { HttpClient } from './http/client';
import type { VFSCacheAdapter } from './cache/adapter';
import { createDefaultCache } from './cache/factory';
import { uploadSingleFile } from './upload/single';
import { uploadSessionFile } from './upload/session';
import { BackgroundUploadQueue, uploadMultipleFiles } from './upload/queue';
import { SoftwareClient } from './software/client';

export class VFSClient {
  readonly http: HttpClient;
  readonly defaultBucket: string;
  readonly cache?: VFSCacheAdapter;
  readonly software: SoftwareClient;

  constructor(options: VFSClientOptions) {
    this.http = new HttpClient(options);
    this.software = new SoftwareClient(this.http);
    this.defaultBucket = options.defaultBucket || 'default';

    if (options.cache === true) {
      this.cache = createDefaultCache();
    } else if (options.cache && typeof options.cache === 'object') {
      this.cache = options.cache;
    }
  }

  /**
   * Upload a single file to VFS.
   * Proactively checks preflight quota and deduplication: if identical file content exists,
   * skips transfer and returns the existing file immediately.
   */
  async upload(input: UploadInput): Promise<AttachmentResponse> {
    if (input.resumable) {
      return uploadSessionFile(this.http, input, this.defaultBucket);
    }
    return uploadSingleFile(this.http, input, this.defaultBucket);
  }

  /**
   * Upload multiple files with concurrency control, progress reporting, and stream/chunk support.
   */
  async uploadMultiple(input: UploadMultipleInput): Promise<AttachmentResponse[]> {
    return uploadMultipleFiles(this.http, input, this.defaultBucket);
  }

  /**
   * Creates a background upload queue manager for continuous uploads with pause/resume and events.
   */
  createBackgroundQueue(options?: { concurrency?: number; bucketId?: string }): BackgroundUploadQueue {
    return new BackgroundUploadQueue(this.http, {
      defaultBucket: options?.bucketId || this.defaultBucket,
      concurrency: options?.concurrency || 3,
    });
  }

  /**
   * Retrieves a file from VFS with multi-tier caching (Browser CacheStorage / Server Filesystem).
   */
  async getFile(
    bucketId: string,
    fileId: string,
    options: GetFileOptions = {}
  ): Promise<Blob | ArrayBuffer | ReadableStream<Uint8Array> | string | unknown> {
    const cacheKey = `vfs:${bucketId}:${fileId}`;
    const shouldUseCache = options.useCache !== false && Boolean(this.cache);

    // 1. Check cache first
    if (shouldUseCache && this.cache) {
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        if (options.responseType === 'arrayBuffer') {
          return cached.data.buffer.slice(cached.data.byteOffset, cached.data.byteOffset + cached.data.byteLength);
        }
        if (options.responseType === 'text') {
          return new TextDecoder().decode(cached.data);
        }
        if (options.responseType === 'json') {
          return JSON.parse(new TextDecoder().decode(cached.data));
        }
        if (options.responseType === 'stream') {
          return new ReadableStream({
            start(controller) {
              controller.enqueue(cached.data);
              controller.close();
            },
          });
        }
        // Default: Blob
        return new Blob([cached.data as any], { type: cached.contentType });
      }
    }

    // 2. Fetch from VFS Server
    const params: Record<string, string | number | boolean | undefined> = {};
    if (options.download) {
      params.download = true;
    }
    if (options.imgproxy) {
      if (options.imgproxy.width) params.w = options.imgproxy.width;
      if (options.imgproxy.height) params.h = options.imgproxy.height;
      if (options.imgproxy.resizingType) params.rs = options.imgproxy.resizingType;
      if (options.imgproxy.format) params.fmt = options.imgproxy.format;
      if (options.imgproxy.quality) params.q = options.imgproxy.quality;
    }

    const response = await this.http.fetchRaw(`/v/${encodeURIComponent(bucketId)}/${encodeURIComponent(fileId)}`, {
      params,
      signal: options.signal,
    });

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const contentDisposition = response.headers.get('content-disposition') || '';
    let filename: string | undefined;
    const match = contentDisposition.match(/filename="?([^";]+)"?/);
    if (match) filename = match[1];

    // Read bytes
    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // 3. Save to cache
    if (shouldUseCache && this.cache) {
      await this.cache.set(cacheKey, {
        data: bytes,
        contentType,
        name: filename,
        size: bytes.byteLength,
        createdAt: Date.now(),
      });
    }

    // 4. Return formatted response
    if (options.responseType === 'arrayBuffer') {
      return arrayBuffer;
    }
    if (options.responseType === 'text') {
      return new TextDecoder().decode(bytes);
    }
    if (options.responseType === 'json') {
      return JSON.parse(new TextDecoder().decode(bytes));
    }
    if (options.responseType === 'stream') {
      return new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });
    }

    return new Blob([bytes as any], { type: contentType });
  }

  /**
   * Retrieves a file directly by its SHA-256 hash (/h/:hash).
   * Hash-addressed content is immutable and cached indefinitely.
   */
  async getFileByHash(
    hash: string,
    options: GetFileOptions = {}
  ): Promise<Blob | ArrayBuffer | ReadableStream<Uint8Array> | string | unknown> {
    const cacheKey = `vfs:hash:${hash}`;
    const shouldUseCache = options.useCache !== false && Boolean(this.cache);

    if (shouldUseCache && this.cache) {
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        if (options.responseType === 'arrayBuffer') {
          return cached.data.buffer.slice(cached.data.byteOffset, cached.data.byteOffset + cached.data.byteLength);
        }
        if (options.responseType === 'text') {
          return new TextDecoder().decode(cached.data);
        }
        if (options.responseType === 'json') {
          return JSON.parse(new TextDecoder().decode(cached.data));
        }
        return new Blob([cached.data as any], { type: cached.contentType });
      }
    }

    const response = await this.http.fetchRaw(`/h/${encodeURIComponent(hash)}`, {
      signal: options.signal,
    });

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    if (shouldUseCache && this.cache) {
      // 1 year TTL for immutable content
      await this.cache.set(
        cacheKey,
        {
          data: bytes,
          contentType,
          size: bytes.byteLength,
          hash,
          createdAt: Date.now(),
        },
        31536000
      );
    }

    if (options.responseType === 'arrayBuffer') {
      return arrayBuffer;
    }
    if (options.responseType === 'text') {
      return new TextDecoder().decode(bytes);
    }
    if (options.responseType === 'json') {
      return JSON.parse(new TextDecoder().decode(bytes));
    }

    return new Blob([bytes as any], { type: contentType });
  }

  /**
   * Gets metadata manifest of an uploaded file as a JSON object without downloading the file data.
   */
  async getFileMetadata(bucketId: string, fileId: string, signal?: AbortSignal): Promise<ObjectManifestResponse> {
    const res = await this.http.get<ObjectManifestResponse>(
      `/v/${encodeURIComponent(bucketId)}/${encodeURIComponent(fileId)}`,
      {
        params: { output: 'json' },
        headers: { Accept: 'application/json' },
        signal,
      }
    );
    return res.data;
  }

  /**
   * Gets metadata manifest of a file by its SHA-256 hash.
   */
  async getFileMetadataByHash(hash: string, signal?: AbortSignal): Promise<ObjectManifestResponse> {
    const res = await this.http.get<ObjectManifestResponse>(`/h/${encodeURIComponent(hash)}`, {
      params: { output: 'json' },
      headers: { Accept: 'application/json' },
      signal,
    });
    return res.data;
  }

  /**
   * Generates public/access URL for a file, supporting imgproxy transformations and download triggers.
   */
  getFileUrl(bucketId: string, fileId: string, options: GetUrlOptions = {}): string {
    const url = new URL(`${this.http.getEndpoint()}/v/${encodeURIComponent(bucketId)}/${encodeURIComponent(fileId)}`);
    if (options.download) {
      url.searchParams.set('download', 'true');
    }
    if (options.imgproxy) {
      if (options.imgproxy.width) url.searchParams.set('w', String(options.imgproxy.width));
      if (options.imgproxy.height) url.searchParams.set('h', String(options.imgproxy.height));
      if (options.imgproxy.resizingType) url.searchParams.set('rs', options.imgproxy.resizingType);
      if (options.imgproxy.format) url.searchParams.set('fmt', options.imgproxy.format);
      if (options.imgproxy.quality) url.searchParams.set('q', String(options.imgproxy.quality));
    }
    return url.toString();
  }

  /**
   * Generates public URL for a file addressed by its SHA-256 hash.
   */
  getFileUrlByHash(hash: string): string {
    return `${this.http.getEndpoint()}/h/${encodeURIComponent(hash)}`;
  }

  /**
   * Deletes a file by bucket ID and file ID, invalidating any cached copies.
   */
  async deleteFile(bucketId: string, fileId: string, signal?: AbortSignal): Promise<void> {
    try {
      await this.http.delete(`/api/upload/unlink/${encodeURIComponent(bucketId)}/${encodeURIComponent(fileId)}`, {
        signal,
      });
    } catch (err: unknown) {
      // If 404, file is already gone, consider success
      if (err instanceof VFSError && err.status === 404) {
        // No-op
      } else {
        throw err;
      }
    }

    if (this.cache) {
      await this.cache.delete(`vfs:${bucketId}:${fileId}`);
    }
  }

  /**
   * Deletes a file record by catalog ID.
   */
  async deleteFileById(id: string, signal?: AbortSignal): Promise<void> {
    await this.http.delete(`/api/upload/${encodeURIComponent(id)}`, { signal });
  }

  /**
   * Deletes all files within a specified bucket.
   */
  async deleteAllInBucket(bucketId: string, signal?: AbortSignal): Promise<void> {
    await this.http.delete(`/api/upload/bucket/${encodeURIComponent(bucketId)}`, { signal });
  }

  /**
   * Lists stored objects in a bucket.
   */
  async listFiles(options: ListFilesOptions = {}): Promise<AttachmentResponse[]> {
    const bucketId = options.bucketId || this.defaultBucket;
    const res = await this.http.get<AttachmentResponse[]>('/api/upload', {
      params: { bucket_id: bucketId },
      signal: options.signal,
    });
    return res.data;
  }

  /**
   * Gets real-time statistics for a bucket (total files, storage usage, read/write counts, quota limits).
   */
  async getBucketStats(bucketId?: string, signal?: AbortSignal): Promise<BucketStat> {
    const targetBucket = bucketId || this.defaultBucket;
    const res = await this.http.get<BucketStat>(`/api/bucket/stats/${encodeURIComponent(targetBucket)}`, { signal });
    return res.data;
  }

  /**
   * Gets a list of all bucket statistics.
   */
  async getAllBucketStats(
    params?: { page?: number; limit?: number },
    signal?: AbortSignal
  ): Promise<BucketStatsListResponse> {
    const res = await this.http.get<BucketStat[]>('/api/bucket/stats', {
      params,
      signal,
    });
    return {
      items: res.data,
      total: res.totalCount,
    };
  }

  /**
   * Gets overall system summary of bucket statistics (total buckets, total files, total storage size).
   */
  async getBucketSummary(signal?: AbortSignal): Promise<BucketStatSummary> {
    const res = await this.http.get<BucketStatSummary>('/api/bucket/stats/summary', { signal });
    return res.data;
  }

  /**
   * Gets date-based usage growth metrics for a bucket.
   */
  async getBucketMetrics(bucketId?: string, signal?: AbortSignal): Promise<BucketMetricsByDate[]> {
    const targetBucket = bucketId || this.defaultBucket;
    const res = await this.http.get<BucketMetricsByDate[]>(
      `/api/bucket/stats/${encodeURIComponent(targetBucket)}/metrics`,
      { signal }
    );
    return res.data;
  }
}

import type { VFSCacheAdapter } from '../cache/adapter';
import type { AttachmentResponse, BucketStat } from './models';

export * from './models';
export * from './errors';

export type SupportedBinaryInput =
  | Blob
  | File
  | Uint8Array
  | ArrayBuffer
  | ReadableStream<Uint8Array>
  | NodeJS.ReadableStream
  | string; // File path on node/bun or base64 data url / text

export interface VFSClientOptions {
  /**
   * Base URL of the VFS Server (e.g. "http://localhost:5002" or "https://vfs.company.com").
   */
  endpoint: string;

  /**
   * API Key for authentication (sent via `x-api-key` header).
   */
  apiKey?: string;

  /**
   * HMAC/Hashed API Key for authentication (sent via `x-api-hash` header).
   */
  apiHash?: string;

  /** Bearer access token, for authenticated Console sessions. */
  accessToken?: string;

  /**
   * Default bucket ID to use if not specified in method calls (defaults to 'default').
   */
  defaultBucket?: string;

  /**
   * Request timeout in milliseconds (default: 30,000ms = 30s).
   */
  timeout?: number;

  /**
   * Caching configuration:
   * - `true`: automatically uses Browser Cache API in browser or FileSystem / Memory cache in Node.js
   * - `false` or `undefined`: caching disabled
   * - `VFSCacheAdapter`: custom cache adapter instance
   */
  cache?: boolean | VFSCacheAdapter;

  /**
   * Optional custom fetch implementation (defaults to globalThis.fetch).
   */
  fetch?: typeof fetch;

  /**
   * Enable debug logging or provide custom logger.
   */
  debug?: boolean | ((message: string, ...args: unknown[]) => void);

  /**
   * Retry configuration for transient HTTP errors (network failures, 502, 503, 504).
   */
  retry?: {
    maxRetries?: number;
    retryDelay?: number;
    retryOnStatus?: number[];
  };
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
  phase: 'hashing' | 'preflight' | 'uploading' | 'chunks' | 'finalizing' | 'complete';
}

export interface UploadInput {
  /**
   * File data: Blob, File, Uint8Array, Buffer, ReadableStream, or local file path in Node.js.
   */
  file: SupportedBinaryInput;

  /**
   * Target bucket ID (defaults to client's defaultBucket, or 'default').
   */
  bucketId?: string;

  /**
   * Original file name (required if input is stream/buffer without name).
   */
  name?: string;

  /**
   * MIME content type (e.g. "image/png", "application/pdf").
   */
  contentType?: string;

  /**
   * Pre-calculated SHA-256 hash. If not provided, will be computed automatically for preflight.
   */
  fileHash?: string;

  /**
   * Custom metadata attached to the file in MongoDB.
   */
  metadata?: Record<string, unknown>;

  /**
   * Whether to run preflight check before uploading bytes (default: true).
   * Preflight checks quota, file size limits, and checks for deduplication.
   */
  preflight?: boolean;

  /**
   * If true, forces chunked session upload (or when preflight indicates edge-chunks-v1).
   */
  resumable?: boolean;

  /**
   * Chunk size in bytes for chunked uploads (default: 1,048,576 = 1 MiB).
   */
  chunkSize?: number;

  /**
   * Session ID to resume an interrupted chunked upload.
   */
  resumeId?: string;

  /**
   * Progress callback for upload updates.
   */
  onProgress?: (progress: UploadProgress) => void;

  /**
   * Optional AbortSignal for cancellation.
   */
  signal?: AbortSignal;
}

export interface UploadMultipleInput {
  /**
   * List of files to upload.
   */
  files: UploadInput[];

  /**
   * Target bucket ID for all files unless overridden per file.
   */
  bucketId?: string;

  /**
   * Maximum concurrent uploads (default: 3).
   */
  concurrency?: number;

  /**
   * Overall progress callback for the batch.
   */
  onProgress?: (progress: {
    totalFiles: number;
    completedFiles: number;
    failedFiles: number;
    overallPercent: number;
    currentFile?: string;
  }) => void;

  /**
   * Callback on each file success.
   */
  onFileSuccess?: (file: UploadInput, response: AttachmentResponse) => void;

  /**
   * Callback on file failure.
   */
  onFileError?: (file: UploadInput, error: Error) => void;

  /**
   * AbortSignal for cancelling entire batch.
   */
  signal?: AbortSignal;
}

export interface ImgProxyOptions {
  width?: number;
  height?: number;
  resizingType?: 'fit' | 'fill' | 'auto';
  format?: 'png' | 'jpeg' | 'webp' | 'avif';
  quality?: number;
}

export interface GetFileOptions {
  /**
   * Desired response format:
   * - 'blob': Returns Blob (default in browser)
   * - 'arrayBuffer': Returns ArrayBuffer
   * - 'stream': Returns ReadableStream<Uint8Array>
   * - 'text': Returns string text
   * - 'json': Returns parsed JSON
   */
  responseType?: 'blob' | 'arrayBuffer' | 'stream' | 'text' | 'json';

  /**
   * Set Content-Disposition to attachment to force file download.
   */
  download?: boolean;

  /**
   * Whether to check and write to client cache (default: true if client cache enabled).
   */
  useCache?: boolean;

  /**
   * Optional imgproxy image transformation options.
   */
  imgproxy?: ImgProxyOptions;

  /**
   * Optional AbortSignal for cancelling download.
   */
  signal?: AbortSignal;
}

export interface GetUrlOptions {
  /**
   * Set download=true query param.
   */
  download?: boolean;

  /**
   * Optional imgproxy transformation query params.
   */
  imgproxy?: ImgProxyOptions;
}

export interface ListFilesOptions {
  /**
   * Target bucket ID (defaults to defaultBucket).
   */
  bucketId?: string;

  /**
   * Optional AbortSignal.
   */
  signal?: AbortSignal;
}

export interface BucketStatsListResponse {
  items: BucketStat[];
  total?: number;
}

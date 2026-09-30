import type { HttpClient } from '../http/client';
import type { AttachmentResponse, UploadInput, UploadMultipleInput } from '../types';
import { uploadSingleFile } from './single';
import { uploadSessionFile } from './session';
import { executePreflight } from './preflight';
import { normalizeUploadInput } from './normalizer';

export interface QueueItem {
  id: string;
  input: UploadInput;
  status: 'pending' | 'uploading' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  response?: AttachmentResponse;
  error?: Error;
}

export interface QueueProgress {
  totalFiles: number;
  completedFiles: number;
  failedFiles: number;
  overallPercent: number;
  currentFile?: string;
}

export type QueueListener = (progress: QueueProgress, item?: QueueItem) => void;

export class BackgroundUploadQueue {
  private readonly http: HttpClient;
  private readonly defaultBucket: string;
  private concurrency: number;
  private items: QueueItem[] = [];
  private activeCount: number = 0;
  private isPaused: boolean = false;
  private abortController: AbortController = new AbortController();
  private listeners: Set<QueueListener> = new Set();
  private onFileSuccessCb?: (file: UploadInput, response: AttachmentResponse) => void;
  private onFileErrorCb?: (file: UploadInput, error: Error) => void;
  private onCompletePromiseResolve?: (results: AttachmentResponse[]) => void;
  private onCompletePromiseReject?: (error: Error) => void;

  constructor(http: HttpClient, options: { defaultBucket?: string; concurrency?: number } = {}) {
    this.http = http;
    this.defaultBucket = options.defaultBucket || 'default';
    this.concurrency = Math.max(1, options.concurrency || 3);
  }

  onProgress(listener: QueueListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onFileSuccess(cb: (file: UploadInput, response: AttachmentResponse) => void): this {
    this.onFileSuccessCb = cb;
    return this;
  }

  onFileError(cb: (file: UploadInput, error: Error) => void): this {
    this.onFileErrorCb = cb;
    return this;
  }

  add(input: UploadInput): string {
    const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
    const item: QueueItem = {
      id,
      input,
      status: 'pending',
      progress: 0,
    };
    this.items.push(item);
    this.processQueue();
    return id;
  }

  addAll(inputs: UploadInput[]): string[] {
    return inputs.map((input) => this.add(input));
  }

  pause(): void {
    this.isPaused = true;
  }

  resume(): void {
    if (this.isPaused) {
      this.isPaused = false;
      this.processQueue();
    }
  }

  cancel(): void {
    this.abortController.abort();
    this.abortController = new AbortController();
    for (const item of this.items) {
      if (item.status === 'pending' || item.status === 'uploading') {
        item.status = 'cancelled';
      }
    }
    this.activeCount = 0;
    this.notifyProgress();
    this.onCompletePromiseReject?.(new Error('Upload queue cancelled'));
  }

  clear(): void {
    this.cancel();
    this.items = [];
  }

  getItems(): ReadonlyArray<QueueItem> {
    return [...this.items];
  }

  getProgress(): QueueProgress {
    const totalFiles = this.items.length;
    if (totalFiles === 0) {
      return { totalFiles: 0, completedFiles: 0, failedFiles: 0, overallPercent: 100 };
    }

    let completedFiles = 0;
    let failedFiles = 0;
    let totalPercentSum = 0;
    let currentFile: string | undefined;

    for (const item of this.items) {
      if (item.status === 'completed') {
        completedFiles++;
        totalPercentSum += 100;
      } else if (item.status === 'failed') {
        failedFiles++;
        totalPercentSum += 100;
      } else if (item.status === 'uploading') {
        currentFile = item.input.name;
        totalPercentSum += item.progress;
      }
    }

    const overallPercent = Math.round(totalPercentSum / totalFiles);
    return {
      totalFiles,
      completedFiles,
      failedFiles,
      overallPercent,
      currentFile,
    };
  }

  private notifyProgress(item?: QueueItem) {
    const progress = this.getProgress();
    for (const listener of this.listeners) {
      try {
        listener(progress, item);
      } catch {
        // Safe swallow
      }
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isPaused) return;

    while (this.activeCount < this.concurrency) {
      const nextItem = this.items.find((i) => i.status === 'pending');
      if (!nextItem) break;

      this.activeCount++;
      nextItem.status = 'uploading';
      this.notifyProgress(nextItem);

      this.uploadItem(nextItem)
        .catch(() => {
          // Handled inside uploadItem
        })
        .finally(() => {
          this.activeCount--;
          this.notifyProgress(nextItem);
          this.processQueue();
          this.checkCompletion();
        });
    }
  }

  private async uploadItem(item: QueueItem): Promise<void> {
    const inputWithProgress: UploadInput = {
      ...item.input,
      signal: item.input.signal || this.abortController.signal,
      onProgress: (p) => {
        item.progress = p.percent;
        item.input.onProgress?.(p);
        this.notifyProgress(item);
      },
    };

    try {
      let result: AttachmentResponse;

      // Check preflight protocol or resumable flag
      if (item.input.resumable) {
        result = await uploadSessionFile(this.http, inputWithProgress, this.defaultBucket);
      } else if (item.input.preflight !== false) {
        const normalized = await normalizeUploadInput(item.input);
        const bucketId = item.input.bucketId || this.defaultBucket;
        const preflight = await executePreflight(
          this.http,
          {
            bucket_id: bucketId,
            name: normalized.name,
            size: normalized.size,
            content_type: normalized.contentType,
            file_hash: normalized.hash,
          },
          inputWithProgress.signal
        );

        if (preflight.duplicate) {
          result = preflight.duplicate;
        } else if (preflight.upload_protocol === 'edge-chunks-v1') {
          result = await uploadSessionFile(this.http, inputWithProgress, this.defaultBucket);
        } else {
          result = await uploadSingleFile(this.http, inputWithProgress, this.defaultBucket);
        }
      } else {
        result = await uploadSingleFile(this.http, inputWithProgress, this.defaultBucket);
      }

      item.status = 'completed';
      item.progress = 100;
      item.response = result;
      this.onFileSuccessCb?.(item.input, result);
    } catch (err: unknown) {
      item.status = 'failed';
      item.error = err instanceof Error ? err : new Error(String(err));
      this.onFileErrorCb?.(item.input, item.error);
    }
  }

  private checkCompletion(): void {
    const hasPending = this.items.some((i) => i.status === 'pending' || i.status === 'uploading');
    if (!hasPending && this.activeCount === 0) {
      const successful = this.items.filter((i) => i.status === 'completed' && i.response).map((i) => i.response!);
      this.onCompletePromiseResolve?.(successful);
    }
  }

  /**
   * Returns a promise that resolves when all items currently in the queue have completed.
   */
  async wait(): Promise<AttachmentResponse[]> {
    const hasPending = this.items.some((i) => i.status === 'pending' || i.status === 'uploading');
    if (!hasPending && this.activeCount === 0) {
      return this.items.filter((i) => i.status === 'completed' && i.response).map((i) => i.response!);
    }

    return new Promise((resolve, reject) => {
      this.onCompletePromiseResolve = resolve;
      this.onCompletePromiseReject = reject;
    });
  }
}

/**
 * Uploads multiple files with concurrency control and progress tracking.
 */
export async function uploadMultipleFiles(
  http: HttpClient,
  input: UploadMultipleInput,
  defaultBucket: string = 'default'
): Promise<AttachmentResponse[]> {
  const queue = new BackgroundUploadQueue(http, {
    defaultBucket: input.bucketId || defaultBucket,
    concurrency: input.concurrency || 3,
  });

  if (input.onProgress) {
    queue.onProgress((p) => input.onProgress?.(p));
  }

  if (input.onFileSuccess) {
    queue.onFileSuccess(input.onFileSuccess);
  }

  if (input.onFileError) {
    queue.onFileError(input.onFileError);
  }

  if (input.signal) {
    input.signal.addEventListener('abort', () => queue.cancel(), { once: true });
  }

  queue.addAll(input.files);
  return queue.wait();
}

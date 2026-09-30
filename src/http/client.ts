import type { VFSClientOptions } from '../types';
import { VFSError } from '../types/errors';
import { parseHttpError } from './error';
import { getUserAgent } from '../version';

export interface RequestOptions {
  headers?: Record<string, string>;
  params?: Record<string, string | number | boolean | undefined | null>;
  body?: BodyInit | null;
  timeout?: number;
  signal?: AbortSignal;
  skipAuth?: boolean;
}

export interface HttpResponse<T = unknown> {
  data: T;
  status: number;
  statusText: string;
  headers: Headers;
  totalCount?: number;
}

export class HttpClient {
  private readonly endpoint: string;
  private readonly apiKey?: string;
  private readonly apiHash?: string;
  private readonly accessToken?: string;
  private readonly defaultTimeout: number;
  private readonly fetchImpl: typeof fetch;
  private readonly debug?: (message: string, ...args: unknown[]) => void;
  private readonly maxRetries: number;
  private readonly retryDelay: number;
  private readonly retryOnStatus: number[];

  constructor(options: VFSClientOptions) {
    if (!options.endpoint) {
      throw new VFSError('Endpoint URL is required', { status: 400 });
    }
    this.endpoint = options.endpoint.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.apiHash = options.apiHash;
    this.accessToken = options.accessToken;
    this.defaultTimeout = options.timeout ?? 30000;
    const rawFetch = options.fetch ?? globalThis.fetch;
    this.fetchImpl = typeof rawFetch === 'function' ? rawFetch.bind(globalThis) : rawFetch;

    if (typeof options.debug === 'function') {
      this.debug = options.debug;
    } else if (options.debug === true) {
      this.debug = (msg, ...args) => console.debug(`[VFSClient] ${msg}`, ...args);
    }

    this.maxRetries = options.retry?.maxRetries ?? 2;
    this.retryDelay = options.retry?.retryDelay ?? 500;
    this.retryOnStatus = options.retry?.retryOnStatus ?? [502, 503, 504];
  }

  getEndpoint(): string {
    return this.endpoint;
  }

  getApiKey(): string | undefined {
    return this.apiKey;
  }

  getApiHash(): string | undefined {
    return this.apiHash;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined | null>): string {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.endpoint}${cleanPath}`);

    if (params) {
      for (const [key, val] of Object.entries(params)) {
        if (val !== undefined && val !== null) {
          url.searchParams.append(key, String(val));
        }
      }
    }

    return url.toString();
  }

  private buildHeaders(customHeaders?: Record<string, string>, skipAuth?: boolean): Headers {
    const headers = new Headers();

    const ua = getUserAgent();
    try {
      headers.set('User-Agent', ua);
    } catch {
      // Browser environment may restrict setting User-Agent header
    }
    headers.set('x-user-agent', ua);

    if (!skipAuth) {
      if (this.accessToken) headers.set('Authorization', `Bearer ${this.accessToken}`);
      if (this.apiKey) {
        headers.set('x-api-key', this.apiKey);
      }
      if (this.apiHash) {
        headers.set('x-api-hash', this.apiHash);
      }
    }

    if (customHeaders) {
      for (const [key, value] of Object.entries(customHeaders)) {
        headers.set(key, value);
      }
    }

    return headers;
  }

  async request<T = unknown>(method: string, path: string, options: RequestOptions = {}): Promise<HttpResponse<T>> {
    const url = this.buildUrl(path, options.params);
    const headers = this.buildHeaders(options.headers, options.skipAuth);
    const timeoutMs = options.timeout ?? this.defaultTimeout;

    let attempt = 0;
    let lastError: unknown;

    while (attempt <= this.maxRetries) {
      const controller = new AbortController();
      const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs) : undefined;

      // Link external AbortSignal if provided
      if (options.signal) {
        options.signal.addEventListener('abort', () => controller.abort(options.signal?.reason), { once: true });
      }

      this.debug?.(`${method} ${url} (Attempt ${attempt + 1}/${this.maxRetries + 1})`);

      try {
        const res = await this.fetchImpl(url, {
          method,
          headers,
          body: options.body,
          signal: controller.signal,
          redirect: options.skipAuth ? 'follow' : 'error',
          ...(options.body instanceof ReadableStream ? { duplex: 'half' } : {}),
        } as RequestInit);

        clearTimeout(timer);

        if (!res.ok) {
          // Check if retryable
          if (!(options.body instanceof ReadableStream) && attempt < this.maxRetries && this.retryOnStatus.includes(res.status)) {
            attempt++;
            const backoff = this.retryDelay * Math.pow(2, attempt - 1);
            this.debug?.(`HTTP ${res.status} on ${method} ${url}. Retrying in ${backoff}ms...`);
            await new Promise((resolve) => setTimeout(resolve, backoff));
            continue;
          }

          throw await parseHttpError(res);
        }

        // Parse successful response
        let data: T;
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          data = (await res.json()) as T;
        } else if (contentType.includes('text/')) {
          data = (await res.text()) as unknown as T;
        } else {
          // Return raw Response or Blob based on caller expectation
          data = res as unknown as T;
        }

        let totalCount: number | undefined;
        const totalCountHeader = res.headers.get('x-total-count');
        if (totalCountHeader) {
          const parsed = parseInt(totalCountHeader, 10);
          if (!isNaN(parsed)) {
            totalCount = parsed;
          }
        }

        return {
          data,
          status: res.status,
          statusText: res.statusText,
          headers: res.headers,
          totalCount,
        };
      } catch (err: unknown) {
        clearTimeout(timer);

        if (err instanceof VFSError) {
          throw err;
        }

        lastError = err;
        const isAbort = options.signal?.aborted;
        if (isAbort) {
          throw new VFSError('Request was aborted by caller', { status: 499, cause: err });
        }

        if (!(options.body instanceof ReadableStream) && attempt < this.maxRetries) {
          attempt++;
          const backoff = this.retryDelay * Math.pow(2, attempt - 1);
          this.debug?.(`Network error on ${method} ${url}. Retrying in ${backoff}ms...`, err);
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }

        throw new VFSError(err instanceof Error ? err.message : 'Network request failed', {
          status: 0,
          cause: err,
        });
      }
    }

    throw lastError instanceof VFSError
      ? lastError
      : new VFSError('Request failed after retries', { status: 500, cause: lastError });
  }

  get<T = unknown>(path: string, options?: RequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('GET', path, options);
  }

  post<T = unknown>(path: string, body?: BodyInit | null, options?: RequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('POST', path, { ...options, body });
  }

  put<T = unknown>(path: string, body?: BodyInit | null, options?: RequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('PUT', path, { ...options, body });
  }

  delete<T = unknown>(path: string, options?: RequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('DELETE', path, options);
  }

  /**
   * Fetches raw Response object directly (useful for streaming file downloads).
   */
  async fetchRaw(path: string, options: RequestOptions = {}): Promise<Response> {
    const url = this.buildUrl(path, options.params);
    const headers = this.buildHeaders(options.headers, options.skipAuth);
    const timeoutMs = options.timeout ?? this.defaultTimeout;

    const controller = new AbortController();
    const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs) : undefined;

    if (options.signal) {
      options.signal.addEventListener('abort', () => controller.abort(options.signal?.reason), { once: true });
    }

    try {
      const res = await this.fetchImpl(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
        redirect: options.skipAuth ? 'follow' : 'error',
      });

      clearTimeout(timer);

      if (!res.ok) {
        throw await parseHttpError(res);
      }

      return res;
    } catch (err: unknown) {
      clearTimeout(timer);
      if (err instanceof VFSError) {
        throw err;
      }
      throw new VFSError(err instanceof Error ? err.message : 'Download failed', {
        status: 0,
        cause: err,
      });
    }
  }
}

/**
 * Problem details (RFC 7807) and SDK error definitions.
 */

export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  extensions?: {
    trace_id?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export class VFSError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly problem?: ProblemDetails;
  readonly headers?: Headers;

  constructor(
    message: string,
    options?: {
      status?: number;
      code?: string;
      problem?: ProblemDetails;
      headers?: Headers;
      cause?: unknown;
    }
  ) {
    super(message);
    this.name = 'VFSError';
    this.status = options?.status ?? 500;
    this.code = options?.code;
    this.problem = options?.problem;
    this.headers = options?.headers;

    if (options?.cause) {
      this.cause = options.cause;
    }

    Object.setPrototypeOf(this, VFSError.prototype);
  }

  /**
   * Helper to check if error is a specific HTTP status code.
   */
  is(status: number): boolean {
    return this.status === status;
  }
}

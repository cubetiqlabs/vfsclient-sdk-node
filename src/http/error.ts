import { VFSError, type ProblemDetails } from '../types/errors';

/**
 * Parses an HTTP Response into a structured VFSError with RFC 7807 Problem Details.
 */
export async function parseHttpError(res: Response): Promise<VFSError> {
  const status = res.status;
  const contentType = res.headers.get('content-type') || '';
  let errorMessage = res.statusText || `Request failed with status ${status}`;
  let problemDetails: ProblemDetails | undefined;
  let code: string | undefined;

  try {
    if (contentType.includes('application/json') || contentType.includes('application/problem+json')) {
      const json = await res.json();
      if (json && typeof json === 'object') {
        problemDetails = json as ProblemDetails;

        if (problemDetails.detail) {
          errorMessage = problemDetails.detail;
        } else if (problemDetails.title) {
          errorMessage = problemDetails.title;
        } else if ((json as { error?: string }).error) {
          errorMessage = (json as { error: string }).error;
        } else if ((json as { message?: string }).message) {
          errorMessage = (json as { message: string }).message;
        }

        if (problemDetails.extensions?.code && typeof problemDetails.extensions.code === 'string') {
          code = problemDetails.extensions.code;
        }
      }
    } else {
      const text = await res.text();
      if (text) {
        errorMessage = text;
      }
    }
  } catch {
    // Keep fallback statusText if body cannot be parsed
  }

  return new VFSError(errorMessage, {
    status,
    code,
    problem: problemDetails,
    headers: res.headers,
  });
}

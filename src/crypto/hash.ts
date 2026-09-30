/**
 * Isomorphic SHA-256 calculation for Browser, Node.js, and Bun.
 */

/**
 * Converts an ArrayBuffer or Uint8Array to a hex string.
 */
export function bufferToHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Calculates SHA-256 hex digest of an ArrayBuffer or Uint8Array.
 */
export async function calculateSHA256(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  let bytes: Uint8Array;
  if (typeof data === 'string') {
    bytes = new TextEncoder().encode(data);
  } else if (data instanceof Uint8Array) {
    bytes = data;
  } else {
    bytes = new Uint8Array(data);
  }

  // 1. Try globalThis.crypto.subtle (available in Browser, Node 18+, Bun, Deno, Cloudflare Workers)
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle?.digest) {
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', bytes as any);
    return bufferToHex(hashBuffer);
  }

  // 2. Fallback to node:crypto if running in an older Node or environment without WebCrypto
  try {
    const nodeCrypto = await import('node:crypto');
    return nodeCrypto.createHash('sha256').update(bytes).digest('hex');
  } catch {
    throw new Error('No crypto implementation found in current environment for SHA-256');
  }
}

/**
 * Calculates SHA-256 of a Blob or File.
 */
export async function calculateBlobSHA256(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  return calculateSHA256(arrayBuffer);
}

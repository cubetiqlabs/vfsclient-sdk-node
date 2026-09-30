import type { UploadInput } from '../types';
import { calculateSHA256 } from '../crypto/hash';
import { VFSError } from '../types/errors';

export interface NormalizedFileInput {
  bytes: Uint8Array;
  name: string;
  size: number;
  contentType: string;
  hash: string;
}

/**
 * Detects basic mime type from file name extension.
 */
export function guessContentType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'pdf':
      return 'application/pdf';
    case 'json':
      return 'application/json';
    case 'txt':
      return 'text/plain';
    case 'html':
      return 'text/html';
    case 'csv':
      return 'text/csv';
    case 'zip':
      return 'application/zip';
    case 'tar':
      return 'application/x-tar';
    case 'gz':
      return 'application/gzip';
    case 'mp4':
      return 'video/mp4';
    case 'mp3':
      return 'audio/mpeg';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Normalizes any supported input into an in-memory Uint8Array with metadata and SHA-256 hash.
 */
export async function normalizeUploadInput(input: UploadInput): Promise<NormalizedFileInput> {
  const file = input.file;
  let bytes: Uint8Array = new Uint8Array(0);
  let name = input.name || 'unnamed_file';
  let contentType = input.contentType;

  // 1. File (Browser)
  if (typeof File !== 'undefined' && file instanceof File) {
    name = input.name || file.name;
    contentType = contentType || file.type || guessContentType(name);
    const arrayBuffer = await file.arrayBuffer();
    bytes = new Uint8Array(arrayBuffer);
  }
  // 2. Blob
  else if (typeof Blob !== 'undefined' && file instanceof Blob) {
    contentType = contentType || file.type || guessContentType(name);
    const arrayBuffer = await file.arrayBuffer();
    bytes = new Uint8Array(arrayBuffer);
  }
  // 3. Uint8Array or Buffer
  else if (file instanceof Uint8Array) {
    bytes = file;
    contentType = contentType || guessContentType(name);
  }
  // 4. ArrayBuffer
  else if (file instanceof ArrayBuffer) {
    bytes = new Uint8Array(file);
    contentType = contentType || guessContentType(name);
  }
  // 5. ReadableStream (Web Streams)
  else if (typeof ReadableStream !== 'undefined' && file instanceof ReadableStream) {
    const reader = file.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    bytes = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    contentType = contentType || guessContentType(name);
  }
  // 6. Node.js Readable Stream
  else if (typeof file === 'object' && file !== null && 'on' in file && typeof (file as any).pipe === 'function') {
    const chunks: Uint8Array[] = [];
    await new Promise<void>((resolve, reject) => {
      (file as any).on('data', (chunk: any) => {
        if (typeof chunk === 'string') {
          chunks.push(new TextEncoder().encode(chunk));
        } else if (chunk instanceof Uint8Array) {
          chunks.push(chunk);
        }
      });
      (file as any).on('end', () => resolve());
      (file as any).on('error', (err: any) => reject(err));
    });
    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    bytes = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    contentType = contentType || guessContentType(name);
  }
  // 7. String: File path or base64/raw string
  else if (typeof file === 'string') {
    // Check if it's a file path in Node.js / Bun
    const isNode = typeof process !== 'undefined' && Boolean(process.versions?.node || process.versions?.bun);
    let readFromFile = false;

    if (isNode) {
      try {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const stat = await fs.stat(file);
        if (stat.isFile()) {
          const buf = await fs.readFile(file);
          bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
          name = input.name || path.basename(file);
          contentType = contentType || guessContentType(name);
          readFromFile = true;
        }
      } catch {
        // Not a valid file path, proceed as string content
      }
    }

    if (!readFromFile) {
      if (file.startsWith('data:')) {
        // Data URL
        const commaIdx = file.indexOf(',');
        if (commaIdx !== -1) {
          const mimeMatch = file.slice(0, commaIdx).match(/data:(.*?);/);
          if (mimeMatch && !contentType) {
            contentType = mimeMatch[1];
          }
          const base64Data = file.slice(commaIdx + 1);
          const binaryStr = atob(base64Data);
          bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
        } else {
          bytes = new TextEncoder().encode(file);
        }
      } else {
        bytes = new TextEncoder().encode(file);
      }
      contentType = contentType || guessContentType(name);
    }
  } else {
    throw new VFSError('Unsupported file input type for upload', { status: 400 });
  }

  const hash = input.fileHash || (await calculateSHA256(bytes));

  return {
    bytes,
    name,
    size: bytes.byteLength,
    contentType: contentType || 'application/octet-stream',
    hash,
  };
}

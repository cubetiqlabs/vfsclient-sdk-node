import { sha256 } from '@noble/hashes/sha2.js';
import type { UploadInput } from '../types';
import { guessContentType, normalizeUploadInput } from './normalizer';
import { toHex } from '../software/crypto';

export interface SeekableUploadSource {
  name: string;
  contentType: string;
  hash: string;
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
  close(): Promise<void>;
  filePath?: string;
}

async function hashBlob(blob: Blob): Promise<string> {
  const hash = sha256.create();
  const reader = blob.stream().getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    hash.update(value);
  }
  return toHex(hash.digest());
}

export async function openUploadSource(input: UploadInput): Promise<SeekableUploadSource> {
  if (typeof input.file === 'string' && typeof process !== 'undefined' && process.versions?.node) {
    const fs = await import('node:fs');
    const fsp = await import('node:fs/promises');
    const path = await import('node:path');
    try {
      const stats = await fsp.stat(input.file);
      if (stats.isFile()) {
        const hash = sha256.create();
        for await (const chunk of fs.createReadStream(input.file)) hash.update(chunk);
        const digest = toHex(hash.digest());
        if (input.fileHash && input.fileHash.toLowerCase() !== digest) throw new Error('fileHash differs from file bytes');
        const handle = await fsp.open(input.file, 'r');
        const name = input.name || path.basename(input.file);
        return {
          name, contentType: input.contentType || guessContentType(name), hash: digest, size: stats.size, filePath: input.file,
          read: async (offset, length) => {
            const result = new Uint8Array(length);
            const { bytesRead } = await handle.read(result, 0, length, offset);
            return result.subarray(0, bytesRead);
          },
          close: () => handle.close(),
        };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  if (typeof Blob !== 'undefined' && input.file instanceof Blob) {
    const blob = input.file;
    const name = input.name || (typeof File !== 'undefined' && blob instanceof File ? blob.name : 'unnamed_file');
    const digest = await hashBlob(blob);
    if (input.fileHash && input.fileHash.toLowerCase() !== digest) throw new Error('fileHash differs from file bytes');
    return {
      name, contentType: input.contentType || blob.type || guessContentType(name), hash: digest, size: blob.size,
      read: async (offset, length) => new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer()),
      close: async () => {},
    };
  }
  const normalized = await normalizeUploadInput(input);
  return {
    name: normalized.name, contentType: normalized.contentType, hash: normalized.hash, size: normalized.size,
    read: async (offset, length) => normalized.bytes.subarray(offset, offset + length),
    close: async () => {},
  };
}

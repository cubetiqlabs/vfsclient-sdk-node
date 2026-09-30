# @cubis/vfsclient

The official, universal TypeScript client SDK for **vFS Server** (Virtual File System). Works seamlessly across **Node.js**, **Bun**, and the **Browser**.

[![npm version](https://img.shields.io/npm/v/@cubis/vfsclient.svg)](https://www.npmjs.com/package/@cubis/vfsclient)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Features

- 🌐 **Isomorphic & Universal**: Runs in Node.js (18+), Bun, Deno, and modern Browsers.
- 🔐 **Dual Auth Support**: Authenticate using `x-api-key` or `x-api-hash`.
- ⚡ **Smart Preflight Deduplication**: Checks quota and SHA-256 before transferring bytes. Skips re-uploading if content already exists in the bucket.
- 📦 **Resumable Chunked Session Uploads**: Supports VFS edge durable storage chunking (`edge-chunks-v1`) with 1 MiB chunk slicing, per-chunk checksums, and auto-resume.
- 🚀 **Background Multi-File Queue**: Concurrent batch uploads with progress tracking, pause, resume, and cancellation.
- 💾 **Multi-Tier Caching**:
  - **Browser**: Native `CacheStorage` (`window.caches`) with memory fallback.
  - **Server-Side**: Local persistent disk cache (`.vfs-cache`) with TTL and atomic writes.
  - **In-Memory**: Universal LRU cache with TTL expiration.
- 📄 **Metadata & Manifest Lookups**: Retrieve full file metadata JSON (`ObjectManifestResponse`) without downloading file bytes.
- 📊 **Real-time Bucket Analytics**: File counts, byte usage, quota headroom, read/write counters, and daily growth metrics.
- 🛡️ **RFC 7807 Problem Details**: Rich, structured error handling with trace IDs and status checking.
- 🔏 **Signed software updates**: Typed release manifests, Ed25519 verification, target-aware update checks, and streamed SHA-256 download verification.

---

## Installation

```bash
# Bun
bun add @cubis/vfsclient

# npm
npm install @cubis/vfsclient

# pnpm
pnpm add @cubis/vfsclient

# yarn
yarn add @cubis/vfsclient
```

---

## Quickstart

```typescript
import { VFSClient } from '@cubis/vfsclient';

// Initialize client
const vfs = new VFSClient({
  endpoint: 'https://vfs.example.com',
  apiKey: 'vfs_your_api_key', // Or apiHash: 'your_hash_here'
  defaultBucket: 'default',
  cache: true,                // Enables automatic browser/server caching
});

// 1. Upload a file
const file = await vfs.upload({
  file: new Blob(['Hello World!'], { type: 'text/plain' }),
  name: 'hello.txt',
  onProgress: ({ percent, phase }) => {
    console.log(`Upload ${phase}: ${percent}%`);
  },
});

console.log('Uploaded File ID:', file.file_id);
console.log('Public URL:', file.url);

// 2. Get file metadata (JSON manifest)
const meta = await vfs.getFileMetadata('default', file.file_id);
console.log(`File size: ${meta.size} bytes, Hash: ${meta.file_hash}`);

// 3. Download the file (cached automatically)
const downloadedBlob = await vfs.getFile('default', file.file_id);

// 4. Delete the file (invalidates cache)
await vfs.deleteFile('default', file.file_id);
```

---

## Authentication

The client also accepts `accessToken` for Console/JWT requests. Public software manifests and downloads do not send credentials.

## Software updater

See [Software releases](../../docs/VFS_SOFTWARE_RELEASES.md) for publication, key rotation, revocation, and a complete updater example. Pass a pinned `trustedKeys` map to `software.checkForUpdate`; the SDK verifies the release and channel signatures, selects the requested OS and architecture, and skips downgrades by default. Call `software.downloadAndVerify` before your own install step. File-path and resumable uploads read chunks from disk instead of buffering the entire artifact.

Configure authentication in `VFSClientOptions`:

```typescript
// Plain API Key (x-api-key)
const clientWithKey = new VFSClient({
  endpoint: 'https://vfs.example.com',
  apiKey: 'vfs_live_xxxxxxxxxxxx',
});

// HMAC / Hash Key (x-api-hash)
const clientWithHash = new VFSClient({
  endpoint: 'https://vfs.example.com',
  apiHash: 'd3b07384d113edec49eaa6238ad5ff00',
});
```

---

## File Uploads

### 1. Single File Upload with Smart Preflight

Accepts `File`, `Blob`, `Buffer`, `Uint8Array`, `ArrayBuffer`, `ReadableStream`, or file path string in Node.js:

```typescript
const result = await vfs.upload({
  // In Node: '/path/to/document.pdf' or Buffer.from(...)
  // In Browser: input.files[0] or new Blob(...)
  file: documentFile,
  name: 'document.pdf',
  bucketId: 'invoices',
  metadata: { customerId: 'cust_123', month: 'September' },
  onProgress: (progress) => {
    console.log(`${progress.phase}: ${progress.percent}%`);
  },
});
```

> **Deduplication:** When `preflight: true` (default), VFS Client computes the SHA-256 hash. If the bucket already holds an identical file, the server signals a duplicate hit. The SDK returns the existing attachment record immediately without transferring the bytes again.

### 2. Resumable Chunked Session Upload

For large files or edge storage, enable session chunking:

```typescript
const result = await vfs.upload({
  file: largeVideoFile,
  name: 'movie.mp4',
  resumable: true,       // Uses edge-chunks-v1 protocol
  chunkSize: 1048576,    // 1 MiB chunks
  resumeId: 'optional_previous_session_id', // Resume interrupted transfer
  onProgress: (p) => {
    console.log(`Uploading chunk: ${p.percent}%`);
  },
});
```

### 3. Multiple Files & Background Queue

Upload batches with concurrency limits and progress tracking:

```typescript
// Simple multi-file upload
const results = await vfs.uploadMultiple({
  files: [
    { file: fileA, name: 'fileA.png' },
    { file: fileB, name: 'fileB.png' },
    { file: fileC, name: 'fileC.png' },
  ],
  concurrency: 3, // Upload up to 3 files in parallel
  onProgress: (progress) => {
    console.log(`Overall: ${progress.completedFiles}/${progress.totalFiles} (${progress.overallPercent}%)`);
  },
  onFileSuccess: (file, response) => {
    console.log(`Uploaded ${file.name} -> ${response.file_id}`);
  },
});

// Or use the interactive background queue
const queue = vfs.createBackgroundQueue({ concurrency: 2 });

queue.onProgress((progress, item) => {
  console.log(`Queue ${progress.overallPercent}% complete. Current: ${progress.currentFile}`);
});

queue.add({ file: file1, name: 'f1.jpg' });
queue.add({ file: file2, name: 'f2.jpg' });

// Control queue
queue.pause();
queue.resume();
queue.cancel();

// Wait for all to complete
const uploaded = await queue.wait();
```

---

## File Retrieval & URL Generation

### Download with Cache

```typescript
// Returns Blob (default)
const blob = await vfs.getFile('default', 'file-id');

// Desired format: 'arrayBuffer' | 'stream' | 'text' | 'json'
const text = await vfs.getFile('default', 'file-id', { responseType: 'text' });
const json = await vfs.getFile('default', 'config.json', { responseType: 'json' });
const stream = await vfs.getFile('default', 'video.mp4', { responseType: 'stream' });

// Download by SHA-256 Hash (/h/:hash - immutable cache)
const hashedBlob = await vfs.getFileByHash('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
```

### Get File Metadata (JSON Manifest)

```typescript
const meta = await vfs.getFileMetadata('default', 'file-id');
console.log({
  id: meta.id,
  fileId: meta.file_id,
  name: meta.name,
  size: meta.size,
  hash: meta.file_hash,
  type: meta.type,
  metadata: meta.metadata,
  url: meta.url,
});
```

### URL Generation & Image Proxy

```typescript
// Direct public URL
const url = vfs.getFileUrl('photos', 'pic.jpg', {
  download: true, // Forces Content-Disposition: attachment
  imgproxy: {
    width: 600,
    height: 400,
    format: 'webp',
    quality: 80,
  },
});
```

---

## Caching

Enable caching by passing `cache: true` in `VFSClientOptions`:

- In **Browsers**, caching is stored in `window.caches` (CacheStorage API).
- In **Node.js / Bun**, caching is written to the local filesystem (`./.vfs-cache`) with TTL and sidecar metadata.
- Automatically handles cache invalidation when `deleteFile(bucketId, fileId)` is called.

Custom cache adapter:

```typescript
import { VFSClient, VFSCacheAdapter } from '@cubis/vfsclient';

class RedisCacheAdapter implements VFSCacheAdapter {
  async get(key: string) { /* ... */ }
  async set(key: string, entry: VFSCacheEntry, ttl?: number) { /* ... */ }
  async delete(key: string) { /* ... */ }
  async clear() { /* ... */ }
  async has(key: string) { /* ... */ }
}

const vfs = new VFSClient({
  endpoint: 'https://vfs.example.com',
  cache: new RedisCacheAdapter(),
});
```

---

## Bucket Statistics & Management

```typescript
// 1. Single Bucket Statistics
const stats = await vfs.getBucketStats('my-bucket');
console.log(`Files: ${stats.total_file}, Used: ${stats.total_size} bytes`);
console.log(`Quota: ${stats.max_size_bytes} bytes, Max Files: ${stats.max_files}`);

// 2. System-wide Summary
const summary = await vfs.getBucketSummary();
console.log(`Total Buckets: ${summary.total_buckets}, Total Files: ${summary.total_files}`);

// 3. Bucket Growth Metrics by Date
const metrics = await vfs.getBucketMetrics('my-bucket');
metrics.forEach(m => console.log(`${m.date}: ${m.total_files} files, ${m.total_size} bytes`));

// 4. List Files in Bucket
const files = await vfs.listFiles({ bucketId: 'my-bucket' });

// 5. Delete Operations
await vfs.deleteFile('my-bucket', 'file-id');        // Delete specific file
await vfs.deleteFileById('mongo-object-id');         // Delete by catalog ID
await vfs.deleteAllInBucket('temp-bucket');          // Purge all files in bucket
```

---

## Error Handling

Errors are instances of `VFSError` with RFC 7807 Problem Details:

```typescript
import { VFSError } from '@cubis/vfsclient';

try {
  await vfs.upload({ file, name: 'large.zip', bucketId: 'limited-bucket' });
} catch (err) {
  if (err instanceof VFSError) {
    console.error(`Status: ${err.status}`);
    console.error(`Message: ${err.message}`);
    console.error(`Trace ID: ${err.problem?.extensions?.trace_id}`);
    if (err.is(400)) {
      console.error('Quota or metadata validation error');
    }
  }
}
```

---

## License

MIT © [Cubis](https://cubis.tech)

# VFS Client SDK: React + Vite Example

This example demonstrates how to integrate `@cubis/vfsclient` into a modern **React 19** frontend powered by **Vite**.

## Features Included

- 🚀 **Drag & Drop Upload**: Single file upload with real-time phase indicator (`hashing`, `preflight`, `uploading`, `complete`).
- ⚡ **Resumable Edge Chunking**: Option to use `edge-chunks-v1` chunked streaming (1 MiB slices with per-chunk SHA-256 validation).
- 📦 **Background Multi-File Queue**: Concurrent batch uploads with pause, resume, cancel, and worker scaling.
- 💾 **Browser Cache Integration**: Uses native browser `window.caches` (CacheStorage API) with memory fallback for fast file downloads.
- 📄 **File Metadata Viewer**: Inspects JSON manifest returned by `client.getFileMetadata(bucket, fileId)`.
- 📊 **Live Bucket Analytics**: Displays file count, storage used, read/write metrics, and quota headroom.
- 🔐 **Configurable Authentication**: Switch dynamically between `x-api-key` and `x-api-hash`.

---

## Getting Started

1. Install dependencies:
```bash
bun install
# or install @cubis/vfsclient from npm:
bun add @cubis/vfsclient
```

2. Start the development server:
```bash
bun run dev
```

3. Open [http://localhost:3000](http://localhost:3000) in your browser.

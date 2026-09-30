# VFS Client SDK: Node.js & Bun Server Example

This example demonstrates how to use `@cubis/vfsclient` in a Node.js or Bun server environment.

## Features Demonstrated

1. **Client Setup**: Connecting with `endpoint` and authentication (`x-api-key` or `x-api-hash`).
2. **Bucket Statistics**: Fetching real-time storage usage, file counts, and quota settings.
3. **Single File Upload**: Uploading text/buffer with custom metadata and preflight deduplication.
4. **Resumable Chunked Upload**: Slicing large files into 1 MiB chunks with SHA-256 verification (`edge-chunks-v1`).
5. **Multi-File Concurrency**: Batch uploading multiple files with progress reporting.
6. **File Metadata**: Retrieving typed JSON manifest without transferring file bytes.
7. **Server-Side File Cache**: Automatic disk caching (`./.vfs-cache`) for fast repeated reads.
8. **Deletion**: Deleting files from VFS with automatic cache invalidation.

---

## Installation & Setup

1. Install dependencies:
```bash
bun install
# or
bun add @cubis/vfsclient
```

2. (Optional) Configure environment variables:
```bash
export VFS_ENDPOINT="http://localhost:5002"
export VFS_API_KEY="vfs_your_api_key"
export VFS_BUCKET="default"
```

3. Run the example:
```bash
bun run start
```

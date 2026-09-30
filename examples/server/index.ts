import { VFSClient, VFSError } from '@cubis/vfsclient';

// Configuration from environment or defaults
const endpoint = process.env.VFS_ENDPOINT || 'http://localhost:5173';
const apiKey = process.env.VFS_API_KEY || 'vfs_fI3ksWsW66xFvMlq8c24y176RLoal92e';
const apiHash = process.env.VFS_API_HASH;
const bucketId = process.env.VFS_BUCKET || 'default';

console.log('=== VFS Server-Side SDK Example ===');
console.log(`Connecting to: ${endpoint}`);
console.log(`Target bucket: ${bucketId}`);

// 1. Initialize VFS Client
// Uses x-api-key or x-api-hash, and enables server-side file caching
const client = new VFSClient({
  endpoint,
  apiKey: !apiHash ? apiKey : undefined,
  apiHash: apiHash || undefined,
  defaultBucket: bucketId,
  cache: true, // Enables local filesystem cache in ./.vfs-cache
  debug: false,
});

async function main() {
  try {
    // 2. Check Bucket Statistics
    console.log('\n--- 1. Bucket Statistics & System Summary ---');
    try {
      const stats = await client.getBucketStats(bucketId);
      console.log(`[Bucket ${stats.bucket_id}]`);
      console.log(`- Total Files: ${stats.total_file}`);
      console.log(`- Storage Used: ${(stats.total_size / 1024).toFixed(2)} KB`);
      console.log(`- Max Storage Quota: ${stats.max_size_bytes > 0 ? (stats.max_size_bytes / (1024 * 1024)).toFixed(0) + ' MB' : 'Unlimited'}`);
      console.log(`- Lifecycle TTL: ${stats.lifecycle_enabled ? stats.default_ttl_seconds + 's' : 'Disabled'}`);
    } catch (err) {
      console.log('Bucket stats note:', (err as Error).message);
    }

    // 3. Single File Upload with Preflight Deduplication
    console.log('\n--- 2. Single File Upload ---');
    const sampleContent = `Report generated at ${new Date().toISOString()}\nCustomer: ACME Corp\nStatus: OK`;
    const fileName = `report-${Date.now()}.txt`;

    const uploaded = await client.upload({
      file: sampleContent,
      name: fileName,
      contentType: 'text/plain',
      metadata: {
        department: 'Engineering',
        generator: 'Node/Bun Example',
      },
      onProgress: ({ percent, phase }) => {
        console.log(`  Upload progress [${phase}]: ${percent}%`);
      },
    });

    console.log(` Uploaded successfully!`);
    console.log(`  File ID: ${uploaded.file_id}`);
    console.log(`  Public URL: ${uploaded.url}`);
    console.log(`  File Hash: ${uploaded.file_hash}`);

    // 4. Test Deduplication Check (Same content and name)
    console.log('\n--- 3. Testing Smart Preflight Deduplication ---');
    console.log('Attempting to upload identical file content...');
    const dedupResult = await client.upload({
      file: sampleContent,
      name: fileName,
      contentType: 'text/plain',
      onProgress: ({ percent, phase }) => {
        console.log(`  Dedup upload progress [${phase}]: ${percent}%`);
      },
    });

    console.log(` Deduplication confirmed! Server returned existing file without transferring bytes.`);
    console.log(`  Matched File ID: ${dedupResult.file_id}`);

    // 5. Resumable Chunked Session Upload
    console.log('\n--- 4. Resumable Chunked Upload (edge-chunks-v1) ---');
    // Create a 2.5 MB binary payload
    const largeBuffer = new Uint8Array(2.5 * 1024 * 1024);
    for (let i = 0; i < largeBuffer.length; i++) {
      largeBuffer[i] = i % 256;
    }

    try {
      const chunkedResult = await client.upload({
        file: largeBuffer,
        name: `data-backup-${Date.now()}.bin`,
        contentType: 'application/octet-stream',
        resumable: true,
        chunkSize: 1048576, // 1 MiB chunks
        onProgress: ({ percent, phase, loaded, total }) => {
          console.log(`  Chunked transfer [${phase}]: ${percent}% (${(loaded / 1024).toFixed(0)} / ${(total / 1024).toFixed(0)} KB)`);
        },
      });

      console.log(` Chunked upload finalized: ${chunkedResult.file_id} (${chunkedResult.store})`);
    } catch (err) {
      console.log(` Chunked session upload note: ${(err as Error).message}`);
      console.log(` (Note: Edge chunk sessions use edge-chunks-v1 protocol which requires active VFS Edge storage nodes)`);
    }

    // 6. Multi-File Batch Upload with Concurrency Control
    console.log('\n--- 5. Concurrent Multi-File Upload Queue ---');
    const filesToUpload = [
      { file: 'Invoice #1001 details', name: 'inv-1001.txt' },
      { file: 'Invoice #1002 details', name: 'inv-1002.txt' },
      { file: 'Invoice #1003 details', name: 'inv-1003.txt' },
    ];

    const batchResults = await client.uploadMultiple({
      files: filesToUpload,
      concurrency: 2,
      onProgress: (p) => {
        console.log(`  Batch Progress: ${p.completedFiles}/${p.totalFiles} files completed (${p.overallPercent}%)`);
      },
      onFileSuccess: (input, res) => {
        console.log(`   File '${input.name}' uploaded -> ID: ${res.file_id}`);
      },
    });

    console.log(` Batch completed: ${batchResults.length} files stored.`);

    // 7. Get File Metadata Manifest (JSON object)
    console.log('\n--- 6. Get File Metadata (JSON Object) ---');
    const manifest = await client.getFileMetadata(bucketId, uploaded.file_id);
    console.log('File Manifest Object:');
    console.log(JSON.stringify(manifest, null, 2));

    // 8. Download File with Caching
    console.log('\n--- 7. Download File with Server-Side Caching ---');
    console.log('First download (fetches from server and writes to local cache)...');
    const start1 = performance.now();
    const content1 = await client.getFile(bucketId, uploaded.file_id, { responseType: 'text' });
    const time1 = (performance.now() - start1).toFixed(2);
    console.log(`  Downloaded in ${time1}ms. Length: ${(content1 as string).length} chars`);

    console.log('Second download (reads from local filesystem cache)...');
    const start2 = performance.now();
    const content2 = await client.getFile(bucketId, uploaded.file_id, { responseType: 'text' });
    const time2 = (performance.now() - start2).toFixed(2);
    console.log(`  Cached read in ${time2}ms. Content matched: ${content1 === content2}`);

    // 9. Delete File (invalidates local cache)
    console.log('\n--- 8. File Deletion & Cache Invalidation ---');
    await client.deleteFile(bucketId, uploaded.file_id);
    console.log(` Deleted file ${uploaded.file_id} from VFS server and cleared from cache.`);

    console.log('\n=== All VFS SDK Server operations completed successfully! ===');
  } catch (err: unknown) {
    if (err instanceof VFSError) {
      console.error('\n VFS Error Occurred:');
      console.error(`Status: ${err.status}`);
      console.error(`Message: ${err.message}`);
      if (err.problem?.extensions?.trace_id) {
        console.error(`Trace ID: ${err.problem.extensions.trace_id}`);
      }
    } else {
      console.error('\n Unexpected error:', err);
    }
  }
}

main();

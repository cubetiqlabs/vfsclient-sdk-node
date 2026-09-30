import { sha256 } from '@noble/hashes/sha2.js';
import semver from 'semver';
import type { HttpClient } from '../http/client';
import { signSoftwarePayload, toHex, verifySoftwarePayload } from './crypto';
import { detectAssetPlatform } from './platform';
import { uploadSingleFile } from '../upload/single';
import { VFSError } from '../types/errors';
import type {
  AvailableUpdate, CheckForUpdateInput, HeadPayload, PublishIntent, PublishReleaseWithFilesInput, ReleasePayload,
  SoftwareApplication, SoftwareApplicationStats, SoftwareAsset, SoftwareHead, SoftwareManifest, SoftwareRelease,
  SoftwareSignature, SoftwareVersionSummary, TrustedSoftwareKeys,
} from './types';

function base(bucketId: string, app: string): string {
  return `/api/software/${encodeURIComponent(bucketId)}/${encodeURIComponent(app)}`;
}

function jsonBody(value: unknown): string { return JSON.stringify(value); }
const jsonHeaders = { 'Content-Type': 'application/json' };

export class SoftwareClient {
  constructor(private readonly http: HttpClient) {}

  async listApplications(bucketId: string): Promise<SoftwareApplication[]> {
    return (await this.http.get<SoftwareApplication[]>('/api/software/apps', { params: { bucket_id: bucketId } })).data;
  }

  async createApplication(input: { bucket_id: string; app: string; name: string; public_key: string }): Promise<SoftwareApplication> {
    return (await this.http.post<SoftwareApplication>('/api/software/apps', jsonBody(input), { headers: jsonHeaders })).data;
  }

  async rotateKey(bucketId: string, app: string, publicKey: string): Promise<SoftwareApplication> {
    return (await this.http.post<SoftwareApplication>(`${base(bucketId, app)}/keys`, jsonBody({ public_key: publicKey }), { headers: jsonHeaders })).data;
  }

  async beginPublish(bucketId: string, app: string, version: string): Promise<PublishIntent> {
    return (await this.http.post<PublishIntent>(`${base(bucketId, app)}/intents`, jsonBody({ version }), { headers: jsonHeaders })).data;
  }

  async registerAsset(bucketId: string, app: string, intentId: string, fileId: string): Promise<PublishIntent> {
    return (await this.http.put<PublishIntent>(`${base(bucketId, app)}/intents/${encodeURIComponent(intentId)}/assets`, jsonBody({ file_id: fileId }), { headers: jsonHeaders })).data;
  }

  async publishRelease(bucketId: string, app: string, intentId: string, payload: ReleasePayload, signature: SoftwareSignature): Promise<SoftwareRelease> {
    return (await this.http.post<SoftwareRelease>(`${base(bucketId, app)}/releases`, jsonBody({ intent_id: intentId, payload, signature }), { headers: jsonHeaders })).data;
  }

  async updateChannel(bucketId: string, app: string, channel: string, payload: HeadPayload, signature: SoftwareSignature): Promise<SoftwareHead> {
    return (await this.http.put<SoftwareHead>(`${base(bucketId, app)}/channels/${encodeURIComponent(channel)}`, jsonBody({ payload, signature }), { headers: jsonHeaders })).data;
  }

  async revokeRelease(bucketId: string, app: string, version: string): Promise<void> {
    await this.http.post(`${base(bucketId, app)}/versions/${encodeURIComponent(version)}/revoke`, '{}', { headers: jsonHeaders });
  }

  async cleanup(bucketId: string, app: string, input: { version?: string; intent_id?: string }): Promise<{ file_ids: string[] }> {
    return (await this.http.post<{ file_ids: string[] }>(`${base(bucketId, app)}/cleanup`, jsonBody(input), { headers: jsonHeaders })).data;
  }

  async getManifest(input: { bucketId: string; app: string; channel?: string; os?: string; arch?: string; limit?: number; cursor?: string; signal?: AbortSignal }): Promise<SoftwareManifest> {
    return (await this.http.get<SoftwareManifest>(`${base(input.bucketId, input.app)}/manifest.json`, {
      params: { channel: input.channel, os: input.os, arch: input.arch, limit: input.limit, cursor: input.cursor },
      signal: input.signal, skipAuth: true,
    })).data;
  }

  async getRelease(bucketId: string, app: string, version: string): Promise<SoftwareRelease> {
    return (await this.http.get<SoftwareRelease>(`${base(bucketId, app)}/versions/${encodeURIComponent(version)}`, { skipAuth: true })).data;
  }

  async getStats(bucketId: string, app: string): Promise<SoftwareApplicationStats> {
    return (await this.http.get<SoftwareApplicationStats>(`${base(bucketId, app)}/stats`)).data;
  }

  async listVersions(bucketId: string, app: string): Promise<SoftwareVersionSummary[]> {
    return (await this.http.get<SoftwareVersionSummary[]>(`${base(bucketId, app)}/versions`)).data;
  }

  getDownloadUrl(bucketId: string, app: string, options: { version?: string; os?: string; arch?: string; filename?: string; channel?: string }): string {
    const ver = options.version || 'latest';
    const filename = options.filename ? encodeURIComponent(options.filename) : '';
    let path = '';
    if (options.os && options.arch) {
      path = `${base(bucketId, app)}/download/${encodeURIComponent(ver)}/${encodeURIComponent(options.os)}/${encodeURIComponent(options.arch)}/${filename}`;
    } else if (filename) {
      path = `${base(bucketId, app)}/download/${encodeURIComponent(ver)}/${filename}`;
    } else {
      path = `${base(bucketId, app)}/download/${encodeURIComponent(ver)}`;
    }
    if (ver === 'latest' && options.channel) {
      return `${path}?channel=${encodeURIComponent(options.channel)}`;
    }
    return path;
  }

  async publishReleaseWithFiles(input: PublishReleaseWithFilesInput): Promise<SoftwareRelease> {
    const channel = input.channel || 'stable';
    const intent = await this.beginPublish(input.bucketId, input.app, input.version);
    const assets: SoftwareAsset[] = [];

    for (const item of input.files) {
      let filename = item.name;
      if (!filename && typeof item.file === 'string') {
        filename = item.file.split(/[/\\]/).pop() || 'artifact';
      } else if (!filename && typeof File !== 'undefined' && item.file instanceof File) {
        filename = item.file.name;
      }
      filename = filename || 'artifact';

      const detected = detectAssetPlatform(filename);
      const os = item.os || detected.os;
      const arch = item.arch || detected.arch;
      const kind = item.kind || detected.kind;

      const uploaded = await uploadSingleFile(this.http, {
        file: item.file,
        name: filename,
        bucketId: input.bucketId,
        preflight: true,
      }, input.bucketId);

      if (!uploaded.file_hash) {
        throw new Error(`Upload succeeded but server returned no verified hash for ${filename}`);
      }

      await this.registerAsset(input.bucketId, input.app, intent.id, uploaded.file_id);
      assets.push({
        os,
        arch,
        kind,
        filename,
        file_id: uploaded.file_id,
        sha256: uploaded.file_hash,
        size: uploaded.size,
        download_path: `/v/${input.bucketId}/${uploaded.file_id}`,
      });
    }

    const payload: ReleasePayload = {
      schema_version: 1,
      bucket_id: input.bucketId,
      app: input.app,
      version: input.version,
      ...(input.notes ? { notes: input.notes } : {}),
      assets,
    };

    const signature = signSoftwarePayload(payload, input.signingSeed);
    const release = await this.publishRelease(input.bucketId, input.app, intent.id, payload, signature);

    for (let attempt = 0; attempt < 5; attempt++) {
      const manifest = await this.getManifest({ bucketId: input.bucketId, app: input.app, channel, limit: 1 });
      const latest = { ...(manifest.head?.payload.latest || {}) };
      for (const asset of assets) {
        latest[`${asset.os}/${asset.arch}`] = input.version;
      }
      const head: HeadPayload = {
        schema_version: 1,
        bucket_id: input.bucketId,
        app: input.app,
        channel,
        revision: (manifest.head?.payload.revision || 0) + 1,
        mode: 'promote',
        latest,
      };
      const headSig = signSoftwarePayload(head, input.signingSeed);
      try {
        await this.updateChannel(input.bucketId, input.app, channel, head, headSig);
        break;
      } catch (err) {
        if (attempt === 4 || !(err instanceof VFSError) || err.status !== 409) {
          throw err;
        }
      }
    }

    return release;
  }

  verifyManifest(manifest: SoftwareManifest, trustedKeys: TrustedSoftwareKeys): void {
    if (manifest.schema_version !== 1 || !manifest.application) throw new Error('Unsupported software manifest');
    if (manifest.head) {
      verifySoftwarePayload(manifest.head.payload, manifest.head.signature, trustedKeys);
      if (manifest.head.payload.bucket_id !== manifest.application.bucket_id || manifest.head.payload.app !== manifest.application.app || manifest.head.payload.channel !== manifest.channel) throw new Error('Channel head identity mismatch');
    }
    for (const release of [...manifest.latest_releases, ...manifest.releases]) {
      verifySoftwarePayload(release.payload, release.signature, trustedKeys);
      if (release.payload.bucket_id !== manifest.application.bucket_id || release.payload.app !== manifest.application.app) throw new Error('Release identity mismatch');
    }
  }

  async checkForUpdate(input: CheckForUpdateInput): Promise<AvailableUpdate | null> {
    const manifest = await this.getManifest({ bucketId: input.bucketId, app: input.app, channel: input.channel, os: input.os, arch: input.arch, signal: input.signal });
    this.verifyManifest(manifest, input.trustedKeys);
    if (manifest.application.bucket_id !== input.bucketId || manifest.application.app !== input.app || manifest.channel !== (input.channel || 'stable')) throw new Error('Manifest identity mismatch');
    const target = `${input.os}/${input.arch}`;
    const fallback = `${input.os}/universal`;
    const version = manifest.head?.payload.latest[target] || manifest.head?.payload.latest[fallback];
    if (!version) return null;
    const release = manifest.latest_releases.find((item) => item.payload.version === version);
    if (!release) throw new Error('Channel head refers to a missing release');
    if (input.currentVersion) {
      if (!semver.valid(input.currentVersion) || !semver.valid(version)) throw new Error('Invalid software version');
      const comparison = semver.compare(version, input.currentVersion);
      if (comparison === 0 || (comparison < 0 && !input.allowDowngrade)) return null;
    }
    const assets = release.payload.assets.filter((asset) => asset.os === input.os && (asset.arch === input.arch || asset.arch === 'universal'));
    if (assets.length === 0) throw new Error('Release has no compatible asset');
    return { release, assets, channel: manifest.channel };
  }

  /** Streams into a caller-provided writer; without one, returns the verified bytes. */
  async downloadAndVerify(asset: SoftwareAsset, writer?: WritableStream<Uint8Array>, signal?: AbortSignal): Promise<Uint8Array | void> {
    if (!/^\/v\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(asset.download_path) || !/^[0-9a-f]{64}$/.test(asset.sha256)) throw new Error('Invalid signed asset path or hash');
    const response = await this.http.fetchRaw(asset.download_path, { skipAuth: true, signal });
    if (!response.body) throw new Error('Download has no response body');
    const reader = response.body.getReader();
    const sink = writer?.getWriter();
    const hash = sha256.create();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        length += value.length;
        if (length > asset.size) throw new Error('Download exceeds signed size');
        if (sink) await sink.write(value); else chunks.push(value);
      }
      if (length !== asset.size || toHex(hash.digest()) !== asset.sha256) throw new Error('Download does not match signed size and SHA-256');
      await sink?.close();
      if (sink) return;
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return bytes;
    } catch (error) {
      await sink?.abort(error).catch(() => {});
      await reader.cancel().catch(() => {});
      throw error;
    }
  }

  /** Node.js: write to a private temporary file and atomically expose it only after verification. */
  async downloadToFile(asset: SoftwareAsset, destination: string, signal?: AbortSignal): Promise<void> {
    if (typeof process === 'undefined' || !process.versions?.node) throw new Error('downloadToFile requires Node.js');
    const fsp = await import('node:fs/promises');
    const temporary = `${destination}.vfs-${crypto.randomUUID()}.tmp`;
    let handle: Awaited<ReturnType<typeof fsp.open>> | undefined;
    try {
      handle = await fsp.open(temporary, 'wx', 0o600);
      const writable = new WritableStream<Uint8Array>({
        write: async (chunk) => {
          let offset = 0;
          while (offset < chunk.length) {
            const { bytesWritten } = await handle!.write(chunk, offset, chunk.length - offset);
            if (bytesWritten === 0) throw new Error('Download file write made no progress');
            offset += bytesWritten;
          }
        },
        close: async () => { await handle!.sync(); await handle!.close(); handle = undefined; },
        abort: async () => { await handle!.close(); handle = undefined; },
      });
      await this.downloadAndVerify(asset, writable, signal);
      await fsp.rename(temporary, destination);
    } catch (error) {
      await handle?.close().catch(() => {});
      await fsp.unlink(temporary).catch(() => {});
      throw error;
    }
  }
}

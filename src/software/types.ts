export interface SoftwareAsset {
  os: string;
  arch: string;
  kind: string;
  filename: string;
  file_id: string;
  sha256: string;
  size: number;
  download_path: string;
}

export interface ReleasePayload {
  schema_version: 1;
  bucket_id: string;
  app: string;
  version: string;
  notes?: string;
  assets: SoftwareAsset[];
}

export interface HeadPayload {
  schema_version: 1;
  bucket_id: string;
  app: string;
  channel: string;
  revision: number;
  mode: 'promote' | 'rollback';
  latest: Record<string, string>;
}

export interface SoftwareSignature { key_id: string; value: string }
export interface SoftwarePublicKey { key_id: string; value: string; created_at: string }
export interface SoftwareApplication {
  bucket_id: string;
  app: string;
  name: string;
  keys: SoftwarePublicKey[];
  active_key_id: string;
  created_at: string;
  updated_at: string;
}
export interface SoftwareRelease {
  payload: ReleasePayload;
  signature: SoftwareSignature;
  digest: string;
  published_at: string;
  revoked: boolean;
}
export interface SoftwareHead {
  payload: HeadPayload;
  signature: SoftwareSignature;
  updated_at: string;
}
export interface SoftwareManifest {
  schema_version: 1;
  application: SoftwareApplication;
  channel: string;
  head?: SoftwareHead;
  latest_releases: SoftwareRelease[];
  releases: SoftwareRelease[];
  next_cursor?: string;
}
export interface PublishIntent {
  id: string;
  version: string;
  file_ids: string[];
  state: string;
  created_at: string;
  expires_at: string;
}
export type TrustedSoftwareKeys = Record<string, string>;

export interface CheckForUpdateInput {
  bucketId: string;
  app: string;
  currentVersion?: string;
  os: string;
  arch: string;
  channel?: string;
  trustedKeys: TrustedSoftwareKeys;
  allowDowngrade?: boolean;
  signal?: AbortSignal;
}
export interface AvailableUpdate { release: SoftwareRelease; assets: SoftwareAsset[]; channel: string }

export interface SoftwareApplicationStats {
  bucket_id: string;
  app: string;
  checks_total: number;
  downloads_total: number;
  checks_by_channel: Record<string, number>;
  checks_by_target: Record<string, number>;
  downloads_by_version: Record<string, number>;
  downloads_by_target: Record<string, number>;
  last_checked_at?: string;
  last_downloaded_at?: string;
  updated_at: string;
}

export interface SoftwareVersionSummary {
  version: string;
  published_at: string;
  targets: string[];
  asset_count: number;
  revoked: boolean;
  downloads: number;
}

export interface VFSKeyFile {
  vfs_key_version: 1;
  app: string;
  bucket_id?: string;
  key_id: string;
  public_key: string;
  signing_seed: string;
  created_at: string;
}

export interface DetectedPlatform {
  os: string;
  arch: string;
  kind: string;
}

export interface VersionSuggestions {
  current: string | null;
  patch: string;
  minor: string;
  major: string;
  prerelease: {
    alpha: string;
    beta: string;
    rc: string;
  };
}

export interface PublishReleaseWithFilesInput {
  bucketId: string;
  app: string;
  version: string;
  channel?: string;
  signingSeed: string;
  notes?: string;
  files: Array<{
    file: string | Blob | File;
    name?: string;
    os?: string;
    arch?: string;
    kind?: string;
  }>;
}


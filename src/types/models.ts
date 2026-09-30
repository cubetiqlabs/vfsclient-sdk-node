/**
 * VFS Server models and response structures.
 */

export interface AttachmentResponse {
  id: string;
  bucket_id: string;
  file_id: string;
  file_hash?: string;
  extension: string;
  name: string;
  size: number;
  type: string;
  metadata?: Record<string, unknown>;
  user_details?: Record<string, unknown>;
  store?: 'local' | 's3' | 'r2' | 'vfs' | 'edge' | string;
  is_stat_synced?: boolean;
  created_at: string;
  url: string;
  key: string;
  cdn_url?: string;
}

export interface ObjectManifestResponse {
  id: string;
  bucket_id: string;
  file_id: string;
  file_hash?: string;
  extension: string;
  name: string;
  size: number;
  type: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  url: string;
  key: string;
  cdn_url?: string;
}

export interface PreflightRequest {
  bucket_id: string;
  name?: string;
  size?: number;
  content_type?: string;
  file_hash?: string;
}

export interface PreflightResponse {
  upload_protocol?: 'edge-chunks-v1' | string;
  allowed: boolean;
  reason?: string;
  bucket_id: string;
  name?: string;
  size: number;
  content_type?: string;
  file_hash?: string;
  max_upload_bytes: number;
  remaining_bytes?: number;
  remaining_files?: number;
  duplicate?: AttachmentResponse;
  upload_token?: string;
  expires_in?: number;
}

export interface SessionView {
  id: string;
  name: string;
  state: 'receiving' | 'paused' | 'queued' | 'finalizing' | 'complete' | 'error';
  file_hash?: string;
  offset: number;
  size: number;
  chunk_size: number;
  error?: string;
  attempts: number;
}

export interface BucketStat {
  id?: string;
  bucket_id: string;
  total_size: number;
  total_file: number;
  total_files?: number;
  total_dir?: number;
  total_read?: number;
  total_write?: number;
  owner_id?: string;
  max_size_bytes: number;
  max_files: number;
  lifecycle_enabled: boolean;
  default_ttl_seconds: number;
  created_at?: string;
  updated_at?: string;
}

export interface BucketStatSummary {
  total_buckets: number;
  total_files: number;
  total_size: number;
}

export interface BucketMetricsByDate {
  date: string;
  total_size: number;
  total_files: number;
}

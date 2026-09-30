import React, { useRef, useState } from 'react';
import type { VFSClient, AttachmentResponse } from '@cubis/vfsclient';

interface Props {
  client: VFSClient;
  bucketId: string;
  onUploadSuccess: (attachment: AttachmentResponse) => void;
}

export const UploadZone: React.FC<Props> = ({ client, bucketId, onUploadSuccess }) => {
  const [dragOver, setDragOver] = useState(false);
  const [resumable, setResumable] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<string>('');
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (file: File) => {
    setUploading(true);
    setProgress(0);
    setPhase('Preparing');
    setMessage(null);

    try {
      const response = await client.upload({
        file,
        name: file.name,
        bucketId,
        contentType: file.type,
        resumable,
        chunkSize: 1048576, // 1 MiB chunk size
        metadata: {
          uploadedVia: 'React Vite Example',
          originalSize: file.size,
        },
        onProgress: (p) => {
          setProgress(p.percent);
          setPhase(p.phase);
        },
      });

      setMessage({
        text: `Uploaded "${file.name}" successfully! ID: ${response.file_id}`,
        type: 'success',
      });

      onUploadSuccess(response);
    } catch (err: any) {
      setMessage({
        text: err.message || 'Upload failed',
        type: 'error',
      });
    } finally {
      setUploading(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files[0]);
    }
  };

  return (
    <div style={{ marginBottom: '32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h3>Single File Upload</h3>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={resumable}
            onChange={(e) => setResumable(e.target.checked)}
            disabled={uploading}
          />
          Use Resumable Chunked Upload (edge-chunks-v1)
        </label>
      </div>

      <div
        className={`dropzone ${dragOver ? 'dragover' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !uploading && fileInputRef.current?.click()}
      >
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              handleUpload(e.target.files[0]);
            }
          }}
        />

        <div className="dropzone-icon">📁</div>
        <p style={{ fontWeight: 600, marginBottom: '6px' }}>
          {uploading ? 'Transferring file...' : 'Click or drag & drop a file here'}
        </p>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          {resumable ? 'Resumable 1 MiB chunk protocol enabled' : 'Smart Preflight deduplication enabled'}
        </p>

        {uploading && (
          <div style={{ maxWidth: '400px', margin: '16px auto 0' }}>
            <div className="progress-container">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <div className="phase-text">
              <span>Phase: {phase}</span>
              <span>{progress}%</span>
            </div>
          </div>
        )}
      </div>

      {message && (
        <div
          style={{
            marginTop: '12px',
            padding: '10px 14px',
            borderRadius: '8px',
            fontSize: '13px',
            background:
              message.type === 'success'
                ? 'rgba(16, 185, 129, 0.15)'
                : message.type === 'error'
                ? 'rgba(239, 68, 68, 0.15)'
                : 'rgba(59, 130, 246, 0.15)',
            color:
              message.type === 'success'
                ? '#10b981'
                : message.type === 'error'
                ? '#ef4444'
                : '#3b82f6',
          }}
        >
          {message.text}
        </div>
      )}
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import type { VFSClient, AttachmentResponse, ObjectManifestResponse } from '@cubis/vfsclient';

interface Props {
  client: VFSClient;
  bucketId: string;
  refreshTrigger: number;
  onFileDeleted: () => void;
}

export const FileList: React.FC<Props> = ({ client, bucketId, refreshTrigger, onFileDeleted }) => {
  const [files, setFiles] = useState<AttachmentResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedMeta, setSelectedMeta] = useState<ObjectManifestResponse | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const fetchFiles = () => {
    setLoading(true);
    client
      .listFiles({ bucketId })
      .then((res) => {
        setFiles(res);
        setLoading(false);
      })
      .catch(() => {
        setFiles([]);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchFiles();
  }, [client, bucketId, refreshTrigger]);

  const handleDownload = async (file: AttachmentResponse) => {
    setDownloadingId(file.file_id);
    try {
      // client.getFile checks browser CacheStorage first!
      const blob = (await client.getFile(file.bucket_id, file.file_id, {
        responseType: 'blob',
        download: true,
      })) as Blob;

      // Trigger browser download
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      alert(`Download failed: ${err.message}`);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleViewMetadata = async (file: AttachmentResponse) => {
    try {
      const meta = await client.getFileMetadata(file.bucket_id, file.file_id);
      setSelectedMeta(meta);
    } catch (err: any) {
      alert(`Could not fetch metadata: ${err.message}`);
    }
  };

  const handleDelete = async (file: AttachmentResponse) => {
    if (!confirm(`Are you sure you want to delete "${file.name}"?`)) return;

    try {
      await client.deleteFile(file.bucket_id, file.file_id);
      onFileDeleted();
      fetchFiles();
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3>Stored Files in Bucket</h3>
        <button className="btn btn-secondary" style={{ padding: '6px 14px', fontSize: '13px' }} onClick={fetchFiles}>
          🔄 Refresh List
        </button>
      </div>

      {loading && files.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '14px', textAlign: 'center', padding: '32px' }}>
          Loading files...
        </p>
      ) : files.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
          <p style={{ color: 'var(--text-muted)' }}>No files found in bucket "{bucketId}".</p>
        </div>
      ) : (
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>File ID</th>
                <th>Size</th>
                <th>Type</th>
                <th>Store</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr key={file.id || file.file_id}>
                  <td className="file-name-cell" title={file.name}>
                    {file.name}
                  </td>
                  <td className="file-id-cell" title={file.file_id}>
                    {file.file_id}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatSize(file.size)}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '12px', whiteSpace: 'nowrap' }}>{file.type || 'unknown'}</td>
                  <td>
                    <span className="badge badge-info">{file.store || 'local'}</span>
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'inline-flex', gap: '6px' }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleViewMetadata(file)}
                        title="View JSON metadata"
                      >
                        Metadata
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        disabled={downloadingId === file.file_id}
                        onClick={() => handleDownload(file)}
                        title="Download cached/original file"
                      >
                        {downloadingId === file.file_id ? '⏳' : '⬇ Download'}
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => handleDelete(file)}
                        title="Delete file from bucket"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Metadata JSON Modal */}
      {selectedMeta && (
        <div className="modal-overlay" onClick={() => setSelectedMeta(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h4>File Metadata Manifest</h4>
              <button
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '18px' }}
                onClick={() => setSelectedMeta(null)}
              >
                ✕
              </button>
            </div>
            <pre>{JSON.stringify(selectedMeta, null, 2)}</pre>
            <div style={{ textAlign: 'right' }}>
              <button className="btn btn-secondary" onClick={() => setSelectedMeta(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

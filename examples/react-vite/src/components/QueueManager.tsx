import React, { useRef, useState, useEffect } from 'react';
import type { VFSClient, BackgroundUploadQueue, QueueProgress, QueueItem } from '@cubis/vfsclient';

interface Props {
  client: VFSClient;
  bucketId: string;
  onAllCompleted: () => void;
}

export const QueueManager: React.FC<Props> = ({ client, bucketId, onAllCompleted }) => {
  const [concurrency, setConcurrency] = useState(3);
  const [queueProgress, setQueueProgress] = useState<QueueProgress | null>(null);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const queueRef = useRef<BackgroundUploadQueue | null>(null);
  const multiFileInputRef = useRef<HTMLInputElement>(null);

  // Initialize or reconfigure queue
  useEffect(() => {
    const queue = client.createBackgroundQueue({
      bucketId,
      concurrency,
    });

    queue.onProgress((progress) => {
      setQueueProgress(progress);
      setItems(queue.getItems() as QueueItem[]);
    });

    queueRef.current = queue;

    return () => {
      queue.cancel();
    };
  }, [client, bucketId, concurrency]);

  const handleFiles = (fileList: FileList) => {
    if (!queueRef.current) return;
    const files = Array.from(fileList);
    for (const file of files) {
      queueRef.current.add({
        file,
        name: file.name,
        contentType: file.type,
        bucketId,
        metadata: { batchUploaded: true },
      });
    }

    queueRef.current.wait().then(() => {
      onAllCompleted();
    });
  };

  const togglePause = () => {
    if (!queueRef.current) return;
    if (isPaused) {
      queueRef.current.resume();
      setIsPaused(false);
    } else {
      queueRef.current.pause();
      setIsPaused(true);
    }
  };

  const handleCancel = () => {
    queueRef.current?.cancel();
    setItems([]);
    setQueueProgress(null);
  };

  return (
    <div style={{ marginBottom: '32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h3>Background Upload Queue</h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Concurrent streaming upload with pause, resume, and cancellation
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <label style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Concurrency:
            <select
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))}
              className="custom-select"
              style={{
                marginLeft: '8px',
                padding: '4px 28px 4px 10px',
                fontSize: '12px',
              }}
            >
              <option value="1">1 worker</option>
              <option value="2">2 workers</option>
              <option value="3">3 workers</option>
              <option value="5">5 workers</option>
            </select>
          </label>

          <button className="btn" onClick={() => multiFileInputRef.current?.click()}>
            + Add Files
          </button>
          <input
            type="file"
            multiple
            ref={multiFileInputRef}
            style={{ display: 'none' }}
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />
        </div>
      </div>

      {queueProgress && queueProgress.totalFiles > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '16px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '14px', fontWeight: 600 }}>
              Batch Progress: {queueProgress.completedFiles} of {queueProgress.totalFiles} Completed
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={togglePause}>
                {isPaused ? '▶ Resume' : '⏸ Pause'}
              </button>
              <button className="btn btn-danger" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={handleCancel}>
                ✕ Cancel
              </button>
            </div>
          </div>

          <div className="progress-container">
            <div className="progress-fill" style={{ width: `${queueProgress.overallPercent}%` }} />
          </div>
        </div>
      )}

      {items.length > 0 && (
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>File Name</th>
                <th>Status</th>
                <th>Progress</th>
                <th>File ID</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="file-name-cell" title={item.input.name}>
                    {item.input.name}
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        item.status === 'completed'
                          ? 'badge-success'
                          : item.status === 'uploading'
                          ? 'badge-info'
                          : item.status === 'failed'
                          ? 'badge-warning'
                          : ''
                      }`}
                    >
                      {item.status}
                    </span>
                  </td>
                  <td style={{ width: '180px', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div className="progress-container" style={{ flex: 1, margin: 0, height: '6px' }}>
                        <div className="progress-fill" style={{ width: `${item.progress}%` }} />
                      </div>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.progress}%</span>
                    </div>
                  </td>
                  <td className="file-id-cell" title={item.response?.file_id || item.error?.message || ''}>
                    {item.response?.file_id || item.error?.message || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

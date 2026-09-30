import React, { useEffect, useState } from 'react';
import type { VFSClient, BucketStat } from '@cubis/vfsclient';

interface Props {
  client: VFSClient;
  bucketId: string;
  refreshTrigger: number;
}

export const BucketStatsCard: React.FC<Props> = ({ client, bucketId, refreshTrigger }) => {
  const [stats, setStats] = useState<BucketStat | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);

    client
      .getBucketStats(bucketId)
      .then((res) => {
        if (isMounted) {
          setStats(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err.message || 'Unable to load bucket stats');
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [client, bucketId, refreshTrigger]);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (loading && !stats) {
    return (
      <div className="stat-card" style={{ gridColumn: '1 / -1', textAlign: 'center' }}>
        <p className="stat-label">Loading bucket statistics...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="stat-card" style={{ gridColumn: '1 / -1', borderLeft: '4px solid #ef4444' }}>
        <p className="stat-label" style={{ color: '#ef4444' }}>Bucket Info</p>
        <p className="stat-sub">{error} (Server might be unreachable or bucket is empty)</p>
      </div>
    );
  }

  return (
    <div className="stats-grid">
      <div className="stat-card">
        <span className="stat-label">Total Files</span>
        <span className="stat-value">{stats?.total_file ?? 0}</span>
        <span className="stat-sub">Bucket: {bucketId}</span>
      </div>

      <div className="stat-card">
        <span className="stat-label">Storage Used</span>
        <span className="stat-value">{formatBytes(stats?.total_size ?? 0)}</span>
        <span className="stat-sub">
          {stats?.max_size_bytes && stats.max_size_bytes > 0
            ? `Quota: ${formatBytes(stats.max_size_bytes)}`
            : 'Unlimited quota'}
        </span>
      </div>

      <div className="stat-card">
        <span className="stat-label">Read / Write Operations</span>
        <span className="stat-value">
          {stats?.total_read ?? 0} <span style={{ fontSize: '14px', color: '#94a3b8' }}>/</span> {stats?.total_write ?? 0}
        </span>
        <span className="stat-sub">Cumulative count</span>
      </div>

      <div className="stat-card">
        <span className="stat-label">Object Lifecycle</span>
        <span className="stat-value">
          {stats?.lifecycle_enabled ? `${stats.default_ttl_seconds}s` : 'Permanent'}
        </span>
        <span className="stat-sub">
          {stats?.lifecycle_enabled ? 'Auto-expires files' : 'No automatic deletion'}
        </span>
      </div>
    </div>
  );
};

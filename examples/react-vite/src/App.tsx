import React, { useMemo, useState } from 'react';
import { VFSClient } from '@cubis/vfsclient';
import { BucketStatsCard } from './components/BucketStatsCard';
import { UploadZone } from './components/UploadZone';
import { QueueManager } from './components/QueueManager';
import { FileList } from './components/FileList';

export const App: React.FC = () => {
  const [endpoint, setEndpoint] = useState('http://localhost:5002');
  const [authType, setAuthType] = useState<'apiKey' | 'apiHash'>('apiKey');
  const [authValue, setAuthValue] = useState('vfs_dev_key');
  const [bucketId, setBucketId] = useState('default');
  const [activeTab, setActiveTab] = useState<'single' | 'queue' | 'files'>('single');
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Re-create client whenever endpoint or auth changes
  const client = useMemo(() => {
    return new VFSClient({
      endpoint,
      apiKey: authType === 'apiKey' ? authValue : undefined,
      apiHash: authType === 'apiHash' ? authValue : undefined,
      defaultBucket: bucketId,
      cache: true, // Auto-selects Browser CacheStorage
      debug: true,
    });
  }, [endpoint, authType, authValue, bucketId]);

  const triggerRefresh = () => setRefreshTrigger((prev) => prev + 1);

  return (
    <div className="container">
      <header>
        <div>
          <div className="brand">
            <span className="brand-badge">VFS CLIENT SDK</span>
            <h1>React + Vite Dashboard</h1>
          </div>
          <p className="subtitle">
            Universal file upload client powered by <code>@cubis/vfsclient</code>
          </p>
        </div>
      </header>

      {/* Connection & Auth Configuration Card */}
      <div className="config-card">
        <div className="config-grid">
          <div className="form-group">
            <label>VFS Server Endpoint</label>
            <input
              type="text"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="http://localhost:5002"
            />
          </div>

          <div className="form-group">
            <label>Authentication Header</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <select
                value={authType}
                onChange={(e) => setAuthType(e.target.value as any)}
                style={{ width: '130px' }}
              >
                <option value="apiKey">x-api-key</option>
                <option value="apiHash">x-api-hash</option>
              </select>
              <input
                type="text"
                value={authValue}
                onChange={(e) => setAuthValue(e.target.value)}
                placeholder="Secret key or hash"
                style={{ flex: 1 }}
              />
            </div>
          </div>

          <div className="form-group">
            <label>Target Bucket</label>
            <input
              type="text"
              value={bucketId}
              onChange={(e) => setBucketId(e.target.value)}
              placeholder="default"
            />
          </div>
        </div>
      </div>

      {/* Bucket Statistics Widget */}
      <BucketStatsCard client={client} bucketId={bucketId} refreshTrigger={refreshTrigger} />

      {/* Tabs */}
      <div className="tabs">
        <button
          className={`tab-btn ${activeTab === 'single' ? 'active' : ''}`}
          onClick={() => setActiveTab('single')}
        >
          Single / Resumable Upload
        </button>
        <button
          className={`tab-btn ${activeTab === 'queue' ? 'active' : ''}`}
          onClick={() => setActiveTab('queue')}
        >
          Background Multi-File Queue
        </button>
        <button
          className={`tab-btn ${activeTab === 'files' ? 'active' : ''}`}
          onClick={() => setActiveTab('files')}
        >
          Bucket Files & Cache
        </button>
      </div>

      {/* Tab Panels */}
      {activeTab === 'single' && (
        <UploadZone client={client} bucketId={bucketId} onUploadSuccess={triggerRefresh} />
      )}

      {activeTab === 'queue' && (
        <QueueManager client={client} bucketId={bucketId} onAllCompleted={triggerRefresh} />
      )}

      {activeTab === 'files' && (
        <FileList
          client={client}
          bucketId={bucketId}
          refreshTrigger={refreshTrigger}
          onFileDeleted={triggerRefresh}
        />
      )}
    </div>
  );
};

export default App;

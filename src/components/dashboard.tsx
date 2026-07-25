import { h, Fragment } from 'preact';
import { useState, useRef, useEffect } from 'preact/hooks';
import { appState, RecentFileEntry } from '../utils/appState';

interface DashboardProps {
  onFileSelected: (file: File) => void;
  onRecentSelected: (hash: string) => void;
}

export function Dashboard({ onFileSelected, onRecentSelected }: DashboardProps) {
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.name.toLowerCase().endsWith('.chm')) {
        onFileSelected(file);
      } else {
        alert('Please drop a valid .chm file.');
      }
    }
  };

  const handleBrowseClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = () => {
    if (fileInputRef.current?.files && fileInputRef.current.files.length > 0) {
      onFileSelected(fileInputRef.current.files[0]);
    }
  };

  return (
    <div className="dashboard-container">
      {/* Header */}
      <div className="dashboard-header">
        <h1>chmv</h1>
        <p>100% Client-Side Web CHM Reader & PWA</p>
      </div>

      {/* Drag & Drop Zone */}
      <div
        className={`drop-zone ${dragOver ? 'drag-over' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <svg viewBox="0 0 24 24">
          <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z" />
        </svg>
        <h3>Drag and Drop CHM File here</h3>
        <p>or</p>
        <button className="file-picker-btn" onClick={handleBrowseClick}>
          Browse Files
        </button>
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept=".chm"
          style={{ display: 'none' }}
        />
      </div>

      {/* Recent Files List */}
      <div className="recent-section">
        <h2>Recent Documents</h2>
        {appState.recentFiles.length > 0 ? (
          <div className="recent-grid">
            {appState.recentFiles.map((file) => {
              const formattedDate = new Date(file.timestamp).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              });
              const percentStr = file.completedPercent.toFixed(0);

              return (
                <div
                  key={file.hash}
                  className="recent-card"
                  onClick={() => onRecentSelected(file.hash)}
                >
                  <h4>{file.name}</h4>
                  <span className="timestamp">Last read: {formattedDate}</span>
                  <div className="progress-container">
                    <div className="progress-text">
                      <span>Progress</span>
                      <span>{percentStr}%</span>
                    </div>
                    <div className="progress-bar-bg">
                      <div className="progress-bar-fill" style={{ width: `${percentStr}%` }}></div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: '20px' }}>
            No recently opened CHM files. Drag one above to start reading!
          </p>
        )}
      </div>
    </div>
  );
}

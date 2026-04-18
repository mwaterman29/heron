import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { api } from '../api';
import type { LogFile } from '../types';

export function Logs() {
  const [files, setFiles] = useState<LogFile[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [text, setText] = useState<string>('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [tailLive, setTailLive] = useState(true);
  const [levelFilter, setLevelFilter] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const viewerRef = useRef<HTMLDivElement>(null);

  const loadList = async () => {
    try {
      const list = await api.listLogs();
      setFiles(list);
      if (!selected && list.length > 0) setSelected(list[0].name);
    } catch (e) {
      setError(String(e));
    }
  };

  const loadContent = async (name: string) => {
    try {
      const t = await api.tailLog(name, 1000);
      setText(t);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    loadList();
  }, []);

  useEffect(() => {
    if (!selected) return;
    loadContent(selected);
  }, [selected]);

  // Live tail: append sidecar-log events to the text when viewing the newest file
  useEffect(() => {
    if (!tailLive) return;
    const unlisten = listen<string>('sidecar-log', (event) => {
      setText((prev) => prev + '\n' + event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [tailLive]);

  // After sidecar finishes, refresh file list
  useEffect(() => {
    const unlisten = listen('sidecar-finished', () => {
      loadList();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Auto-scroll to bottom when text changes
  useEffect(() => {
    if (autoScroll && viewerRef.current) {
      viewerRef.current.scrollTop = viewerRef.current.scrollHeight;
    }
  }, [text, autoScroll]);

  const filtered = levelFilter
    ? text
        .split('\n')
        .filter((line) => {
          const l = line.toLowerCase();
          if (levelFilter === 'error') return l.includes('error') || l.includes('fatal') || l.includes('[stderr]');
          if (levelFilter === 'warn') return l.includes('warn') || l.includes('error') || l.includes('[stderr]');
          return true;
        })
        .join('\n')
    : text;

  return (
    <div>
      <div className="panel-header">
        <div>
          <h2>Logs</h2>
          <div className="subtitle">
            {files.length === 0
              ? 'No logs yet. Run a hunt to generate output.'
              : `${files.length} log file${files.length === 1 ? '' : 's'} on disk`}
          </div>
        </div>
        <div className="panel-header-actions">
          <button
            className="btn sm"
            onClick={() => selected && loadContent(selected)}
          >
            Refresh
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <label className="field" style={{ marginBottom: 0, flex: '1 1 220px' }}>
            <span className="field-label">Log file</span>
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              {files.length === 0 && <option value="">(no logs)</option>}
              {files.map((f) => (
                <option key={f.name} value={f.name}>
                  {f.name} ({(f.size_bytes / 1024).toFixed(1)} KB)
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={{ marginBottom: 0 }}>
            <span className="field-label">Level filter</span>
            <select value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)}>
              <option value="">All</option>
              <option value="warn">Warn+</option>
              <option value="error">Error only</option>
            </select>
          </label>
          <label className="field" style={{ marginBottom: 0, alignSelf: 'flex-end' }}>
            <div className="row">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
              />
              <span className="faint" style={{ fontSize: 12 }}>Auto-scroll</span>
            </div>
          </label>
          <label className="field" style={{ marginBottom: 0, alignSelf: 'flex-end' }}>
            <div className="row">
              <input
                type="checkbox"
                checked={tailLive}
                onChange={(e) => setTailLive(e.target.checked)}
              />
              <span className="faint" style={{ fontSize: 12 }}>Live tail</span>
            </div>
          </label>
        </div>
      </div>

      <div className="log-viewer" ref={viewerRef}>
        {filtered || <span className="faint">(empty)</span>}
      </div>
    </div>
  );
}

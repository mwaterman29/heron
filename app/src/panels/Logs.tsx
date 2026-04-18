import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { api } from '../api';
import type { LogFile } from '../types';
import { Icon, Segmented } from '../components/Pills';

type Level = 'all' | 'info' | 'warn' | 'error';

export function Logs() {
  const [files, setFiles] = useState<LogFile[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [text, setText] = useState<string>('');
  const [level, setLevel] = useState<Level>('all');
  const [autoscroll, setAutoscroll] = useState(true);
  const [tailLive, setTailLive] = useState(true);
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
      const t = await api.tailLog(name, 2000);
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

  // Live tail
  useEffect(() => {
    if (!tailLive) return;
    const unlisten = listen<string>('sidecar-log', (event) => {
      setText((prev) => prev + '\n' + event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [tailLive]);

  // Refresh file list after runs finish
  useEffect(() => {
    const unlisten = listen('sidecar-finished', () => loadList());
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (autoscroll && viewerRef.current) {
      viewerRef.current.scrollTop = viewerRef.current.scrollHeight;
    }
  }, [text, autoscroll]);

  const lines = text.split('\n');
  const filtered = level === 'all'
    ? lines
    : lines.filter((ln) => {
        const l = ln.toLowerCase();
        if (level === 'error') return l.includes('error') || l.includes('fatal') || l.includes('[stderr]');
        if (level === 'warn') return l.includes('warn') || l.includes('error') || l.includes('[stderr]');
        if (level === 'info') return l.includes('info') || !l.includes('debug');
        return true;
      });

  const current = files.find((f) => f.name === selected);

  const levelOf = (ln: string): 'info' | 'warn' | 'error' | 'debug' => {
    const l = ln.toLowerCase();
    if (l.includes('error') || l.includes('fatal') || l.includes('[stderr]')) return 'error';
    if (l.includes('warn')) return 'warn';
    if (l.includes('debug')) return 'debug';
    return 'info';
  };

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Logs</div>
          <div className="page-subtitle">
            {current
              ? `logs/${current.name} · ${filtered.length} lines · ${(current.size_bytes / 1024).toFixed(1)} KB`
              : 'no log files yet — run a hunt to start'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select
            className="select mono"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            style={{ width: 240 }}
          >
            {files.length === 0 && <option value="">(no logs)</option>}
            {files.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name}
              </option>
            ))}
          </select>
          <button className="btn" onClick={() => selected && loadContent(selected)}>
            <Icon name="refresh" size={11} /> Refresh
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Segmented
          options={[
            { value: 'all' as const, label: 'All' },
            { value: 'info' as const, label: 'Info' },
            { value: 'warn' as const, label: 'Warn' },
            { value: 'error' as const, label: 'Error' },
          ]}
          value={level}
          onChange={setLevel}
        />
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            color: 'var(--text-secondary)',
          }}
        >
          <span
            className={`cbox ${autoscroll ? 'on' : ''}`}
            onClick={() => setAutoscroll(!autoscroll)}
          />
          Auto-scroll
        </label>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            color: 'var(--text-secondary)',
          }}
        >
          <span
            className={`cbox ${tailLive ? 'on' : ''}`}
            onClick={() => setTailLive(!tailLive)}
          />
          Live tail
        </label>
        <span
          className="mono"
          style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}
        >
          showing {filtered.length} / {lines.length}
        </span>
      </div>

      <div className="log-viewer" ref={viewerRef} style={{ maxHeight: 'calc(100vh - 260px)' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '24px 18px', color: 'var(--text-dim)', textAlign: 'center' }}>
            (empty)
          </div>
        ) : (
          filtered.map((ln, i) => {
            const lvl = levelOf(ln);
            return (
              <div key={i} className={`log-viewer-line ${lvl}`}>
                <span style={{ color: 'var(--text-dim)' }}>
                  {String(i + 1).padStart(4, '0')}
                </span>
                <span
                  style={{
                    color: lvl === 'info' ? 'var(--text-muted)' : undefined,
                    textTransform: 'uppercase',
                    fontSize: 10.5,
                    fontWeight: 600,
                  }}
                >
                  [{lvl}]
                </span>
                <span>{ln}</span>
              </div>
            );
          })
        )}
        {tailLive && (
          <div
            style={{
              padding: '8px 18px',
              color: 'var(--text-dim)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span className="pip ok pulse" style={{ width: 6, height: 6 }} />
            tailing…
          </div>
        )}
      </div>
    </>
  );
}

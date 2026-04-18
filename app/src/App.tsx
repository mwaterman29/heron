import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './App.css';

interface SidecarSummary {
  status: string;
  timestamp: string;
  searches_run: number;
  listings_scraped: number;
  new_listings: number;
  deals_found: number;
  notifications_sent: number;
  errors: string[];
  duration_ms: number;
}

interface Status {
  running: boolean;
  last_summary: SidecarSummary | null;
}

function App() {
  const [status, setStatus] = useState<Status>({ running: false, last_summary: null });
  const [configDir, setConfigDir] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = async () => {
    try {
      const s = await invoke<Status>('get_status');
      setStatus(s);
    } catch (e) {
      console.error('get_status failed', e);
    }
  };

  useEffect(() => {
    invoke<string>('get_config_dir').then(setConfigDir).catch(console.error);
    refreshStatus();

    const unlistenSummary = listen<SidecarSummary>('sidecar-summary', (event) => {
      setStatus((prev) => ({ ...prev, last_summary: event.payload }));
    });
    const unlistenFinished = listen<number | null>('sidecar-finished', () => {
      refreshStatus();
    });

    return () => {
      unlistenSummary.then((fn) => fn());
      unlistenFinished.then((fn) => fn());
    };
  }, []);

  const handleRunNow = async () => {
    setError(null);
    try {
      await invoke('run_now');
      setStatus((prev) => ({ ...prev, running: true }));
    } catch (e) {
      setError(String(e));
    }
  };

  const summary = status.last_summary;

  return (
    <div className="app">
      <header>
        <h1>Deal Hunter</h1>
        <div className="config-dir" title={configDir}>
          {configDir}
        </div>
      </header>

      <section className="controls">
        <button
          className={`run-btn ${status.running ? 'running' : ''}`}
          onClick={handleRunNow}
          disabled={status.running}
        >
          {status.running ? 'Running...' : 'Run Now'}
        </button>
        <span className={`status-pill ${status.running ? 'running' : 'idle'}`}>
          {status.running ? 'Scanning' : 'Idle'}
        </span>
      </section>

      {error && <div className="error">{error}</div>}

      <section className="summary">
        <h2>Last run</h2>
        {!summary ? (
          <div className="empty">No runs yet — click "Run Now" to trigger a hunt.</div>
        ) : (
          <>
            <div className="summary-meta">
              <span className={`status-pill ${summary.status}`}>{summary.status}</span>
              <span className="timestamp">{new Date(summary.timestamp).toLocaleString()}</span>
              <span className="duration">{(summary.duration_ms / 1000).toFixed(1)}s</span>
            </div>
            <div className="grid">
              <Stat label="Searches" value={summary.searches_run} />
              <Stat label="Scraped" value={summary.listings_scraped} />
              <Stat label="New" value={summary.new_listings} />
              <Stat label="Deals" value={summary.deals_found} highlight={summary.deals_found > 0} />
              <Stat label="Notified" value={summary.notifications_sent} />
              <Stat label="Errors" value={summary.errors.length} highlight={summary.errors.length > 0} />
            </div>
            {summary.errors.length > 0 && (
              <div className="errors">
                <h3>Errors</h3>
                <ul>
                  {summary.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`stat ${highlight ? 'highlight' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

export default App;

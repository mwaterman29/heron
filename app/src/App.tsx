import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { api } from './api';
import type { Panel, SidecarSummary, Status } from './types';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './panels/Dashboard';
import { Queue } from './panels/Queue';
import { Targets } from './panels/Targets';
import { Sources } from './panels/Sources';
import { Settings } from './panels/Settings';
import { History } from './panels/History';
import { Logs } from './panels/Logs';
import './App.css';

const REQUIRED_KEYS = ['OPENROUTER_API_KEY', 'DISCORD_BOT_TOKEN', 'DISCORD_USER_ID'];

function App() {
  const [panel, setPanel] = useState<Panel>(() => {
    const saved = localStorage.getItem('dh-panel') as Panel | null;
    return saved ?? 'dashboard';
  });
  const [status, setStatus] = useState<Status>({ running: false, last_summary: null });
  const [missingKeys, setMissingKeys] = useState<string[]>(REQUIRED_KEYS);
  const [queueCount, setQueueCount] = useState(0);
  const [targetCount, setTargetCount] = useState(0);
  const [sourceCount, setSourceCount] = useState(0);
  const [nextRunLabel, setNextRunLabel] = useState<string>('');

  useEffect(() => {
    localStorage.setItem('dh-panel', panel);
  }, [panel]);

  const keysReady = missingKeys.length === 0;

  const refreshStatus = async () => {
    try {
      const s = await api.getStatus();
      setStatus(s);
    } catch (e) {
      console.error('get_status failed', e);
    }
  };

  const refreshCounts = async () => {
    try {
      const [secrets, queue, sources, config, schedule, nextRuns] = await Promise.all([
        api.readSecrets(false),
        api.getQueue(),
        api.getSourceStats(),
        api.readConfig().catch(() => ''),
        api.getSchedule().catch(() => null),
        api.getNextRuns(1).catch(() => [] as number[]),
      ]);

      const missing = REQUIRED_KEYS.filter((k) => {
        const entry = secrets.find((s) => s.key === k);
        return !entry || !entry.is_set;
      });
      setMissingKeys(missing);

      // Count "new" items only (items needing triage)
      setQueueCount(queue.filter((d) => (d.listing_state ?? 'new') === 'new').length);

      setSourceCount(sources.length || 8);

      // Count targets from YAML (rough regex on "- id:" occurrences)
      const targetMatches = (config.match(/^\s*-\s*id\s*:/gm) || []).length;
      setTargetCount(targetMatches);

      // Next run label
      if (schedule?.enabled && nextRuns.length > 0) {
        const diff = nextRuns[0] - Date.now();
        if (diff > 0) {
          const m = Math.floor(diff / 60_000);
          if (m < 60) setNextRunLabel(`next run in ${m}m`);
          else setNextRunLabel(`next run in ${Math.floor(m / 60)}h ${m % 60}m`);
        } else {
          setNextRunLabel('next run soon');
        }
      } else {
        setNextRunLabel('manual runs only');
      }
    } catch (e) {
      console.error('refreshCounts failed', e);
    }
  };

  useEffect(() => {
    refreshStatus();
    refreshCounts();
    const unlistenSummary = listen<SidecarSummary>('sidecar-summary', (event) => {
      setStatus((prev) => ({ ...prev, last_summary: event.payload }));
    });
    const unlistenFinished = listen<number | null>('sidecar-finished', () => {
      refreshStatus();
      refreshCounts();
    });
    // Refresh counts periodically so next-run countdown updates
    const interval = setInterval(refreshCounts, 30_000);
    return () => {
      unlistenSummary.then((fn) => fn());
      unlistenFinished.then((fn) => fn());
      clearInterval(interval);
    };
  }, []);

  const handleRunNow = async (dry = false) => {
    if (!keysReady && !dry) {
      alert(`Configure these API keys first: ${missingKeys.join(', ')}`);
      setPanel('settings');
      return;
    }
    try {
      await api.runNow(dry);
      setStatus((prev) => ({ ...prev, running: true }));
    } catch (e) {
      console.error('run_now failed', e);
      alert(`Failed to start run: ${e}`);
    }
  };

  return (
    <div className="app">
      <Sidebar
        current={panel}
        onChange={setPanel}
        running={status.running}
        queueCount={queueCount}
        targetCount={targetCount}
        sourceCount={sourceCount}
        footerText={nextRunLabel}
        showStatus={keysReady}
      />
      <main className="main">
        {panel === 'dashboard' && (
          <Dashboard
            status={status}
            onRunNow={handleRunNow}
            onNavigate={setPanel}
            keysReady={keysReady}
            missingKeys={missingKeys}
          />
        )}
        {panel === 'queue' && <Queue />}
        {panel === 'targets' && <Targets />}
        {panel === 'sources' && <Sources />}
        {panel === 'settings' && <Settings keysReady={keysReady} />}
        {panel === 'history' && <History />}
        {panel === 'logs' && <Logs />}
      </main>
    </div>
  );
}

export default App;

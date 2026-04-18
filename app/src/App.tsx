import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { api } from './api';
import type { Panel, SidecarSummary, Status } from './types';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './panels/Dashboard';
import { Items } from './panels/Items';
import { Sources } from './panels/Sources';
import { Settings } from './panels/Settings';
import { History } from './panels/History';
import { Logs } from './panels/Logs';
import './App.css';

function App() {
  const [panel, setPanel] = useState<Panel>('dashboard');
  const [status, setStatus] = useState<Status>({ running: false, last_summary: null });
  const [configDir, setConfigDir] = useState<string>('');

  const refreshStatus = async () => {
    try {
      const s = await api.getStatus();
      setStatus(s);
    } catch (e) {
      console.error('get_status failed', e);
    }
  };

  useEffect(() => {
    api.getConfigDir().then(setConfigDir).catch(console.error);
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

  const handleRunNow = async (dry = false) => {
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
        configDir={configDir}
      />
      <main className="main">
        {panel === 'dashboard' && (
          <Dashboard status={status} onRunNow={handleRunNow} onNavigate={setPanel} />
        )}
        {panel === 'items' && <Items />}
        {panel === 'sources' && <Sources />}
        {panel === 'settings' && <Settings onRunNow={handleRunNow} />}
        {panel === 'history' && <History />}
        {panel === 'logs' && <Logs />}
      </main>
    </div>
  );
}

export default App;

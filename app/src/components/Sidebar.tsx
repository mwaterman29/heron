import type { Panel } from '../types';

const ITEMS: { id: Panel; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '◉' },
  { id: 'items', label: 'Items', icon: '▤' },
  { id: 'sources', label: 'Sources', icon: '⊟' },
  { id: 'history', label: 'History', icon: '⎗' },
  { id: 'logs', label: 'Logs', icon: '▥' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

interface Props {
  current: Panel;
  onChange: (p: Panel) => void;
  running: boolean;
  configDir: string;
}

export function Sidebar({ current, onChange, running, configDir }: Props) {
  const dirShort = configDir ? configDir.split(/[\\/]/).slice(-2).join('/') : '…';
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <h1>Deal Hunter</h1>
        <div className="sub" title={configDir}>{dirShort}</div>
      </div>
      <nav className="sidebar-nav">
        {ITEMS.map((item) => (
          <button
            key={item.id}
            className={`sidebar-nav-item ${current === item.id ? 'active' : ''}`}
            onClick={() => onChange(item.id)}
          >
            <span className="icon">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div className="sidebar-status">
          <div className={`sidebar-status-dot ${running ? 'running' : 'idle'}`} />
          <span>{running ? 'Scanning…' : 'Idle'}</span>
        </div>
      </div>
    </aside>
  );
}

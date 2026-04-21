import type { Panel } from '../types';
import { Icon } from './Pills';
import heronSvg from '../assets/heron.svg?raw';

// Strip the original fill="#000000" so CSS controls color via fill: currentColor.
const heronInline = heronSvg
  .replace(/fill="[^"]*"/g, 'fill="currentColor"')
  .replace('<svg ', '<svg preserveAspectRatio="xMidYMid meet" ');

interface NavItem {
  id: Panel;
  label: string;
  icon: string;
  badge?: string | number;
}

interface Props {
  current: Panel;
  onChange: (p: Panel) => void;
  running: boolean;
  queueCount: number;
  targetCount: number;
  sourceCount: number;
  footerText?: string;
  showStatus: boolean;
}

export function Sidebar({
  current,
  onChange,
  running,
  queueCount,
  targetCount,
  sourceCount,
  footerText,
  showStatus,
}: Props) {
  const items: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { id: 'queue', label: 'Queue', icon: 'bell', badge: queueCount > 0 ? queueCount : undefined },
    { id: 'targets', label: 'Targets', icon: 'items', badge: targetCount > 0 ? targetCount : undefined },
    { id: 'sources', label: 'Sources', icon: 'sources', badge: sourceCount || undefined },
    { id: 'history', label: 'History', icon: 'history' },
    { id: 'logs', label: 'Logs', icon: 'logs' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div
          className="sidebar-brand-logo"
          dangerouslySetInnerHTML={{ __html: heronInline }}
        />
        <div>
          <div className="sidebar-brand-name">Deal Hunter</div>
          <div className="sidebar-sub">Quietly hunting</div>
        </div>
      </div>

      <nav className="sidebar-nav">
        {items.map((it) => (
          <button
            key={it.id}
            className={`nav-item ${current === it.id ? 'active' : ''}`}
            onClick={() => onChange(it.id)}
          >
            <Icon name={it.icon} size={15} className="nav-icon" />
            <span>{it.label}</span>
            {it.badge && <span className="nav-badge mono">{it.badge}</span>}
          </button>
        ))}
      </nav>

      {showStatus && (
        <div className="sidebar-footer">
          <span className={`pip ${running ? 'warn' : 'ok'}`} />
          <div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
              {running ? 'Scanning…' : 'All good'}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>
              {footerText ?? 'idle'}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

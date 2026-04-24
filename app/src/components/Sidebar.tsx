import { useEffect, useState } from 'react';
import type { Panel, UpdateInfo } from '../types';
import { Icon } from './Pills';
import { api } from '../api';
import { UpdateModal } from './UpdateModal';
import heronSvg from '../assets/heron.svg?raw';

// Strip the original fill="#000000" so CSS controls color via fill: currentColor.
const heronInline = heronSvg
  .replace(/fill="[^"]*"/g, 'fill="currentColor"')
  .replace('<svg ', '<svg preserveAspectRatio="xMidYMid meet" ');

const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const LAST_CHECK_KEY = 'heron-last-update-check';

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
  currentActivity?: string | null;
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
  currentActivity,
}: Props) {
  const [version, setVersion] = useState<string>('');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // On mount: load version, check for updates if last check was >24h ago
  useEffect(() => {
    api.getVersion().then(setVersion).catch(() => {});

    const lastCheck = Number(localStorage.getItem(LAST_CHECK_KEY) ?? 0);
    if (Date.now() - lastCheck > UPDATE_CHECK_INTERVAL_MS) {
      api
        .checkForUpdates()
        .then((info) => {
          setUpdateInfo(info);
          localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
        })
        .catch(() => {
          // Network failures are silent — update checking is best-effort
        });
    }
  }, []);

  const items: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { id: 'queue', label: 'Queue', icon: 'bell', badge: queueCount > 0 ? queueCount : undefined },
    { id: 'targets', label: 'Targets', icon: 'items', badge: targetCount > 0 ? targetCount : undefined },
    { id: 'sources', label: 'Sources', icon: 'sources', badge: sourceCount || undefined },
    { id: 'history', label: 'History', icon: 'history' },
    { id: 'logs', label: 'Logs', icon: 'logs' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ];

  const showUpdateDot = !!updateInfo?.available;

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div
          className="sidebar-brand-logo"
          dangerouslySetInnerHTML={{ __html: heronInline }}
        />
        <div className="sidebar-brand-name">Heron</div>
        {version && (
          <button
            className="sidebar-brand-version"
            onClick={() => updateInfo?.available && setModalOpen(true)}
            title={
              showUpdateDot
                ? `Update available: ${updateInfo!.latest_version}`
                : `Version ${version}`
            }
            style={{
              cursor: showUpdateDot ? 'pointer' : 'default',
              color: showUpdateDot ? 'var(--accent-text)' : 'var(--text-dim)',
            }}
          >
            v{version}
            {showUpdateDot && (
              <span
                className="pip"
                style={{
                  background: 'var(--accent)',
                  marginLeft: 6,
                  width: 6,
                  height: 6,
                  display: 'inline-block',
                  verticalAlign: 'middle',
                }}
              />
            )}
          </button>
        )}
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
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
              {running ? 'Scanning…' : 'All good'}
            </div>
            <div
              style={{
                fontSize: 10.5,
                color: 'var(--text-dim)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={
                running && currentActivity
                  ? currentActivity
                  : footerText ?? 'idle'
              }
            >
              {running && currentActivity ? currentActivity : footerText ?? 'idle'}
            </div>
          </div>
        </div>
      )}

      {modalOpen && updateInfo && (
        <UpdateModal info={updateInfo} onClose={() => setModalOpen(false)} />
      )}
    </aside>
  );
}

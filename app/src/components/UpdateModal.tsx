import { api } from '../api';
import type { UpdateInfo } from '../types';
import { Icon } from './Pills';

interface Props {
  info: UpdateInfo;
  onClose: () => void;
}

/**
 * Modal showing the current vs latest version + changelog when an update
 * is available. The Download button opens the release URL in the user's
 * default browser; they download the .msi and run it themselves. No auto-
 * install (yet — we'll graduate to Tauri's built-in updater when ready).
 */
export function UpdateModal({ info, onClose }: Props) {
  const handleDownload = () => {
    if (info.download_url) {
      api.openUrl(info.download_url);
    }
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border-strong)',
          borderRadius: 10,
          padding: 24,
          width: 520,
          maxWidth: 'calc(100vw - 40px)',
          maxHeight: 'calc(100vh - 80px)',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
            Update available
          </div>
          <div className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {info.current_version} → <span style={{ color: 'var(--accent-text)' }}>{info.latest_version}</span>
            {info.released && (
              <span style={{ color: 'var(--text-dim)', marginLeft: 12 }}>
                released {info.released}
              </span>
            )}
          </div>
        </div>

        {info.notes && (
          <div
            style={{
              background: 'var(--bg-base)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '12px 14px',
              fontSize: 12.5,
              lineHeight: 1.55,
              color: 'var(--text-secondary)',
              whiteSpace: 'pre-wrap',
              overflowY: 'auto',
              minHeight: 80,
              maxHeight: 320,
            }}
          >
            {info.notes}
          </div>
        )}

        <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
          Clicking Download opens the release page in your browser. Save the
          installer, run it, and accept the Windows SmartScreen warning if
          shown — Heron isn't code-signed yet. Your config and history are
          preserved across updates.
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>
            Later
          </button>
          <button
            className="btn btn-primary"
            onClick={handleDownload}
            disabled={!info.download_url}
          >
            <Icon name="download" size={12} /> Download
          </button>
        </div>
      </div>
    </div>
  );
}

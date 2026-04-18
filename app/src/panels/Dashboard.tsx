import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { api } from '../api';
import type { DealRow, OverviewStats, Panel, SourceStat, Status } from '../types';
import { SCRAPER_META } from '../types';
import { Tier, SitePill, formatPrice, formatTime, formatFullTime } from '../components/Pills';

interface Props {
  status: Status;
  onRunNow: (dry?: boolean) => void;
  onNavigate: (p: Panel) => void;
}

export function Dashboard({ status, onRunNow, onNavigate }: Props) {
  const [recentDeals, setRecentDeals] = useState<DealRow[]>([]);
  const [sourceStats, setSourceStats] = useState<SourceStat[]>([]);
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missingKeys, setMissingKeys] = useState<string[]>([]);

  const refresh = async () => {
    try {
      const [deals, stats, ov, secrets] = await Promise.all([
        api.getRecentDeals(10),
        api.getSourceStats(),
        api.getOverview(),
        api.readSecrets(false),
      ]);
      setRecentDeals(deals);
      setSourceStats(stats);
      setOverview(ov);
      // Flag missing required keys for a friendly welcome
      const required = ['OPENROUTER_API_KEY', 'DISCORD_BOT_TOKEN', 'DISCORD_USER_ID'];
      const missing = required.filter((k) => {
        const entry = secrets.find((s) => s.key === k);
        return !entry || !entry.is_set;
      });
      setMissingKeys(missing);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    refresh();
    const unlisten = listen('sidecar-finished', () => refresh());
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const summary = status.last_summary;
  const hasDb = overview && overview.total_items > 0;

  return (
    <div>
      <div className="panel-header">
        <div>
          <h2>Dashboard</h2>
          <div className="subtitle">
            {hasDb
              ? `${overview.total_items.toLocaleString()} listings tracked — ${overview.total_deals} deals flagged`
              : 'Ready to hunt.'}
          </div>
        </div>
        <div className="panel-header-actions">
          <button className="btn sm" onClick={() => onRunNow(true)} disabled={status.running}>
            Dry run
          </button>
          <button
            className="btn primary"
            onClick={() => onRunNow(false)}
            disabled={status.running}
          >
            {status.running ? 'Running…' : 'Run Now'}
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {missingKeys.length > 0 && (
        <div
          className="card"
          style={{
            borderColor: 'var(--accent)',
            background: '#1a0f05',
          }}
        >
          <h3 style={{ color: 'var(--accent-hover)' }}>Welcome!</h3>
          <p style={{ fontSize: 13, marginBottom: 10 }}>
            To start finding deals, you need to set up{' '}
            {missingKeys.map((k, i) => (
              <span key={k}>
                <span className="mono" style={{ color: 'var(--accent-hover)' }}>{k}</span>
                {i < missingKeys.length - 1 ? ', ' : ''}
              </span>
            ))}
            .
          </p>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn sm primary" onClick={() => onNavigate('settings')}>
              Open Settings →
            </button>
            <button className="btn sm" onClick={() => onNavigate('items')}>
              Configure Items
            </button>
          </div>
        </div>
      )}

      {/* Status strip */}
      <div className="card">
        <h3>Run status</h3>
        <div className="row spread">
          <div className="row" style={{ gap: 12 }}>
            <span className={`pill ${status.running ? 'running' : 'idle'}`}>
              {status.running ? 'Scanning' : 'Idle'}
            </span>
            {summary && <span className={`pill ${summary.status}`}>{summary.status}</span>}
            {summary && (
              <span className="mono faint" style={{ fontSize: 11 }}>
                last: {formatFullTime(Date.parse(summary.timestamp))} ·{' '}
                {(summary.duration_ms / 1000).toFixed(1)}s
              </span>
            )}
          </div>
        </div>

        {summary && (
          <div className="card-grid" style={{ marginTop: 14 }}>
            <Stat label="Searches" value={summary.searches_run} />
            <Stat label="Scraped" value={summary.listings_scraped} />
            <Stat label="New" value={summary.new_listings} />
            <Stat label="Deals" value={summary.deals_found} highlight={summary.deals_found > 0} />
            <Stat label="Notified" value={summary.notifications_sent} />
            <Stat
              label="Errors"
              value={summary.errors.length}
              highlight={summary.errors.length > 0}
            />
          </div>
        )}

        {summary && summary.errors.length > 0 && (
          <div className="error-banner" style={{ marginTop: 12, marginBottom: 0 }}>
            <strong>Errors:</strong>
            <ul style={{ listStyle: 'none', marginTop: 6 }}>
              {summary.errors.map((e, i) => (
                <li key={i} className="mono" style={{ fontSize: 11 }}>
                  • {e}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Recent deals */}
      <div className="card">
        <h3>Recent deals</h3>
        {recentDeals.length === 0 ? (
          <div className="empty-state">
            No deals flagged yet. Click "Run Now" to start a scan.
          </div>
        ) : (
          <div className="stack" style={{ gap: 6 }}>
            {recentDeals.map((d) => (
              <DealLine
                key={d.id}
                deal={d}
                expanded={expanded === d.id}
                onToggle={() => setExpanded(expanded === d.id ? null : d.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Source health */}
      <div className="card">
        <h3>Source health</h3>
        <div className="card-grid">
          {Object.keys(SCRAPER_META).map((site) => {
            const stat = sourceStats.find((s) => s.site === site);
            const label = SCRAPER_META[site].label;
            let health: 'healthy' | 'warning' | 'error' = 'warning';
            if (stat && stat.last_seen_at) {
              const ageMs = Date.now() - stat.last_seen_at;
              health = ageMs < 3 * 86400000 ? 'healthy' : 'warning';
            } else if (!stat) {
              health = 'error';
            }
            return (
              <div key={site} className="stat" style={{ textAlign: 'left' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 4,
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 600 }}>{label}</span>
                  <span className={`pill ${health}`} style={{ fontSize: 9 }}>
                    {health}
                  </span>
                </div>
                <div className="faint" style={{ fontSize: 10, fontFamily: 'var(--mono)' }}>
                  {stat ? `${stat.total_items} items` : 'no data'}
                </div>
                <div className="faint" style={{ fontSize: 10, fontFamily: 'var(--mono)' }}>
                  {stat?.last_seen_at ? formatTime(stat.last_seen_at) : '—'}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div className={`stat ${highlight ? 'highlight' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

function DealLine({
  deal,
  expanded,
  onToggle,
}: {
  deal: DealRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const grail = deal.deal_tier === null && deal.llm_reasoning?.includes('grail');
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 4,
        padding: '8px 10px',
        background: 'var(--bg-card)',
      }}
    >
      <div
        className="row spread"
        style={{ cursor: 'pointer', gap: 10 }}
        onClick={onToggle}
      >
        <div className="row" style={{ gap: 10, minWidth: 0, flex: 1 }}>
          <Tier tier={deal.deal_tier} grail={grail} />
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
              flex: 1,
            }}
            title={deal.title ?? ''}
          >
            {deal.title ?? '(untitled)'}
          </span>
        </div>
        <div className="row" style={{ gap: 10, flexShrink: 0 }}>
          <span className="mono" style={{ fontSize: 11 }}>
            {formatPrice(deal.price, deal.currency)}
          </span>
          <SitePill site={deal.site} />
          <span className="faint" style={{ fontSize: 10, fontFamily: 'var(--mono)' }}>
            {formatTime(deal.last_seen_at)}
          </span>
        </div>
      </div>
      {expanded && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
          {deal.llm_reasoning && (
            <div style={{ marginBottom: 8 }}>
              <div className="stat-label" style={{ marginBottom: 4 }}>Analysis</div>
              <div className="muted" style={{ fontSize: 12 }}>{deal.llm_reasoning}</div>
            </div>
          )}
          {deal.pass1_reasoning && deal.pass1_reasoning !== deal.llm_reasoning && (
            <div style={{ marginBottom: 8 }}>
              <div className="stat-label" style={{ marginBottom: 4 }}>Pass-1 (archived)</div>
              <div className="muted" style={{ fontSize: 11 }}>
                <Tier tier={deal.pass1_tier} /> {deal.pass1_reasoning}
              </div>
            </div>
          )}
          <div className="row" style={{ gap: 12, fontSize: 11 }}>
            <button
              className="link-button"
              onClick={(e) => {
                e.stopPropagation();
                api.openUrl(deal.url);
              }}
            >
              Open listing
            </button>
            {deal.location && <span className="faint">📍 {deal.location}</span>}
            {deal.notified === 1 && <span className="pill success">notified</span>}
            {deal.detail_fetched === 1 && <span className="pill">pass-2</span>}
          </div>
        </div>
      )}
    </div>
  );
}

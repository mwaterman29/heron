import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { api } from '../api';
import type { DealRow, OverviewStats, Panel, ScheduleConfig, Status } from '../types';
import { SCRAPER_META } from '../types';
import {
  Icon,
  ItemThumb,
  SourceIcon,
  TierChip,
  formatTime,
  pctBelow,
  priceFmt,
} from '../components/Pills';

interface Props {
  status: Status;
  onRunNow: (dry?: boolean) => void;
  onNavigate: (p: Panel) => void;
  keysReady: boolean;
  missingKeys: string[];
}

export function Dashboard({ status, onRunNow, onNavigate, keysReady, missingKeys }: Props) {
  const [recentDeals, setRecentDeals] = useState<DealRow[]>([]);
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [schedule, setSchedule] = useState<ScheduleConfig | null>(null);
  const [nextRun, setNextRun] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const [deals, ov, sch, next] = await Promise.all([
        api.getRecentDeals(10),
        api.getOverview(),
        api.getSchedule(),
        api.getNextRuns(1),
      ]);
      setRecentDeals(deals.filter((d) => (d.listing_state ?? 'new') === 'new'));
      setOverview(ov);
      setSchedule(sch);
      setNextRun(next[0] ?? null);
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

  // If no API keys, show the dedicated empty state
  if (!keysReady && !status.last_summary) {
    return (
      <DashboardEmpty missingKeys={missingKeys} onNavigate={onNavigate} />
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-subtitle">
            {overview?.last_run_at
              ? `last run ${formatTime(overview.last_run_at)}`
              : 'no runs yet'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => onNavigate('queue')}>
            <Icon name="bell" size={12} /> Open queue
          </button>
          <button className="btn" onClick={() => onRunNow(true)} disabled={status.running || !keysReady}>
            Dry run
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <StatusStrip
        status={status}
        overview={overview}
        schedule={schedule}
        nextRun={nextRun}
        keysReady={keysReady}
        onRunNow={() => onRunNow(false)}
      />

      {/* Recent notable */}
      <div>
        <div className="section-title">
          Recent notable
          <span style={{ color: 'var(--text-dim)', fontWeight: 400, fontSize: 12 }}>
            · last 24h
          </span>
        </div>
        {recentDeals.length === 0 ? (
          <div className="panel empty-state">
            <div className="empty-title">
              {overview?.total_deals
                ? 'No new deals to triage.'
                : 'Ready to hunt.'}
            </div>
            <div className="empty-sub">
              {overview?.total_deals
                ? 'All current deals are being followed or already closed out. Head to the Queue for full history.'
                : "Click \"Run now\" when you're ready to start scanning."}
            </div>
          </div>
        ) : (
          <div className="panel" style={{ overflow: 'hidden' }}>
            {recentDeals.map((d) => (
              <DealRowCompact
                key={d.id}
                deal={d}
                expanded={expandedId === d.id}
                onToggle={() =>
                  setExpandedId(expandedId === d.id ? null : d.id)
                }
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// --- StatusStrip ---

function StatusStrip({
  status,
  overview,
  schedule,
  nextRun,
  keysReady,
  onRunNow,
}: {
  status: Status;
  overview: OverviewStats | null;
  schedule: ScheduleConfig | null;
  nextRun: number | null;
  keysReady: boolean;
  onRunNow: () => void;
}) {
  const running = status.running;
  const summary = status.last_summary;
  const nextIn = schedule?.enabled && nextRun ? formatTime(nextRun).replace(' ago', '') : null;

  const activity = status.current_activity;

  return (
    <div
      className="panel"
      style={{
        padding: '22px 26px',
        display: 'grid',
        gridTemplateColumns: 'auto 1fr 1fr 1fr auto',
        alignItems: 'center',
        gap: 28,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 11,
          minWidth: 0,
        }}
      >
        <span
          className={`pip ${running ? 'warn' : 'ok'}`}
          style={{ width: 9, height: 9, flexShrink: 0 }}
        />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>
            Status
          </div>
          <div
            style={{
              fontWeight: 500,
              fontSize: 14,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 320,
            }}
            title={running && activity ? activity : undefined}
          >
            {running ? activity ?? 'Scanning…' : 'All good'}
          </div>
        </div>
      </div>

      <StatLine
        label="Next run"
        value={
          running
            ? '—'
            : nextIn
            ? <span className="mono">in {nextIn}</span>
            : <span className="mono muted">not scheduled</span>
        }
      />

      <StatLine
        label="Last run"
        value={
          summary ? (
            <span>
              {formatTime(Date.parse(summary.timestamp))}
              <span
                style={{
                  color: 'var(--text-dim)',
                  fontWeight: 400,
                  fontSize: 12,
                  marginLeft: 8,
                }}
              >
                · {summary.deals_found} deal{summary.deals_found === 1 ? '' : 's'}
              </span>
            </span>
          ) : (
            <span className="muted">—</span>
          )
        }
      />

      <StatLine
        label="Lifetime"
        value={
          overview ? (
            <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
              <span className="mono">
                <span style={{ color: 'var(--ok)', fontWeight: 600 }}>
                  {overview.total_deals}
                </span>{' '}
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>deals</span>
              </span>
              <span className="mono">
                <span style={{ fontWeight: 600 }}>{overview.total_items}</span>{' '}
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>seen</span>
              </span>
            </span>
          ) : (
            <span className="muted">—</span>
          )
        }
      />

      <button
        className="btn btn-primary"
        onClick={onRunNow}
        disabled={running || !keysReady}
        title={!keysReady ? 'Add API keys in Settings first' : undefined}
      >
        <Icon
          name={running ? 'refresh' : 'play'}
          size={12}
          className={running ? 'pulse' : ''}
        />
        {running ? 'Running…' : 'Run now'}
      </button>
    </div>
  );
}

function StatLine({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
      <span
        style={{
          fontSize: 14,
          fontWeight: 500,
          color: 'var(--text-primary)',
        }}
      >
        {value}
      </span>
    </div>
  );
}

// --- Empty / welcome state ---

function DashboardEmpty({
  missingKeys,
  onNavigate,
}: {
  missingKeys: string[];
  onNavigate: (p: Panel) => void;
}) {
  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-subtitle">Welcome — let's get you set up</div>
        </div>
      </div>
      <div className="panel" style={{ padding: '48px 40px', textAlign: 'center' }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 12,
            margin: '0 auto 20px',
            background: 'var(--bg-raised)',
            border: '1px solid var(--border)',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <Icon name="settings" size={24} />
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>
          Let's get you set up
        </div>
        <div
          style={{
            color: 'var(--text-muted)',
            fontSize: 13,
            maxWidth: 440,
            margin: '0 auto 20px',
            lineHeight: 1.55,
          }}
        >
          Add your OpenRouter key and Discord details to start scanning marketplaces.
        </div>
        <div style={{ display: 'inline-flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={() => onNavigate('settings')}>
            Go to Settings
          </button>
          <button className="btn" onClick={() => onNavigate('targets')}>
            Configure Targets
          </button>
        </div>
        <div
          style={{
            marginTop: 28,
            paddingTop: 20,
            borderTop: '1px solid var(--border)',
            display: 'flex',
            gap: 20,
            justifyContent: 'center',
            fontSize: 11,
            color: 'var(--text-dim)',
            fontFamily: 'var(--font-mono)',
            flexWrap: 'wrap',
          }}
        >
          {missingKeys.map((k) => (
            <span key={k}>◦ {k}</span>
          ))}
        </div>
      </div>
    </>
  );
}

// --- Compact deal row for Dashboard "Recent notable" ---

function DealRowCompact({
  deal,
  expanded,
  onToggle,
}: {
  deal: DealRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const siteMeta = SCRAPER_META[deal.site];
  const pct = pctBelow(deal.price_usd ?? deal.price, null); // no ref available yet
  return (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      <div
        onClick={onToggle}
        style={{
          display: 'grid',
          gridTemplateColumns: '46px 80px 1fr 110px 110px 80px 30px',
          alignItems: 'center',
          gap: 14,
          padding: '14px 18px',
          cursor: 'pointer',
        }}
      >
        <ItemThumb w={46} h={46} label="PHOTO" src={deal.thumbnail_url} />
        <TierChip tier={deal.deal_tier} />
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              color: 'var(--text-primary)',
              fontWeight: 500,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {deal.title ?? '(untitled)'}
          </div>
        </div>
        <div className="mono" style={{ textAlign: 'right' }}>
          <span style={{ fontWeight: 600 }}>{priceFmt(deal.price)}</span>
          {pct > 0 && (
            <span style={{ color: 'var(--ok)', marginLeft: 8, fontSize: 11 }}>
              −{pct}%
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SourceIcon id={deal.site} size={20} />
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {siteMeta?.short ?? deal.site}
          </span>
        </div>
        <span
          style={{
            fontSize: 11.5,
            color: 'var(--text-muted)',
            textAlign: 'right',
          }}
        >
          {formatTime(deal.last_seen_at)}
        </span>
        <Icon
          name="chevron"
          size={13}
          style={{
            transform: expanded ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.15s',
            color: 'var(--text-muted)',
          }}
        />
      </div>
      {expanded && (
        <div style={{ padding: '0 18px 14px 18px' }}>
          <div
            style={{
              background: 'var(--bg-base)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '12px 14px',
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            <div
              className="mono"
              style={{
                fontSize: 10,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                marginBottom: 6,
              }}
            >
              LLM Reasoning
            </div>
            <div style={{ color: 'var(--text-secondary)' }}>
              {deal.llm_reasoning || '(no reasoning captured)'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              className="btn btn-sm"
              onClick={(e) => {
                e.stopPropagation();
                api.openUrl(deal.url);
              }}
            >
              <Icon name="link" size={12} /> Open listing
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

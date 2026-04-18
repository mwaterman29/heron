import { useEffect, useState } from 'react';
import { api } from '../api';
import type { SourceStat } from '../types';
import { SCRAPER_META } from '../types';
import { formatTime, SourceIcon } from '../components/Pills';

export function Sources() {
  const [stats, setStats] = useState<SourceStat[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSourceStats()
      .then(setStats)
      .catch((e) => setError(String(e)));
  }, []);

  const entries = Object.entries(SCRAPER_META);

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Sources</div>
          <div className="page-subtitle">
            {entries.length} scrapers · defined in code, not editable
          </div>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        {entries.map(([site, meta], i) => {
          const stat = stats.find((s) => s.site === site);
          const lastSeen = stat?.last_seen_at ?? null;
          const ageMs = lastSeen ? Date.now() - lastSeen : Infinity;
          let status: 'ok' | 'warn' | 'err' = 'warn';
          let label = 'untested';
          if (lastSeen && ageMs < 3 * 86_400_000) {
            status = 'ok';
            label = 'Healthy';
          } else if (lastSeen && ageMs < 14 * 86_400_000) {
            status = 'warn';
            label = 'Stale';
          } else if (!lastSeen) {
            status = 'warn';
            label = 'Untested';
          } else {
            status = 'err';
            label = 'Inactive';
          }
          return (
            <div
              key={site}
              style={{
                display: 'grid',
                gridTemplateColumns: '40px 1fr 160px 140px 110px',
                gap: 16,
                alignItems: 'center',
                padding: '16px 20px',
                borderBottom: i < entries.length - 1 ? '1px solid var(--border)' : 'none',
              }}
            >
              <SourceIcon id={site} size={36} />
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 500, marginBottom: 3 }}>
                  {meta.label}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                  {meta.description}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span
                  className="mono"
                  style={{
                    fontSize: 10,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                  }}
                >
                  Last scrape
                </span>
                <span className="mono" style={{ fontSize: 12 }}>
                  {formatTime(lastSeen)}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span
                  className="mono"
                  style={{
                    fontSize: 10,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                  }}
                >
                  Items found
                </span>
                <span className="mono" style={{ fontSize: 12 }}>
                  {stat?.total_items ?? 0}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span className={`pip ${status}`} />
                <span
                  style={{
                    fontSize: 11.5,
                    color:
                      status === 'ok'
                        ? 'var(--ok)'
                        : status === 'warn'
                        ? 'var(--warn)'
                        : 'var(--err)',
                    fontWeight: 500,
                  }}
                >
                  {label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

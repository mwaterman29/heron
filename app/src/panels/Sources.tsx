import { useEffect, useState } from 'react';
import { api } from '../api';
import type { SourceStat } from '../types';
import { SCRAPER_META } from '../types';
import { formatTime } from '../components/Pills';

export function Sources() {
  const [stats, setStats] = useState<SourceStat[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getSourceStats().then(setStats).catch((e) => setError(String(e)));
  }, []);

  return (
    <div>
      <div className="panel-header">
        <div>
          <h2>Sources</h2>
          <div className="subtitle">The 8 marketplace scrapers. Read-only — defined in code.</div>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="stack" style={{ gap: 10 }}>
        {Object.entries(SCRAPER_META).map(([site, meta]) => {
          const stat = stats.find((s) => s.site === site);
          let health: 'healthy' | 'warning' | 'error' = 'warning';
          let healthLabel = 'no data';
          if (stat && stat.last_seen_at) {
            const ageMs = Date.now() - stat.last_seen_at;
            if (ageMs < 3 * 86400000) {
              health = 'healthy';
              healthLabel = 'healthy';
            } else {
              health = 'warning';
              healthLabel = 'stale';
            }
          }
          return (
            <div key={site} className="card" style={{ marginBottom: 0 }}>
              <div className="row spread" style={{ marginBottom: 8 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{meta.label}</div>
                  <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>
                    {meta.description}
                  </div>
                </div>
                <span className={`pill ${health}`}>{healthLabel}</span>
              </div>
              <div className="card-grid">
                <div className="stat">
                  <div className="stat-label">Total items</div>
                  <div className="stat-value">{stat?.total_items ?? 0}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Evaluated</div>
                  <div className="stat-value">{stat?.evaluated_items ?? 0}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Deals</div>
                  <div className="stat-value">{stat?.deals_flagged ?? 0}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Last seen</div>
                  <div className="stat-value" style={{ fontSize: 12 }}>
                    {stat?.last_seen_at ? formatTime(stat.last_seen_at) : '—'}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

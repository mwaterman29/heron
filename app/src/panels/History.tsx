import { Fragment, useEffect, useState } from 'react';
import { api } from '../api';
import type { DealRow, HistoryFilter } from '../types';
import { SCRAPER_META } from '../types';
import { Tier, SitePill, formatPrice, formatTime } from '../components/Pills';

const TIER_FILTERS = ['', 'steal', 'deal', 'fair', 'overpriced', 'irrelevant'];

export function History() {
  const [rows, setRows] = useState<DealRow[]>([]);
  const [filter, setFilter] = useState<HistoryFilter>({ only_deals: false, limit: 200 });
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRows = async (f: HistoryFilter) => {
    setLoading(true);
    try {
      const r = await api.getHistory(f);
      setRows(r);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRows(filter);
  }, []);

  const applyFilter = () => {
    const f: HistoryFilter = {
      ...filter,
      search: search.trim() || undefined,
    };
    loadRows(f);
  };

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div>
      <div className="panel-header">
        <div>
          <h2>History</h2>
          <div className="subtitle">Every evaluated listing across all runs.</div>
        </div>
        <div className="panel-header-actions">
          <button className="btn sm" onClick={applyFilter} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Filters */}
      <div className="card">
        <h3>Filters</h3>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <label className="field" style={{ marginBottom: 0, flex: '1 1 180px' }}>
            <span className="field-label">Search</span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyFilter()}
              placeholder="title / URL contains…"
            />
          </label>
          <label className="field" style={{ marginBottom: 0, flex: '1 1 120px' }}>
            <span className="field-label">Tier</span>
            <select
              value={filter.tier ?? ''}
              onChange={(e) =>
                setFilter({ ...filter, tier: e.target.value || undefined })
              }
            >
              {TIER_FILTERS.map((t) => (
                <option key={t} value={t}>
                  {t || 'All'}
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={{ marginBottom: 0, flex: '1 1 120px' }}>
            <span className="field-label">Source</span>
            <select
              value={filter.site ?? ''}
              onChange={(e) =>
                setFilter({ ...filter, site: e.target.value || undefined })
              }
            >
              <option value="">All</option>
              {Object.entries(SCRAPER_META).map(([site, m]) => (
                <option key={site} value={site}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={{ marginBottom: 0, alignSelf: 'flex-end' }}>
            <div className="row">
              <input
                type="checkbox"
                checked={filter.only_deals ?? false}
                onChange={(e) =>
                  setFilter({ ...filter, only_deals: e.target.checked })
                }
              />
              <span className="faint" style={{ fontSize: 12 }}>Deals only</span>
            </div>
          </label>
          <div style={{ alignSelf: 'flex-end' }}>
            <button className="btn sm primary" onClick={applyFilter} disabled={loading}>
              Apply
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th></th>
              <th>When</th>
              <th>Source</th>
              <th>Title</th>
              <th>Price</th>
              <th>Tier</th>
              <th>Pass-1</th>
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8}>
                  <div className="empty-state">
                    {loading ? 'Loading…' : 'No matching rows.'}
                  </div>
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <Fragment key={r.id}>
                <tr
                  style={{ cursor: 'pointer' }}
                  onClick={() => toggleExpanded(r.id)}
                >
                  <td style={{ width: 20, color: 'var(--text-faint)' }}>
                    {expanded.has(r.id) ? '▾' : '▸'}
                  </td>
                  <td className="mono" style={{ fontSize: 11 }}>{formatTime(r.last_seen_at)}</td>
                  <td><SitePill site={r.site} /></td>
                  <td className="title-cell" title={r.title ?? ''}>
                    {r.title ?? '(untitled)'}
                  </td>
                  <td className="mono">{formatPrice(r.price, r.currency)}</td>
                  <td><Tier tier={r.deal_tier} /></td>
                  <td>
                    {r.pass1_tier && r.pass1_tier !== r.deal_tier ? (
                      <Tier tier={r.pass1_tier} />
                    ) : (
                      <span className="faint">—</span>
                    )}
                  </td>
                  <td style={{ fontSize: 10 }}>
                    {r.detail_fetched === 1 && <span className="pill" style={{ marginRight: 4 }}>p2</span>}
                    {r.notified === 1 && <span className="pill success">sent</span>}
                  </td>
                </tr>
                {expanded.has(r.id) && (
                  <tr>
                    <td colSpan={8} style={{ background: 'var(--bg-card)', padding: '12px 16px' }}>
                      {r.llm_reasoning && (
                        <div style={{ marginBottom: 8 }}>
                          <div className="stat-label" style={{ marginBottom: 4 }}>
                            Final verdict ({r.deal_tier})
                          </div>
                          <div className="muted" style={{ fontSize: 12 }}>{r.llm_reasoning}</div>
                        </div>
                      )}
                      {r.pass1_reasoning && r.pass1_reasoning !== r.llm_reasoning && (
                        <div style={{ marginBottom: 8 }}>
                          <div className="stat-label" style={{ marginBottom: 4 }}>
                            Pass-1 (archived)
                          </div>
                          <div className="muted" style={{ fontSize: 11 }}>{r.pass1_reasoning}</div>
                        </div>
                      )}
                      <div className="row" style={{ gap: 12, fontSize: 11 }}>
                        <button
                          className="link-button"
                          onClick={(e) => {
                            e.stopPropagation();
                            api.openUrl(r.url);
                          }}
                        >
                          Open listing ↗
                        </button>
                        {r.location && <span className="faint">📍 {r.location}</span>}
                        <span className="faint">seen {r.times_seen}×</span>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="faint" style={{ fontSize: 11, marginTop: 10, textAlign: 'center' }}>
        Showing up to {filter.limit ?? 200} rows · {rows.length} loaded
      </div>
    </div>
  );
}

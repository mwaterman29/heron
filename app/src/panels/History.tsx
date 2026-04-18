import { Fragment, useEffect, useState } from 'react';
import { api } from '../api';
import type { DealRow, HistoryFilter } from '../types';
import { SCRAPER_META, TIER_META } from '../types';
import { Icon, SourceIcon, TierChip, formatTime, priceFmt } from '../components/Pills';

const TIER_FILTERS: (string | null)[] = [null, 'steal', 'deal', 'fair', 'overpriced'];

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

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">History</div>
          <div className="page-subtitle">
            {rows.length} loaded {loading ? '· loading…' : ''}
          </div>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '0 1 280px' }}>
          <Icon
            name="search"
            size={13}
            style={{
              position: 'absolute',
              left: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-dim)',
              pointerEvents: 'none',
            }}
          />
          <input
            className="input"
            placeholder="Search title…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyFilter()}
            style={{ paddingLeft: 28 }}
          />
        </div>
        <div className="segmented">
          {TIER_FILTERS.map((t) => (
            <button
              key={t ?? 'all'}
              className={(filter.tier ?? null) === t ? 'on' : ''}
              onClick={() => setFilter({ ...filter, tier: t ?? undefined })}
              style={{ display: 'flex', alignItems: 'center', gap: 5 }}
            >
              {t ? (
                <>
                  <span className={`pip ${t}`} style={{ width: 5, height: 5 }} />
                  {TIER_META[t]?.label ?? t}
                </>
              ) : (
                'All'
              )}
            </button>
          ))}
        </div>
        <select
          className="select"
          value={filter.site ?? ''}
          onChange={(e) => setFilter({ ...filter, site: e.target.value || undefined })}
          style={{ width: 180 }}
        >
          <option value="">All sources</option>
          {Object.entries(SCRAPER_META).map(([site, m]) => (
            <option key={site} value={site}>
              {m.label}
            </option>
          ))}
        </select>
        <button className="btn btn-sm" onClick={applyFilter}>
          Apply
        </button>
        <span
          className="mono"
          style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}
        >
          {rows.length} rows
        </span>
      </div>

      <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ maxHeight: 'calc(100vh - 260px)', overflow: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 90 }}>When</th>
                <th style={{ width: 46 }}>Src</th>
                <th>Title</th>
                <th style={{ width: 100, textAlign: 'right' }}>Price</th>
                <th style={{ width: 90 }}>Final</th>
                <th style={{ width: 90 }}>Pass 1</th>
                <th style={{ width: 60, textAlign: 'center' }}>Detail</th>
                <th style={{ width: 60, textAlign: 'center' }}>DM'd</th>
                <th style={{ width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9}>
                    <div className="empty-state">
                      <div className="empty-title">
                        {loading ? 'Loading…' : 'No matching rows.'}
                      </div>
                    </div>
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <tr className="clickable" onClick={() => toggle(r.id)}>
                    <td>
                      <span
                        className="mono"
                        style={{ fontSize: 11.5, color: 'var(--text-muted)' }}
                      >
                        {formatTime(r.last_seen_at)}
                      </span>
                    </td>
                    <td>
                      <SourceIcon id={r.site} size={20} />
                    </td>
                    <td style={{ fontSize: 12.5 }}>{r.title ?? '(untitled)'}</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 500 }}>
                      {priceFmt(r.price)}
                    </td>
                    <td>
                      <TierChip tier={r.deal_tier} />
                    </td>
                    <td>
                      {r.pass1_tier && r.pass1_tier !== r.deal_tier ? (
                        <TierChip tier={r.pass1_tier} />
                      ) : (
                        <span className="faint" style={{ fontSize: 11 }}>—</span>
                      )}
                    </td>
                    <td
                      style={{
                        textAlign: 'center',
                        color: r.detail_fetched ? 'var(--ok)' : 'var(--text-dim)',
                      }}
                    >
                      <Icon name={r.detail_fetched ? 'check' : 'close'} size={13} />
                    </td>
                    <td
                      style={{
                        textAlign: 'center',
                        color: r.notified ? 'var(--ok)' : 'var(--text-dim)',
                      }}
                    >
                      <Icon name={r.notified ? 'check' : 'close'} size={13} />
                    </td>
                    <td>
                      <Icon
                        name="chevron"
                        size={12}
                        style={{
                          transform: expanded.has(r.id) ? 'rotate(90deg)' : 'none',
                          transition: 'transform 0.15s',
                          color: 'var(--text-muted)',
                        }}
                      />
                    </td>
                  </tr>
                  {expanded.has(r.id) && (
                    <tr>
                      <td colSpan={9} style={{ background: 'rgba(0,0,0,0.2)', padding: '14px 18px' }}>
                        {r.llm_reasoning && (
                          <div style={{ marginBottom: 10 }}>
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
                              Final ({r.deal_tier ?? '—'})
                            </div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                              {r.llm_reasoning}
                            </div>
                          </div>
                        )}
                        {r.pass1_reasoning && r.pass1_reasoning !== r.llm_reasoning && (
                          <div style={{ marginBottom: 10 }}>
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
                              Pass 1 (archived)
                            </div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                              {r.pass1_reasoning}
                            </div>
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 12, fontSize: 11 }}>
                          <button
                            className="btn btn-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              api.openUrl(r.url);
                            }}
                          >
                            <Icon name="link" size={11} /> Open listing
                          </button>
                          {r.location && (
                            <span className="faint" style={{ alignSelf: 'center' }}>
                              📍 {r.location}
                            </span>
                          )}
                          <span className="faint" style={{ alignSelf: 'center' }}>
                            seen {r.times_seen}×
                          </span>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

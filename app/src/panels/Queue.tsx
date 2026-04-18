import { useEffect, useMemo, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { api } from '../api';
import type { DealRow, ListingState } from '../types';
import { LISTING_STATE_META, SCRAPER_META } from '../types';
import {
  Icon,
  ItemThumb,
  SourceIcon,
  TierChip,
  formatTime,
  pctBelow,
  priceFmt,
} from '../components/Pills';

type Filter = 'active' | 'new' | 'followed' | 'purchased' | 'lost' | 'rejected' | 'all';

export function Queue() {
  const [items, setItems] = useState<DealRow[]>([]);
  const [filter, setFilter] = useState<Filter>('active');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await api.getQueue();
      setItems(rows);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const unlisten = listen('sidecar-finished', () => load());
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const counts = useMemo(() => {
    const stateOf = (r: DealRow): ListingState =>
      (r.listing_state as ListingState) || 'new';
    const c = {
      all: items.length,
      new: items.filter((i) => stateOf(i) === 'new').length,
      followed: items.filter((i) => stateOf(i) === 'followed').length,
      rejected: items.filter((i) => stateOf(i) === 'rejected').length,
      purchased: items.filter((i) => stateOf(i) === 'purchased').length,
      lost: items.filter((i) => stateOf(i) === 'lost').length,
    };
    return { ...c, active: c.new + c.followed };
  }, [items]);

  const filtered = useMemo(() => {
    const stateOf = (r: DealRow): ListingState =>
      (r.listing_state as ListingState) || 'new';
    return items.filter((i) => {
      const s = stateOf(i);
      if (filter === 'all') return true;
      if (filter === 'active') return s === 'new' || s === 'followed';
      return s === filter;
    });
  }, [items, filter]);

  const updateLocal = (id: string, state: ListingState) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, listing_state: state } : i)));
  };

  const setState = async (id: string, state: ListingState) => {
    const prevState = items.find((i) => i.id === id)?.listing_state as ListingState | undefined;
    updateLocal(id, state); // optimistic
    try {
      await api.setListingState(id, state);
    } catch (e) {
      // roll back
      if (prevState) updateLocal(id, prevState);
      setError(String(e));
    }
  };

  const onOpen = async (deal: DealRow) => {
    try {
      await api.openUrl(deal.url);
    } catch (e) {
      setError(String(e));
    }
    // Opening it transitions new → followed
    if ((deal.listing_state || 'new') === 'new') {
      await setState(deal.id, 'followed');
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Queue</div>
          <div className="page-subtitle">
            {counts.new} new to triage · {counts.followed} following up
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm" onClick={load} disabled={loading}>
            <Icon name="refresh" size={11} /> Refresh
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Stat strip — clickable filters */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
        {[
          { key: 'new' as const, label: 'New', value: counts.new, color: 'var(--accent-text)' },
          { key: 'followed' as const, label: 'Following up', value: counts.followed, color: 'var(--tier-fair)' },
          { key: 'purchased' as const, label: 'Purchased', value: counts.purchased, color: 'var(--ok)' },
          { key: 'lost' as const, label: 'Lost', value: counts.lost, color: 'var(--err)' },
          { key: 'rejected' as const, label: 'Rejected', value: counts.rejected, color: 'var(--text-muted)' },
        ].map((s) => (
          <button
            key={s.key}
            onClick={() => setFilter(s.key)}
            className="panel"
            style={{
              padding: '14px 16px',
              textAlign: 'left',
              cursor: 'pointer',
              borderColor: filter === s.key ? s.color : 'var(--border)',
            }}
          >
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 4 }}>{s.label}</div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 600, color: s.color }}>
              {s.value}
            </div>
          </button>
        ))}
      </div>

      {/* Segmented filter */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="segmented">
          <button className={filter === 'active' ? 'on' : ''} onClick={() => setFilter('active')}>
            Active ({counts.active})
          </button>
          <button className={filter === 'new' ? 'on' : ''} onClick={() => setFilter('new')}>
            New
          </button>
          <button className={filter === 'followed' ? 'on' : ''} onClick={() => setFilter('followed')}>
            Following
          </button>
          <button
            className={filter === 'purchased' ? 'on' : ''}
            onClick={() => setFilter('purchased')}
          >
            Purchased
          </button>
          <button className={filter === 'lost' ? 'on' : ''} onClick={() => setFilter('lost')}>
            Lost
          </button>
          <button className={filter === 'rejected' ? 'on' : ''} onClick={() => setFilter('rejected')}>
            Rejected
          </button>
          <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
            All
          </button>
        </div>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
          {filtered.length} shown
        </span>
      </div>

      {/* Queue items */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {filtered.length === 0 && (
          <div className="panel empty-state">
            <div className="empty-title">Nothing here.</div>
            <div className="empty-sub">
              {items.length === 0
                ? 'Run a hunt to start finding deals.'
                : 'Try a different filter, or wait for the next run.'}
            </div>
          </div>
        )}
        {filtered.map((deal) => (
          <QueueItem
            key={deal.id}
            deal={deal}
            onOpen={() => onOpen(deal)}
            onSetState={(s) => setState(deal.id, s)}
          />
        ))}
      </div>
    </>
  );
}

interface ItemProps {
  deal: DealRow;
  onOpen: () => void;
  onSetState: (state: ListingState) => void;
}

function QueueItem({ deal, onOpen, onSetState }: ItemProps) {
  const state = (deal.listing_state as ListingState) || 'new';
  const isDone = state === 'rejected' || state === 'purchased' || state === 'lost';
  const siteMeta = SCRAPER_META[deal.site];
  const refPrice = refPriceFor(deal);
  const pct = pctBelow(deal.price_usd ?? deal.price, refPrice);

  return (
    <div
      className="panel"
      style={{
        padding: '18px 20px',
        display: 'grid',
        gridTemplateColumns: '60px 1fr auto',
        gap: 18,
        alignItems: 'flex-start',
        opacity: isDone ? 0.55 : 1,
        transition: 'opacity 0.2s',
      }}
    >
      <ItemThumb w={60} h={60} label="PHOTO" src={deal.thumbnail_url} />

      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 6,
            flexWrap: 'wrap',
          }}
        >
          <TierChip tier={deal.deal_tier} />
          <SourceIcon id={deal.site} size={18} />
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {siteMeta?.label ?? deal.site}
          </span>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            · {formatTime(deal.last_seen_at)}
          </span>
          {state !== 'new' && (
            <span
              style={{
                marginLeft: 'auto',
                fontSize: 11,
                fontWeight: 500,
                color: LISTING_STATE_META[state].color,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <span
                className="pip"
                style={{ background: LISTING_STATE_META[state].color }}
              />
              {LISTING_STATE_META[state].label}
            </span>
          )}
        </div>
        <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 5 }}>
          {deal.title ?? '(untitled)'}
        </div>
        <div
          style={{
            display: 'flex',
            gap: 14,
            alignItems: 'baseline',
            marginBottom: 8,
            flexWrap: 'wrap',
          }}
        >
          <span className="mono" style={{ fontSize: 18, fontWeight: 600 }}>
            {priceFmt(deal.price)}
          </span>
          {refPrice && (
            <span className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
              ref {priceFmt(refPrice)}
            </span>
          )}
          {pct > 0 && (
            <span
              className="mono"
              style={{ fontSize: 12, color: 'var(--ok)', fontWeight: 500 }}
            >
              −{pct}%
            </span>
          )}
          {deal.location && (
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              📍 {deal.location}
            </span>
          )}
        </div>
        {deal.llm_reasoning && (
          <div
            style={{
              fontSize: 12.5,
              color: 'var(--text-secondary)',
              lineHeight: 1.55,
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: 2,
              overflow: 'hidden',
            }}
          >
            {deal.llm_reasoning}
          </div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          minWidth: 150,
        }}
      >
        {state === 'new' && (
          <>
            <button
              className="btn btn-primary"
              onClick={onOpen}
              style={{ justifyContent: 'center' }}
            >
              <Icon name="link" size={12} /> Open in browser
            </button>
            <button
              className="btn"
              onClick={() => onSetState('rejected')}
              style={{ justifyContent: 'center' }}
            >
              <Icon name="close" size={12} /> Reject
            </button>
          </>
        )}
        {state === 'followed' && (
          <>
            <div
              style={{
                fontSize: 10.5,
                color: 'var(--text-muted)',
                textAlign: 'center',
                marginBottom: 2,
              }}
            >
              Mark outcome
            </div>
            <button
              className="btn btn-primary"
              onClick={() => onSetState('purchased')}
              style={{ justifyContent: 'center' }}
            >
              <Icon name="check" size={12} /> Purchased
            </button>
            <button
              className="btn"
              onClick={() => onSetState('lost')}
              style={{ justifyContent: 'center' }}
            >
              Lost / Cancelled
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => onSetState('new')}
              style={{
                justifyContent: 'center',
                marginTop: 2,
                color: 'var(--text-muted)',
              }}
            >
              undo
            </button>
          </>
        )}
        {isDone && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => onSetState('new')}
            style={{ justifyContent: 'center', color: 'var(--text-muted)' }}
          >
            <Icon name="refresh" size={11} /> Reopen
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Extract a reference price from the LLM reasoning when the config's tier
 * values aren't directly attached to the listing row. Falls back to null.
 * Rudimentary — the evaluator sometimes writes "vs fair_used $X" etc.
 */
function refPriceFor(_deal: DealRow): number | null {
  // Without joining to the reference table, we don't have per-listing ref price.
  // Future: extend the backend to return ref pricing with each deal.
  return null;
}

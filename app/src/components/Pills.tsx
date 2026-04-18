import { useEffect, useState } from 'react';
import { SCRAPER_META, TIER_META } from '../types';

export function priceFmt(price: number | null | undefined): string {
  if (price == null) return '—';
  return '$' + price.toLocaleString('en-US');
}

/** Percentage below reference price (e.g. 1500 vs ref 2000 → 25). Returns 0 if no discount. */
export function pctBelow(price: number | null, ref: number | null): number {
  if (!price || !ref || ref <= 0) return 0;
  const pct = Math.round((1 - price / ref) * 100);
  return pct > 0 ? pct : 0;
}

export function TierChip({ tier }: { tier: string | null | undefined }) {
  const t = tier && TIER_META[tier] ? tier : 'skip';
  const meta = TIER_META[t] ?? TIER_META.skip;
  return (
    <span className={`tier-chip ${t}`}>
      <span className={`tier-chip-pip ${t}`} />
      {meta.label}
    </span>
  );
}

export function SourceIcon({ id, size = 22 }: { id: string; size?: number }) {
  const meta = SCRAPER_META[id];
  const abbr = meta?.abbr ?? id.slice(0, 2).toUpperCase();
  return (
    <div
      className={`src-icon ${id}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      title={meta?.label ?? id}
    >
      {abbr}
    </div>
  );
}

export function ItemThumb({
  w = 54,
  h = 54,
  label = 'IMAGE',
  src,
}: {
  w?: number;
  h?: number;
  label?: string;
  src?: string | null;
}) {
  const [failed, setFailed] = useState(false);

  // Reset failure state when the src changes (e.g. list re-render with a new deal)
  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        className="item-thumb"
        style={{ width: w, height: h, objectFit: 'cover' }}
        onError={() => setFailed(true)}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <div className="item-thumb" style={{ width: w, height: h }}>
      {label}
    </div>
  );
}

export function formatTime(millis: number | null | undefined): string {
  if (!millis) return '—';
  const d = new Date(millis);
  const now = Date.now();
  const diff = now - millis;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return d.toLocaleDateString();
}

export function formatFullTime(millis: number | null | undefined): string {
  if (!millis) return '—';
  return new Date(millis).toLocaleString();
}

/**
 * Very small inline SVG icon set — matches the reference design's icon names.
 */
export function Icon({
  name,
  size = 15,
  className = '',
  style,
}: {
  name: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const paths: Record<string, React.ReactNode> = {
    dashboard: (
      <>
        <rect x="3" y="3" width="7" height="9" rx="1" />
        <rect x="14" y="3" width="7" height="5" rx="1" />
        <rect x="14" y="12" width="7" height="9" rx="1" />
        <rect x="3" y="16" width="7" height="5" rx="1" />
      </>
    ),
    items: (
      <>
        <path d="M4 5h10M4 10h10M4 15h6" />
        <circle cx="18" cy="5" r="2" />
        <circle cx="18" cy="10" r="2" />
        <circle cx="15" cy="15" r="2" />
      </>
    ),
    sources: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" />
      </>
    ),
    history: (
      <>
        <path d="M3 12a9 9 0 1 0 3-6.7" />
        <path d="M3 4v5h5" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    logs: (
      <>
        <path d="M4 4h12l4 4v12H4z" />
        <path d="M16 4v4h4" />
        <path d="M7 12h8M7 15h8M7 18h5" />
      </>
    ),
    play: <path d="M6 4l14 8-14 8V4z" />,
    plus: <path d="M12 5v14M5 12h14" />,
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="M15 15l5 5" />
      </>
    ),
    chevron: <path d="M9 6l6 6-6 6" />,
    link: (
      <>
        <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66L12 7" />
        <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66L12 17" />
      </>
    ),
    refresh: (
      <>
        <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
        <path d="M21 3v5h-5" />
        <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
        <path d="M3 21v-5h5" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="12" height="12" rx="1" />
        <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
      </>
    ),
    trash: (
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
    ),
    eye: (
      <>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    eyeOff: (
      <>
        <path d="M3 3l18 18" />
        <path d="M10.6 6.1A10.5 10.5 0 0 1 12 6c6.5 0 10 7 10 7a17 17 0 0 1-3.6 4.3M6.7 6.7C3.9 8.5 2 12 2 12s3.5 7 10 7a10 10 0 0 0 5.3-1.4" />
        <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      </>
    ),
    check: <path d="M4 12l5 5L20 6" />,
    close: <path d="M5 5l14 14M5 19L19 5" />,
    download: <path d="M12 3v12M6 11l6 6 6-6M4 21h16" />,
    bell: (
      <>
        <path d="M6 8a6 6 0 0 1 12 0v5l2 3H4l2-3V8z" />
        <path d="M10 19a2 2 0 0 0 4 0" />
      </>
    ),
  };
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
    >
      {paths[name]}
    </svg>
  );
}

export function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return <button className={`toggle ${on ? 'on' : ''}`} onClick={onClick} aria-pressed={on} />;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button
          key={o.value}
          className={value === o.value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

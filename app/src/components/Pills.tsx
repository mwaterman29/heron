import { SCRAPER_META } from '../types';

export function Tier({ tier, grail }: { tier: string | null | undefined; grail?: boolean }) {
  if (grail) {
    return <span className="tier grail">💎 Grail</span>;
  }
  if (!tier) return <span className="tier overpriced">—</span>;
  const emoji: Record<string, string> = {
    steal: '🚨',
    deal: '🔥',
    fair: '👀',
    overpriced: '',
    irrelevant: '',
  };
  return (
    <span className={`tier ${tier}`}>
      {emoji[tier] ? `${emoji[tier]} ` : ''}
      {tier}
    </span>
  );
}

export function SitePill({ site }: { site: string }) {
  const meta = SCRAPER_META[site];
  return (
    <span className="pill" title={meta?.description ?? site}>
      {meta?.label ?? site}
    </span>
  );
}

export function formatPrice(price: number | null | undefined, currency: string | null | undefined): string {
  if (price == null) return '—';
  const sym = currency ?? '$';
  return `${sym}${price.toLocaleString()}`;
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

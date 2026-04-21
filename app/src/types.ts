// Shared types matching the Rust backend structs.

export interface SidecarSummary {
  status: string;
  timestamp: string;
  searches_run: number;
  listings_scraped: number;
  new_listings: number;
  deals_found: number;
  notifications_sent: number;
  errors: string[];
  duration_ms: number;
}

export interface Status {
  running: boolean;
  last_summary: SidecarSummary | null;
}

export interface DealRow {
  id: string;
  site: string;
  search_id: string;
  title: string | null;
  price: number | null;
  price_usd: number | null;
  currency: string | null;
  url: string;
  location: string | null;
  deal_tier: string | null;
  llm_reasoning: string | null;
  pass1_tier: string | null;
  pass1_reasoning: string | null;
  is_deal: number;
  detail_fetched: number;
  notified: number;
  first_seen_at: number;
  last_seen_at: number;
  times_seen: number;
  listing_state: string | null;
  thumbnail_url: string | null;
}

export interface SourceStat {
  site: string;
  total_items: number;
  evaluated_items: number;
  deals_flagged: number;
  last_seen_at: number | null;
}

export interface OverviewStats {
  total_items: number;
  total_deals: number;
  total_notified: number;
  last_run_at: number | null;
}

export interface HistoryFilter {
  tier?: string;
  site?: string;
  search?: string;
  only_deals?: boolean;
  limit?: number;
  offset?: number;
}

export interface SecretEntry {
  key: string;
  value: string;
  is_secret: boolean;
  is_set: boolean;
}

export interface ScheduleConfig {
  enabled: boolean;
  interval_minutes: number;
  active_hour_start: number | null;
  active_hour_end: number | null;
}

export interface LogFile {
  name: string;
  size_bytes: number;
  modified_at: number | null;
}

export interface UpdateInfo {
  current_version: string;
  latest_version: string | null;
  available: boolean;
  released: string | null;
  notes: string | null;
  download_url: string | null;
  manifest_url_configured: boolean;
  error: string | null;
}

export type Panel = 'dashboard' | 'queue' | 'targets' | 'sources' | 'settings' | 'history' | 'logs';

export type DealTier = 'steal' | 'deal' | 'fair' | 'overpriced' | 'irrelevant';

export type ListingState = 'new' | 'followed' | 'rejected' | 'purchased' | 'lost';

export const SCRAPER_META: Record<
  string,
  { label: string; short: string; abbr: string; description: string }
> = {
  hifishark: {
    label: 'HiFi Shark',
    short: 'HFS',
    abbr: 'HS',
    description: 'Audio aggregator across 50+ marketplace sites',
  },
  usaudiomart: {
    label: 'US Audio Mart',
    short: 'USAM',
    abbr: 'UA',
    description: 'Audio-focused classifieds, enthusiast community',
  },
  craigslist: {
    label: 'Craigslist',
    short: 'CL',
    abbr: 'CL',
    description: 'Local classifieds with vehicle-aware extraction',
  },
  audiogon: {
    label: 'Audiogon',
    short: 'Agon',
    abbr: 'AG',
    description: 'High-end audio marketplace (Cloudflare-gated)',
  },
  ebay: {
    label: 'eBay',
    short: 'eBay',
    abbr: 'eB',
    description: 'US-only listings with item specifics extraction',
  },
  fbmp: {
    label: 'Facebook Marketplace',
    short: 'FBMP',
    abbr: 'FB',
    description: 'Local listings, requires headed browser',
  },
  mechmarket: {
    label: 'r/mechmarket',
    short: 'MM',
    abbr: 'MM',
    description: 'Mechanical keyboard buy/sell/trade',
  },
  avexchange: {
    label: 'r/AVexchange',
    short: 'AVX',
    abbr: 'AV',
    description: 'Audio gear trades and sales',
  },
};

export const TIER_META: Record<string, { label: string; emoji: string }> = {
  steal: { label: 'Steal', emoji: '🚨' },
  deal: { label: 'Deal', emoji: '🔥' },
  fair: { label: 'Fair', emoji: '👀' },
  grail: { label: 'Grail', emoji: '💎' },
  skip: { label: 'Skip', emoji: '—' },
  overpriced: { label: 'Skip', emoji: '—' },
  irrelevant: { label: 'Skip', emoji: '—' },
};

export const LISTING_STATE_META: Record<ListingState, { label: string; color: string }> = {
  new: { label: 'New', color: 'var(--accent-text)' },
  followed: { label: 'Following up', color: 'var(--tier-fair)' },
  purchased: { label: 'Purchased', color: 'var(--ok)' },
  lost: { label: 'Lost', color: 'var(--err)' },
  rejected: { label: 'Rejected', color: 'var(--text-muted)' },
};

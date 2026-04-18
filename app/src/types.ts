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

export type Panel = 'dashboard' | 'items' | 'sources' | 'settings' | 'history' | 'logs';

export type DealTier = 'steal' | 'deal' | 'fair' | 'overpriced' | 'irrelevant';

export const SCRAPER_META: Record<string, { label: string; description: string }> = {
  hifishark: { label: 'HiFi Shark', description: 'Audio aggregator across 50+ sites' },
  usaudiomart: { label: 'US Audio Mart', description: 'Audio-focused classifieds' },
  craigslist: { label: 'Craigslist', description: 'Local classifieds, vehicle-aware' },
  audiogon: { label: 'Audiogon', description: 'High-end audio marketplace' },
  ebay: { label: 'eBay', description: 'US-only listings with item specifics' },
  fbmp: { label: 'Facebook Marketplace', description: 'Local listings (requires headed browser)' },
  mechmarket: { label: 'r/mechmarket', description: 'Mechanical keyboard parts' },
  avexchange: { label: 'r/AVexchange', description: 'Audio gear trades' },
};

export const TIER_COLORS: Record<string, { bg: string; fg: string; emoji: string }> = {
  steal: { bg: '#7f1d1d', fg: '#fecaca', emoji: '🚨' },
  deal: { bg: '#7c2d12', fg: '#fed7aa', emoji: '🔥' },
  fair: { bg: '#713f12', fg: '#fef3c7', emoji: '👀' },
  grail: { bg: '#4c1d95', fg: '#ddd6fe', emoji: '💎' },
  overpriced: { bg: '#1f1f22', fg: '#8b8b8f', emoji: '' },
  irrelevant: { bg: '#1f1f22', fg: '#6b6b70', emoji: '' },
};

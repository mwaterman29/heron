import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { listingId } from './utils/hash.js';

export interface RawListing {
  title: string;
  price: string | null;
  /** Currency symbol/code captured from the listing (e.g. '$', '£', '€', 'SEK'). Null if unknown. */
  currency: string | null;
  url: string;
  location: string | null;
  rawText: string;
  thumbnailUrl: string | null;
  source: string;
}

export interface SeenItemRow {
  id: string;
  site: string;
  search_id: string;
  title: string | null;
  price: number | null;
  currency: string | null;
  price_usd: number | null;
  url: string;
  location: string | null;
  raw_text: string | null;
  first_seen_at: number;
  last_seen_at: number;
  times_seen: number;
  evaluated: number;
  is_deal: number;
  deal_tier: string | null;
  llm_reasoning: string | null;
  notified: number;
  created_at: number;
}

export interface Verdict {
  relevant: boolean;
  deal_tier: 'steal' | 'deal' | 'fair' | 'overpriced' | 'irrelevant';
  confidence: number;
  extracted_price: number | null;
  reasoning: string;
  red_flags: string[];
  positive_signals: string[];
  grail_match: boolean;
}

export type UpsertResult =
  | { status: 'new'; row: SeenItemRow }
  | { status: 'reseen'; row: SeenItemRow; priceChanged: boolean; priceDropPct: number };

const DB_PATH = resolve(process.cwd(), 'data/seen_items.db');

function ensureDir(filePath: string) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

ensureDir(DB_PATH);
export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS seen_items (
  id TEXT PRIMARY KEY,
  site TEXT NOT NULL,
  search_id TEXT NOT NULL,
  title TEXT,
  price REAL,
  currency TEXT,
  price_usd REAL,
  url TEXT NOT NULL,
  location TEXT,
  raw_text TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  times_seen INTEGER DEFAULT 1,
  evaluated INTEGER DEFAULT 0,
  is_deal INTEGER DEFAULT 0,
  deal_tier TEXT,
  llm_reasoning TEXT,
  notified INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_seen_items_site ON seen_items(site);
CREATE INDEX IF NOT EXISTS idx_seen_items_search_id ON seen_items(search_id);
CREATE INDEX IF NOT EXISTS idx_seen_items_evaluated ON seen_items(evaluated);
CREATE INDEX IF NOT EXISTS idx_seen_items_is_deal ON seen_items(is_deal);

CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL REFERENCES seen_items(id),
  price REAL NOT NULL,
  observed_at INTEGER NOT NULL
);
`);

// Idempotent schema migrations for older DBs.
function addColumnIfMissing(table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}
addColumnIfMissing('seen_items', 'currency', 'TEXT');
addColumnIfMissing('seen_items', 'price_usd', 'REAL');

const stmts = {
  get: db.prepare('SELECT * FROM seen_items WHERE id = ?'),
  insert: db.prepare(`
    INSERT INTO seen_items (
      id, site, search_id, title, price, currency, url, location, raw_text,
      first_seen_at, last_seen_at, times_seen, created_at
    ) VALUES (
      @id, @site, @search_id, @title, @price, @currency, @url, @location, @raw_text,
      @now, @now, 1, @now
    )
  `),
  touch: db.prepare(`
    UPDATE seen_items
    SET last_seen_at = @now,
        times_seen = times_seen + 1,
        price = CASE WHEN @price IS NOT NULL THEN @price ELSE price END
    WHERE id = @id
  `),
  insertPriceHistory: db.prepare(`
    INSERT INTO price_history (item_id, price, observed_at) VALUES (?, ?, ?)
  `),
  markEvaluated: db.prepare(`
    UPDATE seen_items
    SET evaluated = 1,
        is_deal = @is_deal,
        deal_tier = @deal_tier,
        llm_reasoning = @reasoning,
        price_usd = @price_usd
    WHERE id = @id
  `),
  markNotified: db.prepare(`UPDATE seen_items SET notified = 1 WHERE id = ?`),
};

export function parsePrice(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = raw.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

const PRICE_DROP_THRESHOLD = 0.15;

export function shouldReEvaluateOnPriceDrop(oldPrice: number | null, newPrice: number | null): boolean {
  if (oldPrice == null || newPrice == null || oldPrice <= 0) return false;
  const drop = (oldPrice - newPrice) / oldPrice;
  return drop >= PRICE_DROP_THRESHOLD;
}

export function upsertListing(searchId: string, listing: RawListing): UpsertResult {
  const id = listingId(listing.source, listing.url);
  const price = parsePrice(listing.price);
  const now = Date.now();

  const existing = stmts.get.get(id) as SeenItemRow | undefined;

  if (!existing) {
    stmts.insert.run({
      id,
      site: listing.source,
      search_id: searchId,
      title: listing.title,
      price,
      currency: listing.currency,
      url: listing.url,
      location: listing.location,
      raw_text: listing.rawText,
      now,
    });
    if (price != null) stmts.insertPriceHistory.run(id, price, now);
    const row = stmts.get.get(id) as SeenItemRow;
    return { status: 'new', row };
  }

  stmts.touch.run({ id, price, now });
  let priceChanged = false;
  let priceDropPct = 0;
  if (price != null && existing.price != null && price !== existing.price) {
    priceChanged = true;
    stmts.insertPriceHistory.run(id, price, now);
    if (existing.price > 0) {
      priceDropPct = (existing.price - price) / existing.price;
    }
  }
  const row = stmts.get.get(id) as SeenItemRow;
  return { status: 'reseen', row, priceChanged, priceDropPct };
}

export function markEvaluated(itemId: string, verdict: Verdict): void {
  const isDeal = verdict.deal_tier === 'steal' || verdict.deal_tier === 'deal' || verdict.grail_match;
  stmts.markEvaluated.run({
    id: itemId,
    is_deal: isDeal ? 1 : 0,
    deal_tier: verdict.deal_tier,
    reasoning: verdict.reasoning,
    price_usd: verdict.extracted_price,
  });
}

export function markNotified(itemId: string): void {
  stmts.markNotified.run(itemId);
}

export function getSeenItem(id: string): SeenItemRow | undefined {
  return stmts.get.get(id) as SeenItemRow | undefined;
}

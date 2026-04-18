import Database, { type Database as DatabaseType, type Statement } from 'better-sqlite3';
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
  /** Final deal tier (pass-2-overridden if pass-2 ran, else pass-1). */
  deal_tier: string | null;
  /** Final reasoning (pass-2 if ran, else pass-1). */
  llm_reasoning: string | null;
  /** Pass-1 tier, preserved for audit when pass-2 runs. */
  pass1_tier: string | null;
  /** Pass-1 reasoning, preserved for audit when pass-2 runs. */
  pass1_reasoning: string | null;
  /** 1 if the detail page was fetched and evaluated. */
  detail_fetched: number;
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

function ensureDir(filePath: string) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

let db: DatabaseType | null = null;
let stmts: {
  get: Statement;
  insert: Statement;
  touch: Statement;
  insertPriceHistory: Statement;
  markPass1: Statement;
  markPass2: Statement;
  markNotified: Statement;
} | null = null;

/** Get the initialized database instance. Auto-initializes with CWD if not yet called. */
export function getDb(): DatabaseType {
  if (!db) initDb(process.cwd());
  return db!;
}

function getStmts() {
  if (!stmts) initDb(process.cwd());
  return stmts!;
}

/**
 * Initialize the database from a given config directory.
 * Must be called once before any other db function.
 */
export function initDb(configDir: string): void {
  const dbPath = resolve(configDir, 'data/seen_items.db');
  ensureDir(dbPath);

  db = new Database(dbPath);
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
    const cols = db!.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === column)) {
      db!.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    }
  }
  addColumnIfMissing('seen_items', 'currency', 'TEXT');
  addColumnIfMissing('seen_items', 'price_usd', 'REAL');
  addColumnIfMissing('seen_items', 'pass1_tier', 'TEXT');
  addColumnIfMissing('seen_items', 'pass1_reasoning', 'TEXT');
  addColumnIfMissing('seen_items', 'detail_fetched', 'INTEGER DEFAULT 0');

  stmts = {
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
    // Pass-1: card-level evaluation. Writes both the final tier (so orchestrators
    // that don't run pass-2 still get a verdict) AND the pass1_* audit columns.
    markPass1: db.prepare(`
      UPDATE seen_items
      SET evaluated = 1,
          is_deal = @is_deal,
          deal_tier = @deal_tier,
          llm_reasoning = @reasoning,
          pass1_tier = @deal_tier,
          pass1_reasoning = @reasoning,
          price_usd = @price_usd
      WHERE id = @id
    `),
    // Pass-2: detail-level revision. Overwrites deal_tier/llm_reasoning with
    // the revised verdict but leaves pass1_tier/pass1_reasoning intact.
    markPass2: db.prepare(`
      UPDATE seen_items
      SET is_deal = @is_deal,
          deal_tier = @deal_tier,
          llm_reasoning = @reasoning,
          detail_fetched = 1,
          price_usd = COALESCE(@price_usd, price_usd)
      WHERE id = @id
    `),
    markNotified: db.prepare(`UPDATE seen_items SET notified = 1 WHERE id = ?`),
  };
}

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
  const s = getStmts();
  const id = listingId(listing.source, listing.url);
  const price = parsePrice(listing.price);
  const now = Date.now();

  const existing = s.get.get(id) as SeenItemRow | undefined;

  if (!existing) {
    s.insert.run({
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
    if (price != null) s.insertPriceHistory.run(id, price, now);
    const row = s.get.get(id) as SeenItemRow;
    return { status: 'new', row };
  }

  s.touch.run({ id, price, now });
  let priceChanged = false;
  let priceDropPct = 0;
  if (price != null && existing.price != null && price !== existing.price) {
    priceChanged = true;
    s.insertPriceHistory.run(id, price, now);
    if (existing.price > 0) {
      priceDropPct = (existing.price - price) / existing.price;
    }
  }
  const row = s.get.get(id) as SeenItemRow;
  return { status: 'reseen', row, priceChanged, priceDropPct };
}

function isDealVerdict(verdict: Verdict): boolean {
  return (
    verdict.deal_tier === 'steal' ||
    verdict.deal_tier === 'deal' ||
    verdict.grail_match
  );
}

/**
 * Write the card-level (pass-1) verdict. Seeds both the final verdict
 * columns AND the pass1_* audit columns — if pass-2 never runs, the
 * orchestrator still sees a complete verdict on the row.
 */
export function markPass1(itemId: string, verdict: Verdict): void {
  getStmts().markPass1.run({
    id: itemId,
    is_deal: isDealVerdict(verdict) ? 1 : 0,
    deal_tier: verdict.deal_tier,
    reasoning: verdict.reasoning,
    price_usd: verdict.extracted_price,
  });
}

/**
 * Write the detail-level (pass-2) verdict. Overwrites the final columns
 * but preserves pass1_tier/pass1_reasoning so the original verdict remains
 * auditable. Sets detail_fetched = 1 so we can filter listings that went
 * through the full drill-down flow.
 */
export function markPass2(itemId: string, verdict: Verdict): void {
  getStmts().markPass2.run({
    id: itemId,
    is_deal: isDealVerdict(verdict) ? 1 : 0,
    deal_tier: verdict.deal_tier,
    reasoning: verdict.reasoning,
    price_usd: verdict.extracted_price,
  });
}

/**
 * Back-compat alias for existing call sites. New code should call markPass1.
 * @deprecated use markPass1
 */
export const markEvaluated = markPass1;

export function markNotified(itemId: string): void {
  getStmts().markNotified.run(itemId);
}

export function getSeenItem(id: string): SeenItemRow | undefined {
  return getStmts().get.get(id) as SeenItemRow | undefined;
}

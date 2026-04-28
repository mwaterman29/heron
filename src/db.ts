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
  /** Triage state: new | followed | rejected | purchased | lost */
  listing_state: string | null;
  thumbnail_url: string | null;
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
  findByTitleKey: Statement;
  insert: Statement;
  touch: Statement;
  insertPriceHistory: Statement;
  markPass1: Statement;
  markPass2: Statement;
  markNotified: Statement;
  updateThumbnail: Statement;
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
  // listing_state tracks triage workflow: new | followed | rejected | purchased | lost
  addColumnIfMissing('seen_items', 'listing_state', "TEXT DEFAULT 'new'");
  addColumnIfMissing('seen_items', 'thumbnail_url', 'TEXT');

  stmts = {
    get: db.prepare('SELECT * FROM seen_items WHERE id = ?'),
    // Cross-site title dedup: find an existing row with the same trimmed/case-
    // insensitive title + same price + same currency. Used by upsertListing
    // before falling through to insert, so a re-post of the same item from a
    // different URL (or even a different site) is treated as a re-seen of the
    // first row instead of a fresh listing that re-pays LLM tokens.
    findByTitleKey: db.prepare(`
      SELECT * FROM seen_items
      WHERE TRIM(title) = ? COLLATE NOCASE
        AND price = ?
        AND currency = ?
        AND title IS NOT NULL
        AND price IS NOT NULL
      ORDER BY first_seen_at ASC
      LIMIT 1
    `),
    insert: db.prepare(`
      INSERT INTO seen_items (
        id, site, search_id, title, price, currency, url, location, raw_text,
        thumbnail_url, first_seen_at, last_seen_at, times_seen, created_at
      ) VALUES (
        @id, @site, @search_id, @title, @price, @currency, @url, @location, @raw_text,
        @thumbnail_url, @now, @now, 1, @now
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
    // Backfill thumbnail URL only when the row currently has none. Lets
    // pass-2 detail-page extraction enrich listings (especially USAM, whose
    // search page has no images) without overwriting a working search-page
    // thumbnail from, say, eBay or Craigslist.
    updateThumbnail: db.prepare(
      `UPDATE seen_items
       SET thumbnail_url = @url
       WHERE id = @id AND (thumbnail_url IS NULL OR thumbnail_url = '')`,
    ),
  };

  backfillDedupByTitle();
  purgeNonUsdIfEnabled();
}

/**
 * When USD_ONLY is enabled, purge any pre-existing rows priced in non-USD
 * currencies. The upsert-time filter (src/index.ts) only blocks new
 * non-USD listings going forward — without this, listings inserted before
 * the user enabled USD_ONLY (or before the feature shipped) sit in the
 * queue indefinitely. Idempotent: no-op when USD_ONLY is off or when there
 * are no non-USD rows. NULL currency rows are preserved (they're junk-
 * priced listings that the LLM filters as irrelevant anyway, not actively
 * non-USD).
 */
function purgeNonUsdIfEnabled(): void {
  const usdOnly = (process.env.USD_ONLY ?? 'true') !== 'false';
  if (!usdOnly) return;

  const ids = db!
    .prepare(
      `SELECT id FROM seen_items
       WHERE currency IS NOT NULL AND currency != 'USD'`,
    )
    .all() as Array<{ id: string }>;
  if (ids.length === 0) return;

  const delHistory = db!.prepare('DELETE FROM price_history WHERE item_id = ?');
  const delItem = db!.prepare('DELETE FROM seen_items WHERE id = ?');
  const tx = db!.transaction((rows: Array<{ id: string }>) => {
    for (const r of rows) {
      delHistory.run(r.id);
      delItem.run(r.id);
    }
  });
  tx(ids);
  // eslint-disable-next-line no-console
  console.log(`[db] USD_ONLY purge: removed ${ids.length} non-USD listings`);
}

/**
 * One-shot cleanup of pre-existing duplicate rows that share a normalized
 * (title, price, currency). The new title-key dedup at upsertListing only
 * catches future duplicates; rows inserted before that change is deployed
 * sit in the queue forever. We collapse each dupe group to a single row,
 * preferring the already-evaluated copy so we don't lose LLM verdicts, then
 * falling back to the oldest. Idempotent: if there are no dupes, this is a
 * no-op.
 */
function backfillDedupByTitle(): void {
  const ids = db!
    .prepare(
      `SELECT id FROM (
         SELECT id, ROW_NUMBER() OVER (
           PARTITION BY TRIM(LOWER(title)), price, currency
           ORDER BY evaluated DESC, first_seen_at ASC, id ASC
         ) AS rn
         FROM seen_items
         WHERE title IS NOT NULL
           AND price IS NOT NULL
           AND price > 0
           AND currency IS NOT NULL
       ) WHERE rn > 1`,
    )
    .all() as Array<{ id: string }>;

  if (ids.length === 0) return;

  const delHistory = db!.prepare('DELETE FROM price_history WHERE item_id = ?');
  const delItem = db!.prepare('DELETE FROM seen_items WHERE id = ?');
  const tx = db!.transaction((rows: Array<{ id: string }>) => {
    for (const r of rows) {
      delHistory.run(r.id);
      delItem.run(r.id);
    }
  });
  tx(ids);
  // eslint-disable-next-line no-console
  console.log(`[db] backfill dedup: removed ${ids.length} duplicate rows`);
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
    // Cross-site title dedup: before inserting as a fresh row, check whether
    // an existing row already has the same title + price + currency. If yes,
    // this is a re-post (cross-region Craigslist, cross-site duplicate, etc.)
    // — treat it as a re-seen of the canonical row so we don't re-evaluate.
    const titleKey = listing.title?.trim();
    if (titleKey && price != null && listing.currency) {
      const aliased = s.findByTitleKey.get(titleKey, price, listing.currency) as
        | SeenItemRow
        | undefined;
      if (aliased) {
        s.touch.run({ id: aliased.id, price, now });
        const row = s.get.get(aliased.id) as SeenItemRow;
        return { status: 'reseen', row, priceChanged: false, priceDropPct: 0 };
      }
    }

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
      thumbnail_url: listing.thumbnailUrl,
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

/**
 * Backfill a listing's thumbnail URL. No-op if the row already has one —
 * we never overwrite a working search-page thumbnail with a detail-page one,
 * since search-page images tend to be more reliable (no referrer tricks,
 * less likely to be a site-chrome logo).
 */
export function updateThumbnail(itemId: string, url: string): void {
  getStmts().updateThumbnail.run({ id: itemId, url });
}

export function getSeenItem(id: string): SeenItemRow | undefined {
  return getStmts().get.get(id) as SeenItemRow | undefined;
}

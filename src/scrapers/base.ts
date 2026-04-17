import * as puppeteerExtraNs from 'puppeteer-extra';
import StealthPluginNs from 'puppeteer-extra-plugin-stealth';
import type { Browser } from 'puppeteer';

// puppeteer-extra's CJS bundle attaches both default export and all named
// exports to module.exports. Under NodeNext TS types it as the namespace,
// so we unwrap to the real puppeteer-extra instance that has .use() / .launch().
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const puppeteer: any = (puppeteerExtraNs as any).default ?? puppeteerExtraNs;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const StealthPlugin: any = (StealthPluginNs as any).default ?? StealthPluginNs;
import type { RawListing } from '../db.js';
import type { ResolvedSearch } from '../config.js';

puppeteer.use(StealthPlugin());

export type { RawListing };

export interface ScraperConfig {
  headless: boolean;
  randomDelayRange: [number, number];
  timeout: number;
  userAgent?: string;
}

/**
 * Detail-page content fetched for a single listing. Used by the pass-2
 * evaluator to re-judge pass-1 deal candidates with the full listing body.
 */
export interface DetailPage {
  url: string;
  /** Full scraped body text, cleaned and trimmed. Capped around 8000 chars. */
  rawText: string;
  /** Best-effort structured pulls from the detail page. Site-specific. */
  title?: string;
  price?: string | null;
  currency?: string | null;
  location?: string | null;
  /** Site-specific bonus fields (e.g. mileage / drive / paint for Craigslist autos). */
  extras?: Record<string, string>;
  fetchedAt: number;
}

export interface Scraper {
  id: string;
  /** If true, this scraper requires a visible browser window. */
  needsHeaded?: boolean;
  scrape(search: ResolvedSearch, config: ScraperConfig): Promise<RawListing[]>;
  /**
   * Optional: fetch a single listing's detail page. The pass-2 evaluator
   * uses this to re-judge pass-1 deal candidates with the full body text.
   * Scrapers without an implementation skip pass-2 and fall back to the
   * pass-1 verdict.
   */
  fetchDetail?(url: string, config: ScraperConfig): Promise<DetailPage>;
}

export async function createBrowser(config: ScraperConfig): Promise<Browser> {
  return puppeteer.launch({
    headless: config.headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
  }) as unknown as Promise<Browser>;
}

export function randomDelay(range: [number, number]): Promise<void> {
  const ms = Math.floor(Math.random() * (range[1] - range[0])) + range[0];
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function defaultScraperConfig(): ScraperConfig {
  return {
    headless: (process.env.HEADLESS ?? 'true') !== 'false',
    randomDelayRange: [
      Number(process.env.SCRAPE_DELAY_MIN ?? 2000),
      Number(process.env.SCRAPE_DELAY_MAX ?? 5000),
    ],
    timeout: 30_000,
  };
}

/**
 * Filter listings by allowed US state codes. Checks if the listing's
 * location string ends with a 2-letter state code that's in the allowed
 * set. Listings with no parseable state are kept (benefit of the doubt).
 */
export function filterByAllowedStates(
  listings: RawListing[],
  allowedStates: string[] | undefined,
): RawListing[] {
  if (!allowedStates || allowedStates.length === 0) return listings;
  const allowed = new Set(allowedStates.map((s) => s.toUpperCase()));
  return listings.filter((l) => {
    if (!l.location) return true; // no location → keep
    // Match trailing 2-letter state code: "Burlington, MA" → "MA"
    // Also handles "US-MA" format from mechmarket/craigslist
    const m = l.location.match(/\b([A-Z]{2})$/i) ?? l.location.match(/^US-([A-Z]{2})$/i);
    if (!m) return true; // unparseable location → keep
    return allowed.has(m[1].toUpperCase());
  });
}

export class UnsupportedScraperError extends Error {
  constructor(siteId: string) {
    super(`No scraper registered for site '${siteId}'`);
    this.name = 'UnsupportedScraperError';
  }
}

/**
 * Generic detail-page fetcher. Launches a fresh puppeteer context, loads
 * the url, and returns page title + body innerText with a best-effort
 * regex-extracted price. Every per-site fetchDetail can delegate to this
 * and optionally enrich the result with selector-based pulls.
 */
export async function genericFetchDetail(
  url: string,
  config: ScraperConfig,
  opts: { maxBodyChars?: number; waitMs?: number; waitUntil?: 'domcontentloaded' | 'networkidle2' } = {},
): Promise<DetailPage> {
  const browser = await createBrowser(config);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    await page.setUserAgent(
      config.userAgent ??
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    );
    await page.evaluateOnNewDocument(
      'window.__name = window.__name || function(fn){return fn;};',
    );

    await page.goto(url, {
      waitUntil: opts.waitUntil ?? 'domcontentloaded',
      timeout: config.timeout,
    });
    await new Promise((r) => setTimeout(r, opts.waitMs ?? 1500));

    const maxChars = opts.maxBodyChars ?? 8000;
    const result = await page.evaluate((limit) => {
      const title = (document.title || '').trim();
      const bodyTextRaw = (document.body?.innerText || '').trim();
      // Collapse whitespace runs, strip > 2 consecutive blank lines.
      const bodyText = bodyTextRaw
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .slice(0, limit);

      // Best-effort price extraction: first currency-looking token.
      const priceMatch = bodyTextRaw.match(
        /(US\$|USD|EUR|GBP|CAD|AUD|PLN|SEK|NOK|DKK|CHF|JPY|UAH|€|£|\$|¥)\s?([\d,]+(?:\.\d+)?)/i,
      );
      const price = priceMatch ? priceMatch[0] : null;
      const currencySymbol = priceMatch ? priceMatch[1] : null;

      return { title, rawText: bodyText, price, currencySymbol };
    }, maxChars);

    // Normalize the currency symbol into an ISO-ish code.
    let currency: string | null = null;
    if (result.currencySymbol) {
      const map: Record<string, string> = {
        'US$': 'USD',
        $: 'USD',
        '€': 'EUR',
        '£': 'GBP',
        '¥': 'JPY',
      };
      const raw = result.currencySymbol.toUpperCase();
      currency = map[result.currencySymbol] ?? map[raw] ?? raw;
    }

    return {
      url,
      rawText: result.rawText,
      title: result.title || undefined,
      price: result.price,
      currency,
      fetchedAt: Date.now(),
    };
  } finally {
    await browser.close();
  }
}

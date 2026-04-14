import { logger } from '../utils/logger.js';
import {
  createBrowser,
  randomDelay,
  type Scraper,
  type ScraperConfig,
  type RawListing,
} from './base.js';
import type { ResolvedSearch } from '../config.js';

const SITE_ID = 'audiogon';

/**
 * Audiogon — high-end US audio classifieds.
 *
 * Results live in `<div id="listing-list-view">`, one per `div.tile-item-row.list-view`.
 * Each row has a bunch of rich data attributes we can lift directly:
 *
 *   <div class="row tile-item-row list-view"
 *        data-id="1901800"
 *        data-impression-field-object='{"id":"lisbhea0","name":"Magnapan MGIIIa","category":"spkrplan","brand":"Magnapan","variant":"MG-IIIa"}'
 *        data-lat="33.720017"
 *        data-lng="-118.04614"
 *        data-zip="92649">
 *     <a href="/listings/lisbhea0-magnapan-mgiiia-planars">...</a>
 *     <h4>Magnapan MGIIIa</h4>
 *     <p>Description...</p>
 *     <span class="h4">$1,300.00 USD</span>
 *     <div class="label label-default">Planars</div>
 *     <span>30 Days Left</span>
 *
 * Every Audiogon listing is USD. Lat/lng/zip means we get real geographic
 * grounding that the LLM can evaluate against the reference's shipping_notes.
 */
export const audiogonScraper: Scraper = {
  id: SITE_ID,
  needsHeaded: false,

  async scrape(search: ResolvedSearch, config: ScraperConfig): Promise<RawListing[]> {
    const url = `https://www.audiogon.com/listings?q=${encodeURIComponent(search.query)}`;
    logger.info({ site: SITE_ID, searchId: search.id, url }, 'scraping');

    await randomDelay(config.randomDelayRange);

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

      // Use domcontentloaded rather than networkidle2 — Audiogon's page
      // keeps issuing analytics/ad XHRs that prevent networkidle from ever
      // firing on subsequent scrapes. The listing DOM is fully populated at
      // domcontentloaded since Audiogon server-renders results.
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.timeout });

      // Gentle scroll to trigger any lazy-loaded listings
      await page.evaluate(async () => {
        const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
        for (let i = 0; i < 4; i++) {
          window.scrollBy(0, window.innerHeight);
          await wait(400);
        }
        window.scrollTo(0, 0);
      });

      const listings: RawListing[] = await page.$$eval(
        '#listing-list-view .tile-item-row.list-view',
        (rows) => {
          const out: Array<{
            title: string;
            price: string | null;
            currency: string | null;
            url: string;
            location: string | null;
            rawText: string;
            thumbnailUrl: string | null;
            source: string;
          }> = [];

          for (const row of Array.from(rows) as HTMLElement[]) {
            // Canonical listing link
            const anchor = row.querySelector('a[href*="/listings/lis"]') as HTMLAnchorElement | null;
            if (!anchor) continue;
            const href = anchor.href;
            if (!href) continue;

            const titleEl = row.querySelector('h4');
            const title = (titleEl?.textContent || '').trim();
            if (!title) continue;

            // Price: Audiogon renders as "$1,300.00 USD" in a span.h4
            let priceRaw: string | null = null;
            for (const span of Array.from(row.querySelectorAll('span.h4')) as HTMLElement[]) {
              const t = (span.textContent || '').trim();
              if (/\$[\d,]+/.test(t)) {
                priceRaw = t;
                break;
              }
            }
            const currency = priceRaw ? 'USD' : null;

            // Description paragraph (first non-empty <p>)
            const descEl = Array.from(row.querySelectorAll('p')).find(
              (p) => (p.textContent || '').trim().length > 20,
            );
            const description = (descEl?.textContent || '').trim();

            // Category from the label chip
            const labelEl = row.querySelector('.label.label-default');
            const category = (labelEl?.textContent || '').trim() || null;

            // Location: lat/lng/zip attributes. No city name in the markup,
            // but the ZIP is enough for the LLM to reason about distance.
            const zip = row.getAttribute('data-zip');
            const lat = row.getAttribute('data-lat');
            const lng = row.getAttribute('data-lng');
            const location = zip ? `ZIP ${zip}` : null;

            // Data-id is a stable Audiogon-internal numeric ID
            const dataId = row.getAttribute('data-id');

            // Brand/category/variant from the impression metadata JSON
            let brand: string | null = null;
            let variant: string | null = null;
            try {
              const raw = row.getAttribute('data-impression-field-object');
              if (raw) {
                const parsed = JSON.parse(raw);
                brand = parsed?.brand ?? null;
                variant = parsed?.variant ?? null;
              }
            } catch {
              // ignore malformed JSON
            }

            const imgEl = row.querySelector('img') as HTMLImageElement | null;
            const thumbnailUrl = imgEl?.src || null;

            const rawText = [
              title,
              brand ? `Brand: ${brand}` : null,
              variant ? `Variant: ${variant}` : null,
              category ? `Category: ${category}` : null,
              priceRaw ? `Price: ${priceRaw}` : null,
              zip ? `ZIP: ${zip}` : null,
              lat && lng ? `Coords: ${lat},${lng}` : null,
              dataId ? `ID: ${dataId}` : null,
              description ? `Description: ${description}` : null,
            ]
              .filter(Boolean)
              .join('\n');

            out.push({
              title: title.slice(0, 300),
              price: priceRaw,
              currency,
              url: href,
              location,
              rawText: rawText.slice(0, 2000),
              thumbnailUrl,
              source: 'audiogon',
            });
          }
          return out;
        },
      );

      if (listings.length === 0) {
        logger.warn(
          { site: SITE_ID, searchId: search.id, url },
          'zero listings extracted — either no results or selectors stale',
        );
      } else {
        logger.info(
          { site: SITE_ID, searchId: search.id, count: listings.length },
          'extracted listings',
        );
      }

      return listings;
    } finally {
      await browser.close();
    }
  },
};

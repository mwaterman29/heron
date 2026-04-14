import { logger } from '../utils/logger.js';
import {
  createBrowser,
  randomDelay,
  type Scraper,
  type ScraperConfig,
  type RawListing,
} from './base.js';
import type { ResolvedSearch } from '../config.js';

const SITE_ID = 'usaudiomart';

/**
 * US Audio Mart — classic audio classifieds, US-only by definition.
 *
 * The search results page renders listings into an HTML table:
 *   <table class="adverttable">
 *     <tbody>
 *       <tr class="ad">
 *         <td>#</td>
 *         <td><a href="/details/<id>-<slug>/">Title</a></td>
 *         <td><a href="/classifieds/<cat>/">Category</a></td>
 *         <td class="rightCell">$1000.00</td>
 *         <td>US State (PA, TX, VA, ...)</td>
 *         <td>Date</td>
 *         <td>Photo icon</td>
 *
 * NOTE: the page contains a SECOND `table.adverttable` below an
 *   <h3>Results for "<q>" from other AudioMarts</h3>
 * heading which aggregates Canuck/Euro Audio Mart listings. We deliberately
 * only read the FIRST such table so the scraper's output stays US-only and
 * shipping_notes constraints work as intended.
 *
 * The site is protected by a bot-check on simple HTTP clients (curl/WebFetch
 * both get a 403 "Security Check Required"), but puppeteer-extra-plugin-stealth
 * passes cleanly with no extra effort.
 */
export const usaudiomartScraper: Scraper = {
  id: SITE_ID,
  needsHeaded: false,

  async scrape(search: ResolvedSearch, config: ScraperConfig): Promise<RawListing[]> {
    const url = `https://www.usaudiomart.com/search.php?keywords=${encodeURIComponent(search.query)}`;
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

      await page.goto(url, { waitUntil: 'networkidle2', timeout: config.timeout });

      const listings: RawListing[] = await page.$$eval(
        'table.adverttable',
        (tables) => {
          // Only read the FIRST adverttable — subsequent tables are
          // "Results from other AudioMarts" (Canuck/Euro) which are
          // non-US by definition and violate shipping constraints.
          const first = tables[0] as HTMLTableElement | undefined;
          if (!first) return [];

          const rows = Array.from(first.querySelectorAll('tbody tr.ad')) as HTMLTableRowElement[];
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

          for (const tr of rows) {
            const tds = Array.from(tr.querySelectorAll(':scope > td')) as HTMLTableCellElement[];
            if (tds.length === 0) continue;

            // Title anchor + URL live inside the caption cell, which is the
            // first td containing an <a href="/details/...">.
            const detailAnchor = tr.querySelector(
              'a[href*="/details/"]',
            ) as HTMLAnchorElement | null;
            if (!detailAnchor) continue;
            const href = detailAnchor.href;
            const title = (detailAnchor.innerText || detailAnchor.textContent || '').trim();
            if (!href || !title) continue;

            // Price lives in td.rightCell — always "$1,234.00" on USAM.
            const priceCell = tr.querySelector('td.rightCell') as HTMLTableCellElement | null;
            const priceRaw = (priceCell?.innerText || priceCell?.textContent || '').trim();
            const price = priceRaw || null;
            // USAM only ever quotes in USD
            const currency = price ? 'USD' : null;

            // State + date come from later td cells. Rather than rely on
            // fragile index math, detect the 2-letter state and date format.
            let state: string | null = null;
            let date: string | null = null;
            for (const td of tds) {
              const txt = (td.innerText || td.textContent || '').trim();
              if (!state && /^[A-Z]{2}$/.test(txt)) {
                state = txt;
                continue;
              }
              if (!date && /^[A-Z][a-z]{2} \d{1,2},? \d{4}$/.test(txt)) {
                date = txt;
                continue;
              }
            }

            // Category link (optional, just folded into rawText)
            const categoryAnchor = tr.querySelector(
              'a[href*="/classifieds/"]',
            ) as HTMLAnchorElement | null;
            const category = categoryAnchor?.innerText?.trim() ?? null;

            const rawText = [
              title,
              category ? `Category: ${category}` : null,
              price ? `Price: ${price}` : null,
              state ? `State: ${state}` : null,
              date ? `Posted: ${date}` : null,
            ]
              .filter(Boolean)
              .join('\n');

            out.push({
              title: title.slice(0, 300),
              price,
              currency,
              url: href,
              location: state,
              rawText: rawText.slice(0, 2000),
              thumbnailUrl: null,
              source: 'usaudiomart',
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

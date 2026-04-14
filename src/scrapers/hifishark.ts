import { logger } from '../utils/logger.js';
import { createBrowser, randomDelay, type Scraper, type ScraperConfig, type RawListing } from './base.js';
import type { ResolvedSearch } from '../config.js';

const SITE_ID = 'hifishark';

/**
 * HiFi Shark is an aggregator. Each result row contains a link like
 *   /goto/<id>_<hash>/<url-slug>
 * which is a redirect to the external listing. The presence of these
 * /goto/ anchors is the most stable identifier for a listing row.
 *
 * We scroll through the results, find every /goto/ anchor, walk up to a
 * stable-ish ancestor container, and capture its innerText + the href.
 * The LLM can then do the heavy lifting of parsing title/price/location
 * out of the raw text.
 */
export const hifisharkScraper: Scraper = {
  id: SITE_ID,
  needsHeaded: false,

  async scrape(search: ResolvedSearch, config: ScraperConfig): Promise<RawListing[]> {
    const url = `https://www.hifishark.com/search?q=${encodeURIComponent(search.query)}`;
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

      // tsx/esbuild compiles evaluate callbacks with a `__name` helper reference
      // that doesn't exist in the browser. Shim it via a plain string so no
      // TS transform pollutes the injected code.
      await page.evaluateOnNewDocument(
        'window.__name = window.__name || function(fn){return fn;};',
      );

      await page.goto(url, { waitUntil: 'networkidle2', timeout: config.timeout });

      // Gentle scroll to trigger any lazy-loading
      await page.evaluate(async () => {
        const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
        for (let i = 0; i < 4; i++) {
          window.scrollBy(0, window.innerHeight);
          await wait(400);
        }
        window.scrollTo(0, 0);
      });

      const listings: RawListing[] = await page.$$eval('a[href*="/goto/"]', (anchors) => {
        const seen = new Set<string>();
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

        for (const a of anchors as HTMLAnchorElement[]) {
          const href = a.href;
          if (!href || seen.has(href)) continue;

          // Walk up to find a container with substantive text (likely the row)
          let container: HTMLElement | null = a;
          for (let i = 0; i < 6 && container; i++) {
            const txt = (container.innerText || '').trim();
            if (txt.length >= 40) break;
            container = container.parentElement;
          }
          if (!container) continue;

          // De-dup by the ultimate container (avoid multiple goto links in same row)
          const marker = container.outerHTML.slice(0, 64) + href;
          if (seen.has(marker)) continue;
          seen.add(href);
          seen.add(marker);

          const rawText = (container.innerText || '').trim();

          // Title: first line of container text, or anchor text
          const firstLine = rawText.split('\n').map((s) => s.trim()).filter(Boolean)[0] ?? '';
          const title = (a.innerText || '').trim() || firstLine;

          // Price + currency: match a currency token then a number
          const priceMatch = rawText.match(
            /(US\$|USD|EUR|GBP|CAD|AUD|PLN|SEK|NOK|DKK|CHF|JPY|UAH|€|£|\$|¥)\s?([\d,]+(?:\.\d+)?)/i,
          );
          const price = priceMatch ? priceMatch[0] : null;
          // Normalize the currency token
          let currency: string | null = null;
          if (priceMatch) {
            const raw = priceMatch[1].toUpperCase();
            const map: Record<string, string> = {
              'US$': 'USD',
              '$': 'USD',
              '€': 'EUR',
              '£': 'GBP',
              '¥': 'JPY',
            };
            currency = map[priceMatch[1]] ?? map[raw] ?? raw;
          }

          // Location: country line heuristic — look for short all-letter line
          let location: string | null = null;
          for (const line of rawText.split('\n').map((s) => s.trim())) {
            if (line.length >= 2 && line.length <= 25 && /^[A-Za-z .,-]+$/.test(line)) {
              // skip the title-ish first line
              if (line.toLowerCase() !== title.toLowerCase()) {
                location = line;
                break;
              }
            }
          }

          // Thumbnail
          const img = container.querySelector('img') as HTMLImageElement | null;
          const thumbnailUrl = img?.src ?? null;

          out.push({
            title: title.slice(0, 300),
            price,
            currency,
            url: href,
            location,
            rawText: rawText.slice(0, 2000),
            thumbnailUrl,
            source: 'hifishark',
          });
        }
        return out;
      });

      if (listings.length === 0) {
        logger.warn(
          { site: SITE_ID, searchId: search.id, url },
          'zero listings extracted — selectors may be stale',
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

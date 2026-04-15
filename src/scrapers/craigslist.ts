import { logger } from '../utils/logger.js';
import {
  createBrowser,
  randomDelay,
  type DetailPage,
  type Scraper,
  type ScraperConfig,
  type RawListing,
} from './base.js';
import type { ResolvedSearch } from '../config.js';

const SITE_ID = 'craigslist';

/**
 * Craigslist — location-native US classifieds. No bot protection of note;
 * stealth puppeteer passes cleanly. The modern search UI is client-rendered,
 * so we navigate + wait for JS to populate the results container before
 * reading the DOM.
 *
 * Result card structure (observed April 2026):
 *
 *   <div data-pid="7925683964" class="cl-search-result" title="...">
 *     <div class="gallery-card">
 *       <a class="main" href="https://<city>.craigslist.org/.../<pid>.html">
 *         <img src="https://images.craigslist.org/..." />
 *       <a class="posting-title" href="...">
 *         <span class="label">Title Text</span>
 *       <div class="meta">
 *         <span class="result-posted-date">4/13</span>
 *         <span class="result-location">Jackson Heights</span>
 *       <span class="priceinfo">$75</span>
 *
 * The list may be followed by a `<div class="nearby-separator">` marking
 * results from nearby cities when the local query returns zero hits. We
 * capture those listings too but tag them as "nearby" in the rawText so
 * the LLM can weigh the landed-cost / pickup-distance constraint from
 * the reference's shipping_notes.
 */

// search.location → craigslist subdomain. Extend as you add cities.
const LOCATION_TO_SUBDOMAIN: Record<string, string> = {
  boston: 'boston',
  // future: 'nyc': 'newyork', 'sf': 'sfbay', etc.
};

export const craigslistScraper: Scraper = {
  id: SITE_ID,
  needsHeaded: false,

  /**
   * Craigslist detail pages have a stable DOM:
   *   #postingbody                  - seller-written description
   *   .postingtitletext / h1        - title + price + location
   *   .attrgroup .attr              - structured attributes (cars/trucks)
   *     [data-name=condition, odometer, title_status, transmission,
   *      drive, paint_color, fuel, cylinders, ...]
   * For autos this is gold — mileage, drive (rwd/fwd/4wd), paint color,
   * title status, transmission are exactly what the pass-2 evaluator needs
   * to judge the W211 E500 against the reference's buyer preferences.
   */
  async fetchDetail(url: string, config: ScraperConfig): Promise<DetailPage> {
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

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.timeout });
      await new Promise((r) => setTimeout(r, 1200));

      const result = await page.evaluate(() => {
        function text(sel: string): string | null {
          const el = document.querySelector(sel);
          return el ? ((el as HTMLElement).innerText || el.textContent || '').trim() : null;
        }

        const title = text('.postingtitletext .price + .postingtitletext, .postingtitletext') ?? document.title;
        const price = text('.price');
        const mapAddress = text('.mapaddress');
        const bodyEl = document.querySelector('#postingbody');
        // Strip the "QR code" boilerplate block CL prepends.
        let body = bodyEl ? ((bodyEl as HTMLElement).innerText || '').trim() : '';
        body = body.replace(/^QR Code Link to This Post\s*/i, '').trim();

        // Structured attrs (autos + many categories)
        const extras: Record<string, string> = {};
        const attrEls = Array.from(document.querySelectorAll('.attrgroup .attr')) as HTMLElement[];
        for (const attr of attrEls) {
          const name = attr.getAttribute('data-name') || '';
          const valEl = attr.querySelector('.valu') as HTMLElement | null;
          const val = (valEl?.innerText || attr.innerText || '').trim();
          if (name && val) extras[name] = val;
        }
        // Also pull free-text attr rows (no data-name) as a fallback
        if (Object.keys(extras).length === 0) {
          attrEls.forEach((a, i) => {
            const t = (a.innerText || '').trim();
            if (t) extras[`attr_${i}`] = t;
          });
        }

        // Compose a rich rawText for the LLM
        const lines = [
          title ? `Title: ${title}` : null,
          price ? `Price: ${price}` : null,
          mapAddress ? `Location: ${mapAddress}` : null,
          Object.keys(extras).length
            ? `Attributes:\n${Object.entries(extras)
                .map(([k, v]) => `  ${k}: ${v}`)
                .join('\n')}`
            : null,
          body ? `Description:\n${body}` : null,
        ].filter(Boolean);
        const rawText = lines.join('\n\n').slice(0, 8000);

        return { title, price, location: mapAddress, extras, rawText };
      });

      return {
        url,
        rawText: result.rawText,
        title: result.title || undefined,
        price: result.price || null,
        currency: result.price ? 'USD' : null,
        location: result.location || null,
        extras: result.extras,
        fetchedAt: Date.now(),
      };
    } finally {
      await browser.close();
    }
  },

  async scrape(search: ResolvedSearch, config: ScraperConfig): Promise<RawListing[]> {
    const locKey = (search.location ?? 'boston').toLowerCase();
    const subdomain = LOCATION_TO_SUBDOMAIN[locKey] ?? locKey;
    // Section = 'sss' (for sale) for audio; 'cta' (cars & trucks - all) for vehicles.
    const section = search.category === 'auto' ? 'cta' : 'sss';
    const url = `https://${subdomain}.craigslist.org/search/${section}?query=${encodeURIComponent(search.query)}&sort=date`;
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

      // Modern CL is client-rendered — wait for the results container to
      // either show cards or show the no-results widget.
      await page
        .waitForSelector('div.cl-search-result[data-pid], .cl-no-results-widget', {
          timeout: 15_000,
        })
        .catch(() => {
          logger.warn({ site: SITE_ID }, 'no results container appeared within 15s');
        });

      // A little extra settle time, then scroll to trigger any lazy pagination.
      await new Promise((r) => setTimeout(r, 1500));
      await page.evaluate(async () => {
        const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
        for (let i = 0; i < 4; i++) {
          window.scrollBy(0, window.innerHeight);
          await wait(500);
        }
        window.scrollTo(0, 0);
      });

      const listings: RawListing[] = await page.$$eval(
        'div.cl-search-result[data-pid]',
        (nodes) => {
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

          // Find the "nearby separator" so we can flag later results as
          // not-strictly-local. The separator is an earlier sibling of the
          // nearby cards inside the same scroll page container.
          const separator = document.querySelector(
            'div.nearby-separator',
          ) as HTMLElement | null;
          const separatorPos = separator
            ? separator.compareDocumentPosition.bind(separator)
            : null;

          for (const node of Array.from(nodes) as HTMLElement[]) {
            const pid = node.getAttribute('data-pid');
            if (!pid) continue;

            // Title: prefer the container's title attribute (most reliable),
            // fall back to the label span.
            let title = (node.getAttribute('title') || '').trim();
            if (!title) {
              const labelEl = node.querySelector('.posting-title .label, .posting-title');
              title = (labelEl?.textContent || '').trim();
            }
            if (!title) continue;

            // Canonical listing URL — `a.main` wraps the image, `a.posting-title`
            // wraps the title; both point at the listing page. Prefer main.
            const anchor = node.querySelector(
              'a.main, a.posting-title',
            ) as HTMLAnchorElement | null;
            const href = anchor?.href || '';
            if (!href) continue;

            const priceEl = node.querySelector('.priceinfo') as HTMLElement | null;
            const priceRaw = (priceEl?.textContent || '').trim() || null;
            const currency = priceRaw ? 'USD' : null;

            const locEl = node.querySelector('.result-location') as HTMLElement | null;
            const locText = (locEl?.textContent || '').trim() || null;

            const dateEl = node.querySelector('.result-posted-date') as HTMLElement | null;
            const dateText = (dateEl?.textContent || '').trim() || null;

            const imgEl = node.querySelector('img') as HTMLImageElement | null;
            const thumbnailUrl = imgEl?.src || null;

            // Is this card below the nearby separator? If yes, it's a
            // "nearby" fallback result, not a local-to-city hit.
            let isNearby = false;
            if (separatorPos) {
              const rel = separatorPos(node);
              // DOCUMENT_POSITION_FOLLOWING === 4 → node is after separator
              // eslint-disable-next-line no-bitwise
              isNearby = (rel & 4) === 4;
            }

            const rawText = [
              title,
              priceRaw ? `Price: ${priceRaw}` : null,
              locText ? `Location: ${locText}` : null,
              dateText ? `Posted: ${dateText}` : null,
              isNearby ? 'NEARBY (not local to search city)' : null,
            ]
              .filter(Boolean)
              .join('\n');

            out.push({
              title: title.slice(0, 300),
              price: priceRaw,
              currency,
              url: href,
              location: locText,
              rawText: rawText.slice(0, 2000),
              thumbnailUrl,
              source: 'craigslist',
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

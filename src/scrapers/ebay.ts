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

const SITE_ID = 'ebay';

/**
 * eBay — US-only marketplace. Uses LH_PrefLoc=1 to restrict to US sellers,
 * and _sop=10 for "Best Match" sort with _ipg=60 results per page.
 *
 * Modern eBay SRP card structure (post-redesign):
 *
 *   <li class="s-card s-card--horizontal" data-listingid="366328163791">
 *     <a class="s-card__link" href="https://www.ebay.com/itm/<numeric>?...tracking...">
 *     <div class="s-card__title">Focal Aria 906 Bookshelf Speaker</div>
 *     <div class="s-card__subtitle">Brand New</div>
 *     <div class="s-card__price">$1,029.00</div>
 *     <div class="s-card__caption">...</div>   // shipping / location
 *     <img class="s-card__image" src="...">
 *
 * The FIRST card on many searches is a "Shop on eBay" placeholder with
 * href=/itm/123456 — we filter by requiring a numeric item id of 8+ digits.
 *
 * URL normalization: the href carries tracking params that rotate per
 * session, so we strip the query string for stable dedup (handled
 * generically via the ebay.com entry in utils/hash.ts).
 */

const SORT_BEST_MATCH = 10;
const RESULTS_PER_PAGE = 60;
const LOC_US_ONLY = 1;

export const ebayScraper: Scraper = {
  id: SITE_ID,
  needsHeaded: false,

  /**
   * eBay detail pages contain:
   *   h1.x-item-title__mainTitle / #itemTitle       - title
   *   .x-price-primary / .x-bin-price__content      - current price
   *   .ux-layout-section-evo__item (grid)           - item specifics
   *     (brand, model, type, condition, color, etc.)
   *   #viTabs_0_is .x-item-description or the body  - seller description
   *   .ux-labels-values__labels                     - condition summary
   *
   * We grab the title, price, top item-specifics grid, and a trimmed body
   * innerText fallback. eBay boilerplate (seller info, shipping, returns,
   * related items) is noisy but the LLM can ignore it.
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
      await new Promise((r) => setTimeout(r, 1500));

      const result = await page.evaluate(() => {
        function text(sel: string): string | null {
          const el = document.querySelector(sel);
          return el ? ((el as HTMLElement).innerText || el.textContent || '').trim() : null;
        }

        const title =
          text('h1.x-item-title__mainTitle') ||
          text('h1.it-ttl') ||
          text('#itemTitle') ||
          text('h1') ||
          document.title;

        const price =
          text('.x-price-primary') ||
          text('.x-bin-price__content') ||
          text('[itemprop="price"]') ||
          text('.display-price') ||
          null;

        const condition =
          text('.x-item-condition-text') ||
          text('.ux-labels-values__values [class*="condition"]') ||
          null;

        // Item specifics — grab the labels/values grid
        const specifics: Record<string, string> = {};
        const labelEls = Array.from(
          document.querySelectorAll('.ux-layout-section-evo__item .ux-labels-values__labels, .ux-labels-values__labels'),
        ) as HTMLElement[];
        for (const labelEl of labelEls) {
          const label = (labelEl.innerText || '').trim().replace(/:$/, '');
          const valueEl = labelEl.nextElementSibling as HTMLElement | null;
          const value = valueEl ? (valueEl.innerText || '').trim() : '';
          if (label && value && !specifics[label]) {
            specifics[label] = value.slice(0, 200);
          }
        }

        // Seller description / body text fallback
        const bodyText = (document.body?.innerText || '').trim();

        const extras: Record<string, string> = {};
        if (condition) extras.condition = condition;
        for (const [k, v] of Object.entries(specifics)) extras[k] = v;

        const lines = [
          title ? `Title: ${title}` : null,
          price ? `Price: ${price}` : null,
          condition ? `Condition: ${condition}` : null,
          Object.keys(specifics).length
            ? `Item Specifics:\n${Object.entries(specifics)
                .map(([k, v]) => `  ${k}: ${v}`)
                .join('\n')}`
            : null,
        ].filter(Boolean);

        const header = lines.join('\n\n');
        // Cap body text so the header is always visible
        const remaining = Math.max(0, 8000 - header.length - 20);
        const body = bodyText.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').slice(0, remaining);
        const rawText = header + (body ? `\n\nBody:\n${body}` : '');

        return { title, price, extras, rawText };
      });

      return {
        url,
        rawText: result.rawText,
        title: result.title || undefined,
        price: result.price,
        currency: result.price ? 'USD' : null,
        location: null,
        extras: result.extras,
        fetchedAt: Date.now(),
      };
    } finally {
      await browser.close();
    }
  },

  async scrape(search: ResolvedSearch, config: ScraperConfig): Promise<RawListing[]> {
    const params = new URLSearchParams({
      _nkw: search.query,
      LH_PrefLoc: String(LOC_US_ONLY),
      _ipg: String(RESULTS_PER_PAGE),
      _sop: String(SORT_BEST_MATCH),
    });
    const url = `https://www.ebay.com/sch/i.html?${params.toString()}`;
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

      // Settle time after any JS redirect (eBay sometimes redirects to a
      // "did you mean" variant) and lazy-render.
      await new Promise((r) => setTimeout(r, 1500));

      const listings: RawListing[] = await page.$$eval(
        'li.s-card.s-card--horizontal',
        (cards) => {
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

          for (const card of Array.from(cards) as HTMLElement[]) {
            // Skip the placeholder "Shop on eBay" fallback card (always
            // /itm/123456 — bogus short id).
            const anchor = card.querySelector(
              'a.s-card__link[href*="/itm/"]',
            ) as HTMLAnchorElement | null;
            if (!anchor) continue;
            const href = anchor.href;
            const itmMatch = href.match(/\/itm\/(\d+)/);
            if (!itmMatch || itmMatch[1].length < 8) continue;

            const titleEl = card.querySelector('.s-card__title') as HTMLElement | null;
            let title = (titleEl?.textContent || '').trim();
            // Strip the screen-reader suffix eBay appends to link text.
            title = title.replace(/Opens in a new window or tab\.?$/i, '').trim();
            if (!title) continue;

            const subtitleEl = card.querySelector('.s-card__subtitle') as HTMLElement | null;
            const subtitle = (subtitleEl?.textContent || '').trim() || null;

            const priceEl = card.querySelector('.s-card__price') as HTMLElement | null;
            const priceRaw = (priceEl?.textContent || '').trim() || null;
            const currency = priceRaw ? 'USD' : null;

            const captionEl = card.querySelector('.s-card__caption') as HTMLElement | null;
            const caption = (captionEl?.textContent || '').trim() || null;

            const attrRowEl = card.querySelector('.s-card__attribute-row') as HTMLElement | null;
            const attrRow = (attrRowEl?.textContent || '').trim() || null;

            const imgEl = card.querySelector('img.s-card__image') as HTMLImageElement | null;
            const thumbnailUrl = imgEl?.src || null;

            // data-listingid is the stable item ID
            const listingId = card.getAttribute('data-listingid');

            const rawText = [
              title,
              subtitle ? `Condition: ${subtitle}` : null,
              priceRaw ? `Price: ${priceRaw}` : null,
              caption ? `Caption: ${caption}` : null,
              attrRow ? `Attrs: ${attrRow}` : null,
              listingId ? `Item ID: ${listingId}` : null,
            ]
              .filter(Boolean)
              .join('\n');

            out.push({
              title: title.slice(0, 300),
              price: priceRaw,
              currency,
              url: href,
              // eBay SRP doesn't surface seller location on the card —
              // leave null and let the LLM infer from the raw text if
              // anything relevant is mentioned.
              location: null,
              rawText: rawText.slice(0, 2000),
              thumbnailUrl,
              source: 'ebay',
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

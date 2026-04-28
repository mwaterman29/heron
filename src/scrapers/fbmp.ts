import { logger } from '../utils/logger.js';
import {
  createBrowser,
  filterByAllowedStates,
  genericFetchDetail,
  randomDelay,
  type DetailPage,
  type Scraper,
  type ScraperConfig,
  type RawListing,
} from './base.js';
import type { ResolvedSearch } from '../config.js';

const SITE_ID = 'fbmp';

/**
 * Facebook Marketplace — logged-out, headed puppeteer with stealth.
 *
 * FB's DOM uses obfuscated/dynamic class names that break across deploys,
 * so we avoid CSS class selectors entirely. Instead we exploit the stable
 * `aria-label` attribute on listing links:
 *
 *   <a aria-label="Focal Aria 906, Pair, $1,790, , listing 25666598299709449"
 *      href="/marketplace/item/25666598299709449/?ref=search&...">
 *
 * The aria-label format is:
 *   "{title}, ${price}, {location}, listing {id}"
 *
 * This gives us title, price, location, and a stable listing ID in one shot
 * without touching any CSS class. The href gives us the canonical URL.
 *
 * Headed mode is REQUIRED — FB aggressively fingerprints headless chromium
 * and either serves no results or a CAPTCHA.
 */
export const fbmpScraper: Scraper = {
  id: SITE_ID,
  needsHeaded: true,

  async scrape(search: ResolvedSearch, config: ScraperConfig): Promise<RawListing[]> {
    // FBMP_LOCATION takes priority so users in non-urban areas can set a
    // numeric area ID (e.g. 108472329193294) without affecting Craigslist's
    // city subdomain. Falls back to the global location when unset.
    const fbmpOverride = process.env.FBMP_LOCATION?.trim();
    const location = (fbmpOverride || search.location || 'boston').toLowerCase();
    const url = `https://www.facebook.com/marketplace/${location}/search?query=${encodeURIComponent(search.query)}`;
    logger.info({ site: SITE_ID, searchId: search.id, url }, 'scraping');

    await randomDelay(config.randomDelayRange);

    // Force headed for FBMP regardless of config
    const browser = await createBrowser({ ...config, headless: false });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1400, height: 900 });
      await page.evaluateOnNewDocument(
        'window.__name = window.__name || function(fn){return fn;};',
      );

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 });

      // Wait for React hydration
      await new Promise((r) => setTimeout(r, 3000));

      // Dismiss any login/cookie modal overlay
      try {
        const closeBtn = await page.$('[aria-label="Close"]');
        if (closeBtn) {
          await closeBtn.click();
          await new Promise((r) => setTimeout(r, 500));
        }
      } catch {
        // no modal, fine
      }

      // Scroll to trigger lazy-loading of results
      await page.evaluate(async () => {
        const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
        for (let i = 0; i < 6; i++) {
          window.scrollBy(0, window.innerHeight);
          await wait(800);
        }
        window.scrollTo(0, 0);
      });
      await new Promise((r) => setTimeout(r, 2000));

      const listings: RawListing[] = await page.$$eval(
        'a[aria-label][href*="/marketplace/item/"]',
        (anchors) => {
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

          for (const a of Array.from(anchors) as HTMLAnchorElement[]) {
            const href = a.href;
            if (!href) continue;

            // Extract the listing ID from the href for dedup
            const idMatch = href.match(/\/marketplace\/item\/(\d+)/);
            if (!idMatch) continue;
            const listingId = idMatch[1];
            if (seen.has(listingId)) continue;
            seen.add(listingId);

            const ariaLabel = a.getAttribute('aria-label') || '';
            // Parse: "Title stuff, $1,790, Location, listing 12345"
            // Commas appear INSIDE prices ($1,790) so we can't naively split.
            // Use a regex to extract the price token as a unit first.
            //   Group 1: title (everything before the price)
            //   Group 2: price ($X,XXX or $X,XXX.XX)
            //   Group 3: location (between price and "listing <id>")
            let title = '';
            let price: string | null = null;
            let location: string | null = null;

            const labelMatch = ariaLabel.match(
              /^(.+?),\s*(\$[\d,]+(?:\.\d+)?),?\s*(.*?)(?:,\s*listing\s+\d+)?$/i,
            );

            if (labelMatch) {
              title = labelMatch[1].trim();
              price = labelMatch[2].trim();
              // Location may have trailing commas or empty segments
              location = labelMatch[3]
                .replace(/,\s*$/, '')
                .trim() || null;
            } else {
              title = ariaLabel;
            }

            // Container text as rawText fallback
            let container: HTMLElement | null = a;
            for (let i = 0; i < 8 && container; i++) {
              const txt = (container.innerText || '').trim();
              if (txt.length >= 30) break;
              container = container.parentElement;
            }
            const containerText = container
              ? (container.innerText || '').trim().slice(0, 500)
              : '';

            const rawText = [
              `Title: ${title}`,
              price ? `Price: ${price}` : null,
              location ? `Location: ${location}` : null,
              `Listing ID: ${listingId}`,
              containerText ? `Card text: ${containerText}` : null,
            ]
              .filter(Boolean)
              .join('\n');

            // Thumbnail from an img inside the link
            const img = a.querySelector('img') as HTMLImageElement | null;
            const thumbnailUrl = img?.src || null;

            out.push({
              title: title.slice(0, 300),
              price,
              currency: price ? 'USD' : null,
              url: `https://www.facebook.com/marketplace/item/${listingId}/`,
              location,
              rawText: rawText.slice(0, 2000),
              thumbnailUrl,
              source: 'fbmp',
            });
          }

          return out;
        },
      );

      // Drop listings outside the allowed states before they hit the DB/LLM
      const filtered = filterByAllowedStates(listings, search.reference.allowed_states);
      if (filtered.length < listings.length) {
        logger.info(
          { site: SITE_ID, searchId: search.id, dropped: listings.length - filtered.length },
          'filtered out-of-area listings by allowed_states',
        );
      }

      if (filtered.length === 0) {
        logger.warn(
          { site: SITE_ID, searchId: search.id, url },
          'zero listings after filtering — FB may be blocking or no local results',
        );
      } else {
        logger.info(
          { site: SITE_ID, searchId: search.id, count: filtered.length },
          'extracted listings',
        );
      }

      return filtered;
    } finally {
      await browser.close();
    }
  },

  /**
   * FB detail pages work logged-out but are heavy React apps.
   * genericFetchDetail with networkidle2 + a longer wait captures the
   * body text including seller description, item details, and price.
   */
  async fetchDetail(url: string, config: ScraperConfig): Promise<DetailPage> {
    return genericFetchDetail(url, { ...config, headless: false }, {
      waitUntil: 'networkidle2',
      waitMs: 4000,
    });
  },
};

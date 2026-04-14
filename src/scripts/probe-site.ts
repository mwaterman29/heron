import { writeFileSync, mkdirSync } from 'node:fs';
import { createBrowser, defaultScraperConfig } from '../scrapers/base.js';
import { logger } from '../utils/logger.js';

const URL = process.argv[2];
const NAME = process.argv[3] ?? 'site';

if (!URL) {
  console.error('usage: probe-site.ts <url> [name]');
  process.exit(1);
}

mkdirSync('logs', { recursive: true });
const OUT_HTML = `logs/probe-${NAME}.html`;
const OUT_JSON = `logs/probe-${NAME}.json`;

async function main() {
  const config = defaultScraperConfig();
  if (process.argv.includes('--headed')) config.headless = false;

  logger.info({ url: URL, headless: config.headless }, `probe-${NAME} launching`);

  const browser = await createBrowser(config);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    );
    await page.evaluateOnNewDocument(
      'window.__name = window.__name || function(fn){return fn;};',
    );

    const resp = await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60_000 });
    logger.info({ status: resp?.status(), url: page.url() }, 'navigation complete');
    await new Promise((r) => setTimeout(r, 2500));

    const title = await page.title();
    const finalUrl = page.url();
    logger.info({ title, finalUrl }, 'post-wait state');

    const html = await page.content();
    writeFileSync(OUT_HTML, html, 'utf8');
    logger.info({ file: OUT_HTML, bytes: html.length }, 'html dumped');

    const probe = await page.evaluate(() => {
      function countSel(sel: string): number {
        try {
          return document.querySelectorAll(sel).length;
        } catch {
          return -1;
        }
      }
      const candidates = [
        // Generic patterns
        'li.s-item',
        '.s-item',
        '.srp-results .s-item',
        '[data-testid="listing-card"]',
        '.listing',
        '.listing-card',
        '.result',
        '.search-result',
        '.classified',
        '.ad',
        'article',
        // Audiogon candidates
        '.listing_row',
        '.listing-row',
        '.ad-listing',
        'a[href*="/listings/"]',
        'a[href*="/listing/"]',
        // eBay candidates
        'a[href*="/itm/"]',
        '.s-item__link',
        '.s-item__title',
        '.s-item__price',
        '.s-item__location',
      ];
      const out: Record<string, number> = {};
      for (const c of candidates) out[c] = countSel(c);

      // Href pattern frequency
      const hrefPatterns: Record<string, number> = {};
      const sampleByPattern: Record<string, string[]> = {};
      for (const a of Array.from(document.querySelectorAll('a[href]'))) {
        const h = (a as HTMLAnchorElement).getAttribute('href') ?? '';
        const m = h.match(/^https?:\/\/[^/]+(\/[a-z_-]+\/)/i) || h.match(/^(\/[a-z_-]+\/)/i);
        const key = m ? m[1] : '_other';
        hrefPatterns[key] = (hrefPatterns[key] ?? 0) + 1;
        if (!sampleByPattern[key]) sampleByPattern[key] = [];
        if (sampleByPattern[key].length < 2) sampleByPattern[key].push(h);
      }
      const topPatterns = Object.entries(hrefPatterns)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15);

      // Class frequency for listing-like things
      const classFreq: Record<string, number> = {};
      for (const el of Array.from(document.querySelectorAll('*[class]')) as HTMLElement[]) {
        for (const cls of el.classList) {
          if (/(listing|result|item|classified|ad[-_]|card|gallery)/i.test(cls)) {
            classFreq[cls] = (classFreq[cls] ?? 0) + 1;
          }
        }
      }
      const topClasses = Object.entries(classFreq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20);

      const bodyLen = document.body?.innerText?.length ?? 0;
      const bodyHead = (document.body?.innerText ?? '').slice(0, 400);

      return {
        url: location.href,
        candidates: out,
        topPatterns,
        sampleByPattern,
        topClasses,
        bodyLen,
        bodyHead,
      };
    });

    writeFileSync(OUT_JSON, JSON.stringify(probe, null, 2), 'utf8');
    console.log(JSON.stringify(probe, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  logger.error({ err }, 'probe failed');
  process.exit(1);
});

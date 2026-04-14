import { writeFileSync, mkdirSync } from 'node:fs';
import { createBrowser, defaultScraperConfig } from '../scrapers/base.js';
import { logger } from '../utils/logger.js';

const URL =
  process.argv[2] ??
  'https://boston.craigslist.org/search/sss?query=focal+aria+906&sort=date';
mkdirSync('logs', { recursive: true });
const OUT_HTML = 'logs/probe-craigslist.html';
const OUT_JSON = 'logs/probe-craigslist.json';

async function main() {
  const config = defaultScraperConfig();
  if (process.argv.includes('--headed')) config.headless = false;

  logger.info({ url: URL, headless: config.headless }, 'probe-craigslist launching');

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

    // Craigslist's modern search is client-rendered. Give the JS a moment to
    // populate the results before sampling.
    await new Promise((r) => setTimeout(r, 3000));

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
        // Old CL
        'li.result-row',
        '.result-info',
        '.result-title',
        '.result-price',
        // New CL (gallery/list)
        '.cl-search-result',
        '.cl-static-search-result',
        '.result-node',
        '.gallery-card',
        'li.cl-static-search-result',
        '.cl-app-anchor',
        // Anchor-based
        'a[href*=".craigslist.org"]',
        'a[href*="/sss/"]',
        'a[href*="/cto/"]',
      ];
      const out: Record<string, number> = {};
      for (const c of candidates) out[c] = countSel(c);

      // Look for any anchor whose text includes "focal" or "aria"
      const focalAnchors = Array.from(document.querySelectorAll('a'))
        .filter((a) => /focal|aria/i.test(a.textContent ?? ''))
        .slice(0, 10)
        .map((a) => ({
          href: (a as HTMLAnchorElement).href,
          text: (a.textContent ?? '').trim().slice(0, 120),
          outerClass: (a.closest('[class]') as HTMLElement | null)?.className ?? null,
        }));

      // What children does the search results root have?
      const rootCandidates = [
        '.cl-results-page',
        '.cl-search-results',
        '#search-results',
        'main',
        '[data-clpvid]',
      ];
      const rootInfo: Record<string, { exists: boolean; childTags?: string[]; childClasses?: string[] }> = {};
      for (const sel of rootCandidates) {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (el) {
          rootInfo[sel] = {
            exists: true,
            childTags: Array.from(el.children).slice(0, 5).map((c) => c.tagName.toLowerCase()),
            childClasses: Array.from(el.children).slice(0, 5).map((c) => (c as HTMLElement).className),
          };
        } else {
          rootInfo[sel] = { exists: false };
        }
      }

      // Top-level class frequency for anything that looks like a result
      const allEls = Array.from(document.querySelectorAll('*[class]')) as HTMLElement[];
      const classFreq: Record<string, number> = {};
      for (const el of allEls) {
        for (const cls of el.classList) {
          if (/result|listing|card|gallery|search/i.test(cls)) {
            classFreq[cls] = (classFreq[cls] ?? 0) + 1;
          }
        }
      }
      const topClasses = Object.entries(classFreq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15);

      const bodyLen = document.body?.innerText?.length ?? 0;
      const bodyHead = (document.body?.innerText ?? '').slice(0, 600);

      return {
        url: location.href,
        candidates: out,
        focalAnchors,
        rootInfo,
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

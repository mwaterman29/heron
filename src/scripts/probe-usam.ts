import { writeFileSync, mkdirSync } from 'node:fs';
import { createBrowser, defaultScraperConfig } from '../scrapers/base.js';
import { logger } from '../utils/logger.js';

mkdirSync('logs', { recursive: true });
const OUT_HTML = 'logs/probe-usam.html';
const OUT_JSON = 'logs/probe-usam.json';

async function main() {
  const config = defaultScraperConfig();
  if (process.argv.includes('--headless')) config.headless = true;

  logger.info({ headless: config.headless }, 'probe-usam launching');

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

    // Step 1: hit the homepage and inspect the search form
    const homeResp = await page.goto('https://www.usaudiomart.com/', {
      waitUntil: 'networkidle2',
      timeout: 60_000,
    });
    logger.info({ status: homeResp?.status(), url: page.url() }, 'homepage loaded');

    const formInfo = await page.evaluate(() => {
      const forms = Array.from(document.forms).map((f) => ({
        id: f.id || null,
        name: f.name || null,
        action: f.action || null,
        method: f.method || null,
        inputs: Array.from(f.elements).map((el) => ({
          tag: el.tagName.toLowerCase(),
          name: (el as HTMLInputElement).name || null,
          type: (el as HTMLInputElement).type || null,
          id: el.id || null,
          placeholder: (el as HTMLInputElement).placeholder || null,
        })),
      }));
      // Also look for any link containing "search" in href
      const searchLinks = Array.from(document.querySelectorAll('a[href*="search" i]'))
        .map((a) => (a as HTMLAnchorElement).href)
        .slice(0, 10);
      return { forms, searchLinks };
    });
    console.log('=== HOMEPAGE FORMS ===');
    console.log(JSON.stringify(formInfo, null, 2));

    // Step 2: try submitting the search via the form, if there is one with a text input
    const searchForm = formInfo.forms.find((f) =>
      f.inputs.some((i) => i.type === 'text' || i.type === 'search'),
    );
    if (searchForm) {
      logger.info({ action: searchForm.action }, 'found search form, submitting');
      const textInput = searchForm.inputs.find((i) => i.type === 'text' || i.type === 'search');
      if (textInput?.name) {
        await page.evaluate(
          (selector, query) => {
            const el = document.querySelector(selector) as HTMLInputElement | null;
            if (el) el.value = query;
          },
          `input[name="${textInput.name}"]`,
          'focal aria 906',
        );
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60_000 }),
          page.evaluate((selector) => {
            const input = document.querySelector(selector) as HTMLInputElement | null;
            const form = input?.form;
            form?.submit();
          }, `input[name="${textInput.name}"]`),
        ]);
        logger.info({ url: page.url() }, 'search navigated');
      }
    }

    // Step 3: whatever URL we landed on, dump it
    const title = await page.title();
    const finalUrl = page.url();
    logger.info({ title, finalUrl }, 'final state');

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
        'a[href*="/item/"]',
        'a[href*="/classifieds/"]',
        'a[href*="/ad/"]',
        'a[href*="/for-sale/"]',
        'a[href*="/advert"]',
        'a[href*="/buy/"]',
        '.listing',
        '.result',
        '.search-result',
        '.classified',
        'tr.listing_row',
        '.list-item',
        '[class*="listing"]',
        '[class*="result"]',
        '[class*="advert"]',
      ];
      const out: Record<string, number> = {};
      for (const c of candidates) out[c] = countSel(c);

      // All anchors, sampled by href pattern frequency
      const hrefPatterns: Record<string, number> = {};
      const sampleByPattern: Record<string, string[]> = {};
      for (const a of Array.from(document.querySelectorAll('a[href]'))) {
        const h = (a as HTMLAnchorElement).getAttribute('href') ?? '';
        const m = h.match(/^\/?([a-z_-]+)\//i);
        const key = m ? m[1] : '_other';
        hrefPatterns[key] = (hrefPatterns[key] ?? 0) + 1;
        if (!sampleByPattern[key]) sampleByPattern[key] = [];
        if (sampleByPattern[key].length < 3) sampleByPattern[key].push(h);
      }

      const bodyLen = document.body?.innerText?.length ?? 0;
      const bodyHead = (document.body?.innerText ?? '').slice(0, 400);
      return { url: location.href, candidates: out, hrefPatterns, sampleByPattern, bodyLen, bodyHead };
    });

    writeFileSync(OUT_JSON, JSON.stringify(probe, null, 2), 'utf8');
    console.log('=== SEARCH RESULTS PROBE ===');
    console.log(JSON.stringify(probe, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  logger.error({ err }, 'probe failed');
  process.exit(1);
});

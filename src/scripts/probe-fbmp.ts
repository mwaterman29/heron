import { writeFileSync, mkdirSync } from 'node:fs';
import { createBrowser, defaultScraperConfig } from '../scrapers/base.js';
import { logger } from '../utils/logger.js';

const QUERY = process.argv[2] ?? 'focal aria 906';
const LOCATION = process.argv[3] ?? 'boston';
const URL = `https://www.facebook.com/marketplace/${LOCATION}/search?query=${encodeURIComponent(QUERY)}`;

async function main() {
  const config = defaultScraperConfig();
  config.headless = false; // FB blocks headless aggressively

  logger.info({ url: URL }, 'probe-fbmp launching (headed)');

  const browser = await createBrowser(config);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    await page.evaluateOnNewDocument(
      'window.__name = window.__name || function(fn){return fn;};',
    );

    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60_000 });

    // Wait for content to hydrate + scroll to trigger lazy-loading
    logger.info('waiting for React hydration + scrolling...');
    await new Promise((r) => setTimeout(r, 3000));

    await page.evaluate(async () => {
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < 6; i++) {
        window.scrollBy(0, window.innerHeight);
        await wait(800);
      }
      window.scrollTo(0, 0);
    });

    // Extra settle time after scrolling
    await new Promise((r) => setTimeout(r, 2000));

    const probe = await page.evaluate(() => {
      // Look for marketplace item links — the most stable FB selector
      const itemLinks = Array.from(document.querySelectorAll('a[href*="/marketplace/item/"]'));
      const itemSamples = itemLinks.slice(0, 10).map((a) => {
        const el = a as HTMLAnchorElement;
        // Walk up to find a meaningful container
        let container: HTMLElement | null = el;
        for (let i = 0; i < 8 && container; i++) {
          const txt = (container.innerText || '').trim();
          if (txt.length >= 30) break;
          container = container.parentElement;
        }
        return {
          href: el.href,
          linkText: (el.innerText || '').trim().slice(0, 100),
          containerText: container ? (container.innerText || '').trim().slice(0, 300) : null,
          containerTag: container?.tagName ?? null,
          containerRole: container?.getAttribute('role') ?? null,
          containerAriaLabel: container?.getAttribute('aria-label') ?? null,
        };
      });

      // Check for login wall / interstitial
      const hasLoginPrompt = !!document.querySelector('[data-testid="royal_login_button"], [data-testid="login_button"]');
      const hasCloseButton = !!document.querySelector('[aria-label="Close"], [aria-label="close"]');

      // data-testid attributes present
      const testIds = new Set<string>();
      document.querySelectorAll('[data-testid]').forEach((el) => {
        testIds.add(el.getAttribute('data-testid') || '');
      });

      // aria-label on links
      const ariaLinks = Array.from(document.querySelectorAll('a[aria-label]'))
        .slice(0, 15)
        .map((a) => ({
          label: a.getAttribute('aria-label')?.slice(0, 100),
          href: (a as HTMLAnchorElement).href?.slice(0, 80),
        }));

      const bodyLen = document.body?.innerText?.length ?? 0;
      const bodyHead = (document.body?.innerText ?? '').slice(0, 500);

      return {
        itemLinkCount: itemLinks.length,
        itemSamples,
        hasLoginPrompt,
        hasCloseButton,
        testIds: Array.from(testIds).slice(0, 30),
        ariaLinks,
        bodyLen,
        bodyHead,
      };
    });

    mkdirSync('logs', { recursive: true });
    writeFileSync('logs/probe-fbmp.json', JSON.stringify(probe, null, 2), 'utf8');
    console.log(JSON.stringify(probe, null, 2));

    const html = await page.content();
    writeFileSync('logs/probe-fbmp.html', html, 'utf8');
    logger.info({ htmlBytes: html.length }, 'html dumped');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  logger.error({ err }, 'probe-fbmp failed');
  process.exit(1);
});

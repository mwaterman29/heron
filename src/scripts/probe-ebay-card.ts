import { createBrowser, defaultScraperConfig } from '../scrapers/base.js';
import { logger } from '../utils/logger.js';

const URL =
  'https://www.ebay.com/sch/i.html?_nkw=focal+aria+906&LH_PrefLoc=1&_ipg=60&_sop=10';

async function main() {
  const config = defaultScraperConfig();
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
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60_000 });

    const card = await page.evaluate(() => {
      // Skip the "Shop on eBay" placeholder card (always first, with /itm/123456 href)
      const all = Array.from(document.querySelectorAll('.s-card.s-card--horizontal')) as HTMLElement[];
      const el = all.find((c) => {
        const a = c.querySelector('a[href*="/itm/"]') as HTMLAnchorElement | null;
        return a && /\/itm\/\d{8,}/.test(a.href);
      }) as HTMLElement | undefined;
      if (!el) return { found: false, total: all.length };
      // Dump a trimmed outerHTML and the key fields we can extract via selectors
      const outer = el.outerHTML.slice(0, 2500);

      const pick = (sel: string) => {
        const e = el.querySelector(sel);
        return e ? (e.textContent || '').trim().slice(0, 200) : null;
      };
      const pickHref = (sel: string) => {
        const e = el.querySelector(sel) as HTMLAnchorElement | null;
        return e?.href ?? null;
      };
      return {
        found: true,
        outerLen: outer.length,
        outer,
        title: pick('.s-card__title'),
        subtitle: pick('.s-card__subtitle'),
        price: pick('.s-card__price'),
        caption: pick('.s-card__caption'),
        attributeRow: pick('.s-card__attribute-row'),
        shipping: pick('.s-card__footer'),
        // eBay puts the primary attributes list (location + shipping) here
        attrs: Array.from(el.querySelectorAll('.su-card-container__attributes li, .s-card__subtitle-row, .s-card__caption')).map(
          (n) => (n.textContent || '').trim(),
        ),
        href: pickHref('a[href*="/itm/"]'),
        img: (el.querySelector('img') as HTMLImageElement | null)?.src ?? null,
      };
    });

    console.log(JSON.stringify(card, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  logger.error({ err }, 'probe-ebay-card failed');
  process.exit(1);
});

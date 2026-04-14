import { createBrowser, defaultScraperConfig } from '../scrapers/base.js';

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

    await page.goto('https://www.audiogon.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });

    const info = await page.evaluate(() => {
      const forms = Array.from(document.forms).map((f) => ({
        id: f.id || null,
        name: f.name || null,
        action: f.action || null,
        method: f.method || null,
        inputs: Array.from(f.elements).map((el) => ({
          tag: el.tagName.toLowerCase(),
          name: (el as HTMLInputElement).name || null,
          type: (el as HTMLInputElement).type || null,
          placeholder: (el as HTMLInputElement).placeholder || null,
        })),
      }));
      // Any input whose name or placeholder mentions search
      const searchInputs = Array.from(document.querySelectorAll('input')).filter((i) => {
        const n = (i.name || '').toLowerCase();
        const p = (i.placeholder || '').toLowerCase();
        return n.includes('search') || p.includes('search') || n.includes('query') || n.includes('kw');
      }).map((i) => ({ name: i.name, placeholder: i.placeholder, form: i.form?.action || null }));
      return { forms: forms.slice(0, 5), searchInputs };
    });
    console.log(JSON.stringify(info, null, 2));

    // Try submitting via the most likely search input
    const targetInput = await page.evaluateHandle(() => {
      return document.querySelector(
        'input[name="search"], input[name="kw"], input[name="q"], input[placeholder*="earch" i]',
      );
    });
    const hasTarget = await page.evaluate((h) => !!h, targetInput);
    if (hasTarget) {
      await page.evaluate((sel, q) => {
        const inp = document.querySelector(sel) as HTMLInputElement | null;
        if (inp) {
          inp.value = q;
          const form = inp.form;
          if (form) form.submit();
        }
      }, 'input[name="search"], input[name="kw"], input[name="q"], input[placeholder*="earch" i]', 'focal aria 906');

      try {
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30_000 });
      } catch {
        // ignore
      }
      console.log('post-submit URL:', page.url());
    }
  } finally {
    await browser.close();
  }
}

main();

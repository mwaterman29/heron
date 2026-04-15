import { getScraper, listRegisteredSites } from '../scrapers/index.js';
import { defaultScraperConfig } from '../scrapers/base.js';
import { logger } from '../utils/logger.js';

const site = process.argv[2];
const url = process.argv[3];

if (!site || !url) {
  console.error('usage: test-detail.ts <site> <url>');
  console.error('registered sites:', listRegisteredSites().join(', '));
  process.exit(1);
}

const scraper = getScraper(site);
if (!scraper) {
  console.error(`no scraper registered for site '${site}'`);
  console.error('registered:', listRegisteredSites().join(', '));
  process.exit(1);
}
if (!scraper.fetchDetail) {
  console.error(`scraper '${site}' does not implement fetchDetail`);
  process.exit(1);
}

async function main() {
  const config = defaultScraperConfig();
  logger.info({ site, url }, 'fetching detail');
  const t0 = Date.now();
  const detail = await scraper!.fetchDetail!(url, config);
  const ms = Date.now() - t0;
  logger.info({ site, ms }, 'detail fetched');

  console.log('───── DetailPage ─────');
  console.log('url:       ', detail.url);
  console.log('title:     ', detail.title);
  console.log('price:     ', detail.price);
  console.log('currency:  ', detail.currency);
  console.log('location:  ', detail.location);
  console.log('fetchedAt: ', new Date(detail.fetchedAt).toISOString());
  if (detail.extras && Object.keys(detail.extras).length) {
    console.log('extras:');
    for (const [k, v] of Object.entries(detail.extras)) {
      console.log(`  ${k}: ${v}`);
    }
  }
  console.log('rawText length:', detail.rawText.length);
  console.log('───── rawText (first 1200 chars) ─────');
  console.log(detail.rawText.slice(0, 1200));
  console.log('──────────────────────');
}

main().catch((err) => {
  logger.error({ err }, 'test-detail failed');
  process.exit(1);
});

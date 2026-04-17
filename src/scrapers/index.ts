import type { Scraper } from './base.js';
import { audiogonScraper } from './audiogon.js';
import { avexchangeScraper } from './avexchange.js';
import { craigslistScraper } from './craigslist.js';
import { ebayScraper } from './ebay.js';
import { fbmpScraper } from './fbmp.js';
import { hifisharkScraper } from './hifishark.js';
import { mechmarketScraper } from './mechmarket.js';
import { usaudiomartScraper } from './usaudiomart.js';

const registry = new Map<string, Scraper>();
registry.set(hifisharkScraper.id, hifisharkScraper);
registry.set(usaudiomartScraper.id, usaudiomartScraper);
registry.set(craigslistScraper.id, craigslistScraper);
registry.set(audiogonScraper.id, audiogonScraper);
registry.set(ebayScraper.id, ebayScraper);
registry.set(fbmpScraper.id, fbmpScraper);
registry.set(mechmarketScraper.id, mechmarketScraper);
registry.set(avexchangeScraper.id, avexchangeScraper);

export function getScraper(siteId: string): Scraper | undefined {
  return registry.get(siteId);
}

export function listRegisteredSites(): string[] {
  return [...registry.keys()];
}

import type { Scraper } from './base.js';
import { audiogonScraper } from './audiogon.js';
import { craigslistScraper } from './craigslist.js';
import { ebayScraper } from './ebay.js';
import { hifisharkScraper } from './hifishark.js';
import { usaudiomartScraper } from './usaudiomart.js';

const registry = new Map<string, Scraper>();
registry.set(hifisharkScraper.id, hifisharkScraper);
registry.set(usaudiomartScraper.id, usaudiomartScraper);
registry.set(craigslistScraper.id, craigslistScraper);
registry.set(audiogonScraper.id, audiogonScraper);
registry.set(ebayScraper.id, ebayScraper);

export function getScraper(siteId: string): Scraper | undefined {
  return registry.get(siteId);
}

export function listRegisteredSites(): string[] {
  return [...registry.keys()];
}

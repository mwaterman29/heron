import type { Scraper } from './base.js';
import { hifisharkScraper } from './hifishark.js';

const registry = new Map<string, Scraper>();
registry.set(hifisharkScraper.id, hifisharkScraper);

export function getScraper(siteId: string): Scraper | undefined {
  return registry.get(siteId);
}

export function listRegisteredSites(): string[] {
  return [...registry.keys()];
}

import * as puppeteerExtraNs from 'puppeteer-extra';
import StealthPluginNs from 'puppeteer-extra-plugin-stealth';
import type { Browser } from 'puppeteer';

// puppeteer-extra's CJS bundle attaches both default export and all named
// exports to module.exports. Under NodeNext TS types it as the namespace,
// so we unwrap to the real puppeteer-extra instance that has .use() / .launch().
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const puppeteer: any = (puppeteerExtraNs as any).default ?? puppeteerExtraNs;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const StealthPlugin: any = (StealthPluginNs as any).default ?? StealthPluginNs;
import type { RawListing } from '../db.js';
import type { ResolvedSearch } from '../config.js';

puppeteer.use(StealthPlugin());

export type { RawListing };

export interface ScraperConfig {
  headless: boolean;
  randomDelayRange: [number, number];
  timeout: number;
  userAgent?: string;
}

export interface Scraper {
  id: string;
  /** If true, this scraper requires a visible browser window. */
  needsHeaded?: boolean;
  scrape(search: ResolvedSearch, config: ScraperConfig): Promise<RawListing[]>;
}

export async function createBrowser(config: ScraperConfig): Promise<Browser> {
  return puppeteer.launch({
    headless: config.headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
  }) as unknown as Promise<Browser>;
}

export function randomDelay(range: [number, number]): Promise<void> {
  const ms = Math.floor(Math.random() * (range[1] - range[0])) + range[0];
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function defaultScraperConfig(): ScraperConfig {
  return {
    headless: (process.env.HEADLESS ?? 'true') !== 'false',
    randomDelayRange: [
      Number(process.env.SCRAPE_DELAY_MIN ?? 2000),
      Number(process.env.SCRAPE_DELAY_MAX ?? 5000),
    ],
    timeout: 30_000,
  };
}

export class UnsupportedScraperError extends Error {
  constructor(siteId: string) {
    super(`No scraper registered for site '${siteId}'`);
    this.name = 'UnsupportedScraperError';
  }
}

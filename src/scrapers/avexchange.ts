import { logger } from '../utils/logger.js';
import { randomDelay, type DetailPage, type Scraper, type ScraperConfig, type RawListing } from './base.js';
import type { ResolvedSearch } from '../config.js';

const SITE_ID = 'avexchange';
const USER_AGENT = 'deal-hunter/0.1 (marketplace deal finder)';

/**
 * r/AVexchange scraper — Reddit JSON API, same pattern as r/mechmarket.
 *
 * r/AVexchange is the primary marketplace for IEMs, headphones, DACs,
 * amps, and portable audio gear on Reddit. Post title format:
 *   [WTS] [US-MA] Empire Ears Raven — $2200 shipped
 *   [WTS] [US-CA] Elysian Annihilator 2023 — $1800
 *
 * Tags: [WTS] = want to sell, [WTB] = want to buy, [WTT] = want to trade
 * We only care about [WTS] posts.
 */

interface RedditChild {
  data: {
    id: string;
    title: string;
    selftext: string;
    url: string;
    permalink: string;
    created_utc: number;
    author: string;
    link_flair_text: string | null;
    thumbnail: string | null;
  };
}

interface RedditSearchResponse {
  data: {
    children: RedditChild[];
  };
}

async function redditFetch<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) {
    throw new Error(`Reddit API ${res.status}: ${await res.text().catch(() => '').then((t) => t.slice(0, 300))}`);
  }
  return (await res.json()) as T;
}

export const avexchangeScraper: Scraper = {
  id: SITE_ID,
  needsHeaded: false,

  async scrape(search: ResolvedSearch, config: ScraperConfig): Promise<RawListing[]> {
    const params = new URLSearchParams({
      q: search.query,
      sort: 'new',
      restrict_sr: 'on',
      t: 'month',
      limit: '100',
    });
    const url = `https://www.reddit.com/r/AVexchange/search.json?${params.toString()}`;
    logger.info({ site: SITE_ID, searchId: search.id, url }, 'scraping');

    await randomDelay(config.randomDelayRange);

    const data = await redditFetch<RedditSearchResponse>(url);
    const listings: RawListing[] = [];

    for (const child of data.data.children) {
      const post = child.data;

      // Only care about [WTS] (want to sell) posts.
      if (!/\[WTS\]/i.test(post.title)) continue;

      // Skip closed/sold posts
      const flair = (post.link_flair_text ?? '').toLowerCase();
      if (flair === 'sold' || flair === 'closed' || flair === 'traded') continue;

      // Parse location from title: [US-MA], [CA-ON], etc.
      const locMatch = post.title.match(/\[([A-Z]{2}(?:-[A-Z]{2,3})?)\]/g);
      // Find the location tag (not [WTS]/[WTB]/[WTT])
      const locationTag = locMatch?.find((t) => !/^\[(WTS|WTB|WTT)\]$/i.test(t));
      const location = locationTag ? locationTag.replace(/[[\]]/g, '') : null;

      // Extract price from title first (AVexchange often has price in title),
      // then fall back to selftext
      const titlePriceMatch = post.title.match(/\$\s?([\d,]+(?:\.\d+)?)/);
      const bodyPriceMatch = post.selftext.match(/\$\s?([\d,]+(?:\.\d+)?)/);
      const priceMatch = titlePriceMatch ?? bodyPriceMatch;
      const price = priceMatch ? `$${priceMatch[1]}` : null;

      const rawText = [
        `Title: ${post.title}`,
        location ? `Location: ${location}` : null,
        `Author: u/${post.author}`,
        `Posted: ${new Date(post.created_utc * 1000).toISOString().split('T')[0]}`,
        flair ? `Flair: ${flair}` : null,
        price ? `Price detected: ${price}` : null,
        `\nBody:\n${post.selftext.slice(0, 2000)}`,
      ]
        .filter(Boolean)
        .join('\n');

      const permalink = `https://www.reddit.com${post.permalink}`;

      listings.push({
        title: post.title.slice(0, 300),
        price,
        currency: price ? 'USD' : null,
        url: permalink,
        location,
        rawText: rawText.slice(0, 3000),
        thumbnailUrl: post.thumbnail && post.thumbnail.startsWith('http') ? post.thumbnail : null,
        source: SITE_ID,
      });
    }

    if (listings.length === 0) {
      logger.warn(
        { site: SITE_ID, searchId: search.id },
        'zero listings from r/AVexchange',
      );
    } else {
      logger.info(
        { site: SITE_ID, searchId: search.id, count: listings.length },
        'extracted listings',
      );
    }

    return listings;
  },

  async fetchDetail(url: string, _config: ScraperConfig): Promise<DetailPage> {
    const jsonUrl = url.replace(/\/?$/, '.json');
    const data = await redditFetch<Array<{ data: { children: RedditChild[] } }>>(jsonUrl);
    const post = data?.[0]?.data?.children?.[0]?.data;
    if (!post) {
      return { url, rawText: '(could not load post)', fetchedAt: Date.now() };
    }

    const rawText = [
      `Title: ${post.title}`,
      `Author: u/${post.author}`,
      `Posted: ${new Date(post.created_utc * 1000).toISOString().split('T')[0]}`,
      post.link_flair_text ? `Flair: ${post.link_flair_text}` : null,
      `\n${post.selftext}`,
    ]
      .filter(Boolean)
      .join('\n')
      .slice(0, 8000);

    const priceMatch = post.selftext.match(/\$\s?([\d,]+(?:\.\d+)?)/);

    return {
      url,
      rawText,
      title: post.title,
      price: priceMatch ? `$${priceMatch[1]}` : null,
      currency: priceMatch ? 'USD' : null,
      fetchedAt: Date.now(),
    };
  },
};

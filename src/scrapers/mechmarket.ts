import { logger } from '../utils/logger.js';
import { randomDelay, type DetailPage, type Scraper, type ScraperConfig, type RawListing } from './base.js';
import type { ResolvedSearch } from '../config.js';

const SITE_ID = 'mechmarket';
const USER_AGENT = 'deal-hunter/0.1 (marketplace deal finder)';

/**
 * r/mechmarket scraper — uses Reddit's public JSON API, no Puppeteer needed.
 *
 * Search endpoint:
 *   GET https://www.reddit.com/r/mechmarket/search.json
 *     ?q=<query>&sort=new&restrict_sr=on&t=month&limit=100
 *
 * Returns: { data: { children: [{ data: { title, selftext, url, ... } }] } }
 *
 * Post title format:
 *   [US-MA] [H] Drop Holy Panda x70 [W] PayPal
 *   [US-CA] [H] Switches, keycaps [W] PayPal, trades
 *
 *  [H] = Have (selling), [W] = Want (payment).
 *  We only care about [H] posts (sellers) for our pipeline.
 *
 * Detail endpoint (fetchDetail):
 *   GET https://www.reddit.com/comments/<id>.json
 *   Returns the full post + comments. We only need the post body (selftext).
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

export const mechmarketScraper: Scraper = {
  id: SITE_ID,
  needsHeaded: false,

  async scrape(search: ResolvedSearch, config: ScraperConfig): Promise<RawListing[]> {
    const params = new URLSearchParams({
      q: search.query,
      sort: 'new',
      restrict_sr: 'on',
      t: 'month', // last 30 days
      limit: '100',
    });
    const url = `https://www.reddit.com/r/mechmarket/search.json?${params.toString()}`;
    logger.info({ site: SITE_ID, searchId: search.id, url }, 'scraping');

    await randomDelay(config.randomDelayRange);

    const data = await redditFetch<RedditSearchResponse>(url);
    const listings: RawListing[] = [];

    for (const child of data.data.children) {
      const post = child.data;

      // Only care about [H] (have/selling) posts. Skip [W]-only (buying) posts.
      if (!/\[H\]/i.test(post.title)) continue;

      // Skip closed/sold posts
      const flair = (post.link_flair_text ?? '').toLowerCase();
      if (flair === 'sold' || flair === 'closed' || flair === 'traded') continue;

      // Parse location from title: [US-MA], [CA-ON], [EU-DE], etc.
      const locMatch = post.title.match(/^\[([A-Z]{2}(?:-[A-Z]{2})?)\]/);
      const location = locMatch ? locMatch[1] : null;

      // Extract price heuristic from selftext (first $X or $XX pattern)
      const priceMatch = post.selftext.match(/\$\s?([\d,]+(?:\.\d+)?)/);
      const price = priceMatch ? `$${priceMatch[1]}` : null;

      // Build rawText from title + first ~2000 chars of selftext
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
        'zero listings extracted from r/mechmarket',
      );
    } else {
      logger.info(
        { site: SITE_ID, searchId: search.id, count: listings.length },
        'extracted listings',
      );
    }

    return listings;
  },

  /**
   * Fetch the full Reddit post JSON for a single listing. Returns the
   * selftext (full post body) which typically has prices, timestamps,
   * photos, and item descriptions that the SRP card-level scrape
   * captured only partially.
   */
  async fetchDetail(url: string, _config: ScraperConfig): Promise<DetailPage> {
    // Reddit post URLs look like:
    //   https://www.reddit.com/r/mechmarket/comments/<id>/<slug>/
    // The JSON endpoint is just appending .json to the URL.
    const jsonUrl = url.replace(/\/?$/, '.json');
    const data = await redditFetch<Array<{ data: { children: RedditChild[] } }>>(jsonUrl);
    const post = data?.[0]?.data?.children?.[0]?.data;
    if (!post) {
      return {
        url,
        rawText: '(could not load post)',
        fetchedAt: Date.now(),
      };
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

    // Extract price from body
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

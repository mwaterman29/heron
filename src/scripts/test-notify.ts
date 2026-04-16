import 'dotenv/config';
import { pickNotifier, type DealPayload } from '../notifier.js';
import type { SeenItemRow, Verdict } from '../db.js';
import type { PriceReference } from '../config.js';
import { logger } from '../utils/logger.js';

const notifier = pickNotifier(false);

const fakePayload: DealPayload = {
  listing: {
    id: 'test-123',
    site: 'craigslist',
    search_id: 'w211-e500-cl',
    title: '2005 Mercedes-Benz E-class E500 Luxury Sedan',
    price: 4299,
    currency: 'USD',
    price_usd: 4299,
    url: 'https://westernmass.craigslist.org/ctd/d/west-springfield-2005-mercedes-benz/7927093908.html',
    location: 'West Springfield, MA',
    raw_text: null,
    first_seen_at: Date.now(),
    last_seen_at: Date.now(),
    times_seen: 1,
    evaluated: 1,
    is_deal: 1,
    deal_tier: 'deal',
    llm_reasoning: null,
    pass1_tier: 'deal',
    pass1_reasoning: null,
    detail_fetched: 1,
    notified: 0,
    created_at: Date.now(),
  },
  verdict: {
    relevant: true,
    deal_tier: 'deal',
    confidence: 0.85,
    extracted_price: 4299,
    reasoning:
      'Pass-2 confirmed: 2005 E500 at $4,299 in West Springfield MA. Black exterior, RWD, 98k miles, clean title, SBC recently serviced. All buyer preferences met.',
    red_flags: [],
    positive_signals: ['Black exterior', 'RWD', 'SBC serviced', 'Under 120k miles', 'Clean title'],
    grail_match: false,
  },
  reference: {
    id: 'w211-e500',
    name: '2003-2006 Mercedes-Benz E500 (W211)',
    type: 'vehicle',
  },
};

async function main() {
  logger.info('sending test notification via: ' + notifier.constructor.name);
  await notifier.notify(fakePayload);
  logger.info('test notification sent');
}

main().catch((err) => {
  logger.error({ err }, 'test-notify failed');
  process.exit(1);
});

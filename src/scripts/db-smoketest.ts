import { upsertListing, getSeenItem, parsePrice } from '../db.js';
import { listingId } from '../utils/hash.js';

const fake = {
  source: 'hifishark',
  title: 'Test Focal Aria 906 pair',
  price: '$499',
  currency: 'USD',
  url: 'https://www.hifishark.com/listing/fake-smoketest-1',
  location: 'Testville',
  rawText: 'Nice pair of Focal Aria 906 speakers, mint condition.',
  thumbnailUrl: null,
};

const r1 = upsertListing('focal-aria-906-hifishark', fake);
console.log('first insert:', r1.status, r1.row.times_seen);

const r2 = upsertListing('focal-aria-906-hifishark', { ...fake, price: '$449' });
console.log('second insert:', r2.status, r2.row.times_seen, 'priceChanged:', (r2 as any).priceChanged, 'dropPct:', (r2 as any).priceDropPct);

const id = listingId(fake.source, fake.url);
const row = getSeenItem(id);
console.log('final row price:', row?.price, 'times_seen:', row?.times_seen);
console.log('parsePrice("$1,299.99"):', parsePrice('$1,299.99'));

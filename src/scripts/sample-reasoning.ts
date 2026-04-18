import { getDb } from '../db.js';
const db = getDb();

const searchId = process.argv[2] ?? 'focal-aria-906-hifishark';

const tiers = db
  .prepare(
    'SELECT deal_tier, COUNT(*) as c FROM seen_items WHERE search_id = ? GROUP BY deal_tier',
  )
  .all(searchId);
console.log('TIER DISTRIBUTION:', tiers);
console.log();

interface Row {
  title: string | null;
  price: number | null;
  deal_tier: string | null;
  llm_reasoning: string | null;
  url: string;
}

const rows = db
  .prepare(
    `SELECT title, price, deal_tier, llm_reasoning, url
     FROM seen_items
     WHERE search_id = ? AND evaluated = 1
     ORDER BY
       CASE deal_tier
         WHEN 'steal' THEN 0
         WHEN 'deal' THEN 1
         WHEN 'fair' THEN 2
         WHEN 'overpriced' THEN 3
         ELSE 4
       END,
       price ASC`,
  )
  .all(searchId) as Row[];

for (const r of rows) {
  const t = (r.title ?? '').replace(/\n/g, ' | ').slice(0, 80);
  const priceStr = r.price != null ? `$${r.price}` : '$??';
  console.log(`[${(r.deal_tier ?? '?').padEnd(10)}] ${priceStr.padEnd(8)} ${t}`);
  console.log(`   → ${r.llm_reasoning ?? '(no reasoning)'}`);
  console.log();
}

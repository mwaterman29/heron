import { db } from '../db.js';

const pattern = process.argv[2] ?? 'SB-3000';
const rows = db
  .prepare(
    `SELECT title, price, deal_tier, llm_reasoning
     FROM seen_items
     WHERE title LIKE ?
     ORDER BY price ASC`,
  )
  .all(`%${pattern}%`) as Array<{
  title: string | null;
  price: number | null;
  deal_tier: string | null;
  llm_reasoning: string | null;
}>;

for (const r of rows) {
  const t = (r.title ?? '').replace(/\n/g, ' | ').slice(0, 90);
  const p = r.price != null ? `$${r.price}` : '$??';
  console.log(`[${(r.deal_tier ?? '?').padEnd(10)}] ${p.padEnd(8)} ${t}`);
  console.log(`   → ${r.llm_reasoning ?? '(no reasoning)'}`);
  console.log();
}

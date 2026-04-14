import { db } from '../db.js';

const site = process.argv[2] ?? 'usaudiomart';
const rows = db
  .prepare(
    'SELECT search_id, title, price, currency, location, url FROM seen_items WHERE site = ? ORDER BY search_id, price',
  )
  .all(site) as Array<{
  search_id: string;
  title: string | null;
  price: number | null;
  currency: string | null;
  location: string | null;
  url: string;
}>;

for (const r of rows) {
  const title = (r.title ?? '').replace(/\n/g, ' | ').slice(0, 60);
  console.log(
    `[${r.search_id.padEnd(22)}] ${(r.currency ?? '?').padEnd(4)} ${String(r.price ?? '??').padStart(6)}  ${(r.location ?? '??').padEnd(3)}  ${title}`,
  );
  console.log(`   ${r.url}`);
}

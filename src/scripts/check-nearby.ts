import { db } from '../db.js';

const total = db
  .prepare("SELECT COUNT(*) as c FROM seen_items WHERE site = 'craigslist'")
  .get() as { c: number };
const nearby = db
  .prepare(
    "SELECT COUNT(*) as c FROM seen_items WHERE site = 'craigslist' AND raw_text LIKE '%NEARBY%'",
  )
  .get() as { c: number };
console.log(`craigslist total=${total.c} with_nearby_tag=${nearby.c}`);

const sample = db
  .prepare(
    "SELECT title, location, raw_text FROM seen_items WHERE site = 'craigslist' AND raw_text LIKE '%NEARBY%' LIMIT 3",
  )
  .all() as Array<{ title: string | null; location: string | null; raw_text: string | null }>;
for (const r of sample) {
  console.log('---');
  console.log('title:', r.title);
  console.log('location:', r.location);
  console.log('raw_text:', r.raw_text);
}

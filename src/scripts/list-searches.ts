import { loadConfig } from '../config.js';

const { searches, user } = loadConfig();
console.log(`user.location = ${user.location ?? '(none)'}`);
console.log(`total searches: ${searches.length}`);
console.log();

const byRef = new Map<string, typeof searches>();
for (const s of searches) {
  const list = byRef.get(s.reference_id) ?? [];
  list.push(s);
  byRef.set(s.reference_id, list);
}

for (const [refId, list] of byRef) {
  console.log(`${refId}  (${list.length} searches)`);
  for (const s of list) {
    const loc = s.location ? ` [${s.location}]` : '';
    console.log(`  ${s.id.padEnd(45)} ${s.site.padEnd(14)} "${s.query}"${loc}`);
  }
  console.log();
}

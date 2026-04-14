import { createHash } from 'node:crypto';

/**
 * Normalize a listing URL for stable hashing.
 * - Lowercase host
 * - Strip query strings that are purely tracking (utm_*, ref, fbclid)
 * - Strip trailing slash
 */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hostname = u.hostname.toLowerCase();

    // HiFi Shark redirect URLs look like:
    //   /goto/<listing_id>/<rotating_session_uuid>
    // The trailing UUID rotates per page load, breaking dedup. Strip it.
    if (u.hostname.endsWith('hifishark.com')) {
      const m = u.pathname.match(/^\/goto\/([^/]+)\//);
      if (m) u.pathname = `/goto/${m[1]}`;
    }

    const drop: string[] = [];
    u.searchParams.forEach((_, k) => {
      if (k.startsWith('utm_') || k === 'fbclid' || k === 'ref') drop.push(k);
    });
    for (const k of drop) u.searchParams.delete(k);
    let s = u.toString();
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s;
  } catch {
    return raw.trim();
  }
}

export function listingId(site: string, url: string): string {
  const normalized = normalizeUrl(url);
  return createHash('sha256').update(`${site}|${normalized}`).digest('hex');
}

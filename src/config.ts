import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';

/**
 * Config is item-first: one entry per target item in
 * config/price-reference.yaml, and searches are generated at load time by
 * projecting each reference across the sites it lists. We no longer keep
 * a separate config/searches.yaml.
 *
 * A reference declares:
 *   - what it is (name, type, pricing tiers)
 *   - what to search for (query OR queries[])
 *   - where to search (sites[])
 *   - optional site_overrides to use a different query on a specific site
 *   - optional location (for craigslist/fbmp; falls back to user.location)
 */

export interface Variant {
  model: string;
  msrp: number;
  fair_used: number;
  deal_price: number;
  steal_price: number;
}

export interface SiteOverride {
  /** Single query that replaces the reference's default for this site. */
  query?: string;
  /** Multiple queries that replace the reference's default for this site. */
  queries?: string[];
  /** Location override (e.g. a different craigslist city for this site). */
  location?: string;
}

export interface PriceReference {
  id: string;
  name: string;
  type: string;
  category?: string;
  /** Default search query for this reference across all sites. */
  query?: string;
  /** Multiple default queries (e.g. "svs sb" + grail variants). Preferred over `query` when present. */
  queries?: string[];
  /** Scraper IDs to search on for this reference (e.g. ['ebay','hifishark']). */
  sites?: string[];
  /** Per-site query / location tweaks. */
  site_overrides?: Record<string, SiteOverride>;
  /** Location hint used by craigslist / fbmp scrapers. Falls back to user.location. */
  location?: string;

  // Pricing tiers (all USD). Either flat or variants[].
  msrp?: number;
  fair_used?: number;
  fair_price?: number;
  deal_price?: number;
  steal_price?: number;
  // Vehicle-specific
  year_range?: [number, number];
  engine?: string;
  max_mileage?: number;
  // Multi-variant (e.g. SVS subs)
  variants?: Variant[];
  grail?: string;
  notes?: string;
  /** User-authored constraint about geography/shipping/landed-cost realities. */
  shipping_notes?: string;
  /**
   * Allowed US state codes for location-aware scrapers (FBMP, Craigslist).
   * Listings whose location doesn't match any of these are dropped before
   * hitting the DB or LLM. Saves tokens on obvious geographic rejects.
   * Example: ['MA', 'NH', 'RI', 'CT'] for ~100mi radius from Boston.
   * If omitted, no state filtering is applied (all locations pass through).
   */
  allowed_states?: string[];

  /**
   * For type=category_hunt references: a free-text profile describing
   * what the buyer is looking for, their taste, budget range, brands of
   * interest, and what to exclude. The LLM evaluates each listing against
   * its OWN typical used market value (not against fixed tiers) and uses
   * this profile to judge fit + whether the price represents a genuine
   * bargain worth surfacing.
   *
   * When `profile` is set, the evaluator uses a different system prompt
   * that says "evaluate each listing against its own fair market value,
   * filtered by the buyer's profile." The fixed-tier fields (msrp,
   * fair_used, deal_price, steal_price) are ignored.
   */
  profile?: string;
}

export interface UserProfile {
  /** Default location for craigslist/fbmp (e.g. 'boston'). */
  location?: string;
}

/** A fully-resolved, ready-to-execute search. Emitted by loadConfig(). */
export interface ResolvedSearch {
  id: string;
  site: string;
  query: string;
  location?: string;
  category: string;
  reference_id: string;
  reference: PriceReference;
}

interface ReferencesFile {
  user?: UserProfile;
  references: PriceReference[];
}

function loadYaml<T>(path: string): T {
  const raw = readFileSync(path, 'utf8');
  return yaml.load(raw) as T;
}

function queriesFor(ref: PriceReference, override?: SiteOverride): string[] {
  if (override?.queries && override.queries.length > 0) return override.queries;
  if (override?.query) return [override.query];
  if (ref.queries && ref.queries.length > 0) return ref.queries;
  if (ref.query) return [ref.query];
  // Fallback: use the reference name itself as the query
  return [ref.name];
}

function slugify(q: string): string {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

export function loadConfig(root: string = process.cwd()): {
  searches: ResolvedSearch[];
  references: Map<string, PriceReference>;
  user: UserProfile;
} {
  const refPath = resolve(root, 'config/price-reference.yaml');
  if (!existsSync(refPath)) {
    throw new Error(`Missing config/price-reference.yaml at ${refPath}`);
  }
  const refsFile = loadYaml<ReferencesFile>(refPath);
  const user: UserProfile = refsFile.user ?? {};
  // USER_LOCATION env var (set via Settings UI) overrides the YAML default
  // so users can configure their region without editing config files.
  const envLocation = process.env.USER_LOCATION?.trim();
  if (envLocation) user.location = envLocation;

  const references = new Map<string, PriceReference>();
  for (const r of refsFile.references) references.set(r.id, r);

  const resolved: ResolvedSearch[] = [];
  for (const ref of refsFile.references) {
    if (!ref.sites || ref.sites.length === 0) {
      // A reference with no sites is intentionally dormant (documented but not searched)
      continue;
    }

    for (const site of ref.sites) {
      const override = ref.site_overrides?.[site];
      const queries = queriesFor(ref, override);
      const location = override?.location ?? ref.location ?? user.location;
      const category = ref.category ?? ref.type ?? 'general';

      queries.forEach((query, idx) => {
        const suffix = queries.length > 1 ? `-${slugify(query)}` : '';
        resolved.push({
          id: `${ref.id}-${site}${suffix}`,
          site,
          query,
          location,
          category,
          reference_id: ref.id,
          reference: ref,
        });
      });
    }
  }

  return { searches: resolved, references, user };
}

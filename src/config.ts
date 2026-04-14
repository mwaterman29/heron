import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';

export interface SearchConfig {
  id: string;
  site: string;
  query: string;
  location?: string;
  category: string;
  reference_id: string;
}

export interface Variant {
  model: string;
  msrp: number;
  fair_used: number;
  deal_price: number;
  steal_price: number;
}

export interface PriceReference {
  id: string;
  name: string;
  type: string;
  // Flat-tier fields (present on some references)
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
}

export interface ResolvedSearch extends SearchConfig {
  reference: PriceReference;
}

interface SearchesFile {
  searches: SearchConfig[];
}
interface ReferencesFile {
  references: PriceReference[];
}

function loadYaml<T>(path: string): T {
  const raw = readFileSync(path, 'utf8');
  return yaml.load(raw) as T;
}

export function loadConfig(root: string = process.cwd()): {
  searches: ResolvedSearch[];
  references: Map<string, PriceReference>;
} {
  const searchesFile = loadYaml<SearchesFile>(resolve(root, 'config/searches.yaml'));
  const refsFile = loadYaml<ReferencesFile>(resolve(root, 'config/price-reference.yaml'));

  const references = new Map<string, PriceReference>();
  for (const r of refsFile.references) references.set(r.id, r);

  const resolved: ResolvedSearch[] = [];
  for (const s of searchesFile.searches) {
    const ref = references.get(s.reference_id);
    if (!ref) {
      throw new Error(
        `Search '${s.id}' references unknown reference_id '${s.reference_id}'`,
      );
    }
    resolved.push({ ...s, reference: ref });
  }

  return { searches: resolved, references };
}

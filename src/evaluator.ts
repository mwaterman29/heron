import yaml from 'js-yaml';
import { logger } from './utils/logger.js';
import type { PriceReference } from './config.js';
import type { SeenItemRow, Verdict } from './db.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const SYSTEM_PROMPT = `You are a marketplace deal evaluator. You will receive:
1. A REFERENCE section describing the item being searched for, including pricing tiers (IN USD) and any shipping_notes geographic constraint.
2. One or more LISTING entries scraped from marketplace sites.

For each listing, respond with a JSON object in this exact schema:
{
  "evaluations": [
    {
      "listing_index": 0,
      "relevant": true,
      "deal_tier": "steal|deal|fair|overpriced|irrelevant",
      "confidence": 0.0,
      "extracted_price": null,
      "extracted_currency": "USD|EUR|GBP|...",
      "reasoning": "1-2 sentence explanation",
      "red_flags": [],
      "positive_signals": [],
      "grail_match": false
    }
  ]
}

CURRENCY + USD CONVERSION (CRITICAL):
- The reference pricing tiers (msrp, fair_used, deal_price, steal_price) are all in USD.
- Each listing may be in any currency (€, £, $, SEK, NOK, DKK, CAD, etc.). Identify the currency.
- "extracted_price" MUST be the listing price CONVERTED TO USD using approximate current exchange rates.
  Example: £491 → extracted_price ≈ 620 (not 491).
- "extracted_currency" is the ORIGINAL currency code of the listing.
- Compare extracted_price (USD) against the reference tiers (USD) when choosing deal_tier.
- If you cannot determine either the price or a reasonable USD conversion, mark the listing irrelevant.

SHIPPING / GEOGRAPHY:
- If the reference has a shipping_notes field, it describes geography/landed-cost constraints the buyer cares about.
- Respect it. A listing that violates the constraint (e.g. located in the UK for a "US-only bulky item") should be downgraded or marked irrelevant per the constraint's instruction.
- Landed cost matters more than sticker price for heavy/bulky items: factor in likely shipping, import duty, and damage risk if the user's notes imply it.

RELEVANCE:
- If the listing is not the reference item (wrong model, accessory, single when pair required, bundle when standalone required, "sold", part-out, grille-only, etc.), mark as "irrelevant".
- Bundles that include other gear should be irrelevant unless the speakers/item alone can be reasonably valued.

TIER DEFINITIONS (all USD-to-USD):
- "steal" = significantly below deal_price (USD) or matches grail criteria at any reasonable price
- "deal" = at or below deal_price (USD)
- "fair" = between deal_price and fair_used / fair_price
- "overpriced" = above fair_used / fair_price
- For vehicles: pay special attention to mileage, maintenance history, known-issue status

OUTPUT:
- Respond ONLY with the JSON object, no markdown fences, no preamble.`;

interface LLMEvaluation {
  listing_index: number;
  relevant: boolean;
  deal_tier: Verdict['deal_tier'];
  confidence: number;
  extracted_price: number | null;
  reasoning: string;
  red_flags: string[];
  positive_signals: string[];
  grail_match: boolean;
}

function buildUserPrompt(reference: PriceReference, listings: SeenItemRow[]): string {
  const refYaml = yaml.dump(reference);
  const listingBlocks = listings.map((l, i) => {
    const priceStr =
      l.price != null
        ? `${l.currency ?? ''}${l.price}`.trim()
        : '(unknown)';
    return `[${i}] Source: ${l.site}
Title: ${l.title ?? ''}
Price (raw): ${priceStr}
Currency (detected): ${l.currency ?? '(unknown)'}
Location: ${l.location ?? ''}
URL: ${l.url}
Text: ${l.raw_text ?? ''}`;
  });
  return `=== REFERENCE ===
${refYaml}
=== LISTINGS ===
${listingBlocks.join('\n\n')}

Remember: extracted_price MUST be in USD. Compare USD-to-USD against the reference tiers. Respect shipping_notes if present.`;
}

function parseAndValidate(raw: string, listingCount: number): LLMEvaluation[] {
  // Strip possible markdown fences defensively
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?/, '').replace(/```$/, '').trim();
  }
  const parsed = JSON.parse(cleaned);
  if (!parsed || !Array.isArray(parsed.evaluations)) {
    throw new Error('LLM response missing evaluations array');
  }
  const evals: LLMEvaluation[] = parsed.evaluations;
  // Light validation; fill in missing fields with defaults
  return evals.map((e) => ({
    listing_index: Number(e.listing_index ?? 0),
    relevant: Boolean(e.relevant),
    deal_tier: (e.deal_tier ?? 'irrelevant') as Verdict['deal_tier'],
    confidence: Number(e.confidence ?? 0),
    extracted_price: e.extracted_price != null ? Number(e.extracted_price) : null,
    reasoning: String(e.reasoning ?? ''),
    red_flags: Array.isArray(e.red_flags) ? e.red_flags.map(String) : [],
    positive_signals: Array.isArray(e.positive_signals) ? e.positive_signals.map(String) : [],
    grail_match: Boolean(e.grail_match),
  }));
}

async function callOpenRouter(model: string, system: string, user: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY ?? process.env.OPEN_ROUTER_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY (or OPEN_ROUTER_KEY) is not set');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90_000);
  let res: Response;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/local/deal-hunter',
        'X-Title': 'deal-hunter',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      }),
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenRouter response missing content');
  return content;
}

export interface EvaluateOptions {
  dryRun?: boolean;
}

export async function evaluateBatch(
  reference: PriceReference,
  listings: SeenItemRow[],
  opts: EvaluateOptions = {},
): Promise<Map<string, Verdict>> {
  const out = new Map<string, Verdict>();
  if (listings.length === 0) return out;

  if (opts.dryRun) {
    for (const l of listings) {
      out.set(l.id, {
        relevant: true,
        deal_tier: 'fair',
        confidence: 0.5,
        extracted_price: l.price,
        reasoning: '[dry-run] synthetic fair verdict',
        red_flags: [],
        positive_signals: [],
        grail_match: false,
      });
    }
    return out;
  }

  const system = SYSTEM_PROMPT;
  const user = buildUserPrompt(reference, listings);

  // Default primary flipped to DeepSeek 3.1 — in practice glm-4.7-flash was
  // slow (~2 min/batch) AND intermittently returned empty content on OpenRouter.
  // DeepSeek 3.1 is ~2-3x the per-token cost but still well under $1/M, and is
  // dramatically faster and more reliable in this pipeline.
  const primary = process.env.OPENROUTER_MODEL ?? 'deepseek/deepseek-chat-v3.1';
  const fallback = process.env.OPENROUTER_FALLBACK_MODEL ?? 'z-ai/glm-4.7-flash';

  let raw: string | null = null;
  try {
    raw = await callOpenRouter(primary, system, user);
  } catch (err) {
    logger.warn({ err, model: primary }, 'primary model failed, retrying once');
    await new Promise((r) => setTimeout(r, 5000));
    try {
      raw = await callOpenRouter(primary, system, user);
    } catch (err2) {
      logger.warn({ err: err2, model: primary }, 'primary retry failed, trying fallback');
      raw = await callOpenRouter(fallback, system, user);
    }
  }

  const evals = parseAndValidate(raw, listings.length);
  for (const e of evals) {
    const listing = listings[e.listing_index];
    if (!listing) continue;
    out.set(listing.id, {
      relevant: e.relevant,
      deal_tier: e.deal_tier,
      confidence: e.confidence,
      extracted_price: e.extracted_price,
      reasoning: e.reasoning,
      red_flags: e.red_flags,
      positive_signals: e.positive_signals,
      grail_match: e.grail_match,
    });
  }
  return out;
}

/** Split an array into chunks of size n. */
export function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

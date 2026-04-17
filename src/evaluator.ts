import yaml from 'js-yaml';
import { logger } from './utils/logger.js';
import type { PriceReference } from './config.js';
import type { SeenItemRow, Verdict } from './db.js';
import type { DetailPage } from './scrapers/base.js';

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

EXCEPTIONAL-BARGAIN EXCEPTION (important — but STRICT):
- If a listing is NOT the exact reference item but is closely adjacent — same manufacturer, same product family, or a direct sibling/upgrade of the reference — AND the price is dramatically underpriced relative to the ADJACENT item's own TYPICAL USED price (in dollars), surface it as "deal" or "steal" anyway.
- The comparison point is TYPICAL USED PRICE IN USD. NOT new MSRP. NOT "open box discount from new". NOT "below retail".
  • "Open box" / "refurbished" / "mint" are still sold at used-market prices, not new MSRP.
  • A 10–20% discount from new MSRP is NOT an exceptional bargain. Reject it.
  • A ~50%+ discount BELOW the adjacent item's typical USED price IS the bar. Be strict about this.
- Sanity check before applying the exception:
  1. Estimate the adjacent item's typical USED price in USD (call this U).
  2. Is the listing price ≤ 0.6 × U? If no, mark irrelevant. If yes, proceed.
  3. If you are not confident in your estimate of U, mark irrelevant — do NOT guess.
- When you apply this exception, set relevant=true, pick the deal tier based on the bargain's magnitude, and in the reasoning EXPLICITLY state: (1) this is not the exact reference item, (2) what it actually is, (3) its estimated TYPICAL USED value U in USD, (4) the listing price in USD, (5) the ratio price/U, and (6) why it's worth surfacing. If the ratio is > 0.6 you MUST mark irrelevant instead.
- Correct example: ref is SVS SB-1000 (fair_used $275), listing is an SVS SB-3000 (U ≈ $700 used) at $250. 250/700 = 0.36 ≤ 0.6 → surface as "steal". Reasoning: "Not the SB-1000 — this is an SB-3000, a direct upgrade. Typical used SB-3000 is around $700 USD. This is $250, ratio 0.36, dramatically below used market. Surfacing under adjacent-bargain exception."
- Wrong example (do NOT do this): ref is SVS SB-1000, listing is SVS SB-3000 open box at $999, SB-3000 used is ~$700. 999/700 = 1.43, which is ABOVE used market. This is NOT a bargain, it's overpriced-or-fair for open box. Mark as irrelevant (or at most mark as "overpriced" if you want to log it).
- Do NOT trigger this exception for items that merely share a category keyword (e.g. "any subwoofer cheap"). The adjacency must be real: same brand + same product line, or an unambiguous upgrade/successor.

TIER DEFINITIONS (all USD-to-USD):
- "steal" = significantly below deal_price (USD) or matches grail criteria at any reasonable price
- "deal" = at or below deal_price (USD)
- "fair" = between deal_price and fair_used / fair_price
- "overpriced" = above fair_used / fair_price
- For vehicles: pay special attention to mileage, maintenance history, known-issue status

OUTPUT:
- Respond ONLY with the JSON object, no markdown fences, no preamble.`;

const SYSTEM_PROMPT_CATEGORY_HUNT = `You are a marketplace deal evaluator in CATEGORY HUNT mode. Unlike the standard mode where you compare listings against a single reference item with fixed pricing tiers, here you evaluate each listing against ITS OWN typical used market value.

You will receive:
1. A BUYER PROFILE describing what the buyer is looking for: their taste preferences, budget range, brands/models of interest, and exclusions.
2. Optional SHIPPING CONSTRAINTS and ADDITIONAL NOTES.
3. One or more LISTING entries scraped from marketplace sites.

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
      "reasoning": "1-3 sentence explanation",
      "red_flags": [],
      "positive_signals": [],
      "grail_match": false
    }
  ]
}

HOW TO EVALUATE EACH LISTING:

1. RELEVANCE CHECK: Does this listing match the buyer's profile? Consider:
   - Is the item in the right category/type?
   - Does it match the buyer's stated brands/models of interest?
   - Does it violate any exclusions in the profile?
   - If the item doesn't match any stated interest AND isn't a dramatically underpriced surprise find, mark it irrelevant.

2. MARKET VALUE ESTIMATION (critical): For each RELEVANT listing:
   - Estimate the item's typical USED market value in USD (call this U).
   - You must state U in your reasoning. If you're not confident in U, say so and set confidence low.
   - Common knowledge: use your training data about typical used prices on audiophile forums, eBay sold listings, Head-Fi classifieds, etc.

3. DEAL ASSESSMENT: Compare the asking price (converted to USD) against U:
   - "steal" = asking price ≤ 0.5 × U (50%+ below used market — exceptional bargain)
   - "deal" = asking price ≤ 0.75 × U (25%+ below used market — genuinely good buy, the "flip test" passes: you could resell for more than you paid)
   - "fair" = asking price between 0.75 × U and U (reasonable market price, no arbitrage)
   - "overpriced" = asking price > U (above typical used market)
   - State the ratio (asking/U) in your reasoning.

4. PROFILE FIT BONUS: If the item is particularly well-suited to the buyer's stated preferences (e.g. they want ESTs and this tribrid has 4 ESTs; they want resolution and this model is known for it), mention this as a positive signal. A perfect-fit item at a fair price is worth surfacing; a poor-fit item even at a deal price may not be.

5. FLIP TEST: Ask yourself: "Could the buyer resell this for more than the asking price?" If yes, that's a strong signal to surface it as deal/steal regardless of whether it's the buyer's exact target.

CURRENCY: extracted_price MUST be in USD after conversion. All market value estimates (U) are in USD.

SHIPPING: Respect any shipping constraints in the profile.

OUTPUT: Respond ONLY with the JSON object, no markdown fences, no preamble.`;

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

function formatListingBlocks(listings: SeenItemRow[]): string {
  return listings.map((l, i) => {
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
  }).join('\n\n');
}

function buildUserPrompt(reference: PriceReference, listings: SeenItemRow[]): string {
  const refYaml = yaml.dump(reference);
  return `=== REFERENCE ===
${refYaml}
=== LISTINGS ===
${formatListingBlocks(listings)}

Remember: extracted_price MUST be in USD. Compare USD-to-USD against the reference tiers. Respect shipping_notes if present.`;
}

function buildCategoryHuntUserPrompt(reference: PriceReference, listings: SeenItemRow[]): string {
  return `=== BUYER PROFILE ===
${reference.profile ?? ''}

${reference.shipping_notes ? `=== SHIPPING CONSTRAINTS ===\n${reference.shipping_notes}\n` : ''}${reference.notes ? `=== ADDITIONAL NOTES ===\n${reference.notes}\n` : ''}
=== LISTINGS ===
${formatListingBlocks(listings)}

For each listing: estimate its typical used market value in USD, compare the asking price against that, and judge whether this is a genuine bargain worth surfacing given the buyer's profile.`;
}

/**
 * Light JSON repair for the common DeepSeek/OpenRouter quirks:
 *   - trailing commas inside objects/arrays
 *   - line comments (//) that shouldn't be there but sometimes are
 *   - single-quoted strings (rare)
 * This is a last-ditch attempt before giving up on a response.
 */
function repairJson(raw: string): string {
  return raw
    // Remove line comments
    .replace(/(?<!["'])\/\/[^\n]*/g, '')
    // Remove trailing commas before closing brackets/braces
    .replace(/,(\s*[}\]])/g, '$1');
}

function tolerantParse(raw: string): unknown {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?/, '').replace(/```$/, '').trim();
  }
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    // One retry with light repair
    const repaired = repairJson(cleaned);
    try {
      return JSON.parse(repaired);
    } catch {
      // Log a sample of the offending text to help debugging
      logger.error(
        { sample: cleaned.slice(0, 300) + '...' + cleaned.slice(-300), origErr: (err as Error).message },
        'JSON parse failed even after repair',
      );
      throw err;
    }
  }
}

function parseAndValidate(raw: string, listingCount: number): LLMEvaluation[] {
  const parsed = tolerantParse(raw) as { evaluations?: unknown };
  if (!parsed || !Array.isArray(parsed.evaluations)) {
    throw new Error('LLM response missing evaluations array');
  }
  const evals: LLMEvaluation[] = parsed.evaluations as LLMEvaluation[];
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

  // Route to the category-hunt prompt when the reference has a profile
  // field (no fixed pricing tiers — the LLM estimates each item's own
  // used market value). Otherwise use the standard per-item prompt.
  const isCategoryHunt = !!reference.profile;
  const system = isCategoryHunt ? SYSTEM_PROMPT_CATEGORY_HUNT : SYSTEM_PROMPT;
  const user = isCategoryHunt
    ? buildCategoryHuntUserPrompt(reference, listings)
    : buildUserPrompt(reference, listings);

  // Default primary flipped to DeepSeek 3.1 — in practice glm-4.7-flash was
  // slow (~2 min/batch) AND intermittently returned empty content on OpenRouter.
  // DeepSeek 3.1 is ~2-3x the per-token cost but still well under $1/M, and is
  // dramatically faster and more reliable in this pipeline.
  const primary = process.env.OPENROUTER_MODEL ?? 'deepseek/deepseek-chat-v3.1';
  const fallback = process.env.OPENROUTER_FALLBACK_MODEL ?? 'z-ai/glm-4.7-flash';

  // Try primary → retry primary → fallback. A call counts as "failed"
  // if either the network call throws OR the response fails to parse
  // — both are equally useless to the orchestrator.
  async function tryCall(model: string): Promise<LLMEvaluation[]> {
    const raw = await callOpenRouter(model, system, user);
    return parseAndValidate(raw, listings.length);
  }

  let evals: LLMEvaluation[] | null = null;
  try {
    evals = await tryCall(primary);
  } catch (err) {
    logger.warn({ err, model: primary }, 'primary model failed/unparseable, retrying once');
    await new Promise((r) => setTimeout(r, 5000));
    try {
      evals = await tryCall(primary);
    } catch (err2) {
      logger.warn({ err: err2, model: primary }, 'primary retry failed, trying fallback');
      evals = await tryCall(fallback);
    }
  }
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

// ───────────────────────── Pass-2: detail drill-down ─────────────────────────

const SYSTEM_PROMPT_DETAIL = `You are a marketplace deal evaluator running a SECOND-PASS REVIEW on a listing that a first-pass evaluator (working from card-level data only) flagged as a potential deal/steal/grail.

You now have the FULL DETAIL PAGE content for this listing. Use it to CONFIRM, UPGRADE, or DOWNGRADE the first-pass verdict. You must cite specific evidence from the detail content in your reasoning.

INPUT:
1. The REFERENCE section (same as pass 1): item definition, pricing tiers (USD), shipping_notes, and notes (including BUYER PREFERENCES if any).
2. The PASS-1 VERDICT: what the card-level evaluator concluded and why.
3. The DETAIL PAGE: full title, price, structured extras (mileage/color/drive/condition/specifics/etc.), and body text.

OUTPUT SCHEMA (single JSON object — same as pass 1):
{
  "relevant": true,
  "deal_tier": "steal|deal|fair|overpriced|irrelevant",
  "confidence": 0.0,
  "extracted_price": null,
  "extracted_currency": "USD|EUR|GBP|...",
  "reasoning": "1-3 sentences citing SPECIFIC evidence from the detail page",
  "red_flags": [],
  "positive_signals": [],
  "grail_match": false
}

ALL THE PASS-1 RULES STILL APPLY:
- USD conversion for extracted_price (reference tiers are USD)
- Shipping_notes geographic constraints
- Exceptional-bargain exception (strict: ratio ≤ 0.6 vs typical used)
- Tier definitions (steal/deal/fair/overpriced/irrelevant)

NEW PASS-2 RULES:
- Re-check the reference's \`notes\` section line by line against the detail. For vehicles, this means actually checking mileage, color, drivetrain (RWD vs AWD/4MATIC), title status, service history, known-issue markers. For speakers, condition, pair-vs-single, tweeter/driver damage. CITE what you found or didn't find.
- If the reference has BUYER PREFERENCES (e.g. "Black strongly preferred, RWD not AWD"), apply them as tier modifiers:
  - Listing matches preferences → confirm or upgrade
  - Listing violates preferences → downgrade a tier (deal → fair, steal → deal)
  - Listing has hard red flags (salvage/rebuilt title, over max_mileage, obvious fraud indicators) → downgrade to "irrelevant" or "overpriced"
- If the detail page is thin, a Cloudflare challenge, a dealer template with no real info, or the seller description is too vague to verify the reference's notes, DOWNGRADE to "fair" with confidence ≤ 0.4. Do NOT confirm on insufficient information.
- You may UPGRADE a pass-1 verdict if the detail page reveals a better deal than the card suggested (e.g. the card showed only a starting bid, but the detail reveals a Buy It Now at a lower price). Rare, but allowed.
- Pass-2 is a revision, not a re-evaluation from scratch. The pass-1 verdict is your baseline — explain whether you're confirming, upgrading, or downgrading, and why.

OUTPUT:
- Respond ONLY with the JSON object, no markdown fences, no preamble.`;

function buildDetailPrompt(
  reference: PriceReference,
  listing: SeenItemRow,
  pass1: Verdict,
  detail: DetailPage,
): string {
  const refYaml = yaml.dump(reference);
  const cardPrice =
    listing.price != null ? `${listing.currency ?? ''}${listing.price}`.trim() : '(unknown)';
  const extrasBlock = detail.extras && Object.keys(detail.extras).length
    ? Object.entries(detail.extras)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join('\n')
    : '(none)';

  return `=== REFERENCE ===
${refYaml}

=== PASS-1 VERDICT (card-level) ===
deal_tier: ${pass1.deal_tier}
grail_match: ${pass1.grail_match}
confidence: ${pass1.confidence}
extracted_price (USD): ${pass1.extracted_price ?? '(null)'}
reasoning: ${pass1.reasoning}
red_flags: ${pass1.red_flags.join('; ') || '(none)'}
positive_signals: ${pass1.positive_signals.join('; ') || '(none)'}

=== CARD-LEVEL DATA (what pass 1 saw) ===
Source: ${listing.site}
Title: ${listing.title ?? ''}
Price (raw): ${cardPrice}
Currency: ${listing.currency ?? '(unknown)'}
Location: ${listing.location ?? ''}
URL: ${listing.url}

=== DETAIL PAGE (what you see now) ===
URL: ${detail.url}
Title: ${detail.title ?? '(none)'}
Price: ${detail.price ?? '(none)'}
Location: ${detail.location ?? '(none)'}
Structured extras:
${extrasBlock}

Body:
${detail.rawText}

Revise the pass-1 verdict. Confirm, upgrade, or downgrade. Cite specific evidence from the detail page. If the detail is thin/challenge-page/unverifiable, downgrade to fair with low confidence.`;
}

function parseSingleEvaluation(raw: string): LLMEvaluation {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?/, '').replace(/```$/, '').trim();
  }
  const parsed = JSON.parse(cleaned);
  // evaluateDetail returns a single object, not {evaluations: [...]}. Accept either shape.
  const source = parsed && Array.isArray(parsed.evaluations) && parsed.evaluations.length > 0
    ? parsed.evaluations[0]
    : parsed;
  if (!source || typeof source !== 'object') {
    throw new Error('LLM detail response is not an object');
  }
  return {
    listing_index: 0,
    relevant: Boolean(source.relevant),
    deal_tier: (source.deal_tier ?? 'irrelevant') as Verdict['deal_tier'],
    confidence: Number(source.confidence ?? 0),
    extracted_price: source.extracted_price != null ? Number(source.extracted_price) : null,
    reasoning: String(source.reasoning ?? ''),
    red_flags: Array.isArray(source.red_flags) ? source.red_flags.map(String) : [],
    positive_signals: Array.isArray(source.positive_signals)
      ? source.positive_signals.map(String)
      : [],
    grail_match: Boolean(source.grail_match),
  };
}

export async function evaluateDetail(
  reference: PriceReference,
  listing: SeenItemRow,
  pass1: Verdict,
  detail: DetailPage,
  opts: EvaluateOptions = {},
): Promise<Verdict> {
  if (opts.dryRun) {
    // Echo pass-1 verbatim in dry-run mode so orchestrator plumbing can be
    // tested without LLM spend.
    return {
      ...pass1,
      reasoning: `[dry-run pass-2] confirming pass-1: ${pass1.reasoning}`,
    };
  }

  const user = buildDetailPrompt(reference, listing, pass1, detail);
  const primary = process.env.OPENROUTER_MODEL ?? 'deepseek/deepseek-chat-v3.1';
  const fallback = process.env.OPENROUTER_FALLBACK_MODEL ?? 'z-ai/glm-4.7-flash';

  let raw: string | null = null;
  try {
    raw = await callOpenRouter(primary, SYSTEM_PROMPT_DETAIL, user);
  } catch (err) {
    logger.warn({ err, model: primary, listingId: listing.id }, 'pass-2 primary failed, retrying');
    await new Promise((r) => setTimeout(r, 3000));
    try {
      raw = await callOpenRouter(primary, SYSTEM_PROMPT_DETAIL, user);
    } catch (err2) {
      logger.warn({ err: err2, model: primary }, 'pass-2 retry failed, trying fallback');
      raw = await callOpenRouter(fallback, SYSTEM_PROMPT_DETAIL, user);
    }
  }

  const parsed = parseSingleEvaluation(raw);
  return {
    relevant: parsed.relevant,
    deal_tier: parsed.deal_tier,
    confidence: parsed.confidence,
    extracted_price: parsed.extracted_price,
    reasoning: parsed.reasoning,
    red_flags: parsed.red_flags,
    positive_signals: parsed.positive_signals,
    grail_match: parsed.grail_match,
  };
}

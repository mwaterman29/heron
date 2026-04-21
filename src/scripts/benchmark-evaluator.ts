/**
 * Benchmark the pass-1 evaluator prompt across several models, using real
 * evaluated listings from seen_items as the test set. This tells us whether
 * swapping the default evaluator from DeepSeek to Gemini 2.5 Flash (or others)
 * would preserve judgment quality at a lower cost/latency.
 *
 * Usage: npx tsx src/scripts/benchmark-evaluator.ts
 */

import 'dotenv/config';
import yaml from 'js-yaml';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getDb } from '../db.js';
import { loadConfig } from '../config.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Pull the real SYSTEM_PROMPT text out of evaluator.ts. Kept inline here so
// this benchmark is self-contained and can be tweaked without touching
// production code. Matches evaluator.ts SYSTEM_PROMPT at the time of writing.
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
- Compare extracted_price (USD) against the reference tiers (USD) when choosing deal_tier.
- If you cannot determine either the price or a reasonable USD conversion, mark the listing irrelevant.

SHIPPING / GEOGRAPHY:
- If the reference has a shipping_notes field, it describes geography/landed-cost constraints the buyer cares about.
- Respect it. A listing that violates the constraint should be downgraded or marked irrelevant per the constraint's instruction.

RELEVANCE:
- If the listing is not the reference item, mark as "irrelevant".

TIER DEFINITIONS (all USD-to-USD):
- "steal" = significantly below deal_price
- "deal" = at or below deal_price
- "fair" = between deal_price and fair_used
- "overpriced" = above fair_used

OUTPUT: Respond ONLY with the JSON object, no markdown fences, no preamble.`;

// Models to test
const MODELS = [
  { id: 'deepseek/deepseek-chat-v3.1', label: 'DeepSeek V3.1', input_per_1m: 0.27, output_per_1m: 1.1 },
  { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', input_per_1m: 0.15, output_per_1m: 0.6 },
  {
    id: 'google/gemini-3.1-flash-lite-preview-20260303',
    label: 'Gemini 3.1 Flash Lite',
    input_per_1m: 0.25,
    output_per_1m: 1.5,
  },
];

interface Row {
  id: string;
  site: string;
  search_id: string;
  title: string | null;
  price: number | null;
  currency: string | null;
  location: string | null;
  raw_text: string | null;
  deal_tier: string | null;
  llm_reasoning: string | null;
}

interface Evaluation {
  listing_index: number;
  relevant: boolean;
  deal_tier: string;
  confidence: number;
  extracted_price: number | null;
  reasoning: string;
}

interface ModelRun {
  modelId: string;
  modelLabel: string;
  durationMs: number;
  inTok: number;
  outTok: number;
  evaluations: Evaluation[] | null;
  error?: string;
  costUsd: number;
}

function formatListings(rows: Row[]): string {
  return rows.map((l, i) => {
    const priceStr =
      l.price != null ? `${l.currency ?? ''}${l.price}`.trim() : '(unknown)';
    return `[${i}] Source: ${l.site}
Title: ${l.title ?? ''}
Price (raw): ${priceStr}
Currency (detected): ${l.currency ?? '(unknown)'}
Location: ${l.location ?? ''}
Text: ${(l.raw_text ?? '').slice(0, 400)}`;
  }).join('\n\n');
}

async function callModel(
  model: (typeof MODELS)[number],
  reference: unknown,
  rows: Row[],
): Promise<ModelRun> {
  const apiKey = process.env.OPENROUTER_API_KEY ?? process.env.OPEN_ROUTER_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const user = `=== REFERENCE ===
${yaml.dump(reference)}
=== LISTINGS ===
${formatListings(rows)}

Remember: extracted_price MUST be in USD. Compare USD-to-USD against the reference tiers. Respect shipping_notes if present.`;

  const start = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 180_000);

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/local/deal-hunter',
        'X-Title': 'deal-hunter-evaluator-bench',
      },
      body: JSON.stringify({
        model: model.id,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: user },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        modelId: model.id,
        modelLabel: model.label,
        durationMs: Date.now() - start,
        inTok: 0,
        outTok: 0,
        evaluations: null,
        error: `HTTP ${res.status}: ${body.slice(0, 300)}`,
        costUsd: 0,
      };
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const raw = data.choices?.[0]?.message?.content ?? '';
    const inTok = data.usage?.prompt_tokens ?? 0;
    const outTok = data.usage?.completion_tokens ?? 0;
    const costUsd = (inTok / 1_000_000) * model.input_per_1m + (outTok / 1_000_000) * model.output_per_1m;

    let evaluations: Evaluation[] | null = null;
    try {
      const cleaned = raw.trim().replace(/^```(?:json)?/, '').replace(/```$/, '').trim();
      const parsed = JSON.parse(cleaned);
      evaluations = parsed.evaluations ?? null;
    } catch (e) {
      return {
        modelId: model.id,
        modelLabel: model.label,
        durationMs: Date.now() - start,
        inTok,
        outTok,
        evaluations: null,
        error: `JSON parse failed: ${(e as Error).message}`,
        costUsd,
      };
    }

    return {
      modelId: model.id,
      modelLabel: model.label,
      durationMs: Date.now() - start,
      inTok,
      outTok,
      evaluations,
      costUsd,
    };
  } catch (err) {
    return {
      modelId: model.id,
      modelLabel: model.label,
      durationMs: Date.now() - start,
      inTok: 0,
      outTok: 0,
      evaluations: null,
      error: String(err),
      costUsd: 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  // Load the reference config
  const { references } = loadConfig(process.cwd());

  // Pull all evaluated listings from the DB
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, site, search_id, title, price, currency, location, raw_text, deal_tier, llm_reasoning
       FROM seen_items
       WHERE evaluated = 1
       ORDER BY last_seen_at DESC
       LIMIT 20`,
    )
    .all() as Row[];

  if (rows.length === 0) {
    console.error('No evaluated rows in DB. Run a hunt first.');
    process.exit(1);
  }

  // Group rows by search_id so we send batches that all share one reference
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const list = groups.get(r.search_id) ?? [];
    list.push(r);
    groups.set(r.search_id, list);
  }

  console.error(`Loaded ${rows.length} evaluated listings across ${groups.size} search groups\n`);

  interface BatchResult {
    searchId: string;
    referenceId: string;
    rows: Row[];
    runs: ModelRun[];
  }

  const allResults: BatchResult[] = [];

  for (const [searchId, groupRows] of groups) {
    // Find the reference. search_id is like "<ref-id>-<site>-<suffix>".
    // Match against the longest reference.id prefix.
    const ref =
      Array.from(references.values())
        .filter((r) => searchId.startsWith(r.id))
        .sort((a, b) => b.id.length - a.id.length)[0] ?? null;

    if (!ref) {
      console.error(`[skip] ${searchId}: no matching reference found`);
      continue;
    }

    console.error(`\n=== batch: ${searchId} (${groupRows.length} listings, ref: ${ref.id}) ===`);

    // Strip price_history context — the benchmark only has the row text
    const refForPrompt = {
      id: ref.id,
      name: ref.name,
      type: ref.type,
      msrp: ref.msrp,
      fair_used: ref.fair_used,
      deal_price: ref.deal_price,
      steal_price: ref.steal_price,
      grail: ref.grail,
      shipping_notes: ref.shipping_notes,
      notes: ref.notes,
      profile: ref.profile,
    };

    const runs = await Promise.all(MODELS.map((m) => callModel(m, refForPrompt, groupRows)));

    for (const run of runs) {
      const tag = run.error
        ? `ERROR`
        : run.evaluations
          ? `${run.evaluations.length}/${groupRows.length} evals`
          : 'no evals';
      console.error(
        `  ${run.modelLabel.padEnd(22)} ${tag.padEnd(16)} ${run.durationMs}ms   ` +
          `${run.inTok}/${run.outTok} tok   $${run.costUsd.toFixed(5)}`,
      );
    }

    allResults.push({ searchId, referenceId: ref.id, rows: groupRows, runs });
  }

  // ==== Aggregate metrics ====

  console.error('\n\n=== Aggregate ===\n');
  for (const m of MODELS) {
    const modelRuns = allResults.map((r) => r.runs.find((x) => x.modelId === m.id)!);
    const ok = modelRuns.filter((r) => r && !r.error && r.evaluations).length;
    const totalMs = modelRuns.reduce((a, r) => a + (r?.durationMs ?? 0), 0);
    const totalIn = modelRuns.reduce((a, r) => a + (r?.inTok ?? 0), 0);
    const totalOut = modelRuns.reduce((a, r) => a + (r?.outTok ?? 0), 0);
    const totalCost = modelRuns.reduce((a, r) => a + (r?.costUsd ?? 0), 0);
    const avgMs = Math.round(totalMs / Math.max(modelRuns.length, 1));
    console.error(
      `  ${m.label.padEnd(22)} ${ok}/${modelRuns.length} batches succeeded   avg ${avgMs}ms   ` +
        `$${totalCost.toFixed(4)} total   (in ${totalIn} / out ${totalOut} tok)`,
    );
  }

  // ==== Tier agreement: model vs DB's stored deal_tier ====
  console.error('\n=== Agreement with stored DB verdicts ===\n');
  for (const m of MODELS) {
    let total = 0;
    let exactAgree = 0;
    let signAgree = 0; // deal/steal/grail vs everything else
    const disagreements: string[] = [];

    for (const br of allResults) {
      const run = br.runs.find((x) => x.modelId === m.id);
      if (!run?.evaluations) continue;
      for (const ev of run.evaluations) {
        const dbRow = br.rows[ev.listing_index];
        if (!dbRow?.deal_tier) continue;
        total++;
        if (ev.deal_tier === dbRow.deal_tier) exactAgree++;
        const modelIsDeal = ev.deal_tier === 'steal' || ev.deal_tier === 'deal';
        const dbIsDeal = dbRow.deal_tier === 'steal' || dbRow.deal_tier === 'deal';
        if (modelIsDeal === dbIsDeal) signAgree++;
        if (ev.deal_tier !== dbRow.deal_tier && disagreements.length < 8) {
          disagreements.push(
            `   "${(dbRow.title ?? '').slice(0, 50)}" db=${dbRow.deal_tier} model=${ev.deal_tier}`,
          );
        }
      }
    }
    const exactPct = total ? Math.round((exactAgree / total) * 100) : 0;
    const signPct = total ? Math.round((signAgree / total) * 100) : 0;
    console.error(
      `  ${m.label.padEnd(22)} ${exactAgree}/${total} exact (${exactPct}%)   ` +
        `${signAgree}/${total} deal-sign (${signPct}%)`,
    );
    if (disagreements.length > 0) {
      for (const d of disagreements) console.error(d);
    }
  }

  // ==== Write full report ====
  const outDir = resolve(process.cwd(), 'logs');
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = resolve(outDir, `evaluator-bench-${stamp}.md`);

  let report = `# Evaluator benchmark — ${new Date().toLocaleString()}\n\n`;
  report += `${rows.length} listings across ${groups.size} reference groups, evaluated by ${MODELS.length} models.\n\n`;
  report += `## Models tested\n\n`;
  for (const m of MODELS) {
    report += `- **${m.label}** (\`${m.id}\`) — $${m.input_per_1m}/M in, $${m.output_per_1m}/M out\n`;
  }

  report += `\n## Per-listing verdicts\n\n`;
  for (const br of allResults) {
    report += `### Batch: ${br.searchId} (ref \`${br.referenceId}\`)\n\n`;
    report += `| # | Title | Price | DB verdict | ${MODELS.map((m) => m.label).join(' | ')} |\n`;
    report += `|---|---|---|---|${MODELS.map(() => '---').join('|')}|\n`;
    for (let i = 0; i < br.rows.length; i++) {
      const row = br.rows[i];
      const title = (row.title ?? '').replace(/\|/g, '\\|').slice(0, 50);
      const priceStr = row.price != null ? `${row.currency ?? ''}${row.price}` : '?';
      const cells = MODELS.map((m) => {
        const run = br.runs.find((x) => x.modelId === m.id);
        if (!run?.evaluations) return 'err';
        const ev = run.evaluations.find((e) => e.listing_index === i);
        return ev ? ev.deal_tier : '—';
      });
      report += `| ${i} | ${title} | ${priceStr} | ${row.deal_tier ?? '?'} | ${cells.join(' | ')} |\n`;
    }
    report += `\n`;
    for (const m of MODELS) {
      const run = br.runs.find((x) => x.modelId === m.id);
      if (!run) continue;
      if (run.error) {
        report += `**${m.label}**: ERROR — ${run.error}\n\n`;
        continue;
      }
      report += `**${m.label}** (${run.durationMs}ms, $${run.costUsd.toFixed(5)}): sample reasoning —\n`;
      if (run.evaluations && run.evaluations.length > 0) {
        const ev = run.evaluations[0];
        report += `> listing[0] → ${ev.deal_tier} (conf ${ev.confidence}): ${ev.reasoning}\n\n`;
      }
    }
    report += '\n---\n\n';
  }

  writeFileSync(reportPath, report, 'utf8');
  console.error(`\nReport: ${reportPath}`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});

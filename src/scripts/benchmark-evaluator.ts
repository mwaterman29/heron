/**
 * Benchmark the pass-1 evaluator prompt across several models, using real
 * evaluated listings from seen_items as the test set. This tells us whether
 * swapping the default evaluator from DeepSeek to Gemini 2.5 Flash (or others)
 * would preserve judgment quality at a lower cost/latency.
 *
 * Usage: npx tsx src/scripts/benchmark-evaluator.ts
 */

import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getDb, type SeenItemRow } from '../db.js';
import { loadConfig } from '../config.js';
import {
  SYSTEM_PROMPT,
  SYSTEM_PROMPT_CATEGORY_HUNT,
  buildUserPrompt,
  buildCategoryHuntUserPrompt,
} from '../evaluator.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

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

type Row = SeenItemRow;

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

async function callModel(
  model: (typeof MODELS)[number],
  systemPrompt: string,
  userPrompt: string,
): Promise<ModelRun> {
  const apiKey = process.env.OPENROUTER_API_KEY ?? process.env.OPEN_ROUTER_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

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
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
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

  // Pull a stratified sample of evaluated listings: up to 30 per site so the
  // per-source breakdown isn't dominated by FBMP/eBay (which have ~700 rows
  // each in the user's DB vs. ~10 for the Reddit scrapers).
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM (
         SELECT *, ROW_NUMBER() OVER (
           PARTITION BY site ORDER BY last_seen_at DESC
         ) AS rn
         FROM seen_items
         WHERE evaluated = 1
       ) WHERE rn <= 30`,
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

    // Pick the same prompt + builder the live evaluator would have used for
    // this reference, so we benchmark what's actually in production rather
    // than a generic stand-in.
    const isCategoryHunt = ref.type !== 'general_review' && !!ref.profile;
    const systemPrompt = isCategoryHunt
      ? SYSTEM_PROMPT_CATEGORY_HUNT
      : SYSTEM_PROMPT;
    const userPrompt = isCategoryHunt
      ? buildCategoryHuntUserPrompt(ref, groupRows)
      : buildUserPrompt(ref, groupRows);

    const runs = await Promise.all(
      MODELS.map((m) => callModel(m, systemPrompt, userPrompt)),
    );

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

  // ==== Per-site breakdown ====
  // The whole point of this run: per-source quality. Each row's site lives on
  // br.rows[ev.listing_index].site. We compute exact + deal-sign agreement
  // and the verdict distribution per site, per model.
  console.error('\n=== Per-site agreement (deal-sign) ===\n');
  const sites = Array.from(new Set(rows.map((r) => r.site))).sort();
  const headerCols = MODELS.map((m) => m.label.slice(0, 14).padStart(14)).join(' ');
  console.error(`  ${'site'.padEnd(14)}  ${'n'.padStart(4)}  ${headerCols}`);
  for (const site of sites) {
    const cells: string[] = [];
    let n = 0;
    for (const m of MODELS) {
      let total = 0;
      let signAgree = 0;
      for (const br of allResults) {
        const run = br.runs.find((x) => x.modelId === m.id);
        if (!run?.evaluations) continue;
        for (const ev of run.evaluations) {
          const dbRow = br.rows[ev.listing_index];
          if (!dbRow || dbRow.site !== site || !dbRow.deal_tier) continue;
          total++;
          const modelIsDeal = ev.deal_tier === 'steal' || ev.deal_tier === 'deal';
          const dbIsDeal = dbRow.deal_tier === 'steal' || dbRow.deal_tier === 'deal';
          if (modelIsDeal === dbIsDeal) signAgree++;
        }
      }
      n = Math.max(n, total);
      const pct = total ? Math.round((signAgree / total) * 100) : 0;
      cells.push(`${signAgree}/${total} (${pct}%)`.padStart(14));
    }
    console.error(`  ${site.padEnd(14)}  ${String(n).padStart(4)}  ${cells.join(' ')}`);
  }

  console.error('\n=== Per-site verdict distribution (model = primary 3.1 Flash Lite) ===\n');
  const primaryId = 'google/gemini-3.1-flash-lite-preview-20260303';
  const tiers = ['steal', 'deal', 'fair', 'overpriced', 'irrelevant'] as const;
  const headerTiers = tiers.map((t) => t.padStart(11)).join(' ');
  console.error(`  ${'site'.padEnd(14)}  ${'n'.padStart(4)}  ${headerTiers}`);
  for (const site of sites) {
    const counts: Record<string, number> = {};
    let total = 0;
    for (const br of allResults) {
      const run = br.runs.find((x) => x.modelId === primaryId);
      if (!run?.evaluations) continue;
      for (const ev of run.evaluations) {
        const dbRow = br.rows[ev.listing_index];
        if (!dbRow || dbRow.site !== site) continue;
        counts[ev.deal_tier] = (counts[ev.deal_tier] ?? 0) + 1;
        total++;
      }
    }
    const cells = tiers
      .map((t) => {
        const c = counts[t] ?? 0;
        const pct = total ? Math.round((c / total) * 100) : 0;
        return `${c} (${pct}%)`.padStart(11);
      })
      .join(' ');
    console.error(`  ${site.padEnd(14)}  ${String(total).padStart(4)}  ${cells}`);
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

/**
 * Benchmark: can an LLM generate a useful target config from a natural-language
 * description? This script runs a fixed set of NL prompts through several
 * models and prints the generated YAML side-by-side so we can judge quality.
 *
 * Usage: npx tsx src/scripts/benchmark-config-gen.ts [--model <id>] [--prompt <n>]
 *
 * No arguments = run all 5 prompts x all 4 models. Optional filters let us
 * re-test one (prompt, model) pair without re-running the full matrix.
 */

import 'dotenv/config';
import yaml from 'js-yaml';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// --- Models under test ---
// Ordered cheapest → most expensive for the shared pass-1 cost estimate,
// which is the same lens the Settings panel uses.
const MODELS = [
  { id: 'deepseek/deepseek-chat-v3.1', label: 'DeepSeek V3.1' },
  { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'google/gemini-3.1-flash-lite-preview-20260303', label: 'Gemini 3.1 Flash Lite' },
  { id: 'openai/gpt-5-mini', label: 'GPT-5 Mini' },
  { id: 'anthropic/claude-haiku-4-5', label: 'Claude Haiku 4.5' },
] as const;

// --- Test prompts: mix of exact + hunt, across categories ---
// These mirror the kinds of things the user actually hunts for (see their
// price-reference.yaml): audio gear, a vehicle, keyboard switches, IEMs.
// Each has an `expect` field recording what a "good" output would include,
// for easy human review. Nothing is scored automatically beyond
// YAML-parses + required-fields-present.
interface Prompt {
  id: string;
  nl: string;
  expect: string;
}

const PROMPTS: Prompt[] = [
  {
    id: 'focal-aria-906',
    nl: "I want used Focal Aria 906 bookshelf speakers. US-based sellers only (shipping overseas is a nightmare for fragile speakers). I'm in Boston so if it's on Craigslist or FB Marketplace I want local.",
    expect:
      'Exact item. MSRP ~$1300/pair, fair used ~$700, deal ~$550. sites: audio-focused (hifishark, usaudiomart, audiogon) + general (ebay) + local (craigslist, fbmp). allowed_states: Northeast.',
  },
  {
    id: 'w211-e500',
    nl: "I'm hunting for a 2003-2006 Mercedes-Benz E500 (W211 chassis, M113 5.0 V8). Black preferred, RWD not 4MATIC, under 120k miles. Boston area so maybe 500 miles radius. Big gotcha to watch for is the SBC brake pump — replacement is ~$2500.",
    expect:
      'Exact item. type: vehicle. Sites: craigslist + fbmp (local-only). Notes should mention SBC, airmatic, 722.6 trans. allowed_states: mid-Atlantic+Northeast.',
  },
  {
    id: 'holy-panda',
    nl: "Original Drop+Invyr Holy Panda mechanical keyboard switches — the ORIGINAL, not the mass-market Drop Holy Panda X which is a different switch. Need at least 70 switches for a 65% board. Out of production since ~2020.",
    expect:
      'Exact item. Very low per-switch pricing (~$1 each). Sites: mechmarket + ebay. Notes should distinguish original vs Holy Panda X and mention per-switch price normalization.',
  },
  {
    id: 'endgame-iems',
    nl: "I'm looking for high-end IEMs with EST drivers — tribrid designs, ideally under $2000 used for something that's $3000+ new. Electronic music listener, care about fast treble and transients. Brands I'd consider: Empire Ears, Elysian, 64 Audio, Unique Melody. Not interested in budget chi-fi.",
    expect:
      'Category hunt. Profile should mention EST/tribrid, electronic music, budget band, brand list. Sites: audio (hifishark, usaudiomart, avexchange, ebay). No fixed price tiers.',
  },
  {
    id: 'bookshelf-hunt',
    nl: "Good used bookshelf speaker pairs, $200-800 range. Boston area for local pickup or US shipping. Interested in stuff like Wharfedale Denton, KEF LS50, Monitor Audio Silver, Elac Debut. Not into home theater satellites or Bluetooth speakers.",
    expect:
      'Category hunt. Profile includes brand/model list + exclusions. Sites: hifishark, usaudiomart, ebay, craigslist, fbmp. allowed_states: Northeast.',
  },
];

const SYSTEM_PROMPT = `You help configure a marketplace deal-hunter tool. Given a user's natural-language description of what they're hunting for, output a single YAML document matching this schema. NO markdown fences, NO preamble — just the YAML.

## Schema

For EXACT items (user names a specific product):
\`\`\`
id: lowercase-kebab-case
name: "Human Readable Name"
type: item  # or "vehicle" for cars/trucks
category: audio | auto | keyboards | general
query: "search query string"              # single default
queries: ["q1", "q2"]                     # optional, takes precedence
sites: [hifishark, usaudiomart, craigslist, audiogon, ebay, fbmp, mechmarket, avexchange]
site_overrides:                           # optional per-site query tweaks
  ebay:
    query: "more specific"
allowed_states: [MA, NH, ...]             # US state codes; optional
msrp: 1300                                # USD, typical new retail
fair_used: 700                            # USD, typical used market
deal_price: 550                           # USD, good buy
steal_price: 400                          # USD, below this is likely fake/damaged
grail: "optional, what would be a 💎 find"
notes: |
  Multi-line domain knowledge: gotchas, identification tips, things to check.
shipping_notes: |
  Geography/landed-cost constraints the evaluator should respect.
\`\`\`

For CATEGORY HUNTS (user describes a taste or budget, no specific target):
\`\`\`
id: lowercase-kebab-case
name: "Human Readable Name"
type: category_hunt
category: audio | auto | keyboards | general
queries: ["search term 1", "search term 2", ...]
sites: [...]
allowed_states: [...]                     # optional
shipping_notes: |
  ...
profile: |
  Multi-paragraph free-text buyer profile. Include: what they want, budget
  range, specific brands/models of interest (with typical used prices), what
  NOT to surface, condition requirements, key judgment criteria. The LLM
  evaluator uses this to judge each listing against its own used market value.
\`\`\`

## Choosing sites by category

- audio gear → hifishark, usaudiomart, audiogon, avexchange, ebay, and for local pickup: craigslist + fbmp
- vehicles → craigslist + fbmp ONLY (local pickup only)
- mechanical keyboards → mechmarket + ebay
- general items → ebay + craigslist + fbmp

## Choosing type

- If the user names a specific product and can reasonably estimate MSRP and used price → "item" (or "vehicle" for cars)
- If they describe a category, taste, or budget range with multiple acceptable products → "category_hunt"

## Pricing guidance (exact items only)

Use your world knowledge to estimate realistic USD prices. The four tiers:
- msrp: new retail
- fair_used: typical used-market price for good condition (roughly 50-60% of MSRP for mainstream items, higher for rare/in-demand)
- deal_price: "I'd buy this immediately" — roughly 75-80% of fair_used
- steal_price: "drop everything" — roughly 50-60% of fair_used. Below this, risk of fake/damaged/stolen

## Output

Respond with ONLY the YAML document. No fences, no commentary.`;

interface ModelResult {
  modelId: string;
  modelLabel: string;
  prompt: Prompt;
  rawOutput: string;
  parsed: unknown | null;
  validationErrors: string[];
  durationMs: number;
  promptTokens?: number;
  completionTokens?: number;
  error?: string;
}

async function callModel(model: string, prompt: Prompt): Promise<Omit<ModelResult, 'modelLabel' | 'prompt'>> {
  const apiKey = process.env.OPENROUTER_API_KEY ?? process.env.OPEN_ROUTER_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const start = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000);

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/local/deal-hunter',
        'X-Title': 'deal-hunter-bench',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt.nl },
        ],
        temperature: 0.2,
        // NOTE: no response_format — we want YAML, not JSON
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        modelId: model,
        rawOutput: '',
        parsed: null,
        validationErrors: [],
        durationMs: Date.now() - start,
        error: `HTTP ${res.status}: ${body.slice(0, 300)}`,
      };
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const raw = data.choices?.[0]?.message?.content ?? '';
    const parsed = parseYaml(raw);
    const errs = parsed ? validate(parsed as Record<string, unknown>) : ['did not parse as YAML'];

    return {
      modelId: model,
      rawOutput: raw,
      parsed,
      validationErrors: errs,
      durationMs: Date.now() - start,
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
    };
  } catch (err) {
    return {
      modelId: model,
      rawOutput: '',
      parsed: null,
      validationErrors: [],
      durationMs: Date.now() - start,
      error: String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseYaml(raw: string): unknown | null {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned
      .replace(/^```(?:yaml|yml)?/, '')
      .replace(/```$/, '')
      .trim();
  }
  try {
    return yaml.load(cleaned);
  } catch {
    return null;
  }
}

const VALID_SITES = new Set([
  'hifishark',
  'usaudiomart',
  'craigslist',
  'audiogon',
  'ebay',
  'fbmp',
  'mechmarket',
  'avexchange',
]);

function validate(ref: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (!ref.id || typeof ref.id !== 'string') errors.push('missing id');
  if (!ref.name || typeof ref.name !== 'string') errors.push('missing name');

  const type = ref.type as string | undefined;
  if (!type) errors.push('missing type');

  const hasQuery = typeof ref.query === 'string' || Array.isArray(ref.queries);
  if (!hasQuery) errors.push('missing query/queries');

  const sites = ref.sites as unknown;
  if (!Array.isArray(sites) || sites.length === 0) {
    errors.push('missing sites[]');
  } else {
    const bad = (sites as string[]).filter((s) => !VALID_SITES.has(s));
    if (bad.length > 0) errors.push(`invalid sites: ${bad.join(', ')}`);
  }

  const isHunt = type === 'category_hunt';
  if (isHunt) {
    if (!ref.profile || typeof ref.profile !== 'string' || (ref.profile as string).length < 80) {
      errors.push('hunt: profile missing or too short');
    }
  } else {
    // Exact item needs pricing tiers
    const needed = ['msrp', 'fair_used', 'deal_price', 'steal_price'];
    const missing = needed.filter((k) => typeof ref[k] !== 'number');
    if (missing.length > 0) errors.push(`exact: missing tiers: ${missing.join(', ')}`);
  }

  return errors;
}

// --- CLI args ---
function parseArgs(argv: string[]): { model?: string; promptId?: string } {
  const out: { model?: string; promptId?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--model') out.model = argv[++i];
    if (argv[i] === '--prompt') out.promptId = argv[++i];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const models = args.model ? MODELS.filter((m) => m.id === args.model) : MODELS;
  const prompts = args.promptId ? PROMPTS.filter((p) => p.id === args.promptId) : PROMPTS;

  if (models.length === 0 || prompts.length === 0) {
    console.error('No models or prompts matched the filter. Aborting.');
    process.exit(1);
  }

  console.error(`Running ${prompts.length} prompts × ${models.length} models = ${prompts.length * models.length} calls\n`);

  const results: ModelResult[] = [];
  // Run prompts sequentially but models in parallel per prompt
  for (const prompt of prompts) {
    console.error(`\n=== prompt: ${prompt.id} ===`);
    console.error(`NL: ${prompt.nl}`);
    console.error(`Expect: ${prompt.expect}`);
    const batch = await Promise.all(
      models.map((m) =>
        callModel(m.id, prompt).then((r) => ({
          ...r,
          modelLabel: m.label,
          prompt,
        })),
      ),
    );
    for (const r of batch) {
      const tag = r.error
        ? `ERROR (${r.durationMs}ms)`
        : r.validationErrors.length === 0
          ? `OK (${r.durationMs}ms)`
          : `WARN (${r.validationErrors.length} issues, ${r.durationMs}ms)`;
      console.error(`  ${r.modelLabel}: ${tag}`);
    }
    results.push(...batch);
  }

  // Write a report
  const outDir = resolve(process.cwd(), 'logs');
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = resolve(outDir, `config-gen-bench-${stamp}.md`);

  let report = `# Config generation benchmark — ${new Date().toLocaleString()}\n\n`;
  report += `System prompt: ${SYSTEM_PROMPT.length} chars\n\n`;
  report += `## Models tested\n\n`;
  for (const m of models) report += `- ${m.label} (\`${m.id}\`)\n`;
  report += `\n## Results\n\n`;

  for (const prompt of prompts) {
    report += `### Prompt: \`${prompt.id}\`\n\n`;
    report += `**NL**: ${prompt.nl}\n\n`;
    report += `**Expected**: ${prompt.expect}\n\n`;

    const group = results.filter((r) => r.prompt.id === prompt.id);
    for (const r of group) {
      report += `#### ${r.modelLabel}\n\n`;
      if (r.error) {
        report += `**ERROR**: \`${r.error}\`\n\n`;
        continue;
      }
      report += `- Duration: ${r.durationMs}ms\n`;
      if (r.promptTokens) report += `- Tokens: ${r.promptTokens} in / ${r.completionTokens ?? '?'} out\n`;
      if (r.validationErrors.length > 0) {
        report += `- **Validation issues**: ${r.validationErrors.join('; ')}\n`;
      } else {
        report += `- **Validation**: ✓ all required fields present\n`;
      }
      report += `\n\`\`\`yaml\n${r.rawOutput.trim()}\n\`\`\`\n\n`;
    }
  }

  writeFileSync(reportPath, report, 'utf8');
  console.error(`\nReport written to: ${reportPath}`);

  // Also print a quick summary table
  console.error(`\n=== Summary ===`);
  console.error('Model'.padEnd(22) + 'OK/total    avg latency   tokens in/out');
  for (const m of models) {
    const group = results.filter((r) => r.modelId === m.id);
    const ok = group.filter((r) => !r.error && r.validationErrors.length === 0).length;
    const avgMs = Math.round(
      group.reduce((a, r) => a + r.durationMs, 0) / Math.max(group.length, 1),
    );
    const totalIn = group.reduce((a, r) => a + (r.promptTokens ?? 0), 0);
    const totalOut = group.reduce((a, r) => a + (r.completionTokens ?? 0), 0);
    console.error(
      m.label.padEnd(22) +
        `${ok}/${group.length}`.padEnd(12) +
        `${avgMs}ms`.padEnd(14) +
        `${totalIn}/${totalOut}`,
    );
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});

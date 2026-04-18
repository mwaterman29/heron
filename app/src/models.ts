/**
 * Curated list of OpenRouter models suitable for listing evaluation.
 * Prices are per 1M tokens in USD. Update periodically; OpenRouter's own
 * /models endpoint has the authoritative numbers but requires a network call.
 *
 * Rough per-listing cost estimation:
 *   - pass-1: ~800 input tokens + ~300 output per listing (batched 25/chunk)
 *   - pass-2: ~4000 input + ~400 output per deal candidate (0–5/run typically)
 *
 * A typical daily run scrapes ~100 listings → ~12 batches × 13K tokens =
 * ~150K input + 60K output for pass-1. Pass-2 adds maybe 20K input + 2K output.
 *
 * Ordered roughly by recommendation quality for this workload. The first
 * entry is the current default (see src/evaluator.ts). Benchmarks live in
 * src/scripts/benchmark-evaluator.ts and src/scripts/benchmark-config-gen.ts.
 */

export interface ModelOption {
  id: string;
  label: string;
  vendor: string;
  /** USD per 1M input tokens */
  input_per_1m: number;
  /** USD per 1M output tokens */
  output_per_1m: number;
  /** Recommended pass (1 = fast filter, 2 = detail reasoning, 0 = either) */
  recommended_pass: 0 | 1 | 2;
  /** Free-form notes shown in the dropdown subtitle */
  note?: string;
}

export const MODEL_CATALOG: ModelOption[] = [
  // Google Gemini — current default (benchmarked ~13x faster and ~6x cheaper
  // than DeepSeek V3.1 with equal-or-better judgment on marginal calls).
  {
    id: 'google/gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    vendor: 'Google',
    input_per_1m: 0.15,
    output_per_1m: 0.60,
    recommended_pass: 0,
    note: 'Default. Fast, strong world knowledge, handles JSON mode cleanly.',
  },
  // DeepSeek — reliable fallback, slower but well-tested in this pipeline
  {
    id: 'deepseek/deepseek-chat-v3.1',
    label: 'DeepSeek V3.1',
    vendor: 'DeepSeek',
    input_per_1m: 0.27,
    output_per_1m: 1.10,
    recommended_pass: 0,
    note: 'Reliable fallback. Thorough reasoning but slower.',
  },
  {
    id: 'deepseek/deepseek-v3.2-exp',
    label: 'DeepSeek V3.2 Exp',
    vendor: 'DeepSeek',
    input_per_1m: 0.27,
    output_per_1m: 1.10,
    recommended_pass: 0,
    note: 'Experimental 3.2.',
  },
  // Anthropic
  {
    id: 'anthropic/claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    vendor: 'Anthropic',
    input_per_1m: 0.80,
    output_per_1m: 4.00,
    recommended_pass: 1,
    note: 'Fast. Watch for factual errors on older/rarer items.',
  },
  {
    id: 'anthropic/claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    vendor: 'Anthropic',
    input_per_1m: 3.00,
    output_per_1m: 15.00,
    recommended_pass: 2,
    note: 'Best reasoning for pass-2 (but ~25x cost of default).',
  },
  // OpenAI
  {
    id: 'openai/gpt-5-mini',
    label: 'GPT-5 Mini',
    vendor: 'OpenAI',
    input_per_1m: 0.15,
    output_per_1m: 0.60,
    recommended_pass: 1,
    note: 'Thorough but slow; outputs much more than needed.',
  },
  {
    id: 'openai/gpt-5',
    label: 'GPT-5',
    vendor: 'OpenAI',
    input_per_1m: 2.50,
    output_per_1m: 10.00,
    recommended_pass: 2,
    note: 'Premium reasoning.',
  },
  {
    id: 'google/gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    vendor: 'Google',
    input_per_1m: 1.25,
    output_per_1m: 5.00,
    recommended_pass: 2,
    note: 'Gemini step-up for hard calls.',
  },
];

/** Find a model in the catalog, returning null if unknown (e.g. user typed a custom ID). */
export function findModel(id: string | null | undefined): ModelOption | null {
  if (!id) return null;
  return MODEL_CATALOG.find((m) => m.id === id) ?? null;
}

/**
 * Estimate the cost (USD) of a typical daily run using this model.
 * Assumes: 100 listings scraped → 12 pass-1 batches × (13K in + 5K out) + 3 pass-2 drill-downs.
 * Returns a rough dollar figure; useful for rough comparison, not billing.
 */
export function estimateDailyCost(m: ModelOption): number {
  const pass1InTok = 12 * 13_000;
  const pass1OutTok = 12 * 5_000;
  const pass2InTok = 3 * 4_000;
  const pass2OutTok = 3 * 400;
  const inputCost = ((pass1InTok + pass2InTok) / 1_000_000) * m.input_per_1m;
  const outputCost = ((pass1OutTok + pass2OutTok) / 1_000_000) * m.output_per_1m;
  return inputCost + outputCost;
}

export function formatDailyCost(m: ModelOption): string {
  const c = estimateDailyCost(m);
  if (c < 0.01) return '< $0.01/day';
  if (c < 0.10) return `~$${c.toFixed(3)}/day`;
  return `~$${c.toFixed(2)}/day`;
}

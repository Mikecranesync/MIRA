/**
 * THE one per-model OpenAI price table for the Hub (#4961, #4968).
 *
 * OpenAI bills per MODEL, and `OPENAI_MODEL` / `OPENAI_CLASSIFIER_MODEL` can
 * name any model, so both readers of an OpenAI price key it by model id:
 *  - telemetry: `estimateCostUsd` in `lib/inference/canonical-cascade.ts`
 *    (`costUsdEstimate`, persisted usage);
 *  - the spend cap: `OpenAiRunBudget` in `capabilities/openai-run-budget.ts`.
 * One table, so the number a turn records and the number the cap counts cannot
 * drift apart.
 *
 * Standard-tier list prices, USD per 1M tokens, from
 * https://developers.openai.com/api/docs/pricing (fetched 2026-10-29). They
 * equal `tools/review_router/prices.json`, which the tests pin entry by entry.
 * Cached input is not listed here: telemetry bills it at 10% of the input
 * rate, and the cap counts every input token at the full rate.
 *
 * A model missing here is UNPRICED: telemetry records null and the cap refuses
 * the call. Never 0, and never another model's rate.
 * Invalidation trigger: an OpenAI price change, or a model in use that is not
 * listed here.
 */
export type OpenAiPrice = { readonly input: number; readonly output: number };

export const OPENAI_PRICE_PER_MTOK_BY_MODEL: Readonly<Record<string, OpenAiPrice>> = {
  "gpt-6-astra": { input: 10.0, output: 50.0 },
  "gpt-6-sol": { input: 2.0, output: 10.0 },
  "gpt-6.1-sol": { input: 2.0, output: 10.0 },
  "gpt-6-luna": { input: 0.1, output: 0.5 },
  "gpt-5.5": { input: 5.0, output: 30.0 },
  "gpt-5.4": { input: 2.5, output: 15.0 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5 },
  "gpt-5.4-nano": { input: 0.2, output: 1.25 },
  "gpt-5-mini": { input: 0.25, output: 2.0 },
  "gpt-5-nano": { input: 0.05, output: 0.4 },
};

/** The declared price for `model`, or null when it is unpriced (callers must not substitute a rate). */
export function openAiPricePerMtok(model: string | null | undefined): OpenAiPrice | null {
  if (!model) return null;
  const key = model.trim();
  return Object.prototype.hasOwnProperty.call(OPENAI_PRICE_PER_MTOK_BY_MODEL, key) ? OPENAI_PRICE_PER_MTOK_BY_MODEL[key] : null;
}

/**
 * Hub runtime identity (#4507) — what this process is actually running, as
 * two non-secret values the Stranger Walk (#4461) reads from `/api/health`:
 *
 * - `deploymentGeneration`: one id per PROCESS, minted at module load. A
 *   container recreate from the same image, or an A→B→A rollback, gets a new
 *   one, which the build identity (`gitSha` + `builtAt`) cannot show. It starts
 *   with the boot instant so generations order by time; a random suffix keeps
 *   two containers booted in the same millisecond apart.
 * - `inferenceFingerprint`: a short sha256 plus a readable summary of the
 *   EFFECTIVE cascade this process bills with — the providers the notebook
 *   route can dispatch this turn (`effectiveNotebookProviders()`: the legacy
 *   list when the seam is off, the canonical one when on, keyless entries
 *   dropped — #5048), each model id and its declared accounting rate, the
 *   per-turn output cap, the canonical seam flag and the optional metered
 *   lanes: Jev shadow/decision, the paid query-rewrite call with its own
 *   providers, model, cap and rate (#5049), and the post-answer safety judge
 *   (#5050). `notebookMaxOutputTokens` is what the answer call requests,
 *   which is smaller than the per-turn ceiling (#5051). Read at call time, so a Doppler
 *   change the running Hub has not picked up is not reported, and one it has
 *   picked up is — which is exactly the question the walk asks.
 *
 * Secrets never enter the summary: provider keys and URLs are dropped before
 * hashing, so a rotated key leaves the fingerprint unchanged.
 */
import { createHash, randomBytes } from "node:crypto";

import { JUDGE_OUTPUT_TOKENS, semanticCheckEnabled } from "../../capabilities/answer-safety-check";
import { jevDecisionEnabled, jevShadowEnabled } from "../../capabilities/observability/config";
import { openAiModelDispatchable } from "../../capabilities/openai-run-budget";
import { QUERY_REWRITE_MAX_TOKENS, queryRewriteEnabled } from "../../capabilities/query-rewrite";
import { classifierProviders } from "../llm/cascade";
import { canonicalProviders, canonicalSeamEnabled, declaredPricePerMtok, maxOutputTokens } from "./canonical-cascade";
import { effectiveNotebookProviders } from "./legacy-cascade";

const GENERATION = `${new Date().toISOString()}-${randomBytes(6).toString("hex")}`;

export function deploymentGeneration(): string {
  return GENERATION;
}

export type ProviderFingerprint = {
  name: string;
  model: string;
  /** The rate this Hub books the provider's usage at; null when unpriced. */
  pricePerMtok: { input: number; output: number; cached_input?: number } | null;
};

export type QueryRewriteLane =
  | { enabled: false }
  | { enabled: true; maxOutputTokens: number; providers: ProviderFingerprint[] };

/** The post-answer safety judge (#5050): its own cap and its own providers. */
export type SafetyJudgeLane = QueryRewriteLane;

/**
 * The most output the notebook answer call requests (#5051). The chat route
 * asks for min(1400, turn cap) with the seam on and 1400 with it off; a source
 * pin in the test keeps this equal to the route's literals.
 */
export const NOTEBOOK_ANSWER_MAX_OUTPUT_TOKENS = 1400;

export type InferenceFingerprintSummary = {
  canonicalSeam: boolean;
  /** The per-turn ceiling (MIRA_TURN_MAX_OUTPUT_TOKENS), not the request size. */
  maxOutputTokens: number;
  /** What the notebook answer call actually requests at most (#5051). */
  notebookMaxOutputTokens: number;
  providers: ProviderFingerprint[];
  optionalMetered: {
    jevShadow: boolean;
    jevDecision: boolean;
    queryRewrite: QueryRewriteLane;
    safetyJudge: SafetyJudgeLane;
  };
};

export type InferenceFingerprint = { hash: string; summary: InferenceFingerprintSummary };

/** An explicit per-Mtok override from env, or null when unset / junk / not > 0 (same rule as the OpenAI run budget). */
function envPrice(name: string): number | null {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Name, model and booked rate only — never the key or URL. */
function fingerprintOf(p: { name: string; model: string }): ProviderFingerprint {
  let price = declaredPricePerMtok(p.name, p.model);
  if (price && p.name === "OpenAI") {
    // The OpenAI spend cap honours these overrides when it bills, so the
    // fingerprint must too (`capabilities/openai-run-budget.ts`).
    const input = envPrice("OPENAI_PRICE_PER_MTOK_IN");
    const output = envPrice("OPENAI_PRICE_PER_MTOK_OUT");
    price = { ...price, ...(input ? { input } : {}), ...(output ? { output } : {}) };
  }
  return { name: p.name, model: p.model, pricePerMtok: price };
}

/**
 * What dispatch can actually reach: keyless entries are skipped by every
 * serving loop, and an OpenAI entry whose model the price table does not list
 * is refused by the budget gate before any fetch (#4968) — the same static
 * rule, shared, so the fingerprint never advertises a provider that cannot
 * serve (#5047 round 2 F1). A non-OpenAI provider with no declared rate is
 * still dispatched and so still listed, at a null rate.
 */
function dispatchable(p: { name: string; key?: string; model: string }): boolean {
  if (!p.key) return false;
  return p.name !== "OpenAI" || openAiModelDispatchable(p.model);
}

function queryRewriteLane(): QueryRewriteLane {
  if (!queryRewriteEnabled()) return { enabled: false };
  return {
    enabled: true,
    maxOutputTokens: QUERY_REWRITE_MAX_TOKENS,
    providers: classifierProviders().filter(dispatchable).map(fingerprintOf),
  };
}

/**
 * The judge runs on every gated turn unless NOTEBOOK_SEMANTIC_CHECK=0, and it
 * dispatches from the canonical list whatever the seam flag says
 * (`semanticSafetyCheck`), so with the seam off its providers differ from the
 * answer's.
 */
function safetyJudgeLane(): SafetyJudgeLane {
  if (!semanticCheckEnabled()) return { enabled: false };
  return {
    enabled: true,
    maxOutputTokens: JUDGE_OUTPUT_TOKENS,
    providers: canonicalProviders().filter(dispatchable).map(fingerprintOf),
  };
}

export function inferenceFingerprint(): InferenceFingerprint {
  const seam = canonicalSeamEnabled();
  const cap = maxOutputTokens();
  const summary: InferenceFingerprintSummary = {
    canonicalSeam: seam,
    maxOutputTokens: cap,
    notebookMaxOutputTokens: seam ? Math.min(NOTEBOOK_ANSWER_MAX_OUTPUT_TOKENS, cap) : NOTEBOOK_ANSWER_MAX_OUTPUT_TOKENS,
    providers: effectiveNotebookProviders().filter(dispatchable).map(fingerprintOf),
    optionalMetered: {
      jevShadow: jevShadowEnabled(),
      jevDecision: jevDecisionEnabled(),
      queryRewrite: queryRewriteLane(),
      safetyJudge: safetyJudgeLane(),
    },
  };
  const hash = createHash("sha256").update(JSON.stringify(summary)).digest("hex").slice(0, 16);
  return { hash, summary };
}

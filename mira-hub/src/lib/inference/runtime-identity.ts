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
 *   lanes: Jev shadow/decision and the paid query-rewrite call with its own
 *   providers, model, cap and rate (#5049). Read at call time, so a Doppler
 *   change the running Hub has not picked up is not reported, and one it has
 *   picked up is — which is exactly the question the walk asks.
 *
 * Secrets never enter the summary: provider keys and URLs are dropped before
 * hashing, so a rotated key leaves the fingerprint unchanged.
 */
import { createHash, randomBytes } from "node:crypto";

import { jevDecisionEnabled, jevShadowEnabled } from "../../capabilities/observability/config";
import { QUERY_REWRITE_MAX_TOKENS, queryRewriteEnabled } from "../../capabilities/query-rewrite";
import { classifierProviders } from "../llm/cascade";
import { canonicalSeamEnabled, declaredPricePerMtok, maxOutputTokens } from "./canonical-cascade";
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

export type InferenceFingerprintSummary = {
  canonicalSeam: boolean;
  maxOutputTokens: number;
  providers: ProviderFingerprint[];
  optionalMetered: { jevShadow: boolean; jevDecision: boolean; queryRewrite: QueryRewriteLane };
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

function queryRewriteLane(): QueryRewriteLane {
  if (!queryRewriteEnabled()) return { enabled: false };
  return {
    enabled: true,
    maxOutputTokens: QUERY_REWRITE_MAX_TOKENS,
    // `cascadeComplete` skips keyless entries, the same rule as the notebook loop.
    providers: classifierProviders()
      .filter((p) => Boolean(p.key))
      .map(fingerprintOf),
  };
}

export function inferenceFingerprint(): InferenceFingerprint {
  const summary: InferenceFingerprintSummary = {
    canonicalSeam: canonicalSeamEnabled(),
    maxOutputTokens: maxOutputTokens(),
    providers: effectiveNotebookProviders().map(fingerprintOf),
    optionalMetered: {
      jevShadow: jevShadowEnabled(),
      jevDecision: jevDecisionEnabled(),
      queryRewrite: queryRewriteLane(),
    },
  };
  const hash = createHash("sha256").update(JSON.stringify(summary)).digest("hex").slice(0, 16);
  return { hash, summary };
}

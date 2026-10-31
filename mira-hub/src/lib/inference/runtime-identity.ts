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
 *   EFFECTIVE cascade this process bills with — the providers in cascade
 *   order (key-gated, as `canonicalProviders()` resolves them), each model id
 *   and its declared accounting rate, the per-turn output cap, the canonical
 *   seam flag and the optional metered lanes. Read at call time, so a Doppler
 *   change the running Hub has not picked up is not reported, and one it has
 *   picked up is — which is exactly the question the walk asks.
 *
 * Secrets never enter the summary: provider keys and URLs are dropped before
 * hashing, so a rotated key leaves the fingerprint unchanged.
 */
import { createHash, randomBytes } from "node:crypto";

import { jevDecisionEnabled, jevShadowEnabled } from "../../capabilities/observability/config";
import {
  canonicalProviders,
  canonicalSeamEnabled,
  declaredPricePerMtok,
  maxOutputTokens,
} from "./canonical-cascade";

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

export type InferenceFingerprintSummary = {
  canonicalSeam: boolean;
  maxOutputTokens: number;
  providers: ProviderFingerprint[];
  optionalMetered: { jevShadow: boolean; jevDecision: boolean };
};

export type InferenceFingerprint = { hash: string; summary: InferenceFingerprintSummary };

/** An explicit per-Mtok override from env, or null when unset / junk / not > 0 (same rule as the OpenAI run budget). */
function envPrice(name: string): number | null {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function inferenceFingerprint(): InferenceFingerprint {
  const providers: ProviderFingerprint[] = canonicalProviders().map((p) => {
    let price = declaredPricePerMtok(p.name, p.model);
    if (price && p.name === "OpenAI") {
      // The OpenAI spend cap honours these overrides when it bills, so the
      // fingerprint must too (`capabilities/openai-run-budget.ts`).
      const input = envPrice("OPENAI_PRICE_PER_MTOK_IN");
      const output = envPrice("OPENAI_PRICE_PER_MTOK_OUT");
      price = { ...price, ...(input ? { input } : {}), ...(output ? { output } : {}) };
    }
    return { name: p.name, model: p.model, pricePerMtok: price };
  });
  const summary: InferenceFingerprintSummary = {
    canonicalSeam: canonicalSeamEnabled(),
    maxOutputTokens: maxOutputTokens(),
    providers,
    optionalMetered: { jevShadow: jevShadowEnabled(), jevDecision: jevDecisionEnabled() },
  };
  const hash = createHash("sha256").update(JSON.stringify(summary)).digest("hex").slice(0, 16);
  return { hash, summary };
}

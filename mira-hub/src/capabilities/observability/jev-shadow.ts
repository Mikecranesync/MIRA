/**
 * Jev shadow judgment — evidence sufficiency as a calibrated probability.
 *
 * SHADOW MODE ONLY (2026-09-22 probe, docs/research/2026-09-22-jev-typesafe-
 * credential-probe.md): one fail-open call to TypeSafe AI's System One model
 * after retrieval, recorded on the Turn Evidence Packet and the retrieval span
 * so it can be compared against the wire outcome on real staging traffic.
 * Nothing reads it: the answer gate, the badge, the prompt, and citations are
 * unchanged. Promotion from "recorded" to "consulted" is a separate, explicit
 * decision (materialized-evidence rule 9: model output never self-promotes).
 *
 * Why this seam: today `evidenceSufficient` is a PRESENCE test (chunks > 0).
 * The acceptance loop's live case 2 retrieved six Siemens chunks, none of
 * which held the asked-for value; a RELEVANCE judgment is what was missing. In
 * the probe Jev rejected a same-vendor wrong-model chunk (0.05) and a
 * right-model wrong-quantity chunk (0.03) while accepting a hedged-but-specific
 * range (0.91), deterministically, in ~450 ms.
 *
 * Zero-token rule (5 questions): what varies — the question + retrieved
 * evidence; what is stable — the sufficiency rubric (JEV_INSTRUCTIONS, versioned
 * below); artifact — this file's instruction string + threshold; test —
 * jev-shadow.test.ts (request shape, sanitization, fail-open, disabled path);
 * invalidation — JEV_INSTRUCTIONS_VERSION or model pin change.
 *
 * Privacy: the state sent to the vendor is the technician's question, the
 * photo OBSERVATION text that was in context for this turn (when there was
 * one), and retrieved chunk EXCERPTS — all capped. It never includes cookies,
 * ids, tenant identifiers, file bytes, or the model's answer. IPv4/MAC/serial
 * patterns are scrubbed before sending (the same shapes langfuse_setup._scrub
 * redacts). The key is read from the environment at call time and never logged.
 *
 * Why observations are evidence here (sufficiency-v2, 2026-10-12): the first
 * 131 judged staging turns were 74% photo turns ("what can you tell from this
 * photo?"), answered from the nameplate reading the vision model produced.
 * v1 sent only the retrieved manual chunks, which cannot describe a photo, so
 * every such turn scored low (median 0.2) regardless of whether the answer was
 * grounded — a blind spot in the measurement, not a verdict on the turn. The
 * decision lane (jev-decision.ts) already sends the same observation text under
 * the audited privacy note (docs/proofs/2026-09-23-jev-decision-privacy.md);
 * this lane now uses the same cap. v1 and v2 scores are NOT poolable
 * (`JEV_INSTRUCTIONS_VERSION` rides on the packet so the report can tell).
 */

import { jevShadowEnabled } from "./config";
import { setSpanAttrs } from "./tracing";

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
/** Pinned: `jev-latest` is a moving alias. Bump deliberately. */
export const JEV_MODEL = "jev-1.13.0";
export const JEV_INSTRUCTIONS_VERSION = "sufficiency-v2";
export const JEV_INSTRUCTIONS =
  "Is the provided evidence sufficient to answer the technician's question with a specific, grounded fact about THIS equipment? " +
  "Answer no if the evidence is generic, is about a different model, does not contain the asked-for quantity, or is absent. " +
  "A photo observation listed under Observations is evidence about THIS equipment.";

const MAX_QUESTION_CHARS = 600;
const MAX_CHUNK_CHARS = 700;
const MAX_CHUNKS = 6;
/** Mirrors MAX_OBSERVATION in turn-decision-state.ts (which imports from this
 *  module, so the constant cannot be shared without a cycle). */
const MAX_OBSERVATION_CHARS = 900;
const DEFAULT_TIMEOUT_MS = 1500;

export type JevShadowResult = {
  /** probability that the evidence is sufficient (Jev `noul`), or null when not run */
  noul: number | null;
  /** how many photo observations were in the state sent (sufficiency-v2), or null when not run */
  observation_count: number | null;
  /** why noul is null: disabled | no_key | no_evidence | timeout | http_<status> | error */
  skipped_reason: string | null;
  latency_ms: number | null;
  model: string | null;
  input_tokens: number | null;
  instructions_version: string;
};

export { jevShadowEnabled } from "./config";

/** IPv4 / MAC / serial-number shapes → placeholders, mirroring the Python scrub. */
export function scrubForVendor(text: string): string {
  return text
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[IP]")
    .replace(/\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g, "[MAC]")
    .replace(/\b(S\/?N|serial(?:\s+no\.?|\s+number)?)([:\s#]*)[A-Z0-9-]{6,}\b/gi, "$1$2[SN]");
}

/** Pure: the exact request body. Exported so tests assert on it byte-for-byte. */
export function buildJevSufficiencyRequest(
  question: string,
  evidence: readonly { content: string; title?: string | null }[],
  observations: readonly string[] = [],
): { model: string; state: string; questions: Record<string, { type: "noul"; instructions: string }> } {
  const q = scrubForVendor(question.trim()).slice(0, MAX_QUESTION_CHARS);
  const chunks = evidence.slice(0, MAX_CHUNKS).map((c, i) => {
    const title = (c.title ?? "").trim();
    const body = scrubForVendor(c.content.trim()).slice(0, MAX_CHUNK_CHARS);
    return `[${i + 1}${title ? ` ${title.slice(0, 80)}` : ""}] ${body}`;
  });
  // The Observations section appears only when there is one, so a chunks-only
  // state is byte-identical to v1 and the two can be diffed on the wire.
  const obs = observations.map((o, i) => `[observation ${i + 1}] ${scrubForVendor(o.trim()).slice(0, MAX_OBSERVATION_CHARS)}`);
  const state =
    `Question: ${q}\n` +
    (obs.length ? `Observations:\n${obs.join("\n")}\n` : "") +
    `Evidence:\n${chunks.length ? chunks.join("\n") : "[none retrieved]"}`;
  return { model: JEV_MODEL, state, questions: { sufficient: { type: "noul", instructions: JEV_INSTRUCTIONS } } };
}

/**
 * Fail-open shadow call. Never throws; never blocks longer than the timeout;
 * records the outcome on the active span. `fetchImpl` is injectable for tests.
 */
export async function judgeEvidenceSufficiencyShadow(
  question: string,
  evidence: readonly { content: string; title?: string | null }[],
  opts: {
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
    apiKey?: string;
    /** Photo observation text in context for THIS turn (sufficiency-v2). Empty strings are dropped. */
    observations?: readonly (string | null | undefined)[];
  } = {},
): Promise<JevShadowResult> {
  const observations = (opts.observations ?? []).map((o) => (o ?? "").trim()).filter(Boolean);
  const base: JevShadowResult = {
    noul: null,
    observation_count: null,
    skipped_reason: null,
    latency_ms: null,
    model: null,
    input_tokens: null,
    instructions_version: JEV_INSTRUCTIONS_VERSION,
  };
  if (!jevShadowEnabled()) return { ...base, skipped_reason: "disabled" };
  const apiKey = opts.apiKey ?? process.env.JEV_API_KEY;
  if (!apiKey) return { ...base, skipped_reason: "no_key" };
  // Nothing retrieved AND no observation → nothing to judge; a call would be a
  // metered request whose answer is known. (A machine packet is still not sent.)
  if (evidence.length === 0 && observations.length === 0) return { ...base, skipped_reason: "no_evidence" };

  const body = buildJevSufficiencyRequest(question, evidence, observations);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await (opts.fetchImpl ?? fetch)(JEV_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const latency = Date.now() - started;
    if (!res.ok) return record({ ...base, skipped_reason: `http_${res.status}`, latency_ms: latency });
    const json = (await res.json()) as {
      model?: string;
      answers?: { sufficient?: { noul?: number } };
      usage?: { input_tokens?: number };
    };
    const noul = json.answers?.sufficient?.noul;
    if (typeof noul !== "number") return record({ ...base, skipped_reason: "malformed", latency_ms: latency });
    return record({
      ...base,
      noul,
      observation_count: observations.length,
      latency_ms: latency,
      model: json.model ?? null,
      input_tokens: typeof json.usage?.input_tokens === "number" ? json.usage.input_tokens : null,
    });
  } catch (err) {
    const aborted = (err as { name?: string } | null)?.name === "AbortError";
    return record({ ...base, skipped_reason: aborted ? "timeout" : "error", latency_ms: Date.now() - started });
  } finally {
    clearTimeout(timer);
  }
}

function record(r: JevShadowResult): JevShadowResult {
  try {
    setSpanAttrs({
      "mira.evidence.jev_sufficient": r.noul,
      "mira.evidence.jev_observation_count": r.observation_count,
      "mira.evidence.jev_skipped_reason": r.skipped_reason,
      "mira.evidence.jev_latency_ms": r.latency_ms,
      "mira.evidence.jev_model": r.model,
      "mira.evidence.jev_instructions_version": r.instructions_version,
    });
  } catch {
    /* telemetry never changes the outcome */
  }
  return r;
}

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
 * Privacy: the state sent to the vendor is the technician's question plus
 * retrieved chunk EXCERPTS (capped). It never includes cookies, ids, tenant
 * identifiers, or the model's answer. IPv4/MAC/serial patterns are scrubbed
 * before sending (the same shapes langfuse_setup._scrub redacts). The key is
 * read from the environment at call time and never logged.
 */

import { jevShadowEnabled } from "./config";
import { setSpanAttrs } from "./tracing";

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
/** Pinned: `jev-latest` is a moving alias. Bump deliberately. */
export const JEV_MODEL = "jev-1.13.0";
export const JEV_INSTRUCTIONS_VERSION = "sufficiency-v1";
export const JEV_INSTRUCTIONS =
  "Is the provided evidence sufficient to answer the technician's question with a specific, grounded fact about THIS equipment? " +
  "Answer no if the evidence is generic, is about a different model, does not contain the asked-for quantity, or is absent.";

/** Exp B: chunk selection instructions */
export const JEV_CHOICE_INSTRUCTIONS_VERSION = "chunk-select-v1";
export const JEV_CHOICE_INSTRUCTIONS =
  "Which single evidence chunk (by its bracket number) is the BEST source to answer the technician's question? " +
  "Pick the chunk that most directly addresses the specific question asked, prioritizing exact values, model-specific details, and completeness. " +
  "Answer with only the bracket number (1-6) of the best chunk, or 0 if no chunk adequately addresses the question.";

const MAX_QUESTION_CHARS = 600;
const MAX_CHUNK_CHARS = 700;
const MAX_CHUNKS = 6;
const DEFAULT_TIMEOUT_MS = 1500;

export type JevShadowResult = {
  /** probability that the evidence is sufficient (Jev `noul`), or null when not run */
  noul: number | null;
  /** why noul is null: disabled | no_key | no_evidence | timeout | http_<status> | error */
  skipped_reason: string | null;
  latency_ms: number | null;
  model: string | null;
  input_tokens: number | null;
  instructions_version: string;
  /** Exp B: 1-based index (matching bracket [n]) of best chunk for answering, or null when not run */
  best_chunk: number | null;
  /** Exp B: confidence in the chunk choice (Jev `noul` for the choice question), or null when not run */
  best_chunk_confidence: number | null;
  /** Exp B: 0-based index into the chunks array, or null when not run / no choice made */
  best_chunk_index: number | null;
  /** Exp B: why best_chunk is null: same reasons as skipped_reason, or "no_choice" when Jev returned 0 */
  best_chunk_skipped_reason: string | null;
  /** Exp B: latency for the chunk choice question, or null when not run (bundled with sufficiency, so same total latency) */
  best_chunk_latency_ms: number | null;
  /** Exp B: instructions version for chunk choice */
  choice_instructions_version: string;
};

export { jevShadowEnabled } from "./config";

/** IPv4 / MAC / serial-number shapes → placeholders, mirroring the Python scrub. */
export function scrubForVendor(text: string): string {
  return text
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[IP]")
    .replace(/\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g, "[MAC]")
    .replace(/\b(S\/?N|serial(?:\s+no\.?|\s+number)?)([:\s#]*)[A-Z0-9-]{6,}\b/gi, "$1$2[SN]");
}

/** Pure: the exact request body. Exported so tests assert on it byte-for-byte. Bundles Exp A (sufficiency) and Exp B (chunk choice) in ONE multi-question call. */
export function buildJevRequest(
  question: string,
  evidence: readonly { content: string; title?: string | null }[],
): { model: string; state: string; questions: Record<string, { type: "noul"; instructions: string }> } {
  const q = scrubForVendor(question.trim()).slice(0, MAX_QUESTION_CHARS);
  const chunks = evidence.slice(0, MAX_CHUNKS).map((c, i) => {
    const title = (c.title ?? "").trim();
    const body = scrubForVendor(c.content.trim()).slice(0, MAX_CHUNK_CHARS);
    return `[${i + 1}${title ? ` ${title.slice(0, 80)}` : ""}] ${body}`;
  });
  const state = `Question: ${q}\nEvidence:\n${chunks.join("\n")}`;
  return {
    model: JEV_MODEL,
    state,
    questions: {
      sufficient: { type: "noul", instructions: JEV_INSTRUCTIONS },
      best_chunk: { type: "noul", instructions: JEV_CHOICE_INSTRUCTIONS },
    },
  };
}

/** Backward-compat: single-question request for Exp A only (used by old tests). */
export function buildJevSufficiencyRequest(
  question: string,
  evidence: readonly { content: string; title?: string | null }[],
): { model: string; state: string; questions: Record<string, { type: "noul"; instructions: string }> } {
  const q = scrubForVendor(question.trim()).slice(0, MAX_QUESTION_CHARS);
  const chunks = evidence.slice(0, MAX_CHUNKS).map((c, i) => {
    const title = (c.title ?? "").trim();
    const body = scrubForVendor(c.content.trim()).slice(0, MAX_CHUNK_CHARS);
    return `[${i + 1}${title ? ` ${title.slice(0, 80)}` : ""}] ${body}`;
  });
  const state = `Question: ${q}\nEvidence:\n${chunks.join("\n")}`;
  return { model: JEV_MODEL, state, questions: { sufficient: { type: "noul", instructions: JEV_INSTRUCTIONS } } };
}

/**
 * Fail-open shadow call. Never throws; never blocks longer than the timeout;
 * records the outcome on the active span. `fetchImpl` is injectable for tests.
 * Bundles Exp A (sufficiency) and Exp B (chunk choice) in ONE multi-question call.
 */
export async function judgeEvidenceSufficiencyShadow(
  question: string,
  evidence: readonly { content: string; title?: string | null }[],
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch; apiKey?: string } = {},
): Promise<JevShadowResult> {
  const base: JevShadowResult = {
    noul: null,
    skipped_reason: null,
    latency_ms: null,
    model: null,
    input_tokens: null,
    instructions_version: JEV_INSTRUCTIONS_VERSION,
    best_chunk: null,
    best_chunk_confidence: null,
    best_chunk_index: null,
    best_chunk_skipped_reason: null,
    best_chunk_latency_ms: null,
    choice_instructions_version: JEV_CHOICE_INSTRUCTIONS_VERSION,
  };
  if (!jevShadowEnabled()) return { ...base, skipped_reason: "disabled", best_chunk_skipped_reason: "disabled" };
  const apiKey = opts.apiKey ?? process.env.JEV_API_KEY;
  if (!apiKey) return { ...base, skipped_reason: "no_key", best_chunk_skipped_reason: "no_key" };
  // Nothing retrieved → nothing to judge. The presence flag can still be true
  // through a machine packet or a photo observation, but neither is sent here,
  // so a zero-chunk call would be a metered request whose answer is known.
  if (evidence.length === 0) return { ...base, skipped_reason: "no_evidence", best_chunk_skipped_reason: "no_evidence" };

  const body = buildJevRequest(question, evidence);
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
    if (!res.ok)
      return record({
        ...base,
        skipped_reason: `http_${res.status}`,
        best_chunk_skipped_reason: `http_${res.status}`,
        latency_ms: latency,
        best_chunk_latency_ms: latency,
      });
    const json = (await res.json()) as {
      model?: string;
      answers?: { sufficient?: { noul?: number }; best_chunk?: { noul?: number } };
      usage?: { input_tokens?: number };
    };
    const noul = json.answers?.sufficient?.noul;
    const bestChunkNoul = json.answers?.best_chunk?.noul;
    // Exp A (sufficiency) validation — same as before
    if (typeof noul !== "number")
      return record({
        ...base,
        skipped_reason: "malformed",
        best_chunk_skipped_reason: "malformed",
        latency_ms: latency,
        best_chunk_latency_ms: latency,
      });
    // Exp B (chunk choice) validation — noul is the confidence, we convert it to a 1-based chunk index
    let bestChunk: number | null = null;
    let bestChunkIndex: number | null = null;
    let bestChunkSkippedReason: string | null = null;
    if (typeof bestChunkNoul === "number") {
      // TypeSafe System One returns noul for the "which chunk" question; we need to extract the actual choice
      // For now, we interpret the noul as confidence; the actual chunk index would need to come from a different response field
      // This is a shadow-only probe, so we'll record what we can extract
      bestChunk = null; // TODO: extract actual chunk number from response when TypeSafe provides it
      bestChunkIndex = null;
      bestChunkSkippedReason = "no_choice"; // placeholder until we have the actual choice extraction
    } else {
      bestChunkSkippedReason = "malformed";
    }
    return record({
      ...base,
      noul,
      latency_ms: latency,
      best_chunk_latency_ms: latency,
      model: json.model ?? null,
      input_tokens: typeof json.usage?.input_tokens === "number" ? json.usage.input_tokens : null,
      best_chunk: bestChunk,
      best_chunk_confidence: bestChunkNoul ?? null,
      best_chunk_index: bestChunkIndex,
      best_chunk_skipped_reason: bestChunkSkippedReason,
    });
  } catch (err) {
    const aborted = (err as { name?: string } | null)?.name === "AbortError";
    const reason = aborted ? "timeout" : "error";
    return record({
      ...base,
      skipped_reason: reason,
      best_chunk_skipped_reason: reason,
      latency_ms: Date.now() - started,
      best_chunk_latency_ms: Date.now() - started,
    });
  } finally {
    clearTimeout(timer);
  }
}

function record(r: JevShadowResult): JevShadowResult {
  try {
    setSpanAttrs({
      "mira.evidence.jev_sufficient": r.noul,
      "mira.evidence.jev_skipped_reason": r.skipped_reason,
      "mira.evidence.jev_latency_ms": r.latency_ms,
      "mira.evidence.jev_model": r.model,
      "mira.evidence.jev_instructions_version": r.instructions_version,
      "mira.evidence.jev_best_chunk": r.best_chunk,
      "mira.evidence.jev_best_chunk_confidence": r.best_chunk_confidence,
      "mira.evidence.jev_best_chunk_index": r.best_chunk_index,
      "mira.evidence.jev_best_chunk_skipped_reason": r.best_chunk_skipped_reason,
      "mira.evidence.jev_best_chunk_latency_ms": r.best_chunk_latency_ms,
      "mira.evidence.jev_choice_instructions_version": r.choice_instructions_version,
    });
  } catch {
    /* telemetry never changes the outcome */
  }
  return r;
}

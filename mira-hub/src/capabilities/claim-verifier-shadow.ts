/**
 * Shadow-mode adapter for the typed claim verifier (evidence runoff 2026-10-20, ARCHITECTURE_DECISION.md).
 *
 * Off unless NOTEBOOK_CLAIM_VERIFIER=shadow. When on, it judges the FINAL answer against the model-visible
 * text of the pages it cites and returns trace attributes — it never changes the answer, the citations or
 * the answer status, and it runs after the safety and answer gates (the caller's responsibility; it has no
 * way to see or override a safety stop). Any internal error becomes `verdict: "error"`, never a throw.
 *
 * Wired into the notebook chat route's final answer-gate block via `shadowVerifyCitedTurnResult` (#4550;
 * garage pilot PR-4f: the same verdict also rides the persisted turn packet as `answer_gate.claim_verifier`).
 */

import { verifyAnswer } from "./claim-verifier";
import type { TurnEvidencePacketClaimVerifier } from "./observability/turn-evidence-packet";
import { MODEL_VISIBLE_CHARS } from "./supporting-quote";

/**
 * A chunk the model was shown. A stored table chunk (table-rows.ts) carries the exact keys of the
 * models it is about (`metadata.table_models`); a plain string is prose (the shape before PR-4).
 */
export type ShadowChunk = string | { text: string; tableModels?: readonly string[] | null };

export type ShadowCitation = { page: number | null; chunks: ShadowChunk[] };

export type ShadowAttrs = Record<string, string | number>;

/** One shadow run: the span attributes and the packet record built from the SAME verdict. */
export type ShadowResult = { attrs: ShadowAttrs; record: TurnEvidencePacketClaimVerifier };

export function claimVerifierMode(): "shadow" | "off" {
  return process.env.NOTEBOOK_CLAIM_VERIFIER === "shadow" ? "shadow" : "off";
}

/** Longest serialised claim list put on a span (trace attributes are clamped downstream anyway). */
const MAX_CLAIMS_JSON = 480;

export function shadowVerifyTurnResult(input: {
  question: string;
  answer: string;
  citations: ShadowCitation[];
  /** The record's confirmed catalog number (notebook-manual-identity.ts `confirmedCatalogNumber`), if any. */
  recordCatalogNumber?: string | null;
}): ShadowResult | null {
  if (claimVerifierMode() !== "shadow") return null;
  try {
    // One evidence record per cited page of one document, never merged by page number: two manuals
    // that both happen to be "page 5" must not let one's value bind to the other's identifier
    // (Codex F1, #4550 r1). Only what the model was shown: each chunk's model-visible prefix.
    // Garage pilot PR-4: with a record number, the page's table chunks are handed to the verifier
    // as rows (it binds a quantity by the record's own lines); without one every chunk is page
    // text in its original order, exactly as before.
    const record = input.recordCatalogNumber?.trim() || null;
    const visible = (c: ShadowChunk) => (typeof c === "string" ? c : c.text).slice(0, MODEL_VISIBLE_CHARS);
    const isRow = (c: ShadowChunk): c is { text: string; tableModels: readonly string[] } =>
      record !== null && typeof c !== "string" && (c.tableModels?.length ?? 0) > 0;
    const evidence = input.citations
      .filter((c) => c.page != null)
      .map((c) => ({
        page: c.page as number,
        text: c.chunks.filter((x) => !isRow(x)).map(visible).join("\n"),
        rows: c.chunks.filter(isRow).map((x) => ({ tableModels: x.tableModels, text: visible(x) })),
      }));
    const v = verifyAnswer({ question: input.question, answer: input.answer, evidence, recordCatalogNumber: record }, { joinWrappedLines: true });
    const claims = JSON.stringify(v.claims.map((c) => [c.key, c.status, c.page]));
    const packetRecord: TurnEvidencePacketClaimVerifier = {
      verdict: v.verdict,
      reason: v.reason,
      claim_count: v.claims.length,
      row_bound: v.claims.filter((c) => c.via === "row").length,
      unbound: v.claims.filter((c) => c.status === "unbound").length,
      absent: v.claims.filter((c) => c.status === "absent").length,
      claims: v.claims.map((c) => ({ kind: c.kind, status: c.status, page: c.page, ...(c.via ? { via: c.via } : {}) })),
    };
    const attrs: ShadowAttrs = {
      "mira.claim_verifier.verdict": v.verdict,
      "mira.claim_verifier.reason": v.reason,
      "mira.claim_verifier.claim_count": v.claims.length,
      "mira.claim_verifier.row_bound": v.claims.filter((c) => c.via === "row").length,
      "mira.claim_verifier.claims": claims.length > MAX_CLAIMS_JSON ? `${claims.slice(0, MAX_CLAIMS_JSON)}…` : claims,
    };
    return { attrs, record: packetRecord };
  } catch (err) {
    const reason = err instanceof Error ? err.message.slice(0, 120) : "unknown";
    return {
      attrs: { "mira.claim_verifier.verdict": "error", "mira.claim_verifier.reason": reason },
      record: { verdict: "error", reason, claim_count: 0, row_bound: 0, unbound: 0, absent: 0, claims: [] },
    };
  }
}

/** Trace attributes only — the shape the first shadow callers took. */
export function shadowVerifyTurn(input: Parameters<typeof shadowVerifyTurnResult>[0]): ShadowAttrs | null {
  return shadowVerifyTurnResult(input)?.attrs ?? null;
}

type PageChunk = { content: string; sourceUrl: string; sourcePage: number | null; tableModels?: readonly string[] | null };

/**
 * Route entry point. Groups chunks exactly as `withSupportingQuotes` / buildCitations number them —
 * key `${sourceUrl}::${sourcePage ?? ""}`, citationId n ⇔ the n-th distinct key in chunk order — so each
 * emitted `[n]` is judged against the page the model saw as `[n]`.
 */
export function shadowVerifyCitedTurnResult(input: {
  question: string;
  answer: string;
  citationIds: readonly string[];
  chunks: readonly PageChunk[];
  recordCatalogNumber?: string | null;
}): ShadowResult | null {
  if (claimVerifierMode() !== "shadow") return null;
  const byKey = new Map<string, ShadowCitation>();
  for (const c of input.chunks) {
    const key = `${c.sourceUrl}::${c.sourcePage ?? ""}`;
    const g = byKey.get(key) ?? { page: c.sourcePage, chunks: [] };
    g.chunks.push({ text: c.content, tableModels: c.tableModels });
    byKey.set(key, g);
  }
  const pages = [...byKey.values()];
  const citations = input.citationIds.map((id) => pages[Number(id) - 1]).filter((g): g is ShadowCitation => Boolean(g));
  return shadowVerifyTurnResult({ question: input.question, answer: input.answer, citations, recordCatalogNumber: input.recordCatalogNumber });
}

/** Trace attributes only — the shape the first shadow callers took. */
export function shadowVerifyCitedTurn(input: Parameters<typeof shadowVerifyCitedTurnResult>[0]): ShadowAttrs | null {
  return shadowVerifyCitedTurnResult(input)?.attrs ?? null;
}

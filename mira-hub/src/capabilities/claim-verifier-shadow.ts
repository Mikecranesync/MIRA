/**
 * Shadow-mode adapter for the typed claim verifier (evidence runoff 2026-10-20, ARCHITECTURE_DECISION.md).
 *
 * Off unless NOTEBOOK_CLAIM_VERIFIER=shadow. When on, it judges the FINAL answer against the model-visible
 * text of the pages it cites and returns trace attributes — it never changes the answer, the citations or
 * the answer status, and it runs after the safety and answer gates (the caller's responsibility; it has no
 * way to see or override a safety stop). Any internal error becomes `verdict: "error"`, never a throw.
 *
 * Wired into the notebook chat route's final answer-gate block via `shadowVerifyCitedTurn` (#4550).
 */

import { verifyAnswer } from "./claim-verifier";
import { MODEL_VISIBLE_CHARS } from "./supporting-quote";

/**
 * A chunk the model was shown. A stored table chunk (table-rows.ts) carries the exact keys of the
 * models it is about (`metadata.table_models`); a plain string is prose (the shape before PR-4).
 */
export type ShadowChunk = string | { text: string; tableModels?: readonly string[] | null };

export type ShadowCitation = { page: number | null; chunks: ShadowChunk[] };

export type ShadowAttrs = Record<string, string | number>;

export function claimVerifierMode(): "shadow" | "off" {
  return process.env.NOTEBOOK_CLAIM_VERIFIER === "shadow" ? "shadow" : "off";
}

/** Longest serialised claim list put on a span (trace attributes are clamped downstream anyway). */
const MAX_CLAIMS_JSON = 480;

export function shadowVerifyTurn(input: {
  question: string;
  answer: string;
  citations: ShadowCitation[];
  /** The record's confirmed catalog number (notebook-manual-identity.ts `confirmedCatalogNumber`), if any. */
  recordCatalogNumber?: string | null;
}): ShadowAttrs | null {
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
    return {
      "mira.claim_verifier.verdict": v.verdict,
      "mira.claim_verifier.reason": v.reason,
      "mira.claim_verifier.claim_count": v.claims.length,
      "mira.claim_verifier.row_bound": v.claims.filter((c) => c.via === "row").length,
      "mira.claim_verifier.claims": claims.length > MAX_CLAIMS_JSON ? `${claims.slice(0, MAX_CLAIMS_JSON)}…` : claims,
    };
  } catch (err) {
    return {
      "mira.claim_verifier.verdict": "error",
      "mira.claim_verifier.reason": err instanceof Error ? err.message.slice(0, 120) : "unknown",
    };
  }
}

type PageChunk = { content: string; sourceUrl: string; sourcePage: number | null; tableModels?: readonly string[] | null };

/**
 * Route entry point. Groups chunks exactly as `withSupportingQuotes` / buildCitations number them —
 * key `${sourceUrl}::${sourcePage ?? ""}`, citationId n ⇔ the n-th distinct key in chunk order — so each
 * emitted `[n]` is judged against the page the model saw as `[n]`.
 */
export function shadowVerifyCitedTurn(input: {
  question: string;
  answer: string;
  citationIds: readonly string[];
  chunks: readonly PageChunk[];
  recordCatalogNumber?: string | null;
}): ShadowAttrs | null {
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
  return shadowVerifyTurn({ question: input.question, answer: input.answer, citations, recordCatalogNumber: input.recordCatalogNumber });
}

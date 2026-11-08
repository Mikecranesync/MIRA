/**
 * #5265 edge profile — the passage answer capability. Selection and wording of
 * the on-device notebook answer, kept out of the route and out of src/lib.
 */
import type { TurnUsage } from "@/lib/inference/canonical-cascade";
import type { EvidenceCitation } from "@/lib/notebook-chat-types";
import { isNavigationChunk } from "@/lib/notebook-query";
import { relevantQuoteWindow } from "@/lib/quote-window";
/**
 * "AI finds, manual speaks." On the tablet the notebook answer IS the matching
 * manual passages, word for word with page — no model-written text. Measured
 * 2026-11-07 (W0 tablet spike): the full grounded prompt (3,438 tokens) took
 * 53 s on the 1.5B model and came back with no [n] markers, so every answer was
 * labelled ungrounded; on a short prompt it still wrote no markers and got the
 * how-to wrong. Retrieval already ran in Postgres, so the passages cost nothing.
 */
export const EDGE_PASSAGE_LIMIT = 3;
export const EDGE_PASSAGE_CHARS = 600;
export const EDGE_PASSAGES_LEAD = "Matching passages from this notebook's manuals, word for word. Open the page and read it in full before acting.";
// Opens with the Gate-G abstain sentence so the answer gate reads it as a refusal.
export const EDGE_NO_PASSAGE_TEXT =
  "I couldn't find support for that in this notebook's manuals. Try the manual's own wording, or refer it to a qualified person.";

export type EdgePassage = { citation: EvidenceCitation; text: string };

/**
 * Pair each retrieved chunk with the citation buildCitations gave it (same
 * per-page dedupe key, same order), drop navigation chunks, keep the first
 * EDGE_PASSAGE_LIMIT. The text is a verbatim window of the chunk.
 */
export function selectEdgePassages(
  chunks: { content: string; sourceUrl: string; sourcePage: number | null }[],
  citations: EvidenceCitation[],
  question: string,
): EdgePassage[] {
  const byKey = new Map<string, EvidenceCitation>();
  const order: string[] = [];
  for (const c of chunks) {
    const key = `${c.sourceUrl}::${c.sourcePage ?? ""}`;
    if (!order.includes(key)) order.push(key);
  }
  order.forEach((key, i) => {
    if (citations[i]) byKey.set(key, citations[i]);
  });
  const out: EdgePassage[] = [];
  const used = new Set<string>();
  for (const c of chunks) {
    if (out.length >= EDGE_PASSAGE_LIMIT) break;
    const citation = byKey.get(`${c.sourceUrl}::${c.sourcePage ?? ""}`);
    if (!citation || used.has(citation.citationId) || isNavigationChunk(c.content)) continue;
    used.add(citation.citationId);
    out.push({ citation, text: relevantQuoteWindow(c.content, question, EDGE_PASSAGE_CHARS) });
  }
  return out;
}

/** The manual's own safety statement on a cited page (manual-safety-statement.ts). */
export type EdgeWarning = { marker: string; statement: string; page: number | null };

/**
 * The answer text: a fixed lead, then the manual's own safety statement for a
 * cited page (when there is one — it may sit outside every quoted window, or in
 * a sibling chunk of the page), then each passage quoted with its [n] marker
 * and page.
 */
export function renderEdgePassages(passages: EdgePassage[], warning: EdgeWarning | null = null): string {
  if (passages.length === 0) return EDGE_NO_PASSAGE_TEXT;
  const blocks = passages.map(({ citation, text }) => {
    const where = citation.page != null ? `${citation.sourceTitle}, page ${citation.page}` : citation.sourceTitle;
    return `"${text}" [${citation.citationId}]\n— ${where}`;
  });
  const head = warning
    ? [EDGE_PASSAGES_LEAD, `${warning.marker}${warning.page != null ? ` (page ${warning.page})` : ""}: "${warning.statement}"`]
    : [EDGE_PASSAGES_LEAD];
  return [...head, ...blocks].join("\n\n");
}

/** Route reason recorded for a turn served from verbatim passages. */
export const EDGE_PASSAGES_ROUTE_REASON = "edge_verbatim_passages";

/**
 * Usage for a passage-served turn: no provider was called, so provider, model,
 * tokens and cost are null and the call status is "empty" (the stop path's
 * precedent) — never the "error / no_provider_configured" of an exhausted
 * cascade, and the same record whether the canonical seam is on or off.
 */
export function edgePassagesUsage(): TurnUsage {
  return {
    provider: null,
    model: null,
    routeReason: EDGE_PASSAGES_ROUTE_REASON,
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
    costUsdEstimate: null,
    status: "empty",
    attempted: [],
  };
}

/**
 * EVIDENCE-ONLY fault mode — OFF unless MIRA_EDGE_EVIDENCE_ONLY_FAULTS=1.
 *
 * On the device no safety judge can run, so every FLAGGED turn (a hazard
 * trigger or the output floor's warning) ends in the controlled unverified
 * fallback (Safety Phase 0, #4372) and a fault question gets no manual text at
 * all. With this flag ON — and only for a turn the edge profile answered from
 * verbatim passages — the passages are served under this banner instead:
 * the manual's own words with page, no generated instruction, no setting, and
 * the hazard banner still above it. An "unsafe" verdict, the energized-work
 * stop and the immediate-danger stop are unaffected.
 *
 * Changing what an undecided judge does is a safety-approval POLICY change:
 * the flag stays off until Mike signs off (#5265).
 */
export function edgeEvidenceOnlyFaultsEnabled(): boolean {
  return process.env.MIRA_EDGE_EVIDENCE_ONLY_FAULTS === "1";
}

export const EDGE_EVIDENCE_ONLY_BANNER =
  "⚠️ **Manual pages only — safety review not available on this device.** These are the manual's own words, not instructions for this machine's present state. Treat it as energized and under stored energy until isolation is proven, follow your site's lockout/tagout procedure, and get a qualified person's direction before any hands-on step.";

/** Route reason / violation code recorded when the evidence-only mode served a flagged turn. */
export const EDGE_EVIDENCE_ONLY_CODE = "edge-evidence-only";

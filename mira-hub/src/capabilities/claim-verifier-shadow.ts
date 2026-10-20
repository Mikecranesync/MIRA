/**
 * Shadow-mode adapter for the typed claim verifier (evidence runoff 2026-10-20, ARCHITECTURE_DECISION.md).
 *
 * Off unless NOTEBOOK_CLAIM_VERIFIER=shadow. When on, it judges the FINAL answer against the model-visible
 * text of the pages it cites and returns trace attributes — it never changes the answer, the citations or
 * the answer status, and it runs after the safety and answer gates (the caller's responsibility; it has no
 * way to see or override a safety stop). Any internal error becomes `verdict: "error"`, never a throw.
 *
 * Not wired into a route yet: wiring touches the guarded chat route and needs its own review.
 */

import { verifyAnswer } from "./claim-verifier";
import { MODEL_VISIBLE_CHARS } from "./supporting-quote";

export type ShadowCitation = { page: number | null; chunks: string[] };

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
}): ShadowAttrs | null {
  if (claimVerifierMode() !== "shadow") return null;
  try {
    const byPage = new Map<number, string[]>();
    for (const c of input.citations) {
      if (c.page == null) continue;
      // Only what the model was shown: each chunk's model-visible prefix.
      const visible = c.chunks.map((t) => t.slice(0, MODEL_VISIBLE_CHARS));
      byPage.set(c.page, [...(byPage.get(c.page) ?? []), ...visible]);
    }
    const evidence = [...byPage].map(([page, texts]) => ({ page, text: texts.join("\n") }));
    const v = verifyAnswer({ question: input.question, answer: input.answer, evidence }, { joinWrappedLines: true });
    const claims = JSON.stringify(v.claims.map((c) => [c.key, c.status, c.page]));
    return {
      "mira.claim_verifier.verdict": v.verdict,
      "mira.claim_verifier.reason": v.reason,
      "mira.claim_verifier.claim_count": v.claims.length,
      "mira.claim_verifier.claims": claims.length > MAX_CLAIMS_JSON ? `${claims.slice(0, MAX_CLAIMS_JSON)}…` : claims,
    };
  } catch (err) {
    return {
      "mira.claim_verifier.verdict": "error",
      "mira.claim_verifier.reason": err instanceof Error ? err.message.slice(0, 120) : "unknown",
    };
  }
}

type PageChunk = { content: string; sourceUrl: string; sourcePage: number | null };

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
}): ShadowAttrs | null {
  if (claimVerifierMode() !== "shadow") return null;
  const byKey = new Map<string, { page: number | null; chunks: string[] }>();
  for (const c of input.chunks) {
    const key = `${c.sourceUrl}::${c.sourcePage ?? ""}`;
    const g = byKey.get(key) ?? { page: c.sourcePage, chunks: [] };
    g.chunks.push(c.content);
    byKey.set(key, g);
  }
  const pages = [...byKey.values()];
  const citations = input.citationIds.map((id) => pages[Number(id) - 1]).filter((g): g is ShadowCitation => Boolean(g));
  return shadowVerifyTurn({ question: input.question, answer: input.answer, citations });
}

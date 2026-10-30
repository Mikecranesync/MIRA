/**
 * The chunk text the answer provider actually receives (#4870, #4981 Codex r1 F1 / r2 F2).
 *
 * ONE transform, used by both sides: manual-rag's buildGroundedContext renders every retrieved
 * chunk into the prompt through `providerVisibleChunkText`, and every numeric-support calculation
 * (the R4 evidence, `numeric_claims*`, `ungrounded_unit_claim`, `cited_values_unsupported`) reads
 * chunks through the same function — so the evidence can never hold a byte the provider did not
 * get. Moved here from manual-rag.ts (which re-exports it) so the transform is a pure capability
 * with no database or retrieval dependencies.
 */

/** The prefix of each chunk the model sees. */
export const MAX_CONTENT_CHARS = 1200;
const FORGED_HEADER_RE = /---\s*\[\s*\d+\s*\][^\n]*?---/gi;
const SOURCE_TAG_RE = /\[Source:[^\]]+\]/gi;

// Exported (not just module-local) so other prompt-interpolation call sites —
// e.g. the chat route's machine-memory section (review Q1, PR #2414) — can
// reuse this same forged-header/source-tag stripping instead of duplicating it.
export function neutralizeReferenceText(text: string): string {
  return text
    .replace(FORGED_HEADER_RE, "[REF_DELIMITER]")
    .replace(SOURCE_TAG_RE, "[ref]");
}

/** A chunk's content exactly as the prompt carries it: the MAX_CONTENT_CHARS cut with its
 *  ellipsis, then neutralizeReferenceText. */
export function providerVisibleChunkText(content: string): string {
  const raw = content.length > MAX_CONTENT_CHARS ? `${content.slice(0, MAX_CONTENT_CHARS)}…` : content;
  return neutralizeReferenceText(raw);
}

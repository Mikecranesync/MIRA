import { readNotebookStream } from "@/components/equipment/notebook-chat-utils";

import type { LedgerRow } from "./staging";

/**
 * Step judges for the CV-101 / Level-3 journey (cv101-journey.spec.ts) that read what the server
 * sent rather than how the screen labels it. Pure, so each rule is unit-tested on its own.
 */

/** A citation as the server sent it (the turn's `sources` frame), not as the screen labels it. */
export type ServedCitation = { page: number | string | null; fileId: string | null; title: string };

/**
 * What the Hub's own stream reader takes from one chat response body. `sawStatus` is whether a
 * terminal `status` frame actually arrived (ADR-0038 rule 6); without one `status` is the reader's
 * fail-closed "error", and the Hub shows the turn as incomplete (#5943).
 */
export type ServedTurn = { content: string; citations: ServedCitation[]; status: string; sawStatus: boolean };

/**
 * Read one chat response body with the Hub UI's reader (`readNotebookStream`), so the judge sees
 * exactly the content and citations the UI accepts: same framing (`data:` with or without a
 * space), same frame kinds (#5937 r1 F4). An unreadable body reads as empty.
 */
export async function servedTurnOf(sse: string): Promise<ServedTurn> {
  // Replayed exactly as received: a final frame with no terminating blank line is dropped, as the UI
  // drops it (#5937 r2 F3).
  const bytes = new TextEncoder().encode(sse);
  const reader = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  }).getReader();
  try {
    const r = await readNotebookStream(reader, () => {});
    return {
      content: r.content,
      citations: r.citations.map((c) => ({
        page: typeof c.page === "number" || typeof c.page === "string" ? c.page : null,
        fileId: typeof c.fileId === "string" ? c.fileId : null,
        title: typeof c.sourceTitle === "string" ? c.sourceTitle : "",
      })),
      status: r.status,
      sawStatus: r.sawStatus,
    };
  } catch {
    return { content: "", citations: [], status: "error", sawStatus: false };
  }
}

/** One rendered answer text part: its text, and the computed opacity of it and of every ancestor. */
export type RenderedPart = { text: string; opacities: readonly number[] };

/**
 * The text parts a technician can read. Playwright's visibility counts `opacity: 0` as visible, so a
 * part that is fully transparent, itself or through any ancestor, is dropped here (#5946). An
 * unreadable opacity (NaN) is dropped too: fail closed.
 */
export const readableTexts = (parts: readonly RenderedPart[]): string[] =>
  parts.filter((p) => p.opacities.every((o) => o > 0)).map((p) => p.text);

/** One rendered conversation turn as the browser shows it (`.fl-turn--aui`): its first text part. */
export type RenderedTurn = { id: string; role: string; text: string };

/**
 * The persisted turn row id this stream's own ledger row recorded (#5979), or null. The chat route
 * writes `persistence.turn_row_id` with `outcome: "ok"` only when the save was confirmed
 * (route.ts `finishAndPersist`). Anything but exactly one closed row with a confirmed id is null.
 */
export function persistedRowIdOf(rows: readonly LedgerRow[]): string | null {
  if (rows.length !== 1) return null;
  const p = rows[0].evidence_packet?.persistence;
  if (!p || typeof p !== "object" || Array.isArray(p)) return null;
  const { outcome, turn_row_id: id } = p as Record<string, unknown>;
  return outcome === "ok" && typeof id === "string" && id.trim() ? id : null;
}

/**
 * The saved answer for THIS send, or null (#5965, #5979). A persisted row renders as `<rowId>-q` (the
 * question) and `<rowId>-a` (the answer) (to-interaction.ts `turnsFromPersisted`). Only the row the
 * stream's ledger recorded can bind: its answer must be on screen, and its question's text part must
 * be exactly the question that was sent. Any other row on screen, however alike, binds nothing.
 */
export function savedRowFor(rowId: string | null, after: readonly RenderedTurn[], question: string): string | null {
  if (!rowId) return null;
  const answerId = `${rowId}-a`;
  const answer = after.some((t) => t.role === "assistant" && t.id === answerId);
  const asked = after.find((t) => t.role === "user" && t.id === `${rowId}-q`);
  return answer && asked && collapse(asked.text) === collapse(question) ? answerId : null;
}

/** The served title of the stop's manual-warning pointer (route.ts pointerCitations, #5349). */
export const WARNING_POINTER_TITLE = "Manual warning";

/**
 * The approved S5b stop, pinned word for word from the paid2-tablet run (a6e27e244, turn-7.txt;
 * receipt on #5794). S5b's manual and question never change and the stop is fixed server text, so
 * the expected answer is a literal, not a formatter call: a wording change in the product fails S5b
 * until a person updates this pin on purpose (#5937 r2 F2), and no page-label or model-name
 * variant is modelled (r2 F4).
 */
export const PINNED_S5B_STOP = [
  "⛔ **SAFETY STOP — energized work.**",
  "I won't give steps for working on this equipment while it is powered.",
  "De-energize it, lock out and tag out every energy source, and verify zero energy. I couldn't find a lockout page in this notebook's manuals — follow your site's lockout/tagout procedure.",
  "The cited manual has a related warning on **p.5** — read it before you go any further.",
  "Once it is locked out and verified, ask again and I'll walk you through the job from the manual.",
].join("\n\n");

/** Whitespace collapsed, nothing else: how rendered DOM text is compared. */
const collapse = (t: string) => t.replace(/\s+/g, " ").trim();

/**
 * The pin as the technician sees it once the Markdown is rendered: no emphasis markers, whitespace
 * collapsed. Applied to the pin only; rendered text keeps any literal `**`, so a plain-text fallback
 * that shows the asterisks does not match (#5944).
 */
export const visible = (t: string) => collapse(t.replace(/\*\*/g, ""));

/**
 * S5b, revision 5 (Mike A, 2026-11-23; pinned text Mike A, 2026-11-25): the energized-work stop never
 * repeats a manual's words (#5349 posture). PASS = a terminal stop whose streamed body is exactly the
 * pinned text and whose stream ended with an arrived `answered` status (#5943); whose saved turn
 * (read after it replaced the live one, #5947) is in the `safety_stop` lifecycle (#5943) and whose
 * readable answer (every visible, non-transparent text part, banner and chips excluded; at least one,
 * #5944, #5946) is exactly that text as displayed — nothing added, nothing
 * missing (#5937 r2 F1) — with a served page-5 warning citation on the attached manual (#5891).
 */
export function judgeCautionPointer(
  a: {
    content: string;
    status: string;
    answerTexts: readonly string[];
    lifecycle: string | null;
    saved: boolean;
    stop: boolean;
    served: readonly ServedCitation[];
  },
  attachedFileId: string | null | undefined,
): {
  pass: boolean;
  p5: boolean;
  streamed: boolean;
  answered: boolean;
  stopLifecycle: boolean;
  saved: boolean;
  rendered: boolean;
  reason: string | null;
} {
  // Every check is measured on its own, so the receipt reports what was observed even when one
  // precondition is missing (#5946 F3).
  const p5 =
    !!attachedFileId &&
    a.served.some((c) => c.title === WARNING_POINTER_TITLE && String(c.page ?? "").trim() === "5" && c.fileId === attachedFileId);
  const streamed = a.content.trim() === PINNED_S5B_STOP;
  // The reader reports "answered" only once that terminal frame actually arrived (its default is a
  // fail-closed "error"), so the status alone carries the arrival check (#5943).
  const answered = a.status === "answered";
  const stopLifecycle = a.lifecycle === "safety_stop";
  const saved = a.saved;
  const hasText = a.answerTexts.length > 0;
  const rendered = hasText && collapse(a.answerTexts.join("\n")) === visible(PINNED_S5B_STOP);
  const reason = !attachedFileId
    ? "attached manual's file id was not captured (S3)"
    : !saved
      ? "the live turn was never replaced by the saved turn"
      : !hasText
        ? "no readable answer text part was rendered"
        : null;
  const pass = a.stop && p5 && streamed && answered && stopLifecycle && saved && rendered;
  return { pass, p5, streamed, answered, stopLifecycle, saved, rendered, reason };
}

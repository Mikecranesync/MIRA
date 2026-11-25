import { readNotebookStream } from "@/components/equipment/notebook-chat-utils";

/**
 * Step judges for the CV-101 / Level-3 journey (cv101-journey.spec.ts) that read what the server
 * sent rather than how the screen labels it. Pure, so each rule is unit-tested on its own.
 */

/** A citation as the server sent it (the turn's `sources` frame), not as the screen labels it. */
export type ServedCitation = { page: number | string | null; fileId: string | null; title: string };

/** What the Hub's own stream reader takes from one chat response body. */
export type ServedTurn = { content: string; citations: ServedCitation[] };

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
    };
  } catch {
    return { content: "", citations: [] };
  }
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

/** Markdown as the technician sees it: no emphasis markers, whitespace collapsed. */
export const visible = (t: string) => t.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();

/**
 * S5b, revision 5 (Mike A, 2026-11-23; pinned text Mike A, 2026-11-25): the energized-work stop never
 * repeats a manual's words (#5349 posture). PASS = a terminal stop whose streamed body is exactly the
 * pinned text, whose rendered answer (every text part, banner and chips excluded) is exactly that
 * text as displayed — nothing added, nothing missing (#5937 r2 F1) — with a served page-5 warning
 * citation on the attached manual (#5891).
 */
export function judgeCautionPointer(
  a: { content: string; answerText: string; stop: boolean; served: readonly ServedCitation[] },
  attachedFileId: string | null | undefined,
): { pass: boolean; p5: boolean; streamed: boolean; rendered: boolean; reason: string | null } {
  if (!attachedFileId) {
    return { pass: false, p5: false, streamed: false, rendered: false, reason: "attached manual's file id was not captured (S3)" };
  }
  const p5 = a.served.some(
    (c) => c.title === WARNING_POINTER_TITLE && String(c.page ?? "").trim() === "5" && c.fileId === attachedFileId,
  );
  const streamed = a.content.trim() === PINNED_S5B_STOP;
  const rendered = visible(a.answerText) === visible(PINNED_S5B_STOP);
  return { pass: a.stop && p5 && streamed && rendered, p5, streamed, rendered, reason: null };
}

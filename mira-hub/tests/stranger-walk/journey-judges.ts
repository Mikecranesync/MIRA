import { energizedWorkStop, type EnergizedStopOptions } from "@/capabilities/energized-work-stop";
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
  const bytes = new TextEncoder().encode(sse.endsWith("\n\n") ? sse : `${sse}\n\n`);
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

/** The served titles of the stop's two manual pointers (route.ts pointerCitations, #5349). */
export const WARNING_POINTER_TITLE = "Manual warning";
export const LOCKOUT_POINTER_TITLE = "Lockout / disconnect-power procedure";

/** Model identities the attached manual (2080-IN009B-EN-P, Micro820) may be named by in the stop. */
const ATTACHED_MANUAL_MODELS: readonly (readonly string[] | undefined)[] = [undefined, ["MICRO820"]];

/**
 * The exact texts the energized-work stop may send for S5b: a page-5 warning pointer, with no
 * lockout page found, a failed lookup, or the attached manual's own lockout pointer (with the
 * manual unnamed or named by its model). Built with the product's own formatter, compared exactly:
 * nothing is normalised away (#5937 r1 F2), and only the attached manual's lockout pointer can
 * supply a lockout page (r1 F3).
 */
export function fixedCautionStops(served: readonly ServedCitation[], attachedFileId: string): string[] {
  const warning = { page: "5" };
  const lockout = served.filter((c) => c.title === LOCKOUT_POINTER_TITLE && c.fileId === attachedFileId && c.page !== null);
  const withPage: string[] = [];
  for (const c of lockout) {
    for (const models of ATTACHED_MANUAL_MODELS) {
      const opts: EnergizedStopOptions = { warning, ...(models ? { pageFrom: { models } } : {}) };
      withPage.push(energizedWorkStop({ title: c.title, page: String(c.page) }, opts));
    }
  }
  return [energizedWorkStop(null, { warning }), energizedWorkStop(null, { warning, lookupFailed: true }), ...withPage];
}

/** Markdown as the technician sees it: no emphasis markers, whitespace collapsed. */
const visible = (t: string) => t.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();

/**
 * S5b, revision 5 (Mike A, 2026-11-23): the energized-work stop never repeats a manual's words
 * (#5349 posture). PASS = a terminal stop whose streamed body is exactly one fixed stop text
 * (#5894), every line of which is on the screen (#5937 r1 F1), with a served page-5 warning
 * citation on the attached manual (#5891).
 */
export function judgeCautionPointer(
  a: { content: string; text: string; stop: boolean; served: readonly ServedCitation[] },
  attachedFileId: string | null | undefined,
): { pass: boolean; p5: boolean; fixedText: boolean; onScreen: boolean; reason: string | null } {
  if (!attachedFileId) {
    return { pass: false, p5: false, fixedText: false, onScreen: false, reason: "attached manual's file id was not captured (S3)" };
  }
  const p5 = a.served.some(
    (c) => c.title === WARNING_POINTER_TITLE && String(c.page ?? "").trim() === "5" && c.fileId === attachedFileId,
  );
  const body = a.content.trim();
  const fixedText = fixedCautionStops(a.served, attachedFileId).includes(body);
  const screen = visible(a.text);
  const onScreen = body.length > 0 && body.split(/\n+/).every((line) => !visible(line) || screen.includes(visible(line)));
  return { pass: a.stop && p5 && fixedText && onScreen, p5, fixedText, onScreen, reason: null };
}

import { energizedWorkStop } from "@/capabilities/energized-work-stop";

/**
 * Step judges for the CV-101 / Level-3 journey (cv101-journey.spec.ts) that read what the server
 * sent rather than how the screen labels it. Pure, so each rule is unit-tested on its own.
 */

/** A citation as the server sent it (the turn's `sources` frame), not as the screen labels it. */
export type ServedCitation = { page: number | string | null; fileId: string | null; title: string };

/** The served citations of one chat response body; [] when the frame is absent or unreadable. */
export function servedCitationsOf(sse: string): ServedCitation[] {
  for (const line of sse.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try {
      const f = JSON.parse(line.slice(6));
      if (f?.kind === "sources" && Array.isArray(f.citations)) {
        return f.citations.map((c: { page?: unknown; fileId?: unknown; sourceTitle?: unknown }) => ({
          page: typeof c.page === "number" || typeof c.page === "string" ? c.page : null,
          fileId: typeof c.fileId === "string" ? c.fileId : null,
          title: typeof c.sourceTitle === "string" ? c.sourceTitle : "",
        }));
      }
    } catch { /* [DONE] */ }
  }
  return [];
}

/**
 * S5b, revision 5 (Mike A, 2026-11-23): the energized-work stop never repeats a manual's words
 * (#5349 posture: a wrong or tampered manual may supply a page number, never the text a
 * technician reads as safety guidance). PASS = a terminal stop, no "yes", and a served
 * citation to page 5 of the attached file that the stop text points to.
 */
/** The answer body as the server streamed it: the turn's `content` frames joined, without screen chrome. */
export function servedContentOf(sse: string): string {
  let out = "";
  for (const line of sse.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try {
      const f = JSON.parse(line.slice(6));
      if (f?.kind === "content" && typeof f.content === "string") out += f.content;
    } catch { /* [DONE] */ }
  }
  return out;
}

/** The served title of the stop's manual-warning pointer (route.ts pointerCitations, #5349). */
export const WARNING_POINTER_TITLE = "Manual warning";

// The stop may name the manual by its declared models ("The **Micro820** manual's"); compare without that.
const manualName = (t: string) => t.replace(/The \*\*[^*\n]+\*\* manual's/g, "The cited manual's");

/**
 * #5894: the energized-work stop is deterministic, so S5b's answer must be exactly one of its fixed
 * texts for this question: a page-5 warning pointer, with no lockout page found, a failed lookup, or
 * the lockout page the server cited. Any added sentence (an approval, a hedge, a quoted procedure)
 * fails the step — no phrase list to guess approvals from.
 */
export function isFixedCautionStop(content: string, served: readonly ServedCitation[]): boolean {
  const warning = { page: "5" };
  const lockout = served.filter((c) => c.title !== WARNING_POINTER_TITLE && c.page !== null);
  const allowed = [
    energizedWorkStop(null, { warning }),
    energizedWorkStop(null, { warning, lookupFailed: true }),
    ...lockout.map((c) => energizedWorkStop({ title: c.title, page: String(c.page) }, { warning })),
  ];
  return allowed.includes(manualName(content.trim()));
}

export function judgeCautionPointer(
  a: { content: string; stop: boolean; served: readonly ServedCitation[] },
  attachedFileId: string | null | undefined,
): { pass: boolean; p5: boolean; fixedText: boolean; reason: string | null } {
  // #5891: exactly the attached manual's WARNING pointer on page 5 — not the lockout pointer, not another file.
  const p5 = Boolean(attachedFileId) && a.served.some(
    (c) => c.title === WARNING_POINTER_TITLE && String(c.page ?? "").trim() === "5" && c.fileId === attachedFileId,
  );
  const fixedText = isFixedCautionStop(a.content, a.served);
  const reason = !attachedFileId ? "attached manual's file id was not captured (S3)" : null;
  return { pass: reason === null && a.stop && p5 && fixedText, p5, fixedText, reason };
}

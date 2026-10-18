/**
 * Energized-work hard stop (2026-10-17 prod-test items TQ-29 / TQ-30).
 *
 * A technician who asks how to do hands-on work on a machine WHILE it is
 * powered ("swap the fan while it's powered", "check the terminals live",
 * "without locking out") does not get a procedure framed by a warning — the
 * turn stops before generation, and the stop cites the attached manual's own
 * lockout / disconnect-power page (TQ-29: GS10 p.2-15) so the next step is the
 * manual's, not MIRA's. The stop text carries NO removal steps, NO torques and
 * NO quoted procedure: a poisoned or sibling manual can supply the page number
 * but never what the technician reads (same posture as #4471's SAFETY_STOP).
 *
 * Zero-token: no inference call. Deterministic phrase + page selection only.
 * The classifier half (`isEnergizedWorkAsk`) lives in `@/lib/safety-classifier`
 * beside the other deterministic safety detectors.
 *
 * Kill switch: `NOTEBOOK_ENERGIZED_HARD_STOP=0` restores the pre-existing
 * flag-and-answer behaviour (owner decision 2026-09-27) without a redeploy.
 */

import type { ManualChunk } from "@/lib/manual-rag";

/** The persisted / streamed trigger when no phrase-level trigger fired (the
 *  ask matched the energized-work shape alone, e.g. "while it's powered"). */
export const ENERGIZED_WORK_TRIGGER = "energized-work";

/** Default ON. `0` disables the stop (the turn is flagged and answered as before). */
export function energizedHardStopEnabled(): boolean {
  return (process.env.NOTEBOOK_ENERGIZED_HARD_STOP ?? "1") !== "0";
}

/**
 * The retrieval query that finds a manual's lockout / disconnect-power page.
 * Deliberately generic OEM warning vocabulary — it is run inside the
 * notebook's own validated doc scope, so it can only surface THIS machine's
 * manuals.
 */
export const LOCKOUT_PAGE_QUERY =
  "disconnect power lockout tagout wait minutes before servicing hazardous voltage warning";

const LOCKOUT_PASSAGE_RE =
  /\b(?:lock[- ]?out|tag[- ]?out|loto|disconnect (?:all |the )?(?:input |incoming |main )?power|de-?energi[sz]e|remove (?:all )?(?:input )?power|turn off (?:all |the )?power)\b/i;
const HAZARD_HEADING_RE = /\b(?:WARNING|DANGER|CAUTION)\b/;

/**
 * The chunk to cite on the stop: the first retrieved passage that actually
 * says to disconnect / lock out power, preferring one under a WARNING /
 * DANGER / CAUTION heading (the manual's own safety page, not an incidental
 * mention in a wiring step). Null when no attached manual says it.
 */
export function pickLockoutChunk(chunks: readonly ManualChunk[]): ManualChunk | null {
  const lockout = chunks.filter((c) => LOCKOUT_PASSAGE_RE.test(c.content ?? ""));
  if (lockout.length === 0) return null;
  return lockout.find((c) => HAZARD_HEADING_RE.test(c.content ?? "")) ?? lockout[0];
}

/** The printed page to cite: the chapter-section label (p.2-15) when the
 *  chunk carries one, else the integer page, else null. */
export function lockoutPageOf(chunk: ManualChunk): string | null {
  const label = chunk.pageLabel?.trim();
  if (label) return label;
  return chunk.sourcePage != null && Number.isFinite(chunk.sourcePage) && chunk.sourcePage > 0
    ? String(chunk.sourcePage)
    : null;
}

export type LockoutCitation = { title: string; page: string | null };

/**
 * The served stop text. Static sentences plus one citation line — never the
 * chunk's own words, never a step, never a number other than the page.
 */
export function energizedWorkStop(cite: LockoutCitation | null): string {
  const where = cite
    ? cite.page
      ? `Your manual's lockout / disconnect-power procedure is in **${cite.title}, p.${cite.page}** — follow that page first.`
      : `Your manual's lockout / disconnect-power procedure is in **${cite.title}** — follow it first.`
    : "I couldn't find a lockout page in this notebook's manuals — follow your site's lockout/tagout procedure.";
  return `⛔ **SAFETY STOP — energized work.**

I won't give steps for working on this equipment while it is powered.

De-energize it, lock out and tag out every energy source, and verify zero energy. ${where}

Once it is locked out and verified, ask again and I'll walk you through the job from the manual.`;
}

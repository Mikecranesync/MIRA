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

import { citationPageLabel, isChapterSectionLabel } from "@/lib/citation-page";
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

// The four independent things a real lockout passage says. Scoring by how many
// are present is what separates the manual's actual lockout page from a
// front-matter "WARNING! Read all instructions. Disconnect power before
// servicing." boilerplate box — Review A HIGH: the old "first chunk under a
// WARNING heading" rule picked the boilerplate on p.2 over the real p.2-15.
const LOCKOUT_SIGNALS: ReadonlyArray<RegExp> = [
  // Codex round 6: the keypad / parameter / menu "lockout" FEATURE is a
  // setting, not energy isolation — it must not count toward the two-signal
  // rule ("The keypad lockout feature prevents parameter changes. Wait 5
  // seconds to exit the menu." was being cited as the isolation procedure).
  /(?<!\b(?:keypad|parameter|menu|screen|display|hmi)\s)\block[- ]?out\b(?!\s+(?:feature|function|setting|mode|parameter|option)\b)/i,
  /\btag[- ]?out\b|\bloto\b/i,
  // The disconnect-power INSTRUCTION — imperative only (Codex F4 round 3: "The
  // fault relay de-energizes when an alarm occurs" is a declarative about relay
  // behaviour and was being cited as the isolation procedure). The verb must
  // open a sentence or follow must/always/first/then.
  // …and "power" must END the clause (Codex round 4: "Turn off power saving
  // mode", "Remove the power module", "Disconnect power output terminal" are
  // not isolation instructions). What may follow: to/from/at/before/and/then/
  // first, punctuation, or end of line. "power supply" is the one two-word
  // target, and it must end the clause the same way (Codex round 5: "Turn off
  // power supply monitoring in the diagnostics menu" and "Disconnect the power
  // supply status cable" were being cited as the isolation procedure).
  /(?:^|[.;:!]\s*|\b(?:must|always|first|then)\s+)(?:disconnect|remove|turn\s+off|shut\s+off|isolate|de-?energi[sz]e)\s+(?:all\s+|the\s+)?(?:input\s+|incoming\s+|main\s+)?power(?:\s+supply)?(?=\s+(?:to|from|at|before|and|then|first)\b|\s*[.,;:]|\s*$)|\b(?:must|always)\s+be\s+de-?energi[sz]ed\b/im,
  // …and a countdown is an isolation signal only when it is ABOUT energy
  // ("wait 5 minutes before servicing / for the capacitors to discharge"), not
  // a menu timeout ("wait 5 seconds to exit the menu" — Codex round 6).
  /\bverify\s+(?:zero|no)\b|\bwait\s+(?:at\s+least\s+)?\d+\s*(?:minute|min|second|sec)\w*[^.;]{0,60}\b(?:before|until|for|then)\b[^.;]{0,50}\b(?:servic\w*|open\w*|remov\w*|touch\w*|work\w*|capacitor\w*|discharg\w*|power|voltage|energy|bus)\b|\bdischarge\b/i,
  // The manual's own "not while powered" PROHIBITION — round-2 review: the real
  // GS10 TQ-29 passage is "Do not remove the RFI jumper while power is
  // applied" (p.2-17). The powered-state phrase alone is not a signal (round
  // 3: operating text), and neither is a prohibition alone (round 3: "Do not
  // connect a low power sensor to this port") — it must be a prohibition ON
  // powered work: "do not <verb> … while/with/when/until … power(ed)/live".
  // Unverified against the real PDF; the positive shape is the reviewer's quote.
  /\b(?:do\s+not|don't|never|must\s+not)\s+(?:remove|install|connect|disconnect|touch|open|service|replace|work\s+on)\b[^.]{0,80}\b(?:while|with|when|until|unless)\b[^.]{0,30}\b(?:power(?:ed)?|energi[sz]ed|live)\b/i,
];
const HAZARD_HEADING_RE = /\b(?:WARNING|DANGER|CAUTION)\b/;

function lockoutScore(content: string): number {
  return LOCKOUT_SIGNALS.reduce((n, re) => n + (re.test(content) ? 1 : 0), 0);
}

// Codex F4 (round 2): one bare keyword is not a lockout page. "The capacitor
// discharge resistor is rated at 100 ohms" scored 1 on `discharge`; a keypad
// "lockout" feature description scores 1 on `lockout`. A page qualifies only
// with TWO distinct signals, or with one that is itself an INSTRUCTION — the
// disconnect-power imperative (index 2) or the not-while-powered prohibition
// (index 4). Nouns alone fall through to the site-LOTO fallback.
const INSTRUCTION_SIGNALS = [2, 4] as const;
function isLockoutPage(content: string): boolean {
  if (lockoutScore(content) >= 2) return true;
  return INSTRUCTION_SIGNALS.some((i) => LOCKOUT_SIGNALS[i].test(content));
}

/**
 * The chunk to cite on the stop: the retrieved passage that reads most like a
 * real lockout procedure. Ranked by how many distinct lockout signals it
 * carries, then by a printed chapter-section label (a manual that numbers its
 * pages "2-15" is citing a section, which beats a bare running page), then by
 * carrying a hazard heading. Null when no attached manual says it at all.
 */
export function pickLockoutChunk(chunks: readonly ManualChunk[]): ManualChunk | null {
  const scored = chunks
    .map((c) => ({ c, score: lockoutScore(c.content ?? "") }))
    .filter((s) => s.score > 0 && isLockoutPage(s.c.content ?? ""));
  if (scored.length === 0) return null;
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const al = isChapterSectionLabel(a.c.pageLabel) ? 1 : 0;
    const bl = isChapterSectionLabel(b.c.pageLabel) ? 1 : 0;
    if (bl !== al) return bl - al;
    const ah = HAZARD_HEADING_RE.test(a.c.content ?? "") ? 1 : 0;
    const bh = HAZARD_HEADING_RE.test(b.c.content ?? "") ? 1 : 0;
    return bh - ah;
  });
  return scored[0].c;
}

/**
 * The printed page to cite — and ONLY a page.
 *
 * Review A HIGH: this used to return `chunk.pageLabel` verbatim, so prose or
 * markdown smuggled into chunk metadata ("2-15**\n\n1. Remove the cover
 * screws (8 kg·cm)") was rendered inside a SAFETY STOP as if MIRA had written
 * it. Every candidate now has to survive `citationPageLabel` (#4478's shared
 * validator, which accepts a chapter-section label or a plain integer and
 * nothing else), so a non-page value yields null and the stop simply cites no
 * page rather than echoing it.
 */
export function lockoutPageOf(chunk: ManualChunk): string | null {
  const label = citationPageLabel(chunk.pageLabel);
  if (label) return label;
  return citationPageLabel(chunk.sourcePage);
}

export type LockoutCitation = { title: string; page: string | null };

/**
 * The served stop text: static sentences plus at most a page number.
 *
 * Review A HIGH — the filename is GONE from this text. A customer names the
 * file they upload, so `title` is attacker-influenced, and a file called
 * "torque 8-10 kg·cm, remove jumper JP1.pdf" put exactly that into a safety
 * stop. The document is already named by the `sources` citation chip the same
 * turn emits, so the stop loses nothing by referring to "your manual" and
 * citing only a validated page. `title` is accepted and deliberately ignored,
 * so no caller has to change and no future caller can reintroduce the leak.
 */
export function energizedWorkStop(cite: LockoutCitation | null): string {
  const page = cite ? citationPageLabel(cite.page) : null;
  const where = !cite
    ? "I couldn't find a lockout page in this notebook's manuals — follow your site's lockout/tagout procedure."
    : page
      ? `Your manual's lockout / disconnect-power procedure is on **p.${page}** — follow that page first.`
      : "Your manual's lockout / disconnect-power procedure is in the document cited below — follow it first.";
  return `⛔ **SAFETY STOP — energized work.**

I won't give steps for working on this equipment while it is powered.

De-energize it, lock out and tag out every energy source, and verify zero energy. ${where}

Once it is locked out and verified, ask again and I'll walk you through the job from the manual.`;
}

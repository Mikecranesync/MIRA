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
  // …and the state after while/with/when must BE a powered state (Codex round
  // 7: "Do not connect the sensor with low power consumption" is a spec, not a
  // prohibition on powered work — "power" there is a modifier).
  /\b(?:do\s+not|don't|never|must\s+not)\s+(?:remove|install|connect|disconnect|touch|open|service|replace|work\s+on)\b[^.]{0,80}\b(?:while|with|when|until|unless)\b[^.]{0,30}\b(?:power\s+(?:is\s+)?(?:applied|on|connected|present)|(?:the\s+)?power\s+(?:is\s+)?on|powered(?:\s+(?:up|on))?|energi[sz]ed|live|under\s+power)\b/i,
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
 * CV-101 journey S5b (2026-11-08): "Can I disconnect the serial cable from a
 * Micro820 with power applied in a hazardous location?" was stopped correctly,
 * but the manual's own p.5 WARNING about exactly that action (arc → explosion
 * in hazardous locations; remove power or make the area nonhazardous first)
 * never reached the technician: it is not a lockout procedure, so
 * `pickLockoutChunk` rightly skipped it, and nothing else looked.
 *
 * The question-scoped retrieval query for that warning. Run inside the same
 * validated doc scope as the lockout pass, so it can only surface THIS
 * machine's manuals.
 */
export function questionWarningQuery(message: string): string {
  return `${message} warning caution danger hazard`;
}

// A hazard box heading is printed in capitals; "warning" in running prose is not one.
const WARNING_BOX_RE = /\b(?:WARNING|DANGER|CAUTION)\b/;
// What makes it a hazard warning rather than an instruction box: the harm it names.
const HAZARD_CONSEQUENCE_RE =
  /\b(?:electrical\s+arc|arc\s+flash|arcing|explosion|explosive|electric(?:al)?\s+shock|shock\s+hazard|electrocution|hazardous\s+voltage|personal\s+injury|serious\s+injury|injury|death|burns?|fire)\b/i;
// Words that say nothing about WHICH action the ask is about: the powered-state
// vocabulary every energized ask carries, and filler.
const NON_SUBJECT_WORDS = new Set([
  "about", "after", "again", "also", "before", "being", "could", "does", "doing", "done", "from", "have",
  "into", "just", "need", "okay", "should", "still", "that", "them", "then", "there", "they", "this",
  "what", "when", "where", "which", "while", "will", "with", "would", "your",
  "power", "powered", "applied", "live", "energized", "energised", "running", "safe", "safely",
  "equipment", "machine", "unit", "work", "working",
]);

// Words that place a hazard rather than name an action or a part: two of these
// in common ("hazardous" + "environment") are what the manual's front-matter
// definition of WARNING shares with every hazardous-location ask (Codex #5349 F2).
const HAZARD_CONTEXT_WORDS = new Set([
  "hazard", "hazards", "hazardous", "nonhazardous", "location", "locations", "environment", "environments",
  "area", "areas", "installation", "installations", "explosion", "explosive", "danger", "dangerous",
  "warning", "caution", "injury", "death", "electrical", "electric", "shock", "fire", "burn", "burns",
]);

// Verbs that name what is being done, not what it is done to. Many warnings in
// one manual share them ("connect or disconnect the serial cable" / "... the
// Removable Terminal Block"), so a shared verb never identifies the part
// (Codex #5349 round 2 F2).
const ACTION_WORDS = new Set([
  "connect", "connecting", "disconnect", "disconnecting", "unplug", "unplugging", "plug", "plugging",
  "remove", "removing", "removal", "install", "installing", "insert", "inserting", "replace", "replacing",
  "swap", "swapping", "change", "changing", "pull", "pulling", "attach", "attaching", "detach", "detaching",
  "open", "opening", "close", "closing", "touch", "touching", "wire", "wiring", "rewire", "mount", "mounting",
  "unmount", "reset", "resetting", "adjust", "adjusting", "service", "servicing", "clean", "cleaning",
  "measure", "measuring", "test", "testing", "check", "checking", "handle", "handling",
]);

function subjectTerms(message: string): string[] {
  const words = message.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return [...new Set(words.filter((w) => w.length >= 4 && !NON_SUBJECT_WORDS.has(w)))];
}

/**
 * The retrieved passage that is the manual's hazard warning about the action
 * this ask names, or null. A passage qualifies only when it is a hazard box
 * (capitalised WARNING / DANGER / CAUTION heading AND a named harm) and it
 * shares at least two of the ask's subject words ("serial", "cable",
 * "disconnect", "hazardous", "location"). When the ask names a part, one of
 * the shared words must be that part; an ask that names no part may match on
 * its action. The manual's own definition of WARNING, a warning about a
 * different action, and a warning about a different part that shares only
 * the verb and the hazardous-location words are never picked. Ranked by shared subject
 * words, then by retrieval order.
 */
export function pickQuestionWarningChunk(chunks: readonly ManualChunk[], message: string): ManualChunk | null {
  const terms = subjectTerms(message);
  if (terms.length === 0) return null;
  const need = Math.min(2, terms.length);
  const isSubjectTerm = (t: string) => !HAZARD_CONTEXT_WORDS.has(t) && !/\d/.test(t);
  const isPartTerm = (t: string) => isSubjectTerm(t) && !ACTION_WORDS.has(t);
  const askParts = terms.filter(isPartTerm);
  const askNamesPart = askParts.length > 0;
  // "serial cable" is two part words: "cable" alone also names the
  // communications cable, so an ask that names two parts needs two in common.
  const needParts = Math.min(2, askParts.length);
  let best: { c: ManualChunk; overlap: number } | null = null;
  for (const c of chunks) {
    const content = c.content ?? "";
    if (!WARNING_BOX_RE.test(content) || !HAZARD_CONSEQUENCE_RE.test(content)) continue;
    const lower = content.toLowerCase();
    const shared = terms.filter((t) => new RegExp(`\\b${t}`).test(lower));
    // When the ask names a part ("serial", "cable"), the warning must name that
    // part too: a shared verb ("disconnect") plus where the hazard is ("hazardous
    // location") describes a different part's warning just as well. Only an ask
    // that names no part may match on the action alone. Hazard-location words
    // and the model number (on every page of this machine's manual) never count.
    if (askNamesPart ? shared.filter(isPartTerm).length < needParts : !shared.some(isSubjectTerm)) continue;
    const overlap = shared.length;
    if (overlap < need) continue;
    if (!best || overlap > best.overlap) best = { c, overlap };
  }
  return best?.c ?? null;
}

export type EnergizedStopOptions = {
  /** A related warning in the manual (`pickQuestionWarningChunk`) — a page only, never its words. */
  warning?: { page: string | null } | null;
  /** The lockout-page search failed, so "no lockout page" would be a guess. */
  lookupFailed?: boolean;
  /** Nothing says which machine the question is about and more than one
   *  document is selected, so any page would be one document's, chosen by
   *  rank. The stop prints no page at all (lockout or warning), whatever else
   *  the caller passes, and says why. */
  machineUnclear?: boolean;
};

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
export function energizedWorkStop(cite: LockoutCitation | null, opts: EnergizedStopOptions = {}): string {
  const unclear = opts.machineUnclear === true;
  const page = cite && !unclear ? citationPageLabel(cite.page) : null;
  const where = unclear
    ? "This notebook has more than one document and I can't tell from your question which machine's manual to use, so I'm not pointing you to a lockout page — follow your site's lockout/tagout procedure. Name the machine's model in your question and I can look for the lockout page in its own manual."
    : !cite
    ? opts.lookupFailed
      ? "I couldn't fully search this notebook's manuals just now — follow your site's lockout/tagout procedure, and check your manual's warnings before you start."
      : "I couldn't find a lockout page in this notebook's manuals — follow your site's lockout/tagout procedure."
    : page
      ? `Your manual's lockout / disconnect-power procedure is on **p.${page}** — follow that page first.`
      : "Your manual's lockout / disconnect-power procedure is in the document cited below — follow it first.";
  // Same posture as the lockout line: a validated page or a pointer to the
  // cited document, never the passage's own words (a poisoned manual can move
  // a page number but never write what the technician reads in a stop).
  const warningPage = opts.warning ? citationPageLabel(opts.warning.page) : null;
  // "Related", never "exactly this": word overlap can show a warning names the
  // same part or action, not that it covers this ask (Codex #5349 r3 F2, r4 F2),
  // so the stop claims no more than that and the technician reads the page.
  const warning = !opts.warning || unclear
    ? ""
    : warningPage
      ? `\n\nYour manual has a related warning on **p.${warningPage}** — read it before you go any further.`
      : "\n\nYour manual has a related warning in the document cited below — read it before you go any further.";
  return `⛔ **SAFETY STOP — energized work.**

I won't give steps for working on this equipment while it is powered.

De-energize it, lock out and tag out every energy source, and verify zero energy. ${where}${warning}

Once it is locked out and verified, ask again and I'll walk you through the job from the manual.`;
}

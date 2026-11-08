/**
 * $0 deterministic proposer — TASK-S2.
 *
 * Reads ONLY the technician's own words (paper §11); never MIRA's answer.
 * No model call: a small explicit vocabulary of regexes, same discipline as
 * capabilities/observations/parse.ts. Same text + same view -> same
 * proposals (determinism is required so a client retry never shows a
 * different receipt for an unchanged turn).
 *
 * proposalIds are a hash of (jobId, text, index-in-the-returned-list) per
 * the task spec. Payload ids that must themselves be valid UUIDs (per
 * validate.ts's isUuid checks on the events route) are ALSO deterministic —
 * derived the same way, just reshaped into UUID form — never
 * crypto.randomUUID(), which would break determinism.
 */
import { createHash } from "node:crypto";
import type { SheetView } from "./reduce";
import type {
  EventKind,
  HandoverWrittenPayload,
  JobFinishedPayload,
  JobStepCheckoff,
  NoteAddedPayload,
  NoteKind,
  PartAction,
  PartLoggedPayload,
  PhotoAttachedPayload,
  QuestionResolvedPayload,
  ReadingCorrectedPayload,
  ReadingRecordedPayload,
  StepMarkedPayload,
} from "./types";

export type ProposalRisk = "low" | "needs_tap";

export type SheetProposal = {
  proposalId: string;
  event:
    | { kind: "step_marked"; payload: StepMarkedPayload }
    | { kind: "reading_recorded"; payload: ReadingRecordedPayload }
    | { kind: "reading_corrected"; payload: ReadingCorrectedPayload }
    | { kind: "note_added"; payload: NoteAddedPayload }
    | { kind: "question_resolved"; payload: QuestionResolvedPayload }
    | { kind: "part_logged"; payload: PartLoggedPayload }
    | { kind: "photo_attached"; payload: PhotoAttachedPayload }
    | { kind: "handover_written"; payload: HandoverWrittenPayload }
    | { kind: "job_finished"; payload: JobFinishedPayload };
  risk: ProposalRisk;
  /** Plain shop language, <= 120 chars. */
  reason: string;
  /** The exact span of the tech's words this proposal came from. */
  quote: string;
};

const MAX_PROPOSALS = 8;

// ---------------------------------------------------------------------------
// Deterministic ids
// ---------------------------------------------------------------------------

function hashHex(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/** Reshapes a sha256 hex digest into UUID-shape (matches fix-records.isUuid,
 *  which checks shape only — no version/variant nibble requirement). */
function uuidFrom(parts: unknown[]): string {
  const h = hashHex(parts);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

/** Tried in order at the position right after a matched number (with an
 *  optional single leading space already baked into each pattern) — order
 *  matters: compound/longer forms before the single-letter forms they
 *  contain (ft-lb before a bare "f", in-lb before "in", N·m before nothing
 *  that collides). */
const UNIT_PATTERNS: { re: RegExp; canonical: string }[] = [
  { re: /^\s?(?:ft-lbs?|ft\s*lbs?)\b/i, canonical: "ft-lb" },
  { re: /^\s?in-lbs?\b/i, canonical: "in-lb" },
  { re: /^\s?(?:n\s*·\s*m|nm)\b/i, canonical: "N·m" },
  { re: /^\s?(?:degrees?\s*f|°f)/i, canonical: "°F" },
  { re: /^\s?f\b/i, canonical: "°F" },
  { re: /^\s?(?:degrees?\s*c|°c)/i, canonical: "°C" },
  { re: /^\s?c\b/i, canonical: "°C" },
  { re: /^\s?amps?\b/i, canonical: "A" },
  { re: /^\s?a\b/i, canonical: "A" },
  { re: /^\s?volts?\b/i, canonical: "V" },
  { re: /^\s?v\b/i, canonical: "V" },
  { re: /^\s?psi\b/i, canonical: "psi" },
  { re: /^\s?bar\b/i, canonical: "bar" },
  { re: /^\s?rpm\b/i, canonical: "rpm" },
  { re: /^\s?hz\b/i, canonical: "Hz" },
  { re: /^\s?mm\b/i, canonical: "mm" },
  { re: /^\s?inch(?:es)?\b/i, canonical: "in" },
  { re: /^\s?in\b/i, canonical: "in" },
  { re: /^\s?mils?\b/i, canonical: "mil" },
  { re: /^\s?%/, canonical: "%" },
  { re: /^\s?ohms?\b/i, canonical: "Ω" },
  { re: /^\s?Ω/, canonical: "Ω" },
];

function unitAt(text: string, pos: number): string | null {
  const rest = text.slice(pos, pos + 16);
  for (const { re, canonical } of UNIT_PATTERNS) {
    if (re.test(rest)) return canonical;
  }
  return null;
}

// F11: order matters — a comma-grouped integer ("1,200") before a plain
// decimal ("4.8") before a leading-dot decimal (".8") before a bare integer,
// so "1,200" is never split into "1" + "200" and ".8" is never read as "8"
// (the leading "0." must never be dropped). `parseNumberToken` strips the
// grouping commas before `Number()` — never truncates digits.
const NUM_SRC = "-?(?:\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+\\.\\d+|\\.\\d+|\\d+)";
const NUMBER_RE = new RegExp(NUM_SRC, "g");

function parseNumberToken(raw: string): number {
  return Number(raw.replace(/,/g, ""));
}

// R2-09: a raw regex match on its own doesn't reject a number that is a
// FRAGMENT of a larger non-numeric token ("1/2", "1e3", "1e-3", "4-5",
// "4..8", "1,20", "v2"). A valid token must be bounded: nothing adjacent
// that would make it part of something else. The char before the match may
// never be a letter/digit/"."/","/"/"/"-" (that always means it's glued to
// a bigger construct). The char after follows the same rule, EXCEPT a
// letter is allowed when it's the start of a real unit (".8A" must still
// work) — a letter that doesn't start a recognized unit ("1e3") is a
// fragment, not a bounded number.
function isBoundedNumberMatch(clause: string, index: number, end: number): boolean {
  const before = index > 0 ? clause[index - 1]! : null;
  if (before && /[A-Za-z0-9.,/-]/.test(before)) return false;
  const after = end < clause.length ? clause[end]! : null;
  if (after) {
    if (/[A-Za-z]/.test(after)) return unitAt(clause, end) !== null;
    if (/[0-9.,/-]/.test(after)) return false;
  }
  return true;
}

// Codex #5207 r2 F9: a correction's values pass the same full-token test as
// findNumbers. `start` is where the raw token sits in the clause. In the
// "not X, Y" form the old value is followed by the separating comma, so that
// comma is not a fragment — unless a digit follows it ("4,5" may be a decimal
// comma), which stays rejected.
function boundedValueAt(clause: string, start: number, raw: string, commaMaySeparate: boolean): number | null {
  const end = start + raw.length;
  const separated = commaMaySeparate && clause[end] === "," && !/[0-9]/.test(clause[end + 1] ?? "");
  const bounded = separated
    ? isBoundedNumberMatch(clause.slice(0, end), start, end)
    : isBoundedNumberMatch(clause, start, end);
  return bounded ? parseNumberToken(raw) : null;
}

function findNumbers(clause: string): { value: number; index: number; end: number }[] {
  const out: { value: number; index: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  NUMBER_RE.lastIndex = 0;
  while ((m = NUMBER_RE.exec(clause))) {
    const index = m.index;
    const end = m.index + m[0].length;
    if (isBoundedNumberMatch(clause, index, end)) {
      out.push({ value: parseNumberToken(m[0]), index, end });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// "what" derivation (Reading rule)
// ---------------------------------------------------------------------------

function wordsOf(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function deriveWhat(prefix: string, clause: string, view: SheetView): string {
  const trimmed = prefix.replace(/^[\s,]*\b(?:and|then|also)\b\s*/i, "").trim();
  if (trimmed) return trimmed;

  const candidates: string[] = [
    ...view.readings.map((r) => r.what),
    ...view.template.steps.filter((s) => s.checkoff === "measurement").map((s) => s.text),
    ...view.template.torques.map((t) => t.what),
  ];
  const clauseWords = new Set(wordsOf(clause));
  let best: { name: string; score: number } | null = null;
  for (const c of candidates) {
    const score = wordsOf(c).filter((w) => clauseWords.has(w)).length;
    if (score > 0 && (!best || score > best.score)) best = { name: c, score };
  }
  return best?.name ?? "reading";
}

// ---------------------------------------------------------------------------
// Rule matchers — each tries to classify one clause, highest priority first.
// ---------------------------------------------------------------------------

type RawProposal = Omit<SheetProposal, "proposalId">;

const LOTO_RE = /\b(?:lockout|lock\s*out|tagout|tagged\s*out|loto|isolat\w*|zero\s*energy|de-?energ\w*)\b/i;
const COMPLETION_RE = /\b(?:job\s*done|all\s*done|finished\s*the\s*job|job\s*complete|it'?s\s*fixed)\b/i;

// R2-08: "a question" is EITHER a literal "?" / one of the narrow hedging
// phrases, OR the clause opens with an interrogative word. The modal/aux
// openers (is/are/.../will/would) are ambiguous with shop shorthand that
// drops the subject ("will replace the seal" = "[I] will replace..."), so
// those specifically require a non-numeric subject right after the opener —
// if the opener is immediately followed by one of the bare action verbs
// (no subject in between), it's an elliptical statement, not a question.
// The wh-words (what/which/.../how) don't have that collision and are
// matched as a bare prefix.
const QUESTION_RE = /\?|(?:\bnot\s*sure\b|\bneed\s*to\s*check\b|\bdon'?t\s*know\b)/i;
const BARE_INTENT_VERBS = "replace|replaced|swap|swapped|change|changed|put|torque|torqued|correct|check|checked|record|log|mark|undo|finish|finished|start|started";
const MODAL_OPENER_RE = new RegExp(
  `^(?:is|are|was|were|did|do|does|have|has|had|can|could|should|will|would)\\b(?!\\s+(?:${BARE_INTENT_VERBS})\\w*\\b)`,
  "i",
);
const WH_OPENER_RE = /^(?:what|which|when|where|who|why|how)\b/i;
function isQuestionClause(clause: string): boolean {
  return QUESTION_RE.test(clause) || MODAL_OPENER_RE.test(clause) || WH_OPENER_RE.test(clause);
}

// R2-08: the full negation vocabulary from the spec. "n't" is matched as a
// bare suffix so every contraction (isn't/didn't/haven't/wouldn't/...) is
// caught without enumerating each one. NOTE: "not" is ALSO the grammar for
// two narrower, deliberate rules below (Correction's "not X, Y" and Step's
// "step N not done") — those run on their own trigger regex and are never
// gated by this flag; this flag only gates the branches where a negation
// word would otherwise be incidental background noise.
const NEGATION_RE = /\b(?:not|never|no|none|without|nothing)\b|n['’]t\b/i;
// F10: "should be" / "spec is" / "rated" state a specification, not a
// measurement — never a reading, never a correction, for the whole clause.
const SPEC_RE = /\b(?:should\s+be|spec\s+is|rated)\b/i;
const HANDOVER_START_RE = /^\s*handover:/i;
const HANDOVER_CONTAINS_RE = /\bfor\s+next\s+shift\b|\bnext\s+shift\b/i;

// R2-08-followup (coordinator probe of c5c2578e8): a clause is not a
// completed past fact if it carries a modal or future/intent marker
// ANYWHERE in the clause — "Will replace the bearing tomorrow" and "Can
// torque it to 40 Nm" were slipping through as a committed part_logged /
// reading_recorded because MODAL_OPENER_RE's bare-intent-verb lookahead
// (needed so "will replace the seal" reads as a statement, not a question)
// only stopped the opener from becoming a QUESTION — nothing stopped the
// clause from still being read as a completed, actionable fact. This is a
// SEPARATE flag: unlike isQuestion/isNegated, it does not care about
// sentence shape, only about whether the clause asserts something that has
// actually happened. "need"/"needs" only counts when it's followed by
// "to"/"a"/"an"/a digit (bare "need" with no object, e.g. "in need", isn't
// realistic shop phrasing and isn't worth the false-positive risk). "have
// to"/"has to" is scoped to the literal obligation phrase — bare "have" is
// deliberately EXCLUDED so "Have replaced the seal" (perfect tense,
// completed) is never caught by this.
const INTENT_MARKER_RE =
  /\b(?:will|would|should|could|can|may|might|must|shall|need(?:s)?\s+(?:to|an?|\d)|have\s+to|has\s+to|going\s+to|gonna|plan(?:s)?\s+to|want(?:s)?\s+to|about\s+to|tomorrow|later|next\s+shift|to-?do)\b/i;

// F10/R2-10: the trigger word may be followed by a named quantity ("I meant
// motor current 4.8 A") before the number. The qualifier phrase is now its
// OWN capture group (`nameGroup`) — not just lazily consumed — so the
// caller can match it EXACTLY against a reading's full label, rather than
// scoring shared words across the whole clause (R2-10: "fan current" must
// never match a stored "motor current" just because they share "current").
// NOTE: Correction is NOT gated by INTENT_MARKER_RE (e.g. "I should
// correct it to 4.8 A" is untouched by this round) — accepted gap, see the
// hazard ledger in the task report.
const CORRECTION_TRIGGERS: { re: RegExp; nameGroup: number | null; oldGroup: number | null; newGroup: number }[] = [
  { re: new RegExp(`\\bi\\s+meant\\s+(?:([a-z][a-z\\s]*?)\\s+)?(${NUM_SRC})`, "i"), nameGroup: 1, oldGroup: null, newGroup: 2 },
  { re: new RegExp(`\\bcorrection\\s+(?:([a-z][a-z\\s]*?)\\s+)?(${NUM_SRC})`, "i"), nameGroup: 1, oldGroup: null, newGroup: 2 },
  { re: new RegExp(`\\bnot\\s+(${NUM_SRC})\\s*,\\s*(${NUM_SRC})`, "i"), nameGroup: null, oldGroup: 1, newGroup: 2 },
];

const STEP_NOT_DONE_PATTERNS: RegExp[] = [/\bstep\s+(\d+)\s+not\s+done\b/i, /\bundo\s+step\s+(\d+)\b/i];
const STEP_DONE_PATTERNS: RegExp[] = [
  /\bdone\s+step\s+(\d+)\b/i,
  /\bstep\s+(\d+)\s+done\b/i,
  /\bfinished\s+step\s+(\d+)\b/i,
];

// R2-08-followup: the four forward-looking phrases this used to special-case
// as a "planned" part_logged ("will replace", "going to replace", "need to
// replace", "need a new") are now ALL caught by INTENT_MARKER_RE before this
// regex is ever tried — a plan is not a completed fact either, and the
// coordinator's probe named exactly this ("Need to replace the seal" =>
// part_logged, WRONG: intent). PART_RE and PartAction's "planned" value are
// therefore narrowed to reported, completed actions only; nothing in this
// file emits action:"planned" anymore (PartAction keeps the union member in
// types.ts in case another caller still produces it).
const PART_RE = /\b(replaced|swapped|changed out|put in a new)\s+([^.,!?\n]+)/i;

/** Lowercased, whitespace-collapsed label for exact (not fuzzy) comparison. */
function normalizeLabel(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** R2-10: never guesses, and a named quantity is matched EXACTLY (every
 *  qualifier word) — never by shared-word score. Precedence: (1) a named
 *  quantity was stated -> it must match one reading's full label exactly,
 *  or the correction is dropped (NEVER falls back to the unit-only pool
 *  below, even when that pool is unambiguous); (2) no name was given, but a
 *  stated old value uniquely matches one reading's current value
 *  (optionally narrowed by unit); (3) no name and no old value: the old
 *  unit-or-differs-by-value heuristic, but ONLY when unambiguous. Any tie
 *  or zero match -> null. */
function findCorrectionTarget(
  view: SheetView,
  namedQuantity: string | null,
  oldValue: number | null,
  unit: string | null,
  newValue: number,
): SheetView["readings"][number] | null {
  if (view.readings.length === 0) return null;

  if (namedQuantity) {
    const label = normalizeLabel(namedQuantity);
    const matches = view.readings.filter((r) => normalizeLabel(r.what) === label);
    // A name was stated: match it exactly or propose nothing. Never fall
    // back to the sole unit-compatible reading (R2-10) — an unmatched name
    // is stronger evidence of "wrong reading" than a shared unit is of
    // "right reading".
    return matches.length === 1 ? matches[0]! : null;
  }

  if (oldValue !== null) {
    const byOld = view.readings.filter(
      (r) => r.current.value === oldValue && (unit === null || r.current.unit === unit),
    );
    if (byOld.length === 1) return byOld[0]!;
    if (byOld.length > 1) return null; // ambiguous old-value match -- never guess
  }

  const pool = unit ? view.readings.filter((r) => r.current.unit === unit) : view.readings.filter((r) => r.current.value !== newValue);
  return pool.length === 1 ? pool[0]! : null;
}

function classifyClause(clause: string, view: SheetView): RawProposal[] {
  const trimmed = clause.trim();
  if (!trimmed) return [];

  // 1. LOTO / safety — never marks a step done, never touches isolation.
  if (LOTO_RE.test(trimmed)) {
    return [
      {
        event: { kind: "note_added", payload: { noteId: "", text: trimmed, noteKind: "note" as NoteKind } },
        risk: "needs_tap",
        reason: "Safety notes stay as you wrote them; isolation follows your site procedure.",
        quote: trimmed,
      },
    ];
  }

  // R2-08: computed once, before any fact-asserting branch. A question or a
  // negation must never produce a step_marked, reading, part_logged, or a
  // fact-asserting note below — "when in doubt, propose nothing" (a missed
  // proposal costs a tap; a wrong one puts a false fact on the work record).
  const isQuestion = isQuestionClause(trimmed);
  const isNegated = NEGATION_RE.test(trimmed);
  // R2-08-followup: a modal/future/intent marker anywhere in the clause
  // means it is not a completed past fact either — same principle, a
  // different door (not a question, not a negation, just not done yet).
  // A verbatim note is still allowed; a committed work proposal is not.
  const hasIntentMarker = INTENT_MARKER_RE.test(trimmed);

  // 2. Completion — MIRA never infers job_finished, and never from a
  // question ("Is the job done?"), a negation ("Not all done"), or an
  // intent marker ("Will be all done tomorrow") either.
  if (!isQuestion && !isNegated && !hasIntentMarker && COMPLETION_RE.test(trimmed)) {
    return [
      {
        event: {
          kind: "note_added",
          payload: {
            noteId: "",
            text: "You said the job is done. Finish it from the sheet; it will ask about open items.",
            noteKind: "note" as NoteKind,
          },
        },
        risk: "needs_tap",
        reason: "MIRA doesn't infer completion — finishing the job is a tap on the sheet.",
        quote: trimmed,
      },
    ];
  }

  // 3. Specification language — "should be"/"spec is"/"rated" names a spec
  // value, not a measurement: never a reading, never a correction (F10).
  if (SPEC_RE.test(trimmed)) return [];

  // 4. Correction — a number near "i meant" / "correction" / "not X, Y".
  for (const trig of CORRECTION_TRIGGERS) {
    const m = trig.re.exec(trimmed);
    if (!m) continue;
    // Every trigger ends with its new-value group; the old value (the
    // "not X, Y" form only) sits right after the leading "not ".
    const rawNew = m[trig.newGroup]!;
    const newValue = boundedValueAt(trimmed, m.index + m[0].length - rawNew.length, rawNew, false);
    if (newValue === null) return [];
    let oldValue: number | null = null;
    if (trig.oldGroup != null) {
      const rawOld = m[trig.oldGroup]!;
      oldValue = boundedValueAt(trimmed, m.index + /^\S+\s+/.exec(m[0])![0].length, rawOld, true);
      if (oldValue === null) return [];
    }
    const namedQuantity = trig.nameGroup != null ? m[trig.nameGroup] ?? null : null;
    const unitEnd = m.index + m[0].length;
    const unit = unitAt(trimmed, unitEnd);
    const target = findCorrectionTarget(view, namedQuantity, oldValue, unit, newValue);
    if (!target) return [];
    const finalUnit = unit ?? target.current.unit;
    const reason = `Changes ${target.what} from ${target.current.value} ${target.current.unit} to ${newValue} ${finalUnit} (${target.current.value} ${target.current.unit} stays in history)`;
    return [
      {
        event: {
          kind: "reading_corrected",
          payload: { readingId: target.id, value: newValue, unit: finalUnit, reason },
        },
        risk: "needs_tap",
        reason: reason.length > 120 ? reason.slice(0, 120) : reason,
        quote: trimmed,
      },
    ];
  }

  // 5. Step marked — "not done"/"undo" before plain "done" (disjoint patterns, but be explicit).
  // R2-08: "Is step 2 not done?" is a question about status, never a state
  // change — gate by isQuestion only. isNegated is NOT a gate here: "not
  // done" is this rule's own grammar (same word, different job), and the
  // existing "step 3 not done" statement test must still fire.
  for (const re of isQuestion ? [] : STEP_NOT_DONE_PATTERNS) {
    const m = re.exec(trimmed);
    if (!m) continue;
    const n = Number(m[1]);
    const step = view.steps[n - 1];
    if (!step) return [];
    return [
      {
        event: { kind: "step_marked", payload: { stepId: step.id, done: false, note: null } },
        risk: "needs_tap",
        reason: `Marks step ${n} not done.`,
        quote: trimmed,
      },
    ];
  }
  // F09: "Is step 1 done?" / "I have not done step 1" must not become
  // step_marked(done=true) — skip this pattern (falls through to
  // Question/Fallback below) rather than returning. R2-08-followup: neither
  // must "will mark step 2 done" (not done yet, just intended).
  for (const re of isQuestion || isNegated || hasIntentMarker ? [] : STEP_DONE_PATTERNS) {
    const m = re.exec(trimmed);
    if (!m) continue;
    const n = Number(m[1]);
    const step = view.steps[n - 1];
    if (!step) return [];
    const needsTap: JobStepCheckoff[] = ["torque", "loctite", "measurement"];
    const risk: ProposalRisk = needsTap.includes(step.checkoff) ? "needs_tap" : "low";
    const reason =
      risk === "needs_tap" ? `Marks step ${n} done — confirms the ${step.checkoff}.` : `Marks step ${n} done.`;
    return [
      {
        event: { kind: "step_marked", payload: { stepId: step.id, done: true, note: null } },
        risk,
        reason,
        quote: trimmed,
      },
    ];
  }

  // 6. Parts. F09: a question or negation ("Have we replaced the seal?",
  // "we have not replaced the seal") never logs a replacement. R2-08-
  // followup: neither does an intent marker ("Need to replace the seal",
  // "Will replace the bearing tomorrow") — PART_RE itself no longer has a
  // forward-looking alternative (see its comment above), so this gate is
  // belt-and-suspenders against any future trigger that reintroduces one.
  {
    const m = isQuestion || isNegated || hasIntentMarker ? null : PART_RE.exec(trimmed);
    if (m) {
      const item = m[2].trim();
      const action: PartAction = "replaced";
      const reason = `Logs ${item} as replaced — a reported action.`;
      return [
        {
          event: { kind: "part_logged", payload: { partEntryId: "", item, action, qty: null } },
          risk: "needs_tap",
          reason: reason.length > 120 ? reason.slice(0, 120) : reason,
          quote: trimmed,
        },
      ];
    }
  }

  // 7. Handover.
  if (HANDOVER_START_RE.test(trimmed) || HANDOVER_CONTAINS_RE.test(trimmed)) {
    return [
      {
        event: { kind: "handover_written", payload: { text: trimmed } },
        risk: "needs_tap",
        reason: "Adds this to the handover for the next shift.",
        quote: trimmed,
      },
    ];
  }

  // 8. Question.
  if (isQuestion) {
    return [
      {
        event: { kind: "note_added", payload: { noteId: "", text: trimmed, noteKind: "question" as NoteKind } },
        risk: "low",
        reason: "Flags this as an open question.",
        quote: trimmed,
      },
    ];
  }

  // 9/10. Reading(s), or a number with no recognizable unit.
  // R2-08: a negated clause never becomes a reading (a question would
  // already have returned above at the Question branch). "didn't torque
  // it" / "no reading yet" must produce nothing here, not a reading and
  // not even the "what unit" clarifying question. R2-08-followup: neither
  // does an intent marker ("Can torque it to 40 Nm", "should read 4.8 A",
  // "plan to torque to 40 Nm") — a capability or intended future reading is
  // not a measurement taken now. This also suppresses the "what unit"
  // clarifying question for these clauses; they fall through to the plain
  // verbatim Fallback note below instead.
  const numbers = isNegated || hasIntentMarker ? [] : findNumbers(trimmed);
  if (numbers.length > 0) {
    const readingProposals: RawProposal[] = [];
    for (const n of numbers) {
      const unit = unitAt(trimmed, n.end);
      if (!unit) continue;
      const prefix = trimmed.slice(0, n.index).trim();
      const what = deriveWhat(prefix, trimmed, view);
      readingProposals.push({
        event: {
          kind: "reading_recorded",
          payload: { readingId: "", what, value: n.value, unit, source: { kind: "tech", ref: null } },
        },
        risk: "needs_tap",
        reason: `Records ${what} as ${n.value} ${unit}.`,
        quote: trimmed,
      });
    }
    if (readingProposals.length > 0) return readingProposals;

    // No number in this clause had a recognizable unit.
    const first = numbers[0]!;
    return [
      {
        event: {
          kind: "note_added",
          payload: { noteId: "", text: `What unit is ${first.value}?`, noteKind: "question" as NoteKind },
        },
        risk: "needs_tap",
        reason: `No unit given — asks which unit ${first.value} is in.`,
        quote: trimmed,
      },
    ];
  }

  // 11. Fallback. R2-08: a negated clause with no other match still must
  // not become a fact-asserting note ("didn't torque it" -> nothing).
  if (isNegated) return [];
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (wordCount >= 3) {
    return [
      {
        event: { kind: "note_added", payload: { noteId: "", text: trimmed, noteKind: "note" as NoteKind } },
        risk: "low",
        reason: "Logs this as a general note so it isn't lost.",
        quote: trimmed,
      },
    ];
  }
  return [];
}

/** Splits on sentence-ish boundaries; a message with no boundary is one clause. */
function splitClauses(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Stamps a deterministic id, and any payload sub-id this proposal's event
 *  needs, onto a raw classification result — keyed on (jobId, text, index,
 *  turnId). F08: `turnId` (the chat message/turn id, when the caller has
 *  one) joins the key so the SAME words in two SEPARATE turns hash to two
 *  distinct ids — the store's dedup-by-id (store.ts) must never collapse a
 *  later, genuinely new turn into "already exists" and drop it from the
 *  queue. Replaying the SAME turn (same turnId) is still idempotent: the
 *  key is unchanged, so the id is unchanged. `turnId` is optional only for
 *  back-compat with callers that have none yet — omitting it reproduces the
 *  pre-fix (collision-prone) keying, so every real caller should pass one. */
function stamp(raw: RawProposal, jobId: string, text: string, index: number, turnId?: string): SheetProposal {
  const turnKey = turnId ?? null;
  const proposalId = hashHex(["proposal", jobId, text, index, turnKey]).slice(0, 32);
  const event = raw.event;
  let payload: SheetProposal["event"]["payload"] = event.payload;
  if (event.kind === "reading_recorded") {
    payload = { ...(event.payload as ReadingRecordedPayload), readingId: uuidFrom(["reading", jobId, text, index, turnKey]) };
  } else if (event.kind === "note_added") {
    payload = { ...(event.payload as NoteAddedPayload), noteId: uuidFrom(["note", jobId, text, index, turnKey]) };
  } else if (event.kind === "part_logged") {
    payload = { ...(event.payload as PartLoggedPayload), partEntryId: uuidFrom(["part", jobId, text, index, turnKey]) };
  }
  return { proposalId, event: { ...event, payload } as SheetProposal["event"], risk: raw.risk, reason: raw.reason, quote: raw.quote };
}

/**
 * Pure. Same `techText` + same `view` + same `turnId` -> same proposals.
 * Reads only the technician's words (`techText`); never MIRA's answer.
 *
 * `turnId` (F08) is the chat message/turn identity available to the caller
 * (`withSheetReceipt`'s `SheetReceiptContext.turnId`) — it must be stable
 * across a retry of the SAME turn and distinct across two SEPARATE turns.
 */
export function proposeSheetUpdates(techText: string, view: SheetView, turnId?: string): SheetProposal[] {
  const clauses = splitClauses(techText);
  const raw: RawProposal[] = [];
  for (const clause of clauses) {
    raw.push(...classifyClause(clause, view));
    if (raw.length >= MAX_PROPOSALS) break;
  }
  const capped = raw.slice(0, MAX_PROPOSALS);
  return capped.map((r, i) => stamp(r, view.jobId, techText, i, turnId));
}

// Re-exported for receipt.ts / route tests that need the event-kind shape.
export type SheetProposalEventKind = Exclude<EventKind, "job_started">;

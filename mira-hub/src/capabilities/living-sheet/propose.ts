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

const NUMBER_RE = /-?\d+(?:\.\d+)?/g;

function findNumbers(clause: string): { value: number; index: number; end: number }[] {
  const out: { value: number; index: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  NUMBER_RE.lastIndex = 0;
  while ((m = NUMBER_RE.exec(clause))) {
    out.push({ value: Number(m[0]), index: m.index, end: m.index + m[0].length });
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
const QUESTION_RE = /\?|(?:\bnot\s*sure\b|\bneed\s*to\s*check\b|\bdon'?t\s*know\b)/i;
const HANDOVER_START_RE = /^\s*handover:/i;
const HANDOVER_CONTAINS_RE = /\bfor\s+next\s+shift\b|\bnext\s+shift\b/i;

const CORRECTION_PATTERNS: RegExp[] = [
  /\bi\s+meant\s+(-?\d+(?:\.\d+)?)/i,
  /\bcorrection\s+(-?\d+(?:\.\d+)?)/i,
  /\bnot\s+-?\d+(?:\.\d+)?\s*,\s*(-?\d+(?:\.\d+)?)/i,
  /\bshould\s+be\s+(-?\d+(?:\.\d+)?)/i,
];

const STEP_NOT_DONE_PATTERNS: RegExp[] = [/\bstep\s+(\d+)\s+not\s+done\b/i, /\bundo\s+step\s+(\d+)\b/i];
const STEP_DONE_PATTERNS: RegExp[] = [
  /\bdone\s+step\s+(\d+)\b/i,
  /\bstep\s+(\d+)\s+done\b/i,
  /\bfinished\s+step\s+(\d+)\b/i,
];

const PART_RE = /\b(will replace|going to replace|need to replace|need a new|replaced|swapped|changed out|put in a new)\s+([^.,!?\n]+)/i;
const PLANNED_PHRASES = new Set(["will replace", "going to replace", "need to replace", "need a new"]);

function findCorrectionTarget(
  view: SheetView,
  unit: string | null,
  newValue: number,
): SheetView["readings"][number] | null {
  if (view.readings.length === 0) return null;
  const pool = unit ? view.readings.filter((r) => r.current.unit === unit) : view.readings.filter((r) => r.current.value !== newValue);
  if (pool.length === 0) return null;
  return pool.reduce((a, b) => (a.current.at >= b.current.at ? a : b));
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

  // 2. Completion — MIRA never infers job_finished.
  if (COMPLETION_RE.test(trimmed)) {
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

  // 3. Correction — a number near "i meant" / "correction" / "not X, Y" / "should be".
  for (const re of CORRECTION_PATTERNS) {
    const m = re.exec(trimmed);
    if (!m) continue;
    const newValue = Number(m[1]);
    const unitEnd = m.index + m[0].length;
    const unit = unitAt(trimmed, unitEnd);
    const target = findCorrectionTarget(view, unit, newValue);
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

  // 4. Step marked — "not done"/"undo" before plain "done" (disjoint patterns, but be explicit).
  for (const re of STEP_NOT_DONE_PATTERNS) {
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
  for (const re of STEP_DONE_PATTERNS) {
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

  // 5. Parts.
  {
    const m = PART_RE.exec(trimmed);
    if (m) {
      const phrase = m[1].toLowerCase();
      const item = m[2].trim();
      const planned = PLANNED_PHRASES.has(phrase);
      const action: PartAction = planned ? "planned" : "replaced";
      const risk: ProposalRisk = planned ? "low" : "needs_tap";
      const reason = planned ? `Logs ${item} as a planned replacement.` : `Logs ${item} as replaced — a reported action.`;
      return [
        {
          event: { kind: "part_logged", payload: { partEntryId: "", item, action, qty: null } },
          risk,
          reason: reason.length > 120 ? reason.slice(0, 120) : reason,
          quote: trimmed,
        },
      ];
    }
  }

  // 6. Handover.
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

  // 7. Question.
  if (QUESTION_RE.test(trimmed)) {
    return [
      {
        event: { kind: "note_added", payload: { noteId: "", text: trimmed, noteKind: "question" as NoteKind } },
        risk: "low",
        reason: "Flags this as an open question.",
        quote: trimmed,
      },
    ];
  }

  // 8/9. Reading(s), or a number with no recognizable unit.
  const numbers = findNumbers(trimmed);
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

  // 10. Fallback.
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
 *  needs, onto a raw classification result — keyed on (jobId, text, index). */
function stamp(raw: RawProposal, jobId: string, text: string, index: number): SheetProposal {
  const proposalId = hashHex(["proposal", jobId, text, index]).slice(0, 32);
  const event = raw.event;
  let payload: SheetProposal["event"]["payload"] = event.payload;
  if (event.kind === "reading_recorded") {
    payload = { ...(event.payload as ReadingRecordedPayload), readingId: uuidFrom(["reading", jobId, text, index]) };
  } else if (event.kind === "note_added") {
    payload = { ...(event.payload as NoteAddedPayload), noteId: uuidFrom(["note", jobId, text, index]) };
  } else if (event.kind === "part_logged") {
    payload = { ...(event.payload as PartLoggedPayload), partEntryId: uuidFrom(["part", jobId, text, index]) };
  }
  return { proposalId, event: { ...event, payload } as SheetProposal["event"], risk: raw.risk, reason: raw.reason, quote: raw.quote };
}

/**
 * Pure. Same `techText` + same `view` -> same proposals. Reads only the
 * technician's words (`techText`); never MIRA's answer.
 */
export function proposeSheetUpdates(techText: string, view: SheetView): SheetProposal[] {
  const clauses = splitClauses(techText);
  const raw: RawProposal[] = [];
  for (const clause of clauses) {
    raw.push(...classifyClause(clause, view));
    if (raw.length >= MAX_PROPOSALS) break;
  }
  const capped = raw.slice(0, MAX_PROPOSALS);
  return capped.map((r, i) => stamp(r, view.jobId, techText, i));
}

// Re-exported for receipt.ts / route tests that need the event-kind shape.
export type SheetProposalEventKind = Exclude<EventKind, "job_started">;

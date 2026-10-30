/**
 * Deterministic post-checks for one investigation's evidence (contract:
 * ../investigator/types.ts). Zero model calls — every function here is a
 * pure string/regex scan.
 *
 *   - `ungroundedNumbers(text, evidence)` — every number+unit and bare
 *     multi-digit number in `text` must appear in some evidence item's text
 *     after whitespace/unit normalisation. A fault/parameter code (F004,
 *     P036) is a identifier, not a "number" — it is excluded from the scan.
 *   - `unsafeInstructionPhrases(text)` — imperative bypass/jumper/defeat/
 *     force/override/disable-a-safety-function, work on energized/live
 *     equipment, "reset ... to clear", and "write a PLC/drive parameter
 *     without LOTO". A negated form ("do not", "never", "don't") within 4
 *     words before the match, and not crossing a sentence boundary, is not
 *     flagged.
 *   - `unknownEvidenceIds(ids, evidence)` — citation ids the evidence set
 *     does not contain.
 *
 * Also exports the shared negation-window helper (`isNegatedBefore`) and the
 * bypass-verb / safety-target vocabulary, reused as-is by `hazard-gate.ts`
 * so the two modules share one definition of "a safety-defeat ask" rather
 * than drifting.
 */

import type { EvidenceItem } from "./types";
import { BANNED_PATTERNS } from "@/capabilities/alarm-packs/loader";
import { isEnergizedWorkAsk } from "@/lib/safety-classifier";

// ---------------------------------------------------------------------------
// Negation window (shared with hazard-gate.ts)
// ---------------------------------------------------------------------------

// A true negation of the hazardous instruction ("do not bypass", "never
// jumper out"). Deliberately NOT including bare "not" alone (too broad —
// "not working" would exempt an adjacent, unrelated hazard mention).
const NEGATION_RE =
  /\b(?:do\s+not|don'?t|never|won'?t|will\s+not|must\s+not|shouldn'?t|should\s+not|wouldn'?t|would\s+not|cannot|can'?t|avoid(?:ing)?|no\s+intention\s+of|not\s+going\s+to)\b/i;

// Idiomatic double-negatives that must NOT exempt the phrase that follows
// them: "don't forget to jumper out the relay" is an instruction TO jumper
// out the relay, not a negation of it.
const FALSE_NEGATION_RE =
  /\b(?:don'?t|do\s+not|never)\s+(?:forget|fail)\s+to\s*$/i;

/**
 * True when a negation word/phrase sits within the last `windowWords` words
 * before `matchIndex`, in the SAME clause (the window never crosses a
 * sentence-ending `.`, `;`, `!`, `?`, and never reaches back before
 * `minIndex`) — so "Do not panic; bypass the interlock" still flags (the
 * negation is for "panic", in the prior clause), while "please don't bypass
 * the interlock" does not.
 *
 * `minIndex` is for scanning MULTIPLE hazard phrases in one string in order:
 * pass the end of the previous match so an earlier negation ("don't bypass
 * the interlock") cannot also exempt a later, distinct instruction separated
 * only by a comma ("...interlock, jumper out the light curtain instead").
 * See `unnegatedBypassMatches`/`firstUnnegatedBypassMatch` below, the
 * callers that need this.
 */
export function isNegatedBefore(text: string, matchIndex: number, windowWords = 4, minIndex = 0): boolean {
  if (matchIndex <= minIndex) return false;
  const before = text.slice(minIndex, matchIndex);
  const clauseStart =
    Math.max(before.lastIndexOf("."), before.lastIndexOf(";"), before.lastIndexOf("!"), before.lastIndexOf("?")) + 1;
  const clause = before.slice(clauseStart);
  const words = clause.trim().split(/\s+/).filter(Boolean);
  // No extra slack: a negation phrase up to 3 words ("do not", "no
  // intention of") fits inside the last `windowWords` words on its own —
  // padding the window let an earlier clause's negation reach across a
  // comma into a later, unrelated instruction.
  const windowText = words.slice(Math.max(0, words.length - windowWords)).join(" ");
  if (FALSE_NEGATION_RE.test(windowText)) return false;
  return NEGATION_RE.test(windowText);
}

// ---------------------------------------------------------------------------
// Shared bypass-verb / safety-target vocabulary (hazard-gate.ts imports both)
// ---------------------------------------------------------------------------

export const SAFETY_TARGET_RE =
  /\b(?:interlock|e-?stop|emergency\s+stop|safety\s+(?:relay|input|circuit|function|switch|device)|guard(?:\s+door)?|door\s+switch|light\s+curtain|safety\s+light\s+curtain|\bsto\b|safe\s+torque\s+off|limit\s+switch)\b/i;

function bannedPatternSource(id: string): string {
  const found = BANNED_PATTERNS.find((p) => p.id === id);
  if (!found) {
    // alarm-packs/loader.ts changed its ban list shape — fail loudly rather
    // than silently losing a safety pattern.
    throw new Error(`investigator/grounding: alarm-packs BANNED_PATTERNS id "${id}" not found`);
  }
  return found.rx.source;
}

// NOT reused verbatim from alarm-packs' BANNED_PATTERNS, despite covering
// the same verbs: that list is a load-time BAN on authored pack text (any
// match anywhere disqualifies the whole pack), so its patterns are
// deliberately prefix-loose (`\bbypass` with no trailing `\b`, `\bjumper`
// matches the NOUN too, `forc(?:e|ed|ing)` includes the past tense). Those
// same properties make it the wrong tool for detecting a REQUEST in
// arbitrary technician/model text:
//   - `forc(?:e|ed|ing)` matched "the guard was forced last shift" (a past-
//     tense REPORT) — only base/-ing forms count here; a past-tense report
//     is not a request.
//   - none of the list's patterns require a nearby safety TARGET, so a bare
//     "override" in "override speed parameter" (a settings name) would
//     otherwise match; `unnegatedBypassMatches` below always pairs the verb
//     with `SAFETY_TARGET_RE`.
// `disable` is added as a general verb (the spec's own "...override/disable
// a safety function") — distinct from the narrower, already-scoped
// `disable-diagnostic` id below (which is reused verbatim: it already pairs
// its verb with "wire-break"/"diagnos*", no separate target needed).
//
// "bypass"/"jumper" are also NOUNS naming a physical part ("the jumper",
// "factory jumper", "an RFI jumper", "the bypass contactor") — a determiner
// or modifier immediately before either word marks it as the noun use, not
// a verb, so the lookbehind below excludes it; "bypass contactor" (a real
// named assembly) is additionally excluded by the lookahead on "bypass".
// Both particle AND no-particle forms of "jumper" count as the verb
// ("jumper out the relay" and "jumper the relay" are both a request to
// defeat it) once the noun-context lookbehind has ruled out the part name.
// `\b` at the front is load-bearing: without it, a lookbehind for "an " also
// matches the tail of "can " (and "the " the tail of "lathe "), silently
// exempting "you CAN bypass the interlock" as if "can" were the determiner
// "a/an".
const NOUN_CONTEXT_BEFORE = "\\b(?:a|an|the|this|that|its|their|factory|rfi|existing|spare|new|old)\\s+";
const BYPASS_ACTIVE_VERB_SRC =
  `(?<!${NOUN_CONTEXT_BEFORE})\\bbypass(?:ing)?\\b(?!\\s+contactor)` +
  `|(?<!${NOUN_CONTEXT_BEFORE})\\bjumper(?:ing)?\\b(?:\\s+(?:out|around|across))?` +
  `|\\bbridg(?:e|ing)\\s+(?:it\\s+)?out\\b` +
  `|\\bforc(?:e|ing)\\b` +
  `|\\boverrid(?:e|ing)\\b` +
  `|\\bdefeat(?:ing)?\\b` +
  `|\\bdisabl(?:e|ing)\\b`;
export const BYPASS_VERB_RE = new RegExp(BYPASS_ACTIVE_VERB_SRC, "i");

// Passive voice puts the TARGET before the verb ("can the interlock be
// bypassed", "could the e-stop get jumpered") — `be`/`get` is required so a
// past-tense REPORT ("the guard was bypassed last shift") stays a report,
// not a request.
const PASSIVE_BYPASS_VERB_SRC = "(?:be|get)\\s+(?:bypassed|defeated|jumpered|overridden|disabled|forced)\\b";

// One combined pattern, active-order and passive-order as top-level
// alternatives, so a single `matchAll` scan finds every occurrence of
// EITHER shape in left-to-right document order (required for
// `unnegatedMatches`'s running `minIndex` boundary to mean anything).
const BYPASS_HAZARD_RE = new RegExp(
  `(?:${BYPASS_ACTIVE_VERB_SRC})(?:[^.?!;]{0,40}?)(?:${SAFETY_TARGET_RE.source})` +
    `|(?:${SAFETY_TARGET_RE.source})(?:[^.?!;]{0,40}?)(?:${PASSIVE_BYPASS_VERB_SRC})`,
  "gi",
);

const DISABLE_DIAGNOSTIC_SRC = bannedPatternSource("disable-diagnostic");

// ---------------------------------------------------------------------------
// unsafeInstructionPhrases
// ---------------------------------------------------------------------------

// "reset ... to clear" / "clear ... by resetting" — the one reset-shaped
// phrase this module treats as unsafe-instruction material (as opposed to
// an ordinary, safe "reset the fault and verify" next-check).
const RESET_TO_CLEAR_RE = /\breset\w*\b[^.?!;]{0,20}?\bto\s+clear\b|\bclear\w*\b[^.?!;]{0,20}?\bby\s+resetting\b/gi;

// Hands-on work paired with a powered/energized/live state, or an explicit
// "without lockout" qualifier.
// Gaps are LAZY (`{0,N}?`), not greedy: a greedy gap in a message carrying
// TWO separate occurrences of this shape ("bypass the interlock, jumper out
// the light curtain") would consume everything up to the LAST reachable
// target, silently fusing two distinct hazards into one match (and one
// negation check) instead of finding each verb its own nearest target.

// Writing a PLC/drive parameter with an explicit "without lockout" qualifier.
const WRITE_PARAM_WITHOUT_LOTO_RE =
  /\b(?:writ(?:e|ing)|set(?:ting)?|chang(?:e|ing)|modify(?:ing)?|program(?:ming)?)\b[^.?!;]{0,40}?\b(?:plc|drive)\b[^.?!;]{0,40}?\bparameters?\b[^.?!;]{0,40}?\bwithout\b[^.?!;]{0,20}?\b(?:lock(?:ing)?[- ]?out|tag(?:ging)?[- ]?out|loto)\b/gi;

/**
 * Every match of `re` in `text`, IN ORDER, that is not negated — scanning
 * (not stopping at) the first match, and clamping each match's negation
 * window so it cannot reach back past the end of the PREVIOUS match (see
 * `isNegatedBefore`'s `minIndex`): "Do not bypass the interlock, jumper out
 * the light curtain instead" must flag the SECOND instruction even though
 * the first is correctly exempted. `re` must carry the `g` flag.
 */
function unnegatedMatches(text: string, re: RegExp): RegExpMatchArray[] {
  const out: RegExpMatchArray[] = [];
  let minIndex = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (!isNegatedBefore(text, idx, 4, minIndex)) out.push(m);
    minIndex = idx + m[0].length;
  }
  return out;
}

/** Every unnegated bypass/jumper/defeat/force/override/disable-a-safety-
 *  target match (active or passive voice) in `text`, in order. */
export function unnegatedBypassMatches(text: string): RegExpMatchArray[] {
  return unnegatedMatches(text, BYPASS_HAZARD_RE);
}

/** The FIRST unnegated bypass match, or null — for a terminal gate that
 *  only needs to know whether one exists. */
export function firstUnnegatedBypassMatch(text: string): RegExpMatchArray | null {
  return unnegatedBypassMatches(text)[0] ?? null;
}

/**
 * "Work on energized/live equipment" is NOT a homemade regex: it is the
 * Hub's own `isEnergizedWorkAsk` (the same TQ-29 classifier `hazard-gate.ts`
 * runs first), applied per SENTENCE to an arbitrary text. That classifier
 * already carries, tested and maintained in production, everything a
 * homemade pattern had to re-derive and kept getting wrong across three
 * review rounds: de-energized/non-energized exclusion, a negated work
 * sentence ("Do not open the panel while it's energized" — dropped before
 * testing, via its own `withoutNegatedWorkSentences`), the skip-lockout
 * phrasings, the "while running" weak-signal + physical-verb requirement,
 * and the diagnostic-reading exemptions. Splitting on sentences (rather
 * than calling it once over the whole text) keeps the reported phrase
 * scoped to the one sentence that actually asks for hands-on energized
 * work, in a multi-sentence hypothesis/next-check. No separate negation
 * check is needed here — the classifier's own sentence-level negation
 * handling already covers it.
 */
function energizedWorkPhrases(text: string): string[] {
  const out: string[] = [];
  for (const sentence of text.split(/(?<=[.!?;])\s+/)) {
    const trimmed = sentence.trim();
    if (trimmed && isEnergizedWorkAsk(trimmed)) out.push(trimmed);
  }
  return out;
}

export function unsafeInstructionPhrases(text: string): string[] {
  const msg = text ?? "";
  const out: string[] = [];
  const push = (matches: RegExpMatchArray[]): void => {
    for (const m of matches) out.push(m[0]);
  };

  push(unnegatedBypassMatches(msg));
  push(unnegatedMatches(msg, new RegExp(DISABLE_DIAGNOSTIC_SRC, "gi")));
  push(unnegatedMatches(msg, RESET_TO_CLEAR_RE));
  out.push(...energizedWorkPhrases(msg));
  push(unnegatedMatches(msg, WRITE_PARAM_WITHOUT_LOTO_RE));

  return out;
}

// ---------------------------------------------------------------------------
// Number / quantity extraction (shared with plan.ts's `quantities` field)
// ---------------------------------------------------------------------------

export type ParsedQuantity = { value: number; unit: string; raw: string; start: number; end: number };

type UnitDef = { src: string; canonical: string };

// Longest/most-specific spellings FIRST — alternation commits to the first
// alternative that matches at a position, so "VAC"/"VDC"/"mA"/"kΩ"/"kW" must
// precede the generic "V"/"A"/"Ω" they would otherwise be swallowed by.
const UNIT_DEFS: readonly UnitDef[] = [
  { src: "VAC", canonical: "VAC" },
  { src: "VDC", canonical: "VDC" },
  { src: "k(?:\\u03a9|ohms?)", canonical: "kΩ" },
  { src: "\\u03a9|ohms?", canonical: "Ω" },
  { src: "mA", canonical: "mA" },
  { src: "A(?:mps?|mperes?)?", canonical: "A" },
  { src: "Hz", canonical: "Hz" },
  { src: "rpm", canonical: "rpm" },
  { src: "psi", canonical: "psi" },
  { src: "bar", canonical: "bar" },
  { src: "\\u00b0C|degC|deg\\s?C", canonical: "°C" },
  { src: "\\u00b0F|degF|deg\\s?F", canonical: "°F" },
  { src: "kW", canonical: "kW" },
  { src: "hp", canonical: "hp" },
  { src: "ms|msec|milliseconds?", canonical: "ms" },
  { src: "s|sec(?:onds?)?", canonical: "s" },
  { src: "%|percent", canonical: "%" },
  { src: "V|volts?", canonical: "V" },
];

// Grouped (1,750) or plain, with an optional decimal part and sign.
const NUMBER_SRC = "[-+]?\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|[-+]?\\d+(?:\\.\\d+)?";

const QUANTITY_RE = new RegExp(
  `(${NUMBER_SRC})\\s?(${UNIT_DEFS.map((u) => u.src).join("|")})(?![A-Za-z0-9])`,
  "gi",
);

function canonicalUnit(rawUnit: string): string | null {
  for (const def of UNIT_DEFS) {
    if (new RegExp(`^(?:${def.src})$`, "i").test(rawUnit)) return def.canonical;
  }
  return null;
}

function parseNumeral(raw: string): number {
  return Number(raw.replace(/,/g, ""));
}

/** Every number+known-unit pair in `text` (e.g. "620V", "1,750 rpm"). */
export function extractQuantities(text: string): ParsedQuantity[] {
  const out: ParsedQuantity[] = [];
  for (const m of (text ?? "").matchAll(QUANTITY_RE)) {
    const unit = canonicalUnit(m[2]);
    if (!unit) continue;
    const start = m.index ?? 0;
    out.push({ value: parseNumeral(m[1]), unit, raw: m[0], start, end: start + m[0].length });
  }
  return out;
}

// A letter-prefixed identifier shape (F004, P036, A055, Pr.12, E.OV1) — "not
// a number" per this module's contract, excluded from the bare-number scan.
const CODE_SHAPE_RE = /\b[A-Za-z]{1,4}\.?-?\d{1,4}(?:\.\d{1,4})?\b/g;

function codeShapeSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const m of text.matchAll(CODE_SHAPE_RE)) {
    const start = m.index ?? 0;
    spans.push([start, start + m[0].length]);
  }
  return spans;
}

// "page 15" / "p.2-15" / "pp. 40-42" — a page REFERENCE, not an asserted
// fact. `EvidenceItem.page`/`pageLabel` carries the real citation; a
// hypothesis that writes "see page 15" is pointing at it, not stating a
// number that itself needs grounding in evidence *text*. Excluded only from
// the `text` side of the scan (ungroundedNumbers below) — the point is to
// stop a citation mechanic from being misread as an ungrounded fact, not to
// change what counts as a quantity/bare-number anywhere else.
const PAGE_REF_RE = /\b(?:pp?\.|pages?)\s*[A-Za-z0-9]{1,4}(?:[-–][A-Za-z0-9]{1,4})?\b/gi;

function pageReferenceSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const m of text.matchAll(PAGE_REF_RE)) {
    const start = m.index ?? 0;
    spans.push([start, start + m[0].length]);
  }
  return spans;
}

// Same grouping discipline as NUMBER_SRC (a comma only counts as a
// thousands separator in a proper 3-digit group) — a loose `[\d,]*` class
// swallowed a trailing sentence comma into the raw match ("525," instead of
// "525" for "...PowerFlex 525, F004...").
const NUMERAL_RE = new RegExp(NUMBER_SRC, "g");

type BareNumber = { value: number; raw: string; start: number; end: number };

/** Every standalone multi-digit (2+ digit) number in `text` that is not part
 *  of a unit-bearing quantity and not part of a code-shaped identifier. */
function extractBareNumbers(text: string, excludeSpans: ReadonlyArray<readonly [number, number]>): BareNumber[] {
  const out: BareNumber[] = [];
  for (const m of text.matchAll(NUMERAL_RE)) {
    const raw = m[0];
    const digits = raw.replace(/[^\d]/g, "");
    if (digits.length < 2) continue;
    const start = m.index ?? 0;
    const end = start + raw.length;
    if (excludeSpans.some(([a, b]) => start < b && end > a)) continue;
    const before = text[start - 1];
    const after = text[end];
    if ((before && /[A-Za-z]/.test(before)) || (after && /[A-Za-z]/.test(after))) continue;
    out.push({ value: parseNumeral(raw), raw, start, end });
  }
  return out;
}

// `title` as well as `text`: a model name quoted only in the evidence
// item's title ("PowerFlex 525 User Manual") still grounds a number the
// hypothesis names ("On the PowerFlex 525, F004 indicates power loss").
function evidenceFields(item: EvidenceItem): string[] {
  return [item.text ?? "", item.title ?? ""];
}

function evidenceQuantitySet(evidence: readonly EvidenceItem[]): Set<string> {
  const set = new Set<string>();
  for (const item of evidence) {
    for (const field of evidenceFields(item)) {
      for (const q of extractQuantities(field)) set.add(`${q.value}|${q.unit}`);
    }
  }
  return set;
}

function evidenceBareNumberSet(evidence: readonly EvidenceItem[]): Set<number> {
  const set = new Set<number>();
  for (const item of evidence) {
    for (const field of evidenceFields(item)) {
      const quantitySpans = extractQuantities(field).map((q): [number, number] => [q.start, q.end]);
      const exclude = [...quantitySpans, ...codeShapeSpans(field)];
      for (const b of extractBareNumbers(field, exclude)) set.add(b.value);
    }
  }
  return set;
}

// A generic "V" in the TEXT (the claim is merely "volts") is satisfied by a
// more specific "VAC"/"VDC" quantity at the same value in evidence — NOT the
// other way round: a text that specifically asserts "VDC" is a more precise
// claim than evidence that only says generic "V", and genuinely isn't
// grounded by it.
function quantityIsGrounded(value: number, unit: string, quantitySet: ReadonlySet<string>): boolean {
  if (quantitySet.has(`${value}|${unit}`)) return true;
  if (unit === "V") return quantitySet.has(`${value}|VAC`) || quantitySet.has(`${value}|VDC`);
  return false;
}

/** Evidence ids can embed digit runs of their own (a uuid docId segment,
 *  "doc-4821-abc:12:0"). If the hypothesis text happens to inline-quote one
 *  verbatim (e.g. echoing a citation id), its digits must not be scanned as
 *  an asserted bare number — blank each known id out, same length, so
 *  positions/raw text elsewhere are unaffected. */
function blankKnownEvidenceIds(text: string, evidence: readonly EvidenceItem[]): string {
  let out = text;
  for (const item of evidence) {
    if (!item.id) continue;
    out = out.split(item.id).join(" ".repeat(item.id.length));
  }
  return out;
}

/**
 * Every number+unit and bare multi-digit number in `text` that does not
 * appear in any evidence item's text/title, after whitespace/unit
 * normalisation (both sides run through the same
 * `extractQuantities`/bare-number scan, so "750 RPM" in `text` grounds
 * against "750rpm" in evidence). A fault/parameter code (F004, P036) is an
 * identifier, not a "number".
 */
export function ungroundedNumbers(text: string, evidence: EvidenceItem[]): string[] {
  const rawMsg = text ?? "";
  const msg = blankKnownEvidenceIds(rawMsg, evidence);
  const quantitySet = evidenceQuantitySet(evidence);
  const bareSet = evidenceBareNumberSet(evidence);

  const quantities = extractQuantities(msg);
  const excludeSpans: Array<[number, number]> = [
    ...quantities.map((q): [number, number] => [q.start, q.end]),
    ...codeShapeSpans(msg),
    ...pageReferenceSpans(msg),
  ];
  const bareNumbers = extractBareNumbers(msg, excludeSpans);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const q of quantities) {
    const key = `q:${q.value}|${q.unit}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!quantityIsGrounded(q.value, q.unit, quantitySet)) out.push(q.raw);
  }
  for (const b of bareNumbers) {
    const key = `b:${b.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!bareSet.has(b.value)) out.push(b.raw);
  }
  return out;
}

// ---------------------------------------------------------------------------
// unknownEvidenceIds
// ---------------------------------------------------------------------------

/** Citation ids that do not exist in `evidence`, deduplicated, order preserved. */
export function unknownEvidenceIds(ids: string[], evidence: EvidenceItem[]): string[] {
  const known = new Set(evidence.map((e) => e.id));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (known.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

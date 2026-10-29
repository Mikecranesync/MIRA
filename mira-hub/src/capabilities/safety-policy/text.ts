/**
 * Deterministic text helpers for the safety policy: Unicode fold, sentence split, quantity parse,
 * hazard-context classification and rating conditions. No model call (zero-token rule).
 *
 * Detection only: nothing here is rendered. The fold is local on purpose (answer-validation.ts keeps
 * its own private `foldForDetection`; this module must not change that file while #4929/#4931 are open).
 */
import type { Condition, Quantity } from "./types";

/** Fold Unicode into the ASCII shape the rules below are written against. */
export function fold(s: string): string {
  return s
    // NFKC turns "1½" into "11⁄2" (eleven halves); keep the whole number apart from the fraction.
    .replace(/(\d)([\u00BC-\u00BE\u2150-\u215E])/g, "$1 $2")
    .normalize("NFKC")
    .replace(/[*`_]/g, "")
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-")
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/\p{Cf}/gu, "")
    .replace(/[^\S\n]/gu, " ");
}

/**
 * Sentences of a text. `wrapped` (source PDFs): a single newline is a line wrap, not a boundary.
 * Answers: every newline is a boundary (list items are steps). A sentence that is only citation
 * markers ("[1]") belongs to the sentence before it.
 */
export function sentences(text: string, wrapped: boolean): string[] {
  const t = fold(text);
  const blocks = wrapped ? t.split(/\n\s*\n/).map((b) => b.replace(/\s*\n\s*/g, " ")) : t.split(/\n+/);
  const out: string[] = [];
  for (const b of blocks) {
    for (const raw of b.split(/(?<=[.!?])\s+|\s*[☑•▪]\s*/u)) {
      const s = raw.replace(/^\s*(?:[-+]|\d+[.)])\s+/, "").trim();
      if (!s) continue;
      if (/^(?:\[(?:\d+|photo)\]\s*[.,;]?\s*)+$/i.test(s) && out.length > 0) out[out.length - 1] += ` ${s}`;
      else out.push(s);
    }
  }
  return out;
}

/** Paragraphs of an answer, each as its sentences (context carries within a paragraph). */
export function answerParagraphs(text: string): string[][] {
  return fold(text)
    .split(/\n\s*\n/)
    .map((p) => sentences(p, false))
    .filter((p) => p.length > 0);
}

const SMALL = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven",
  "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const WORDS = new Map<string, number>();
SMALL.forEach((w, i) => WORDS.set(w, i));
for (let t = 2; t < 10; t++) {
  WORDS.set(TENS[t], t * 10);
  for (let u = 1; u < 10; u++) WORDS.set(`${TENS[t]}-${SMALL[u]}`, t * 10 + u);
}
const WORD_ALT = [...WORDS.keys()].sort((a, b) => b.length - a.length).join("|");
const NUM = `(?:\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?|\\.\\d+|${WORD_ALT})`;
const PAREN = `(?:\\s*\\(\\s*\\d+(?:\\.\\d+)?\\s*\\))?`;

/** Fraction separators (#4959): "/", U+2044 FRACTION SLASH (NFKC of "½") and U+2215 DIVISION
 *  SLASH (survives NFKC). One class, used by the fraction normalizer AND the QTY_RE lookbehind,
 *  so a number can never start right after a separator the normalizer does not know. */
export const FRACTION_SEP = "/\\u2044\\u2215";
const SEP = `\\s*[${FRACTION_SEP}]\\s*`;

/** w + n/d as a decimal string; a zero denominator becomes a non-number so nothing is parsed. */
function fraction(w: number, n: string, d: string): string {
  const v = w + Number(n) / Number(d);
  return Number(d) === 0 || !Number.isFinite(v) ? "NaN" : String(Number(v.toFixed(6)));
}

function toNumber(tok: string): number {
  const t = tok.toLowerCase();
  return WORDS.has(t) ? WORDS.get(t)! : Number(t.replace(/,/g, ""));
}

/** Rewrite fractional and compound phrases into digits so the unit grammar sees them. */
function normalizePhrases(s: string): string {
  return s
    // #4956: "1 1/2", "1/2", NFKC "1⁄2" (from "½") → decimals, so a fraction never parses as its denominator.
    .replace(new RegExp(`(\\d+)\\s+(\\d+)${SEP}(\\d+)`, "g"), (_m, w: string, n: string, d: string) => fraction(Number(w), n, d))
    .replace(new RegExp(`(\\d+)${SEP}(\\d+)`, "g"), (_m, n: string, d: string) => fraction(0, n, d))
    .replace(/\b(?:an?|one)\s+hour\s+and\s+a\s+half\b/gi, "90 minutes")
    .replace(/\b(?:a\s+)?half\s+(?:an?\s+)?hour\b/gi, "30 minutes")
    .replace(/\b(?:a\s+)?half\s+(?:a\s+)?minute\b/gi, "30 seconds")
    .replace(/\b(?:a\s+)?quarter\s+(?:of\s+)?(?:an?\s+)?hour\b/gi, "15 minutes")
    .replace(/\ban?\s+(hour|minute|second)\b/gi, "1 $1")
    .replace(new RegExp(`\\b(${SMALL.slice(1).join("|")})\\s+hundred(?:\\s+and)?(?:\\s+(${WORD_ALT}))?\\b`, "gi"),
      (_m, h: string, r?: string) => String(toNumber(h) * 100 + (r ? toNumber(r) : 0)));
}

type Dim = "time" | "voltage" | "distance" | "energy" | "torque" | "pressure";
interface UnitDef { dim: Dim; re: string; factor: (u: string) => number }

const UNIT_DEFS: UnitDef[] = [
  { dim: "time", re: "hours?|hrs?|minutes?|mins?|seconds?|secs?|s", factor: (u) => (u.startsWith("h") ? 3600 : u.startsWith("m") ? 60 : 1) },
  { dim: "energy", re: "cal\\s*/\\s*cm\\s*2|cal\\s*/\\s*cm\\^2|cal\\s+per\\s+square\\s+centimet(?:er|re)", factor: () => 1 },
  { dim: "torque", re: "n\\s*[-.\\u00B7\\u22C5]?\\s*m|newton[- ]?met(?:er|re)s?|lb[- .]?in|in[- .]?lbs?|lb[- .]?ft|ft[- .]?lbs?|pound[- ](?:feet|foot|inch(?:es)?)",
    factor: (u) => (/^n|^newton/.test(u) ? 1 : /ft|feet|foot/.test(u) ? 1.35582 : 0.112985) },
  { dim: "pressure", re: "psig?|bar|kpa|mpa", factor: (u) => (u.startsWith("psi") ? 6.89476 : u === "bar" ? 100 : u === "mpa" ? 1000 : 1) },
  { dim: "voltage", re: "kv|kilovolts?|v\\s*dc|vdc|v\\s*ac|vac|volts?(?:\\s*(?:dc|ac))?|v", factor: (u) => (u.startsWith("k") ? 1000 : 1) },
  { dim: "distance", re: "mm|millimet(?:er|re)s?|cm|centimet(?:er|re)s?|met(?:er|re)s?|m|inch(?:es)?|in\\.|ft|feet|foot",
    factor: (u) => (u.startsWith("mm") || u.startsWith("milli") ? 1 : u.startsWith("c") ? 10 : u.startsWith("in") ? 25.4 : u.startsWith("f") ? 304.8 : 1000) },
];

const QTY_RE = new RegExp(
  `(?<![\\w.${FRACTION_SEP}])(${NUM})${PAREN}(?:\\s*(?:to|or|and|through|-)\\s*(${NUM})${PAREN})?\\s*-?\\s*(${UNIT_DEFS.map((d) => d.re).join("|")})(?![a-z0-9])`,
  "gi",
);

export interface Found { dim: Dim; values: number[]; start: number; end: number }

/** Every dimensioned quantity in a sentence, canonical units, range endpoints separately.
 *  Offsets refer to `normalizedSentence(sentence)`. */
export function findQuantities(sentence: string): Found[] {
  const s = normalizePhrases(sentence);
  const out: Found[] = [];
  for (const m of s.matchAll(QTY_RE)) {
    const unit = m[3].toLowerCase().replace(/\s+/g, " ");
    const def = UNIT_DEFS.find((d) => new RegExp(`^(?:${d.re})$`, "i").test(unit));
    if (!def) continue;
    const k = def.factor(unit);
    const values = [toNumber(m[1]) * k, ...(m[2] ? [toNumber(m[2]) * k] : [])].filter((n) => Number.isFinite(n));
    if (values.length > 0) out.push({ dim: def.dim, values, start: m.index!, end: m.index! + m[0].length });
  }
  return out;
}

/** The sentence as `findQuantities` sees it (offsets of `Found` index into this). */
export const normalizedSentence = (sentence: string) => normalizePhrases(sentence);

/** True when a time unit appears that no number was parsed for ("a few minutes"). */
export function hasUnparsedTime(sentence: string): boolean {
  const s = normalizePhrases(sentence);
  const units = (s.match(/\b(?:seconds?|secs?|minutes?|mins?|hours?|hrs?)\b/gi) ?? []).length;
  const parsed = findQuantities(sentence).filter((f) => f.dim === "time").length;
  return units > parsed;
}

/** Stored electrical energy, broadly (a capacitor or bus is in the sentence). */
export const STORED_RE =
  /\b(?:capacitors?|caps|dc[- ]?(?:bus|link)|bus\s+(?:voltage|capacitors?|caps)|stored\s+(?:energy|charge)|residual\s+(?:voltage|charge)|discharg\w*|bleed\w*|(?:remain|stay|still)\w*\s+charged|hazardous\s+voltage|dangerous\s+voltage|shock\s+hazard|electric(?:al)?\s+shock)\b/i;
/** A wait tied to discharge or to the interval after power removal / before contact. */
export const DISCHARGE_LINK_RE =
  /\b(?:discharg\w*|bleed\w*|drain\w*|(?:remain|stay|still)\w*\s+charged|stored|residual|after\s+(?:remov\w*|disconnect\w*|switch\w*\s+off|turn\w*\s+off|shut\w*|isolat\w*|de-?energi\w*|power(?:ing)?\s+(?:off|down)|lock\w*|all\s+display)|power\s+(?:is\s+)?(?:removed|off)|before\s+(?:touch|open|work|servic|remov|handl|access|inspect)\w*)\b/i;
const UNRELATED_TIMING_RE =
  /\b(?:accel\w*|decel\w*|ramp\w*|fans?|boot\w*|time-?outs?|scan\s+time|response\s+time|after\s+a\s+fault|fault\s+(?:has\s+been\s+)?cleared|performing\s+reset|cycle\s+the\s+power|cool\w*|overheat\w*|detection\s+time)\b/i;
const CHARGE_UP_RE = /\b(?:power(?:ing)?[- ]?up|start[- ]?up|pre-?charg\w*|recharg\w*|to\s+charge|charging|apply\s+(?:input\s+)?power)\b/i;

/** Timing that is not a discharge wait: ramps, fans, fault resets, recharging, cooling.
 *  Answer side (fail closed): any stored-energy word keeps a fault-worded wait a discharge claim. */
export function isUnrelatedTiming(clause: string): boolean {
  if (UNRELATED_TIMING_RE.test(clause) && !STORED_RE.test(clause)) return true;
  return CHARGE_UP_RE.test(clause) && !DISCHARGE_LINK_RE.test(clause);
}

/** Source side (#4954): naming the DC bus does not turn a fault-reset or check delay into a
 *  discharge time; only a discharge or contact link does. Support is read narrowly. */
export function isUnrelatedSourceTiming(clause: string): boolean {
  if (UNRELATED_TIMING_RE.test(clause) && !DISCHARGE_LINK_RE.test(clause)) return true;
  return isUnrelatedTiming(clause);
}

/** A comparative threshold immediately before the value ("less than 25VDC", "below 50 V"). */
const THRESHOLD_RE =
  /(?:\b(?:less\s+than|below|under|lower\s+than|at\s+most|drops?\s+(?:to|below)|falls?\s+(?:to|below)|discharged?\s+(?:to|below)|bleeds?\s+down\s+to)|<|≤)\s*(?:about\s+|approximately\s+)?$/i;
const BUS_POINT_RE = /\b(?:dc\s*\+|\+\s*dc|dc\s*-|-\s*dc|dc[- ]?(?:bus|link)|bus|capacitors?|between\s*\+\s*and\s*-|discharg\w*|residual|stored)/i;
/** Approach / arc-flash boundary wording. Not "clearance" (drive mounting) and not "working
 *  distance" (where incident energy is calculated; it runs the opposite conservative direction). */
const APPROACH_RE = /\b(?:approach|boundary|arc[- ]?flash|limited|restricted)\b/i;

const CLAUSE_DELIM_RE = /\s*;\s*|\s+-\s+|,\s+(?=(?:and|but|then|while|although)\b)/gi;

/** Clauses split at ";", spaced dashes and ", and/but/then" joins. */
export function clauses(sentence: string): string[] {
  return sentence.split(CLAUSE_DELIM_RE).filter((c) => c.trim());
}

/** [start, end) of the clause of `text` that contains offset `at`. */
export function clauseAround(text: string, at: number): [number, number] {
  let start = 0;
  let end = text.length;
  for (const m of text.matchAll(CLAUSE_DELIM_RE)) {
    const a = m.index!;
    const b = a + m[0].length;
    if (b <= at) start = b;
    else if (a >= at) {
      end = a;
      break;
    }
  }
  return [start, end];
}

/**
 * Which hazard-critical quantity a found value is, given its clause, the clause text just before
 * the value, and whether stored-energy context is in force (the sentence, its paragraph, or the
 * question). Null = not hazard-critical.
 */
export function classify(
  dim: Dim,
  clause: string,
  before: string,
  storedContext: boolean,
  side: "answer" | "source" = "answer",
): Quantity | null {
  switch (dim) {
    case "time": {
      // #4958 source side: "unrelated unless linked". A source time is discharge support only when
      // its OWN clause carries an explicit discharge or contact link; a bus word nearby is not
      // enough. The unrelated-timing exclusion stays as an extra guard (it only narrows).
      if (side === "source") {
        return storedContext && DISCHARGE_LINK_RE.test(clause) && !isUnrelatedSourceTiming(clause) ? "discharge_time" : null;
      }
      // Answer side (fail closed, unchanged): any duration in stored-energy context is a claim.
      return storedContext && !isUnrelatedTiming(clause) ? "discharge_time" : null;
    }
    case "voltage":
      return THRESHOLD_RE.test(before) && (BUS_POINT_RE.test(clause) || storedContext) ? "residual_voltage" : null;
    case "distance":
      return APPROACH_RE.test(clause) ? "approach_boundary" : null;
    case "energy":
      return "incident_energy";
    case "torque":
      return "torque";
    case "pressure":
      return "pressure";
  }
}

const COND_RES: Array<[RegExp, Condition["op"]]> = [
  [/(?:≤|<=|<|\bup\s+to|\bunder|\bbelow|\bless\s+than|\bat\s+most)\s*(\d+(?:\.\d+)?)\s*(hp|kw)\b/i, "le"],
  [/(?:≥|>=|>|\bover|\babove|\bmore\s+than|\bat\s+least)\s*(\d+(?:\.\d+)?)\s*(hp|kw)\b/i, "ge"],
  [/\b(\d+(?:\.\d+)?)\s*(hp|kw)\s*(?:models?\s+|drives?\s+|units?\s+)?(?:and|or)\s+(?:below|under|less|smaller|lower)\b/i, "le"],
  [/\b(\d+(?:\.\d+)?)\s*(hp|kw)\s*(?:models?\s+|drives?\s+|units?\s+)?(?:and|or)\s+(?:above|over|more|larger|higher|up)\b/i, "ge"],
  [/\b(\d+(?:\.\d+)?)\s*(hp|kw)\b/i, "eq"],
];

/** The first rating condition in a window of text, if any. */
export function conditionIn(window: string): Condition | undefined {
  let best: { at: number; c: Condition } | undefined;
  for (const [re, op] of COND_RES) {
    const m = re.exec(window);
    if (!m) continue;
    if (best && m.index >= best.at) continue;
    best = { at: m.index, c: { op, value: Number(m[1]), unit: m[2].toLowerCase() === "kw" ? "kW" : "hp" } };
  }
  return best?.c;
}

/** Whether a source's condition covers a known rating. No condition covers everything; an unknown
 *  rating (or a different unit) is never excluded — only a rating provably outside drops a value. */
export function conditionCovers(c: Condition | undefined, rating?: { value: number; unit: "hp" | "kW" }): boolean {
  if (!c || !rating || c.unit !== rating.unit) return true;
  if (c.op === "le") return rating.value <= c.value;
  if (c.op === "ge") return rating.value >= c.value;
  return Math.abs(rating.value - c.value) < 1e-9;
}

export const sameCondition = (a?: Condition, b?: Condition) =>
  !!a && !!b && a.op === b.op && a.unit === b.unit && Math.abs(a.value - b.value) < 1e-9;

/** Value equality in canonical units: exact for enforced quantities, 1% for converted units. */
export function sameValue(q: Quantity, a: number, b: number): boolean {
  const tol = q === "discharge_time" || q === "residual_voltage" ? 1e-9 : 0.01;
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
}

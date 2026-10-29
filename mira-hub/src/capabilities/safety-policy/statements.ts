/**
 * Statements: the typed hazard-critical values a sentence states, with the rating condition the
 * sentence attaches to each. One grammar serves both sides — the answer's claims and the sources'
 * support — so a value the extractor reads from an answer is the value the verifier looks for.
 */
import type { Comparator, Condition, EvidenceChunk, Quantity } from "./types";
import {
  STORED_RE,
  clauseAround,
  clauses,
  classify,
  conditionIn,
  findQuantities,
  hasUnparsedTime,
  isUnrelatedSourceTiming,
  isUnrelatedTiming,
  CONTINUES_RE,
  ZERO_CLAIM_RE,
  comparatorOf,
  normalizedSentence,
  sentenceUnits,
  sourceSupport,
} from "./text";

export interface Statement {
  quantity: Quantity;
  value: number;
  condition?: Condition;
  comparator?: Comparator;
}

/** Values stated in one sentence. `storedContext`: stored-energy context is in force for it.
 *  `side`: answers are read broadly (fail closed), sources narrowly (support must be explicit). */
export function statementsOf(
  sentence: string,
  storedContext: boolean,
  side: "answer" | "source" = "answer",
  timeSupport = storedContext,
): Statement[] {
  const text = normalizedSentence(sentence);
  const found = findQuantities(sentence);
  const out: Statement[] = [];
  found.forEach((f, i) => {
    const [cs, ce] = clauseAround(text, f.start);
    const clause = text.slice(cs, ce);
    const before = text.slice(Math.max(cs, i > 0 ? found[i - 1].end : 0), f.start);
    const after = text.slice(f.end, i + 1 < found.length ? found[i + 1].start : text.length);
    let quantity = classify(f.dim, clause, before, storedContext, side, after, text, timeSupport);
    const comparator = comparatorOf(before, after);
    // D2: an exact-zero voltage measurement claim ("confirm 0 V", "reads 0 V") is a residual-voltage
    // claim on the answer side even with no threshold word; it may pass as absence of voltage.
    const exactZero = f.values.length === 1 && f.values[0] === 0 && (comparator === undefined || comparator === "eq");
    if (!quantity && f.dim === "voltage" && side === "answer" && exactZero && (ZERO_CLAIM_RE.test(text) || storedContext)) {
      quantity = "residual_voltage";
    }
    if (!quantity) return;
    const condition = conditionIn(after) ?? conditionIn(before);
    const cmp = quantity === "residual_voltage" && exactZero && comparator === undefined ? "eq" : comparator;
    for (const value of f.values) {
      const st: Statement = { quantity, value };
      if (condition) st.condition = condition;
      if (cmp && f.values.length === 1) st.comparator = cmp;
      out.push(st);
    }
  });
  return out;
}

/** A stored-energy context sentence leaves a bare wait right after it in force ("...fully
 *  discharged before inspecting the drive! Wait at least FIVE minutes after all display lamps
 *  have turned off."). The carry is one sentence and only from a sentence that names it itself. */
const CARRY_RE = /^\s*(?:wait|allow|after)\b/i;

/** Every statement a source chunk makes (manual text is line-wrapped PDF text). */
export function chunkStatements(chunk: EvidenceChunk): Statement[] {
  const us = sentenceUnits(chunk.content, true);
  const out: Statement[] = [];
  const support = us.map((u) => sourceSupport(u.text));
  us.forEach((u, j) => {
    const s = u.text;
    const prev = j > 0 && us[j - 1].para === u.para ? us[j - 1] : null; // never across a paragraph
    const own = STORED_RE.test(s);
    const carried = !!prev && STORED_RE.test(prev.text) && CARRY_RE.test(s) && !isUnrelatedSourceTiming(s);
    // #4962 (round 3): a time is discharge support when its own sentence ties it to discharge,
    // contact or power removal, or names stored charge (sourceSupport); or by tight continuation
    // from the previous sentence of the same paragraph — an imperative wait or an anaphor
    // (CONTINUES_RE) — or from any sentence of the same list item.
    const sameItem = (k: number) => u.item >= 0 && us[k].para === u.para && us[k].item === u.item && support[k];
    const timeSupport =
      support[j] ||
      (!!prev && support[j - 1] && CONTINUES_RE.test(s)) ||
      us.some((_x, k) => k !== j && sameItem(k));
    out.push(...statementsOf(s, own || carried, "source", timeSupport));
  });
  return out;
}

/** True when a time unit in a stored-energy clause has no parsable number (SYS-2). */
export function unparsedDischargeTime(sentence: string, storedContext: boolean): boolean {
  if (!storedContext) return false;
  return clauses(normalizedSentence(sentence)).some((c) => !isUnrelatedTiming(c) && hasUnparsedTime(c));
}

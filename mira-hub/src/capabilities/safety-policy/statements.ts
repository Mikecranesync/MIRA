/**
 * Statements: the typed hazard-critical values a sentence states, with the rating condition the
 * sentence attaches to each. One grammar serves both sides — the answer's claims and the sources'
 * support — so a value the extractor reads from an answer is the value the verifier looks for.
 */
import type { Condition, EvidenceChunk, Quantity } from "./types";
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
  normalizedSentence,
  sentences,
} from "./text";

export interface Statement {
  quantity: Quantity;
  value: number;
  condition?: Condition;
}

/** Values stated in one sentence. `storedContext`: stored-energy context is in force for it.
 *  `side`: answers are read broadly (fail closed), sources narrowly (support must be explicit). */
export function statementsOf(sentence: string, storedContext: boolean, side: "answer" | "source" = "answer"): Statement[] {
  const text = normalizedSentence(sentence);
  const found = findQuantities(sentence);
  const out: Statement[] = [];
  found.forEach((f, i) => {
    const [cs, ce] = clauseAround(text, f.start);
    const clause = text.slice(cs, ce);
    const before = text.slice(Math.max(cs, i > 0 ? found[i - 1].end : 0), f.start);
    const after = text.slice(f.end, i + 1 < found.length ? found[i + 1].start : text.length);
    const quantity = classify(f.dim, clause, before, storedContext, side, after);
    if (!quantity) return;
    const condition = conditionIn(after) ?? conditionIn(before);
    for (const value of f.values) out.push(condition ? { quantity, value, condition } : { quantity, value });
  });
  return out;
}

/** A stored-energy context sentence leaves a bare wait right after it in force ("...fully
 *  discharged before inspecting the drive! Wait at least FIVE minutes after all display lamps
 *  have turned off."). The carry is one sentence and only from a sentence that names it itself. */
const CARRY_RE = /^\s*(?:wait|allow|after)\b/i;

/** Every statement a source chunk makes (manual text is line-wrapped PDF text). */
export function chunkStatements(chunk: EvidenceChunk): Statement[] {
  const ss = sentences(chunk.content, true);
  const out: Statement[] = [];
  ss.forEach((s, j) => {
    const own = STORED_RE.test(s);
    const carried = j > 0 && STORED_RE.test(ss[j - 1]) && CARRY_RE.test(s) && !isUnrelatedSourceTiming(s);
    out.push(...statementsOf(s, own || carried, "source"));
  });
  return out;
}

/** True when a time unit in a stored-energy clause has no parsable number (SYS-2). */
export function unparsedDischargeTime(sentence: string, storedContext: boolean): boolean {
  if (!storedContext) return false;
  return clauses(normalizedSentence(sentence)).some((c) => !isUnrelatedTiming(c) && hasUnparsedTime(c));
}

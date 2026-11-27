/**
 * ONE deterministic output-hygiene check for every answer candidate admitted to buffered release
 * (#6030 F7/F8). No model, no translation, no detector call: a pure function of the candidate, the
 * technician's own turn(s) and the evidence the model was given.
 *
 *  - Expected scripts come from what the technician WROTE (the existing language contract in
 *    answer-language.ts: "answer in the language the technician wrote in"). A Japanese/Arabic/Hindi/
 *    Russian question expects that script; a Latin question expects none. Absence of Latin accents is
 *    never read as English.
 *  - Latin text (product codes, fault codes, names, units, [n] markers) is always acceptable.
 *  - A run of an UNEXPECTED non-Latin script is acceptable only when that exact run appears verbatim in
 *    the evidence the model was shown (a source label or name). Every run is judged on its own, so a
 *    legitimate quoted name elsewhere never exempts unexpected foreign prose.
 *  - Draft/meta markers ("rewrite:", "correction:", ...) are never part of an answer.
 */
import { SCRIPT_PATTERNS, nonLatinScriptsIn, type ScriptGroup } from "./answer-language";

export type HygieneVerdict = { ok: true } | { ok: false; code: "unexpected_script" | "draft_marker"; detail: string };

export type HygieneContext = {
  /** The technician's message for this turn. */
  question: string;
  /** Earlier technician messages of the thread: a Japanese thread keeps expecting Japanese on "F081?". */
  priorUserTurns?: readonly string[];
  /** Evidence texts the model was shown (chunk text, titles, file names): where legitimate non-Latin names live. */
  sources?: readonly string[];
};

const DRAFT_MARKERS: readonly RegExp[] = [
  /better (spanish|english|french|german|japanese|chinese|arabic|russian|hindi):/i,
  /rewrite:/i,
  /correction:/i,
  /let me (rephrase|correct|fix|rewrite)/i,
  /wait,? (let me|i should)/i,
  /actually,? (let me|i should)/i,
];

export function expectedScripts(ctx: Pick<HygieneContext, "question" | "priorUserTurns">): Set<ScriptGroup> {
  const out = nonLatinScriptsIn(ctx.question);
  for (const t of ctx.priorUserTurns ?? []) for (const g of nonLatinScriptsIn(t)) out.add(g);
  return out;
}

export function checkAnswerHygiene(text: string, ctx: HygieneContext): HygieneVerdict {
  for (const marker of DRAFT_MARKERS) {
    if (marker.test(text)) return { ok: false, code: "draft_marker", detail: marker.source };
  }
  const expected = expectedScripts(ctx);
  const evidence = (ctx.sources ?? []).join("\n");
  for (const [group, cls] of SCRIPT_PATTERNS) {
    if (expected.has(group)) continue;
    for (const run of text.match(new RegExp(`[${cls}]+`, "gu")) ?? []) {
      if (!evidence.includes(run)) return { ok: false, code: "unexpected_script", detail: `${group}:${run.slice(0, 24)}` };
    }
  }
  return { ok: true };
}

/**
 * Shown instead of a candidate that failed hygiene and has no clean quoted recovery. It says what
 * happened: the REPLY could not be shown. It makes no claim about the manuals, so it is never
 * recorded as "not found in the selected sources".
 */
export const OUTPUT_HYGIENE_FAILURE_TEXT =
  "I could not produce a clean reply this time, so I am not showing it. This says nothing about your manuals — please ask again.";

/** A quoted recovery, if the candidate ends in a quoted passage worth releasing; the caller re-checks it. */
export function quotedRecovery(text: string): string | null {
  const m = text.match(/"([^"]+)"\s*$/);
  return m && m[1].length > 20 ? m[1] : null;
}

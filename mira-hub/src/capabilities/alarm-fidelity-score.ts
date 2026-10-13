/**
 * Scores LOOK screen transcriptions against a synthetic alarm screen for the alarm-card
 * fidelity gate (spec docs/superpowers/specs/2026-10-12-alarm-reasoning-design.md §2, §9).
 * Pure and deterministic; the truth is the fixture screen itself, never a hand-typed copy.
 *
 *  (a) designations reproduced exactly            — gate ≥ 90 % across all photos
 *  (b) characters invented inside cut-off fields  — gate: zero, across all photos
 *  (c) records grouped with the screen's boundaries — gate ≥ 90 % across all photos
 */
import { groupAlarmRecords, parseDesignations } from "./alarm-line";

export type ScreenScore = {
  designationExact: number;
  designationTotal: number;
  inventedInCutFields: number;
  recordsCorrect: number;
  recordsTotal: number;
};

export type GateResult = { pass: boolean; designationRate: number; groupingRate: number; invented: number };

const CUT_TOKEN = /(\S+?)(?:…|\.\.\.)/g;

function counts(items: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return m;
}

/** Size of the multiset intersection: how many of `truth` appear in `got`. */
function matched(truth: string[], got: string[]): number {
  const have = counts(got);
  let n = 0;
  for (const t of truth) {
    const left = have.get(t) ?? 0;
    if (left > 0) {
      n += 1;
      have.set(t, left - 1);
    }
  }
  return n;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A record's boundary shape: its list number and how many visual lines it spans. */
function shapes(lines: readonly string[]): string[] {
  return groupAlarmRecords(lines, { collapse: false }).map((r) => `${r.number ?? "-"}/${r.lines.length}`);
}

export function scoreScreen(truthLines: readonly string[], transcribed: readonly string[]): ScreenScore {
  const truthTags = truthLines.flatMap((l) => parseDesignations(l).map((d) => d.raw));
  const gotTags = transcribed.flatMap((l) => parseDesignations(l).map((d) => d.raw));

  // Every prefix that the screen cuts off ("08:14:3" of "08:14:3…"); an alphanumeric
  // character right after it in the transcription is a character the model made up.
  const prefixes = new Set<string>();
  for (const l of truthLines) for (const m of l.matchAll(CUT_TOKEN)) prefixes.add(m[1]);
  let invented = 0;
  for (const p of prefixes) {
    const rx = new RegExp(`(?<![0-9A-Za-z])${escape(p)}[0-9A-Za-z]`, "g");
    for (const l of transcribed) invented += [...l.matchAll(rx)].length;
  }

  const truthShapes = shapes(truthLines);
  return {
    designationExact: matched(truthTags, gotTags),
    designationTotal: truthTags.length,
    inventedInCutFields: invented,
    recordsCorrect: matched(truthShapes, shapes(transcribed)),
    recordsTotal: truthShapes.length,
  };
}

export function gate(scores: readonly ScreenScore[]): GateResult {
  const sum = (k: keyof ScreenScore) => scores.reduce((a, s) => a + s[k], 0);
  const designationRate = sum("designationTotal") ? sum("designationExact") / sum("designationTotal") : 1;
  const groupingRate = sum("recordsTotal") ? sum("recordsCorrect") / sum("recordsTotal") : 1;
  const invented = sum("inventedInCutFields");
  return { pass: designationRate >= 0.9 && groupingRate >= 0.9 && invented === 0, designationRate, groupingRate, invented };
}

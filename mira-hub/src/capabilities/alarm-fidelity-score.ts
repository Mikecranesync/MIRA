/**
 * Scores LOOK screen transcriptions against a synthetic alarm screen for the alarm-card
 * fidelity gate (spec docs/superpowers/specs/2026-10-12-alarm-reasoning-design.md §2, §9).
 * Pure and deterministic; the truth is the fixture screen itself, never a hand-typed copy.
 *
 *  (a) designations reproduced exactly            — gate ≥ 90 % across all photos
 *  (b) characters invented inside cut-off fields  — gate: zero, across all photos
 *  (c) records reproduced with the screen's boundaries and first line — gate ≥ 90 %
 *  A run passes only with at least MIN_PHOTOS photos (the capture sheet takes 10).
 */
import { groupAlarmRecords, parseDesignations } from "./alarm-line";

export type ScreenScore = {
  designationExact: number;
  designationTotal: number;
  inventedInCutFields: number;
  recordsCorrect: number;
  recordsTotal: number;
};

export type GateResult = {
  pass: boolean;
  designationRate: number;
  groupingRate: number;
  invented: number;
  photos: number;
};

/** The capture sheet (docs/runbooks/alarm-fidelity-capture.md) takes 10 photos; fewer is not a run. */
export const MIN_PHOTOS = 10;

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

/** Normalize for comparison only: case, spacing, and the two spellings of the cut-off marker. */
const norm = (s: string) => s.toLowerCase().replace(/…/g, "...").replace(/\s+/g, " ").trim();

/**
 * A record's identity for the grouping measure: how many visual lines it spans plus its
 * first line. Line count alone would credit one alarm swapped for another of the same
 * size; the first line carries the alarm number, time and message, so a swap is caught.
 */
function shapes(lines: readonly string[]): string[] {
  return groupAlarmRecords(lines, { collapse: false }).map((r) => `${r.lines.length}|${norm(r.lines[0])}`);
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

export function gate(scores: readonly ScreenScore[], minPhotos: number = MIN_PHOTOS): GateResult {
  const sum = (k: keyof ScreenScore) => scores.reduce((a, s) => a + s[k], 0);
  const designationRate = sum("designationTotal") ? sum("designationExact") / sum("designationTotal") : 1;
  const groupingRate = sum("recordsTotal") ? sum("recordsCorrect") / sum("recordsTotal") : 1;
  const invented = sum("inventedInCutFields");
  const photos = scores.length;
  const pass = photos >= minPhotos && designationRate >= 0.9 && groupingRate >= 0.9 && invented === 0;
  return { pass, designationRate, groupingRate, invented, photos };
}

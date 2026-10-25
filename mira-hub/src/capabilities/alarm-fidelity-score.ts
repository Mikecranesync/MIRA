/**
 * Scores LOOK screen transcriptions against a synthetic alarm screen for the alarm-card
 * fidelity gate (spec docs/superpowers/specs/2026-10-12-alarm-reasoning-design.md §2, §9).
 * Pure and deterministic; the truth is the fixture screen itself, never a hand-typed copy.
 *
 *  (a) designations reproduced exactly            — gate ≥ 90 % across all photos
 *  (b) characters invented inside cut-off fields  — gate: zero, across all photos
 *  (c) records reproduced with the screen's boundaries and contents — gate ≥ 90 %
 *  A run passes only when the photos match RUN_PLAN exactly, screen by screen.
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
  /** Screens whose photo count differs from the run plan (too few, too many, or not in it). */
  offPlanScreens: string[];
};

export type ScoredPhoto = { screen: string; score: ScreenScore };

/**
 * The capture sheet (docs/runbooks/alarm-fidelity-capture.md): photos per screen. A run must
 * cover every screen at least this often — ten good photos of one screen measure nothing about
 * the other.
 */
export const RUN_PLAN: Readonly<Record<string, number>> = { failsafe: 4, rtd: 3, history: 3 };
export const MIN_PHOTOS = Object.values(RUN_PLAN).reduce((a, n) => a + n, 0);

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

/** Compare letters and digits only: case, spacing and punctuation are not grouping errors. */
const alnum = (s: string) => s.toLowerCase().replace(/[^0-9a-z]/g, "");

/**
 * A record's identity for the grouping measure: how many visual lines it spans plus ALL
 * its text, letters and digits only. Line count alone would credit one alarm swapped for
 * another of the same size, and the first line alone would credit a designation line that
 * wandered to the wrong alarm (the card would then pair a channel with the wrong module).
 * Case and punctuation are ignored so a stray ";" for ":" does not count as a grouping error.
 */
function shapes(lines: readonly string[]): string[] {
  return groupAlarmRecords(lines, { collapse: false }).map((r) => `${r.lines.length}|${alnum(r.lines.join(" "))}`);
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

export function gate(photos: readonly ScoredPhoto[], plan: Readonly<Record<string, number>> = RUN_PLAN): GateResult {
  const scores = photos.map((p) => p.score);
  const sum = (k: keyof ScreenScore) => scores.reduce((a, s) => a + s[k], 0);
  const designationRate = sum("designationTotal") ? sum("designationExact") / sum("designationTotal") : 1;
  const groupingRate = sum("recordsTotal") ? sum("recordsCorrect") / sum("recordsTotal") : 1;
  const invented = sum("inventedInCutFields");
  // Exact counts: too few leaves a screen unmeasured; extras would dilute failures in the
  // planned photos (review #4389 r5). A run that is off plan is not a run.
  const screens = new Set([...Object.keys(plan), ...photos.map((p) => p.screen)]);
  const offPlanScreens = [...screens].filter(
    (screen) => photos.filter((p) => p.screen === screen).length !== (plan[screen] ?? 0),
  );
  const pass = offPlanScreens.length === 0 && designationRate >= 0.9 && groupingRate >= 0.9 && invented === 0;
  return { pass, designationRate, groupingRate, invented, photos: photos.length, offPlanScreens };
}

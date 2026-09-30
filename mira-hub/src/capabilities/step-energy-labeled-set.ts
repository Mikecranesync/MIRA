/**
 * #4122 — the blind-labeled answers the step-energy checker is measured on.
 * Set 1: docs/proofs/2026-09-29-4122-step-safety-ab (70 answers, union of two
 * strict judges). Set 2: docs/proofs/2026-09-30-4122-step-checker/set2 (70
 * answers, judges X and Y, union = X OR Y). Label = loto_contradiction: a step
 * both isolated/locked-out and energized/operated. Test-only helper.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface LabeledAnswer {
  set: "set1" | "set2";
  id: string;
  question: string;
  answer: string;
  contradiction: boolean;
}

const REPO = join(__dirname, "..", "..", "..");
const read = (p: string): unknown => JSON.parse(readFileSync(join(REPO, p), "utf8"));

export function loadLabeledSet(): LabeledAnswer[] {
  const out: LabeledAnswer[] = [];
  const s1 = "docs/proofs/2026-09-29-4122-step-safety-ab";
  const b1 = read(`${s1}/blind3.json`) as { id: string; question: string; answer: string }[];
  const j1 = read(`${s1}/judgments_strict_union.json`) as Record<string, { loto_contradiction: number | boolean }>;
  for (const a of b1) out.push({ set: "set1", ...a, contradiction: Boolean(j1[a.id].loto_contradiction) });
  const s2 = "docs/proofs/2026-09-30-4122-step-checker/set2";
  const b2 = read(`${s2}/blind.json`) as { id: string; question: string; answer: string }[];
  const x = read(`${s2}/judgments_X.json`) as Record<string, { loto_contradiction: boolean }>;
  const y = read(`${s2}/judgments_Y.json`) as Record<string, { loto_contradiction: boolean }>;
  for (const a of b2) out.push({ set: "set2", ...a, contradiction: Boolean(x[a.id].loto_contradiction || y[a.id].loto_contradiction) });
  return out;
}

export interface Score { tp: number; fp: number; fn: number; tn: number; precision: number; recall: number }

export function score(rows: LabeledAnswer[], detect: (r: LabeledAnswer) => boolean): Score {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const r of rows) {
    const hit = detect(r);
    if (hit && r.contradiction) tp++;
    else if (hit) fp++;
    else if (r.contradiction) fn++;
    else tn++;
  }
  return { tp, fp, fn, tn, precision: tp + fp ? tp / (tp + fp) : 1, recall: tp + fn ? tp / (tp + fn) : 1 };
}

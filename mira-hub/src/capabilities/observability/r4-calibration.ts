/**
 * T-2 calibration (#4875 §1d, #4870): agreement between R4_NO_INVENTED_VALUES
 * and human labels on the 40-turn stratified sample.
 *
 * Positive class = "the answer states a number the evidence does not support".
 * R4 `fail` predicts positive; a human `yes` is positive. `unsure` and
 * unlabeled turns are excluded from the matrix and counted separately, so a
 * half-labeled sample can never read as calibrated. Pure; zero tokens. The
 * release threshold is an owner decision and deliberately not encoded here.
 */

export type R4Verdict = "pass" | "fail";
export type HumanLabel = "yes" | "no" | "unsure";

export interface R4CalibrationResult {
  sample: number;
  scored: number;
  unsure: string[];
  unlabeled: string[];
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number | null;
  recall: number | null;
  agreement: number | null;
  kappa: number | null;
  falsePositives: string[];
  falseNegatives: string[];
}

const ratio = (n: number, d: number): number | null => (d === 0 ? null : n / d);

export function scoreR4Calibration(
  key: Record<string, R4Verdict>,
  labels: Record<string, HumanLabel | undefined>,
): R4CalibrationResult {
  const r: R4CalibrationResult = {
    sample: 0, scored: 0, unsure: [], unlabeled: [],
    tp: 0, fp: 0, fn: 0, tn: 0,
    precision: null, recall: null, agreement: null, kappa: null,
    falsePositives: [], falseNegatives: [],
  };
  for (const [id, verdict] of Object.entries(key)) {
    r.sample++;
    const label = labels[id];
    if (label === undefined) { r.unlabeled.push(id); continue; }
    if (label === "unsure") { r.unsure.push(id); continue; }
    r.scored++;
    const predicted = verdict === "fail";
    const actual = label === "yes";
    if (predicted && actual) r.tp++;
    else if (predicted && !actual) { r.fp++; r.falsePositives.push(id); }
    else if (!predicted && actual) { r.fn++; r.falseNegatives.push(id); }
    else r.tn++;
  }
  const n = r.scored;
  r.precision = ratio(r.tp, r.tp + r.fp);
  r.recall = ratio(r.tp, r.tp + r.fn);
  r.agreement = ratio(r.tp + r.tn, n);
  if (n > 0) {
    const pe = ((r.tp + r.fp) * (r.tp + r.fn) + (r.fn + r.tn) * (r.fp + r.tn)) / (n * n);
    r.kappa = pe === 1 ? null : ((r.agreement as number) - pe) / (1 - pe);
  }
  return r;
}

/**
 * replay-assignment.ts — re-run FIELD ASSIGNMENT over the stored internet-100
 * evidence with ZERO new inference (materialized-evidence recall: the 154
 * runs/ files carry each leg's raw candidate + rawText verbatim).
 *
 *   bun benchmarks/nameplate/internet-100/replay-assignment.ts
 *   bun benchmarks/nameplate/internet-100/score-all.ts --dir ... --runs runs-replay --out results-replay.json
 *
 * What changes vs the stored runs: values + review are recomputed through the
 * NEW anchor-first assignment (parseNameplateLines with widened anchors wins
 * over the model's field mapping; toFact's anchor gate holds unanchored
 * identities at candidate). What CANNOT change: rawText and the candidate —
 * those are the frozen perception evidence. So the delta between
 * results.json and results-replay.json is precisely the effect of the
 * field-assignment fix, isolated from provider noise.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseNameplateLines } from "../../../src/lib/nameplate/passes";
import { toFact, summarizeForReview, isComplianceMark } from "../../../src/lib/nameplate/evidence";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNS = path.join(HERE, "runs");
const OUT = path.join(HERE, "runs-replay");

type Candidate = {
  manufacturer?: string | null;
  model?: string | null;
  catalogNumber?: string | null;
  serialNumber?: string | null;
  equipmentType?: string | null;
  confidence?: number | null;
  rawText?: string[] | null;
};

function reassign(candidate: Candidate) {
  const rawText = candidate.rawText ?? [];
  const det = parseNameplateLines(rawText);
  const evidence = [
    toFact({ field: "manufacturer", value: candidate.manufacturer ?? null, rawText, confidence: candidate.confidence ?? null }),
    toFact({ field: "model", value: det.model?.value ?? candidate.model ?? null, rawText, confidence: candidate.confidence ?? null }),
    toFact({ field: "catalogNumber", value: det.catalogNumber?.value ?? candidate.catalogNumber ?? null, rawText }),
    toFact({ field: "serialNumber", value: det.serialNumber?.value ?? candidate.serialNumber ?? null, rawText }),
    toFact({ field: "equipmentType", value: candidate.equipmentType ?? null, rawText }),
    ...rawText.filter(isComplianceMark).map((mark) => toFact({ field: "certification", value: mark, rawText })),
  ];
  const review = summarizeForReview(evidence);
  return {
    values: {
      manufacturer: candidate.manufacturer ?? null,
      model: det.model?.value ?? candidate.model ?? null,
      catalogNumber: det.catalogNumber?.value ?? candidate.catalogNumber ?? null,
      equipmentType: candidate.equipmentType ?? null,
      serialNumber: det.serialNumber?.value ?? candidate.serialNumber ?? null,
      voltage: det.voltage?.text ?? null,
      current: det.current?.text ?? null,
      resolution: det.resolution?.text ?? null,
      ambient: det.ambient?.text ?? null,
      insulation: det.insulation ?? null,
      marks: det.marks.length ? det.marks.join(", ") : null,
    },
    review: {
      promotable: review.promotable.map((f) => ({ field: f.field, value: f.value })),
      needsReview: review.needsReview.map((f) => f.field),
      rejected: review.rejected.map((f) => ({ field: f.field, value: f.value, reason: f.reason })),
    },
  };
}

fs.mkdirSync(OUT, { recursive: true });
let n = 0;
for (const f of fs.readdirSync(RUNS).filter((x) => x.endsWith(".json"))) {
  const run = JSON.parse(fs.readFileSync(path.join(RUNS, f), "utf8"));
  for (const leg of ["improved", "baseline"]) {
    const l = run[leg];
    if (!l || l.error || !l.candidate) continue;
    Object.assign(l, reassign(l.candidate));
  }
  fs.writeFileSync(path.join(OUT, f), JSON.stringify(run, null, 2));
  n++;
}
console.log(`replayed field assignment for ${n} samples -> ${OUT}`);

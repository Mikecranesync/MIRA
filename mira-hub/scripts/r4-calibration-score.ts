/**
 * T-2 calibration scorer (#4870). Reads the R4 key (trace_id -> pass|fail) and
 * a directory of human label documents (one JSON per trace_id, field `label`:
 * yes|no|unsure — the shape the labeling page writes), prints the result.
 *   cd mira-hub && npx vite-node --config vitest.config.ts scripts/r4-calibration-score.ts -- <key.json> <labels-dir>
 * Zero tokens; never writes anywhere.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { scoreR4Calibration, type HumanLabel, type R4Verdict } from "@/capabilities/observability/r4-calibration";

const [keyPath, labelsDir] = process.argv.slice(2).filter((a) => a !== "--");
const key: Record<string, R4Verdict> = JSON.parse(readFileSync(keyPath, "utf8"));
const labels: Record<string, HumanLabel> = {};
for (const f of readdirSync(labelsDir).filter((n) => n.endsWith(".json"))) {
  const doc = JSON.parse(readFileSync(join(labelsDir, f), "utf8"));
  const body = doc.data ?? doc;
  if (body.label === "yes" || body.label === "no" || body.label === "unsure") labels[basename(f, ".json")] = body.label;
}
console.log(JSON.stringify(scoreR4Calibration(key, labels), null, 2));

/**
 * Score a fidelity run: LOOK's stored screen_text_lines for each photo, against the
 * synthetic screen it was a photo of (docs/runbooks/alarm-fidelity-capture.md).
 *
 * Input JSON:  { "photos": [ { "id": "p1", "screen": "failsafe" | "rtd", "lines": string[] } ] }
 * The lines come from a READ-ONLY staging query of evidence_item.capture_meta
 * (screen_text_lines) for the test notebook's LOOK photos — never production.
 *
 * Run:  cd mira-hub && npx vite-node ../tools/alarm-fidelity/score-run.ts <run.json>
 * Exit 0 when the gate passes, 1 when it fails, 2 on bad input.
 */
import { readFileSync } from "node:fs";
import { gate, scoreScreen, type ScreenScore } from "../../mira-hub/src/capabilities/alarm-fidelity-score";
import { SCREEN_FAIL_SAFE, SCREEN_RTD } from "../../mira-hub/src/capabilities/alarm-screens.fixture";

type Photo = { id: string; screen: "failsafe" | "rtd"; lines: string[] };

const TRUTH: Record<Photo["screen"], readonly string[]> = { failsafe: SCREEN_FAIL_SAFE, rtd: SCREEN_RTD };

const path = process.argv[2];
if (!path) {
  console.error("usage: score-run.ts <run.json>");
  process.exit(2);
}
const run = JSON.parse(readFileSync(path, "utf8")) as { photos?: Photo[] };
if (!Array.isArray(run.photos) || run.photos.length === 0) {
  console.error("run.json has no photos");
  process.exit(2);
}

const scores: ScreenScore[] = [];
console.log("photo        screen    tags exact   invented   records grouped");
for (const p of run.photos) {
  const truth = TRUTH[p.screen];
  if (!truth || !Array.isArray(p.lines)) {
    console.error(`photo ${p.id}: unknown screen or missing lines`);
    process.exit(2);
  }
  const s = scoreScreen(truth, p.lines);
  scores.push(s);
  console.log(
    `${p.id.padEnd(12)} ${p.screen.padEnd(9)} ${`${s.designationExact}/${s.designationTotal}`.padEnd(12)} ` +
      `${String(s.inventedInCutFields).padEnd(10)} ${s.recordsCorrect}/${s.recordsTotal}`,
  );
}
const g = gate(scores);
console.log(
  `\nGATE ${g.pass ? "PASS" : "FAIL"} — tags ${(g.designationRate * 100).toFixed(1)} % (need ≥ 90), ` +
    `grouping ${(g.groupingRate * 100).toFixed(1)} % (need ≥ 90), invented ${g.invented} (need 0), photos ${scores.length}`,
);
process.exit(g.pass ? 0 : 1);

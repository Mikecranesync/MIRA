/**
 * IMIB safety-gate arm: run each question through the notebook route's deterministic pre-LLM gate, exactly as
 * route.ts calls it (notebookSafetyTrigger(message) and energizedHardStopEnabled() && isEnergizedWorkAsk(message)).
 * Zero tokens. Records what the gate does; the scoring against expected_gate lives in analyze.py.
 *   cd mira-hub && npx vite-node --config vitest.config.ts ../tools/bench4589/safety_gate.ts -- <cases.json> <out.jsonl>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { isEnergizedWorkAsk, notebookSafetyTrigger } from "@/lib/safety-classifier";
import { energizedHardStopEnabled } from "@/capabilities/energized-work-stop";

const [casesPath, outPath] = process.argv.slice(2).filter((a) => a !== "--");
const cases: { id: string; question: string }[] = JSON.parse(readFileSync(casesPath, "utf8"));
const lines = cases.map((c) => {
  const trigger = notebookSafetyTrigger(c.question);
  const stop = energizedHardStopEnabled() && isEnergizedWorkAsk(c.question);
  return JSON.stringify({ id: c.id, trigger, stop, gate: stop ? "stop" : trigger ? "flag" : "none" });
});
writeFileSync(outPath, lines.join("\n") + "\n");
console.log(`${lines.length} rows -> ${outPath}`);

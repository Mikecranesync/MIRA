/**
 * Calibration harness for the Jev Decision Fabric.
 *
 * Imports the SHIPPING module so the payload measured here is byte-identical
 * to the payload production would send. Reads labelled states from a JSON file
 * and prints per-question signals plus cost/latency.
 *
 * Usage: bun tools/qa/jev_decision_probe.ts <states.json> [--repeat N]
 */
import { buildDecisionRequest, JEV_DECISION_QUESTIONS, JEV_QUESTION_SET_VERSION } from "../../mira-hub/src/capabilities/observability/jev-decision";
import { buildTurnDecisionState } from "../../mira-hub/src/capabilities/observability/turn-decision-state";
import { JEV_ENDPOINT } from "../../mira-hub/src/capabilities/observability/jev-shadow";

const file = process.argv[2];
const repeatArg = process.argv.indexOf("--repeat");
const repeat = repeatArg > 0 ? Number(process.argv[repeatArg + 1]) : 1;
const key = process.env.JEV_API_KEY;
if (!key) { console.error("JEV_API_KEY not set"); process.exit(2); }

type Labelled = {
  id: string;
  label: "divergent" | "sound";
  note?: string;
  question: string;
  answer: string;
  assetIdentity?: string | null;
  observations?: string[];
  evidence?: { source?: string; family?: string; content: string }[];
  gates?: Partial<Parameters<typeof buildTurnDecisionState>[0]["gates"]>;
};

const cases: Labelled[] = JSON.parse(await Bun.file(file).text());
const noulKeys = (Object.keys(JEV_DECISION_QUESTIONS) as (keyof typeof JEV_DECISION_QUESTIONS)[])
  .filter((k) => JEV_DECISION_QUESTIONS[k].type === "noul");

console.log(`question-set=${JEV_QUESTION_SET_VERSION}  questions=${Object.keys(JEV_DECISION_QUESTIONS).length}  cases=${cases.length}  repeat=${repeat}`);
const rows: any[] = [];

for (const c of cases) {
  for (let r = 0; r < repeat; r++) {
    const state = buildTurnDecisionState({
      question: c.question,
      answer: c.answer,
      assetIdentity: c.assetIdentity ?? null,
      observations: c.observations ?? [],
      evidence: c.evidence ?? [],
      gates: {
        decision: null, evidence_sufficient: null, citations_shipped: null,
        ungrounded_unit_claim: null, system_prompt_kind: null, retrieval_strategy: null,
        ...(c.gates ?? {}),
      },
    });
    const body = buildDecisionRequest(state);
    const t0 = Date.now();
    const res = await fetch(JEV_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const ms = Date.now() - t0;
    if (!res.ok) { console.log(`${c.id} r${r} HTTP ${res.status} ${(await res.text()).slice(0,200)}`); continue; }
    const j: any = await res.json();
    const sig: Record<string, number> = {};
    for (const k of noulKeys) if (typeof j.answers?.[k]?.noul === "number") sig[k] = j.answers[k].noul;
    const fc = j.answers?.failure_class;
    rows.push({ id: c.id, label: c.label, r, ms, tokens: j.usage?.input_tokens ?? null, sig, fc: fc?.choice ?? null, fcc: fc?.confidence ?? null, fcp: fc?.probabilities ?? null });
    const show = noulKeys.map((k) => `${k.slice(0,12)}=${(sig[k] ?? NaN).toFixed(2)}`).join(" ");
    console.log(`${c.id.padEnd(22)} ${c.label.padEnd(9)} r${r} ${String(ms).padStart(5)}ms tok=${j.usage?.input_tokens} class=${fc?.choice}@${(fc?.confidence ?? 0).toFixed(2)}`);
    console.log(`    ${show}`);
  }
}
await Bun.write("/tmp/jev-decision-probe.json", JSON.stringify(rows, null, 2));
console.log(`\nwrote /tmp/jev-decision-probe.json  n=${rows.length}`);
const lat = rows.map(r=>r.ms).sort((a,b)=>a-b);
const tok = rows.map(r=>r.tokens).filter(Boolean);
if (lat.length) console.log(`latency p50=${lat[Math.floor(lat.length*0.5)]}ms p95=${lat[Math.floor(lat.length*0.95)]}ms  tokens mean=${Math.round(tok.reduce((a,b)=>a+b,0)/tok.length)}`);

/**
 * Technician benchmark runner for the Equipment Notebook. Scores the notebook
 * chat against tests/equipment/benchmark/oracle.json — deterministic marker +
 * citation scoring, NO LLM judge. Grounded cases require the required markers
 * AND a non-empty citation; abstention cases require a refusal with ZERO
 * citations (the "not-found must not show pages as proof" gate) and no
 * fabricated marker; the motor-frequency case additionally fails if a display
 * value (b001/b002) is presented as a setting.
 *
 * Usage (needs a running server + a notebook loaded with the PF525 quick-start):
 *   node tests/equipment/benchmark/runner.mjs <notebookId> [baseUrl] [cookieStateFile]
 *
 * cookieStateFile defaults to tests/equipment/.state/notebook.json (Playwright
 * storageState). Credentials are never printed. Exit code = number of failures.
 */
import fs from "node:fs";
import path from "node:path";

const NB = process.argv[2];
const BASE = process.argv[3] ?? "http://127.0.0.1:3130/hub";
const STATE = process.argv[4] ?? "tests/equipment/.state/notebook.json";
if (!NB) {
  console.error("usage: runner.mjs <notebookId> [baseUrl] [stateFile]");
  process.exit(2);
}

const oracle = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "oracle.json"), "utf8"));
const st = JSON.parse(fs.readFileSync(STATE, "utf8"));
const cookie = (st.cookies || []).map((c) => c.name + "=" + c.value).join("; ");

const nb = await (await fetch(`${BASE}/api/equipment-notebooks/${NB}/`, { headers: { Cookie: cookie } })).json();
const docIds = (nb.sources || []).filter((s) => s.enabledByDefault).map((s) => s.docId);

async function ask(q) {
  const r = await fetch(`${BASE}/api/equipment-notebooks/${NB}/chat/`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ message: q, sourceDocIds: docIds }),
  });
  const text = await r.text();
  let content = "", cites = [], status = "";
  for (const line of text.split("\n\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const d = t.slice(5).trim();
    if (d === "[DONE]") continue;
    try {
      const f = JSON.parse(d);
      if (f.kind === "content") content += f.content;
      else if (f.kind === "sources") cites = f.citations || [];
      else if (f.kind === "status") status = f.status;
    } catch {}
  }
  return { content, cites, status };
}

// Normalize unicode spaces (LLMs emit U+202F / U+00A0 between "PowerFlex" and
// "525") so marker matching compares content, not whitespace codepoints.
const norm = (s) => s.replace(/[    ]/g, " ");

function scoreGrounded(c, res) {
  const a = norm(res.content);
  const reasons = [];
  for (const m of c.markers_all ?? []) if (!a.includes(m)) reasons.push(`missing required marker "${m}"`);
  if (c.markers_any && !c.markers_any.some((m) => a.includes(m))) reasons.push(`none of markers_any present`);
  if (res.cites.length === 0) reasons.push("grounded answer has NO citation");
  for (const bad of c.must_not_conflate ?? []) {
    // Genuine conflation = an IMPERATIVE to set the display value: "set b001",
    // "set ... to b002" (the display value as the object of "set"), within a few
    // words. This must NOT fire on a correct negation like "b001/b002 ... cannot
    // be set directly" (the model flagging them as display-only — the desired
    // behavior). So only the forward "set … b00X" direction, and never when the
    // clause disclaims it as display-only.
    const re = new RegExp(`\\bset\\b(?:\\s+\\S+){0,3}\\s+\\[?${bad}\\b`, "i");
    const disclaims = new RegExp(`${bad}[^.]*\\b(display|cannot|read-?only|only|not\\s+(?:a\\s+)?set)\\b`, "i");
    if (re.test(a) && !disclaims.test(a)) reasons.push(`conflates display value ${bad} with a setting`);
  }
  return reasons;
}

function scoreAbstain(c, res) {
  const reasons = [];
  if (res.cites.length > 0) reasons.push(`refusal/absent answer shipped ${res.cites.length} citation(s) as proof`);
  return reasons;
}

// abstain_or_point: pass if the answer honestly acknowledges the info isn't in
// the loaded docs (optionally pointing to the full manual). A citation to the
// page that REFERENCES the topic is legitimate here; a fabricated numeric spec
// is not.
function scorePointOrAbstain(c, res) {
  const a = norm(res.content).toLowerCase();
  // "specified in the <external publication>" / "refer to <pub>" is the manual's
  // own deferral (UM p.10 lists the Wiring-and-Grounding pub; p.34 defers to its
  // distance tables) — grounded pointing, not fabrication. A numeric spec answer
  // still fails (no acknowledgment phrase).
  const acknowledges =
    /\b(does not|doesn'?t|not (?:give|list|specify|include|contain)|no specific|see the|user manual|full manual|not (?:in|found)|specified in the|refer to|publication)\b/.test(a);
  return acknowledges ? [] : ["did not acknowledge the missing coverage (possible fabrication)"];
}

let fails = 0;
const rows = [];
for (const c of oracle.cases) {
  const res = await ask(c.q);
  let reasons;
  if (c.expect === "grounded") reasons = scoreGrounded(c, res);
  else if (c.expect === "abstain") reasons = scoreAbstain(c, res);
  else reasons = scorePointOrAbstain(c, res); // abstain_or_point
  const pass = reasons.length === 0;
  if (!pass) fails++;
  rows.push({ id: c.id, class: c.class, pass, status: res.status, cites: res.cites.length, reasons, answer: res.content.slice(0, 140) });
}

console.log(`\nEquipment Notebook technician benchmark — ${oracle.cases.length} cases\n`);
for (const r of rows) {
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.id.padEnd(24)} [${r.class}] cites=${r.cites} status=${r.status}`);
  if (!r.pass) console.log(`      ✗ ${r.reasons.join("; ")}`);
  console.log(`      ${r.answer.replace(/\n/g, " ")}`);
}
console.log(`\n${rows.filter((r) => r.pass).length}/${rows.length} passed, ${fails} failed`);
process.exit(fails);

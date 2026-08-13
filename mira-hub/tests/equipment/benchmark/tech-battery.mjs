/**
 * Adversarial technician battery for the Equipment Notebook. Drives the REAL
 * chat endpoint with the tech-conversations.json corpus (single-turn categories
 * + multi-turn scripts), threading conversation history through each script the
 * way the client does. Captures question / answer / citations (page+file) /
 * status / latency for every turn and writes a JSON + a human-readable Markdown
 * report. Evaluation is qualitative — a knowledgeable technician (or Claude)
 * reads the report and judges each answer — plus cheap auto-signals so obvious
 * failures (grounded answer with no citation, refusal that still shows pages)
 * surface without a self-graded rubric.
 *
 * Usage:
 *   node tests/equipment/benchmark/tech-battery.mjs <notebookId> [baseUrl] [stateFile] [label]
 *   baseUrl default http://127.0.0.1:3131/hub  (my branch's dev hub)
 *   stateFile default tests/equipment/.state/notebook.json (Playwright storageState)
 *   label default "run" — names the output files
 */
import fs from "node:fs";
import path from "node:path";

const NB = process.argv[2];
const BASE = process.argv[3] ?? "http://127.0.0.1:3131/hub";
const STATE = process.argv[4] ?? "tests/equipment/.state/notebook.json";
const LABEL = process.argv[5] ?? "run";
if (!NB) {
  console.error("usage: tech-battery.mjs <notebookId> [baseUrl] [stateFile] [label]");
  process.exit(2);
}

const corpus = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "tech-conversations.json"), "utf8"));
const st = JSON.parse(fs.readFileSync(STATE, "utf8"));
const cookie = (st.cookies || []).map((c) => c.name + "=" + c.value).join("; ");

const nbDetail = await (await fetch(`${BASE}/api/equipment-notebooks/${NB}/`, { headers: { Cookie: cookie } })).json();
const docIds = (nbDetail.sources || []).filter((s) => s.enabledByDefault).map((s) => s.docId);
if (docIds.length === 0) {
  console.error("notebook has no enabled sources — nothing to ground on");
  process.exit(2);
}

async function ask(q, history) {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/equipment-notebooks/${NB}/chat/`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ message: q, sourceDocIds: docIds, history }),
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
  return {
    q,
    answer: content.trim(),
    status,
    latencyMs: Date.now() - t0,
    citations: cites.map((c) => ({ page: c.page, file: c.sourceTitle })),
  };
}

const norm = (s) => (s || "").replace(/[   ⁠]/g, " ");

// Cheap auto-signals — never the final verdict, just red flags.
function autoFlags(r) {
  const flags = [];
  const refusalish = r.status === "insufficient_evidence" || r.status === "error" || !r.answer;
  if (!refusalish && r.citations.length === 0) flags.push("grounded-but-uncited");
  if (refusalish && r.citations.length > 0) flags.push("refusal-with-citations");
  if (r.status === "error") flags.push("provider-error");
  if (r.answer && r.answer.length > 1600) flags.push("very-long");
  return flags;
}

const results = { label: LABEL, base: BASE, notebook: NB, docIds, singles: [], conversations: [] };

for (const c of corpus.singles) {
  const r = await ask(c.q, []);
  results.singles.push({ ...c, ...r, autoFlags: autoFlags(r) });
  process.stderr.write(`. ${c.id}\n`);
}

for (const conv of corpus.conversations) {
  const history = [];
  const turns = [];
  for (const t of conv.turns) {
    const r = await ask(t.q, history.slice(-12));
    turns.push({ ...t, ...r, autoFlags: autoFlags(r) });
    history.push({ role: "user", content: t.q });
    if (r.answer) history.push({ role: "assistant", content: r.answer });
    process.stderr.write(`.. ${conv.id} :: ${t.q.slice(0, 40)}\n`);
  }
  results.conversations.push({ id: conv.id, cat: conv.cat, turns });
}

// ---- write artifacts ----
const outDir = path.join(import.meta.dirname, "runs");
fs.mkdirSync(outDir, { recursive: true });
const jsonPath = path.join(outDir, `battery-${LABEL}.json`);
fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));

const md = [];
md.push(`# Technician battery — ${LABEL}`);
md.push(`Notebook \`${NB}\` · ${docIds.length} sources · ${BASE}\n`);
const citeStr = (cs) => (cs.length ? cs.map((c) => `${c.file} p.${c.page ?? "?"}`).join(", ") : "—");
md.push(`## Single-turn (${results.singles.length})\n`);
for (const r of results.singles) {
  md.push(`### ${r.id} · _${r.cat}_`);
  md.push(`**Q:** ${r.q}`);
  md.push(`**A:** ${norm(r.answer) || "_(no answer)_"}`);
  md.push(`**status:** ${r.status || "?"} · **cites:** ${citeStr(r.citations)} · **${r.latencyMs}ms**${r.autoFlags.length ? ` · ⚑ ${r.autoFlags.join(", ")}` : ""}`);
  md.push(`**want:** ${r.notes}\n`);
}
md.push(`## Multi-turn (${results.conversations.length})\n`);
for (const conv of results.conversations) {
  md.push(`### ${conv.id} · _${conv.cat}_`);
  conv.turns.forEach((t, i) => {
    md.push(`**T${i + 1} Q:** ${t.q}`);
    md.push(`**T${i + 1} A:** ${norm(t.answer) || "_(no answer)_"}`);
    md.push(`_status ${t.status || "?"} · cites ${citeStr(t.citations)} · ${t.latencyMs}ms${t.autoFlags.length ? ` · ⚑ ${t.autoFlags.join(", ")}` : ""}_`);
    md.push(`_want: ${t.notes}_\n`);
  });
}
const mdPath = path.join(outDir, `battery-${LABEL}.md`);
fs.writeFileSync(mdPath, md.join("\n"));

// compact console summary
const allTurns = [...results.singles, ...results.conversations.flatMap((c) => c.turns)];
const flagged = allTurns.filter((t) => t.autoFlags.length);
console.log(`\n${LABEL}: ${allTurns.length} turns, ${flagged.length} auto-flagged`);
for (const t of flagged) console.log(`  ⚑ ${(t.id || t.q).slice(0, 40).padEnd(40)} ${t.autoFlags.join(",")}`);
console.log(`\nreport: ${mdPath}\njson:   ${jsonPath}`);

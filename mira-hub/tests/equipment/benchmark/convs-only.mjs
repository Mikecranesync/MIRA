/**
 * Scratch: multi-turn-only slice of tech-battery.mjs (same ask/report logic).
 * Usage: node convs-only.mjs <notebookId> [baseUrl] [stateFile] [label] [corpusFile]
 */
import fs from "node:fs";
import path from "node:path";

const NB = process.argv[2];
const BASE = process.argv[3] ?? "http://127.0.0.1:3131/hub";
const STATE = process.argv[4] ?? "tests/equipment/.state/notebook.json";
const LABEL = process.argv[5] ?? "convs";
const CORPUS = process.argv[6] ?? path.join(import.meta.dirname, "tech-conversations.json");
if (!NB) {
  console.error("usage: convs-only.mjs <notebookId> [baseUrl] [stateFile] [label] [corpusFile]");
  process.exit(2);
}

const corpus = JSON.parse(fs.readFileSync(CORPUS, "utf8"));
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

const results = { label: LABEL, base: BASE, notebook: NB, docIds, conversations: [] };

for (const conv of corpus.conversations) {
  const history = [];
  const turns = [];
  for (const t of conv.turns) {
    const r = await ask(t.q, history.slice(-12));
    turns.push({ ...t, ...r });
    history.push({ role: "user", content: t.q });
    if (r.answer) history.push({ role: "assistant", content: r.answer });
    process.stderr.write(`.. ${conv.id} :: ${t.q.slice(0, 40)}\n`);
  }
  results.conversations.push({ id: conv.id, cat: conv.cat, turns });
}

const outDir = path.join(import.meta.dirname, "runs");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `battery-${LABEL}.json`), JSON.stringify(results, null, 2));

const citeStr = (cs) => (cs.length ? cs.map((c) => `${c.file} p.${c.page ?? "?"}`).join(", ") : "—");
const md = [`# Multi-turn battery — ${LABEL}`, `Notebook \`${NB}\` · ${docIds.length} sources · ${BASE}\n`];
for (const conv of results.conversations) {
  md.push(`### ${conv.id} · _${conv.cat}_`);
  conv.turns.forEach((t, i) => {
    md.push(`**T${i + 1} Q:** ${t.q}`);
    md.push(`**T${i + 1} A:** ${t.answer || "_(no answer)_"}`);
    md.push(`_status ${t.status || "?"} · cites ${citeStr(t.citations)} · ${t.latencyMs}ms_`);
    md.push(`_want: ${t.notes}_\n`);
  });
}
fs.writeFileSync(path.join(outDir, `battery-${LABEL}.md`), md.join("\n"));
console.log(`wrote runs/battery-${LABEL}.md`);

/**
 * Multi-evidence answer-completeness bench for the Equipment Notebook.
 *
 * Asks each completeness-oracle.json question against the REAL chat endpoint
 * and scores TWO independent axes per question:
 *   coverage      — fraction of corpus-proven facets the answer names
 *                   (marker regex; `marker2` = second required regex for a facet)
 *   groundedness  — fraction of NAMED facets whose citation set contains a page
 *                   whose chunk text matches the facet's support regex
 * An answer can be fully grounded yet incomplete — that split is the point.
 *
 * `--gate` enforces each question's min_coverage AND groundedness=1.0 for
 * named facets (exit code = failures). Without it the run is report-only
 * (baseline measurement).
 *
 * Usage: doppler run -p factorylm -c dev -- \
 *   node tests/equipment/benchmark/completeness-bench.mjs <notebookId> [baseUrl] [stateFile] [--gate]
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Pool } = require("pg");

const args = process.argv.slice(2).filter((a) => a !== "--gate");
const GATE = process.argv.includes("--gate");
const NB = args[0];
const BASE = args[1] ?? "http://127.0.0.1:3131/hub";
const STATE = args[2] ?? "tests/equipment/.state/notebook.json";
if (!NB) {
  console.error("usage: completeness-bench.mjs <notebookId> [baseUrl] [stateFile] [--gate]");
  process.exit(2);
}

const oracle = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "completeness-oracle.json"), "utf8"));
const st = JSON.parse(fs.readFileSync(STATE, "utf8"));
const cookie = (st.cookies || []).map((c) => c.name + "=" + c.value).join("; ");

const cs = (process.env.NEON_DATABASE_URL || "")
  .replace(/[?&](sslmode|ssl|channel_binding)=[^&]*/g, "")
  .replace(/\?$/, "");
if (!cs) {
  console.error("NEON_DATABASE_URL not set — run under doppler (factorylm/dev)");
  process.exit(2);
}
const pool = new Pool({ connectionString: cs, ssl: { rejectUnauthorized: false } });

const nbDetail = await (await fetch(`${BASE}/api/equipment-notebooks/${NB}/`, { headers: { Cookie: cookie } })).json();
const docIds = (nbDetail.sources || []).filter((s) => s.enabledByDefault).map((s) => s.docId);

async function ask(q) {
  const r = await fetch(`${BASE}/api/equipment-notebooks/${NB}/chat/`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ message: q, sourceDocIds: docIds, history: [] }),
  });
  const text = await r.text();
  let content = "", cites = [];
  for (const line of text.split("\n\n")) {
    const t = line.trim();
    if (!t.startsWith("data:") || t.slice(5).trim() === "[DONE]") continue;
    try {
      const f = JSON.parse(t.slice(5).trim());
      if (f.kind === "content") content += f.content;
      else if (f.kind === "sources") cites = (f.citations || []).map((c) => ({ page: c.page, file: c.sourceTitle }));
    } catch {}
  }
  return { answer: content.trim(), citations: cites };
}

async function pageText(file, page) {
  const { rows } = await pool.query(
    `SELECT content FROM knowledge_entries
      WHERE (metadata->>'filename') = $1 AND source_page = $2 LIMIT 20`,
    [file, page],
  );
  return rows.map((r) => String(r.content)).join("\n");
}

let failures = 0;
const summary = [];
for (const qc of oracle.questions) {
  const { answer, citations } = await ask(qc.q);
  const a = answer.normalize("NFKC");
  let named = 0, grounded = 0;
  const missing = [], ungrounded = [];
  for (const f of qc.facets) {
    const hit =
      new RegExp(f.marker, "i").test(a) && (!f.marker2 || new RegExp(f.marker2, "i").test(a));
    if (!hit) {
      missing.push(f.key);
      continue;
    }
    named++;
    let sup = false;
    for (const c of citations) {
      if (new RegExp(f.support, "i").test(await pageText(c.file, c.page))) {
        sup = true;
        break;
      }
    }
    if (sup) grounded++;
    else ungrounded.push(f.key);
  }
  const coverage = named / qc.facets.length;
  const groundedness = named ? grounded / named : 0;
  const covOk = coverage >= (qc.min_coverage ?? 1.0);
  const grdOk = named === 0 ? false : groundedness === 1.0;
  const verdict = covOk && grdOk ? "PASS" : "FAIL";
  if (GATE && verdict === "FAIL") failures++;
  summary.push(
    `${verdict} ${qc.id} [${qc.shape}] coverage=${named}/${qc.facets.length}` +
      ` groundedness=${grounded}/${named}` +
      (missing.length ? ` missing=[${missing}]` : "") +
      (ungrounded.length ? ` uncited-facet=[${ungrounded}]` : ""),
  );
  summary.push(`     A: ${a.slice(0, 220).replace(/\s+/g, " ")}`);
  summary.push(`     cites: ${citations.map((c) => `p.${c.page}`).join(",") || "—"}`);
}

console.log(summary.join("\n"));
const passes = summary.filter((l) => l.startsWith("PASS")).length;
console.log(`\ncompleteness: ${passes}/${oracle.questions.length} pass${GATE ? " (gated)" : " (report-only)"}`);
await pool.end();
process.exit(GATE ? failures : 0);

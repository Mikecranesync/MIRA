/**
 * Benchmark acceptance: retrieval rows for tools/benchmark-acceptance/scorecard.py.
 *
 * T4 pattern (tools/evidence-runoff/bench/t4_retrieval.ts): load every manual into a throwaway local
 * Postgres with staging's knowledge_entries schema, chunk it as MIRA does at ingest (chunkText, one page at
 * a time), then call main's unmodified retrieveNodeChunks doc-scoped for every question. Zero tokens.
 *
 *   cd mira-hub && NOTEBOOK_LEXICAL_V2=<0|1> BENCH_PG=postgres://bench@localhost:55432/bench \
 *     npx vite-node --config vitest.config.ts ../tools/benchmark-acceptance/retrieval_rank.ts -- \
 *     <off|on> <topK> <questions.json> <out.jsonl>
 *
 * questions.json: [{id, set, manual, pdf, question, accepted: number[], regression_case?}]
 * An empty `accepted` marks an unanswerable question (kind "unanswerable"); its refusal is answer-stage
 * and stays null here. Production parity: refuses to run if hybrid or rerank is switched on.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "pg";
import { extractText, getDocumentProxy } from "unpdf";
import { retrieveNodeChunks } from "@/lib/manual-rag";
import { chunkText } from "@/lib/node-knowledge-ingest";

type Q = { id: string; set: string; manual: string; pdf: string; question: string; accepted: number[]; regression_case?: string };
const [arm, topKArg, qPath, outPath] = process.argv.slice(2).filter((a) => a !== "--");
const topK = Number(topKArg);
const flag = process.env.NOTEBOOK_LEXICAL_V2 === "1";
if (!["off", "on"].includes(arm) || !(topK > 0) || !qPath || !outPath) throw new Error("usage: <off|on> <topK> <q.json> <out.jsonl>");
if ((arm === "on") !== flag) throw new Error(`arm ${arm} but NOTEBOOK_LEXICAL_V2=${process.env.NOTEBOOK_LEXICAL_V2 ?? "unset"}`);
for (const v of ["NOTEBOOK_HYBRID_RETRIEVAL", "NOTEBOOK_RERANK"]) {
  if (process.env[v] === "1") throw new Error(`${v}=1 breaks production parity (prd runs neither)`);
}

const qs: Q[] = JSON.parse(readFileSync(qPath, "utf8"));
const uuidOf = (s: string) => {
  const h = createHash("sha256").update(s).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const tenant = uuidOf(`bench-tenant-${arm}-${topK}`);
const nodeId = uuidOf("bench-node");
const db = new Client({ connectionString: process.env.BENCH_PG });
await db.connect();
await db.query("DELETE FROM knowledge_entries WHERE tenant_id = $1", [tenant]);

const docOf = new Map<string, string>();
for (const [manual, pdf] of new Map(qs.map((q) => [q.manual, q.pdf]))) {
  const doc = uuidOf(`bench-doc-${manual}`);
  docOf.set(manual, doc);
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(readFileSync(pdf))), { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  let idx = 0;
  for (let p = 0; p < pages.length; p++) {
    for (const c of chunkText(pages[p] ?? "")) {
      await db.query(
        `INSERT INTO knowledge_entries (id, tenant_id, source_type, content, is_private, verified, source_url, source_page,
           page_start, page_end, doc_id, ingest_route, metadata)
         VALUES ($1,$2,'node_attachment',$3,true,true,$4,$5,$5,$5,$6,'v2',$7)`,
        [randomUUID(), tenant, c, `node-doc/${doc}/${manual}.pdf`, p + 1, doc,
          JSON.stringify({ node_id: nodeId, chunk_index: idx++, filename: `${manual}.pdf` })],
      );
    }
  }
}

const ask = (q: Q) => retrieveNodeChunks(db as never, tenant, q.question, {
  nodeId, unsPath: null, topK, docIds: [docOf.get(q.manual)!], rawQuery: q.question, validatedDocScope: true,
});
// Untimed warm-up pass, so neither arm's p95 carries cold planner/cache cost (each arm is its own process).
for (const q of qs) await ask(q).catch(() => undefined);

const lines: string[] = [];
for (const q of qs) {
  const base = { id: q.id, dataset: q.set, arm, kind: q.accepted.length ? "answerable" : "unanswerable",
    accepted: q.accepted, regression_case: q.regression_case ?? null, benchmark_defect: null,
    answer_correct: null, citation_correct: null, refused: null, safety_warning_ok: null,
    warning_before_hazard: null, unsupported_claims: null, fabrication: null, top_k: topK };
  const t0 = performance.now();
  try {
    const chunks = await ask(q);
    lines.push(JSON.stringify({ ...base, ranked_pages: chunks.map((c) => c.sourcePage), latency_ms: performance.now() - t0, error: null }));
  } catch (e) {
    lines.push(JSON.stringify({ ...base, ranked_pages: [], latency_ms: null, error: String(e).slice(0, 300) }));
  }
}
await db.query("DELETE FROM knowledge_entries WHERE tenant_id = $1", [tenant]);
await db.end();
writeFileSync(outPath, lines.join("\n") + "\n");
console.log(`wrote ${lines.length} rows (${arm}, topK ${topK}) to ${outPath}`);

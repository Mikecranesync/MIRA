/**
 * Dev variant of tools/benchmark-acceptance/retrieval_rank.ts for the HYBRID lane (#4983).
 *
 * Differences from the pinned harness: (1) rows are kept between runs per set (BENCH_SET) and the
 * ingest is skipped when they exist; (2) every chunk is embedded at ingest with the SAME model/dim/call
 * the hub's write path uses (node-knowledge-ingest.ts: nomic-embed-text, 768, Ollama /api/embeddings,
 * raw text) and stored in `embedding`; (3) the production-parity refusal is removed so
 * NOTEBOOK_HYBRID_RETRIEVAL=1 can be measured. Arm label comes from argv ("off" | "hybrid").
 *
 *   cd mira-hub && OLLAMA_BASE_URL=http://localhost:11434 BENCH_PG=... BENCH_SET=forum-fresh \
 *     [NOTEBOOK_HYBRID_RETRIEVAL=1] npx vite-node --config vitest.config.ts \
 *     ../tools/bench4589/retrieval_hybrid_dev.ts -- <off|hybrid> <topK> <questions.json> <out.jsonl>
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "pg";
import { extractText, getDocumentProxy } from "unpdf";
import { retrieveNodeChunks } from "@/lib/manual-rag";
import { chunkText, EMBED_DIM, EMBED_MODEL } from "@/lib/node-knowledge-ingest";

type Q = { id: string; set: string; manual: string; pdf: string; question: string; accepted: number[]; regression_case?: string };
const [arm, topKArg, qPath, outPath] = process.argv.slice(2).filter((a) => a !== "--");
const topK = Number(topKArg);
// Arm label: "off" | "hybrid" | "rerank" | "hybrid+rerank" — must agree with the flags.
if (!/^(off|hybrid|rerank|rewrite|hybrid\+rerank|hybrid\+rewrite|rewrite\+rerank|hybrid\+rewrite\+rerank)$/.test(arm) || !(topK > 0) || !qPath || !outPath) throw new Error("usage: <off|hybrid|rerank|rewrite|…> <topK> <q.json> <out.jsonl>");
// Rewrite arm: a cache of {sha256(question): {rewrite}} produced once by rewrite_queries.py (REWRITES_JSON).
const rewrites: Record<string, { rewrite: string }> = arm.includes("rewrite")
  ? JSON.parse(readFileSync(process.env.REWRITES_JSON ?? "", "utf8")).rewrites
  : {};
if (arm.includes("rewrite") !== Boolean(process.env.REWRITES_JSON)) throw new Error(`arm ${arm} but REWRITES_JSON=${process.env.REWRITES_JSON ?? "unset"}`);
const rewriteOf = (question: string): string | undefined => rewrites[createHash("sha256").update(question).digest("hex")]?.rewrite;
if (arm.includes("hybrid") !== (process.env.NOTEBOOK_HYBRID_RETRIEVAL === "1")) throw new Error(`arm ${arm} but NOTEBOOK_HYBRID_RETRIEVAL=${process.env.NOTEBOOK_HYBRID_RETRIEVAL ?? "unset"}`);
if (arm.includes("rerank") !== (process.env.NOTEBOOK_RERANK === "1" && !!process.env.RERANKER_URL)) throw new Error(`arm ${arm} but NOTEBOOK_RERANK=${process.env.NOTEBOOK_RERANK ?? "unset"} RERANKER_URL=${process.env.RERANKER_URL ?? "unset"}`);
if (process.env.NOTEBOOK_LEXICAL_V2 === "1") throw new Error("lexical-v2 is not the production arm");
const base = process.env.OLLAMA_BASE_URL;
if (!base) throw new Error("OLLAMA_BASE_URL required (chunks are embedded at ingest)");

const qs: Q[] = JSON.parse(readFileSync(qPath, "utf8"));
const uuidOf = (s: string) => {
  const h = createHash("sha256").update(s).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
// One tenant per set, shared by both arms: identical rows and vectors under both.
const tenant = uuidOf(`hyb-tenant-${process.env.BENCH_SET ?? "x"}`);
const nodeId = uuidOf("bench-node");
const db = new Client({ connectionString: process.env.BENCH_PG });
await db.connect();

async function embed(text: string): Promise<number[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const resp = await fetch(`${base}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
      signal: AbortSignal.timeout(60000),
    });
    if (resp.ok) {
      const data = (await resp.json()) as { embedding?: number[] };
      if (Array.isArray(data.embedding) && data.embedding.length === EMBED_DIM) return data.embedding;
      throw new Error(`bad embedding dimension ${data.embedding?.length}`);
    }
  }
  throw new Error("embedder failed 3 times");
}

const { rows: have } = await db.query("SELECT count(*)::int AS n, count(embedding)::int AS e FROM knowledge_entries WHERE tenant_id = $1", [tenant]);
const loaded = have[0].n > 0 && have[0].e === have[0].n;
if (loaded) console.error(`reusing ${have[0].n} embedded rows for tenant ${tenant}`);
else if (have[0].n > 0) {
  console.error(`tenant ${tenant} has ${have[0].n} rows but ${have[0].e} embeddings — re-ingesting`);
  await db.query("DELETE FROM knowledge_entries WHERE tenant_id = $1", [tenant]);
}

const docOf = new Map<string, string>();
let embedded = 0;
for (const [manual, pdf] of new Map(qs.map((q) => [q.manual, q.pdf]))) {
  const doc = uuidOf(`bench-doc-${manual}`);
  docOf.set(manual, doc);
  if (loaded) continue;
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(readFileSync(pdf))), { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  let idx = 0;
  for (let p = 0; p < pages.length; p++) {
    for (const c of chunkText(pages[p] ?? "")) {
      const vec = await embed(c);
      embedded++;
      await db.query(
        `INSERT INTO knowledge_entries (id, tenant_id, source_type, content, is_private, verified, source_url, source_page,
           page_start, page_end, doc_id, ingest_route, metadata, embedding)
         VALUES ($1,$2,'node_attachment',$3,true,true,$4,$5,$5,$5,$6,'v2',$7,$8::vector)`,
        [randomUUID(), tenant, c, `node-doc/${doc}/${manual}.pdf`, p + 1, doc,
          JSON.stringify({ node_id: nodeId, chunk_index: idx++, filename: `${manual}.pdf` }), `[${vec.join(",")}]`],
      );
    }
  }
  console.error(`ingested ${manual} (${embedded} chunks embedded so far)`);
}

const ask = (q: Q) => retrieveNodeChunks(db as never, tenant, q.question, {
  nodeId, unsPath: null, topK, docIds: [docOf.get(q.manual)!], rawQuery: q.question, validatedDocScope: true, rewrittenQuery: rewriteOf(q.question),
});
let missingRewrites = 0;
for (const q of qs) await ask(q).catch(() => undefined); // warm-up (planner cache, embedder keep-alive)

const lines: string[] = [];
let vectorRan = 0;
for (const q of qs) {
  const base = { id: q.id, dataset: q.set, arm, kind: q.accepted.length ? "answerable" : "unanswerable",
    accepted: q.accepted, regression_case: q.regression_case ?? null, top_k: topK };
  const t0 = performance.now();
  try {
    const diagnostics: { vectorLane?: string } = {};
    if (arm.includes("rewrite") && !rewriteOf(q.question)) missingRewrites++;
    const chunks = await retrieveNodeChunks(db as never, tenant, q.question, {
      nodeId, unsPath: null, topK, docIds: [docOf.get(q.manual)!], rawQuery: q.question, validatedDocScope: true, diagnostics, rewrittenQuery: rewriteOf(q.question),
    });
    if (diagnostics.vectorLane === "ran") vectorRan++;
    lines.push(JSON.stringify({ ...base, ranked_pages: chunks.map((c) => c.sourcePage), vector_lane: diagnostics.vectorLane ?? null, latency_ms: performance.now() - t0, error: null }));
  } catch (e) {
    lines.push(JSON.stringify({ ...base, ranked_pages: [], vector_lane: null, latency_ms: null, error: String(e).slice(0, 300) }));
  }
}
await db.end();
writeFileSync(outPath, lines.join("\n") + "\n");
console.log(`wrote ${lines.length} rows (${arm}, topK ${topK}, vector lane ran on ${vectorRan}, questions without a rewrite: ${missingRewrites}) to ${outPath}`);

/**
 * T4: retrieval measured on its own. Loads one text variant of every manual into a throwaway local Postgres
 * (staging's knowledge_entries schema, read read-only), then runs main's unmodified retrieveNodeChunks exactly
 * as notebook chat calls it (doc-scoped, topK 6, validatedDocScope) for every question with accepted pages.
 *
 *   cd mira-hub && T4_PG=postgres://bench@localhost:55432/t4 npx vite-node --config vitest.config.ts <this> -- \
 *     <variant: mira|docling-off|docling-v1> <questions.json> <docling_root> <out.json>
 * Variant text is chunked with the same chunkText(1000, 120) MIRA uses at ingest, one page at a time.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Client } from "pg";
import { extractText, getDocumentProxy } from "unpdf";
import { retrieveNodeChunks } from "@/lib/manual-rag";
import { chunkText } from "@/lib/node-knowledge-ingest";

type Q = { id: string; set: string; manual: string; pdf: string; question: string; accepted: number[] };
const [variant, qPath, doclingRoot, outPath] = process.argv.slice(2).filter((a) => a !== "--");
const qs: Q[] = JSON.parse(readFileSync(qPath, "utf8"));
const uuidOf = (s: string) => {
  const h = createHash("sha256").update(s).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const tenant = uuidOf(`t4-tenant-${variant}`);
const nodeId = uuidOf("t4-node");

async function pagesOf(manual: string, pdf: string): Promise<string[]> {
  if (variant === "mira") {
    const doc = await getDocumentProxy(new Uint8Array(readFileSync(pdf)));
    const { text } = await extractText(doc, { mergePages: false });
    return Array.isArray(text) ? text : [text];
  }
  const dir = `${doclingRoot}/${variant.replace("docling-", "")}/${manual}`;
  const out: string[] = [];
  for (let p = 1; existsSync(`${dir}/p${p}.md`); p++) out.push(readFileSync(`${dir}/p${p}.md`, "utf8"));
  return out;
}

const db = new Client({ connectionString: process.env.T4_PG });
await db.connect();
await db.query("DELETE FROM knowledge_entries WHERE tenant_id = $1", [tenant]);
const manuals = new Map(qs.map((q) => [q.manual, q.pdf]));
const docOf = new Map<string, string>();
let rowsIn = 0;
for (const [manual, pdf] of manuals) {
  const doc = uuidOf(`t4-doc-${manual}`);
  docOf.set(manual, doc);
  const pages = await pagesOf(manual, pdf);
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
      rowsIn++;
    }
  }
}
const results = [];
const lat: number[] = [];
for (const q of qs) {
  const t0 = performance.now();
  const chunks = await retrieveNodeChunks(db as never, tenant, q.question, {
    nodeId, unsPath: null, topK: 6, docIds: [docOf.get(q.manual)!], rawQuery: q.question, validatedDocScope: true,
  });
  lat.push(performance.now() - t0);
  const pages = chunks.map((c) => c.sourcePage);
  results.push({ id: q.id, set: q.set, manual: q.manual, accepted: q.accepted, pages,
    hit1: pages.length > 0 && q.accepted.includes(pages[0] as number),
    hit6: pages.some((p) => q.accepted.includes(p as number)) });
}
lat.sort((a, b) => a - b);
const n = results.length;
const summary = { variant, rows: rowsIn, n, hit1: results.filter((r) => r.hit1).length, hit6: results.filter((r) => r.hit6).length,
  p50_ms: Math.round(lat[Math.floor(n / 2)]), p95_ms: Math.round(lat[Math.floor(0.95 * n)]) };
writeFileSync(outPath, JSON.stringify({ summary, results }, null, 1));
console.log(JSON.stringify(summary));
await db.end();

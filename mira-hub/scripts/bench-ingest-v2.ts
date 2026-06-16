/**
 * bench-ingest-v2.ts — DEV-ONLY benchmark + verification for the in-Hub
 * streaming ingest-v2 PDF path (writePdfChunksForNode / ingestPdfToNode).
 *
 * Runbook: docs/runbooks/ingest-v2-verify-and-benchmark.md
 * Code under test: src/lib/node-knowledge-ingest.ts (PR #1935, Slice 1)
 *
 * What it does, against the DEV Neon branch (factorylm/dev) ONLY:
 *   1. Ingests several real PDFs through the REAL ingestPdfToNode (the exact
 *      code the node-attach upload route calls) — so the RLS-enforced
 *      factorylm_app INSERT path is exercised, not a copy of the SQL.
 *   2. Verifies each upload via the OWNER pool (BYPASSRLS): rows-in-DB ==
 *      returned chunkCount, every row is_private + ingest_route='v2', every
 *      chunk_index distinct (no ON CONFLICT self-collision).
 *   3. Proves citability with the REAL retrieveNodeChunks (BM25 the chat
 *      surface uses) — uploaded content comes back ranked, with page numbers.
 *   4. Cleans up every BENCH_-prefixed row it created (owner pool — the RLS
 *      factorylm_app role lacks the DELETE grant, so cleanup MUST be owner).
 *
 * Run:  doppler run -p factorylm -c dev -- bun mira-hub/scripts/bench-ingest-v2.ts
 *
 * SAFETY: only ever INSERTs/DELETEs rows whose filename starts with `BENCH_`,
 * and refuses to run unless the DB host looks like the dev endpoint (override
 * with BENCH_ALLOW_NON_DEV=1 if the dev endpoint is ever renamed). NEVER point
 * this at prod — it writes to knowledge_entries / hub_uploads.
 */
import { readFileSync, existsSync } from "fs";
import { ingestPdfToNode } from "@/lib/node-knowledge-ingest";
import { retrieveNodeChunks } from "@/lib/manual-rag";
import { withTenantContext } from "@/lib/tenant-context";
import pool from "@/lib/db";

// Dev fixtures — a tenant with a tenants row + a kg_entity node to attach to.
// (Discover replacements with: select id,tenant_id,uns_path from kg_entities limit 5;)
const TENANT = process.env.BENCH_TENANT ?? "78917b56-f85f-43bb-9a08-1bb98a6cd6c3";
const NODE = process.env.BENCH_NODE ?? "f42ec123-c515-4d4c-bbd0-09b5d3bae2b8";
const UNS = process.env.BENCH_UNS ?? "enterprise.knowledge_base.accolift.2730070.manuals";
const ROOT = process.env.BENCH_ROOT ?? "/Users/charlienode/mira-ingestv2/";

const FILES = [
  "docs/MIRA_DOCS_MAP_2026-06-07.pdf",
  "docs/instructions/Conv_Simple_Prog3_Modbus_Polling.pdf",
  "docs/instructions/Conv_Simple_LadderFirst.pdf",
  "docs/instructions/Conv_Simple_UDFB_Intro.pdf",
  "docs/instructions/Conv_Simple_Complete.pdf",
  "docs/research/2026-06-01-dt-alignment-analysis.pdf",
];

const CITE_QUERIES = [
  "RS-485 wiring and Modbus polling",
  "how do I build a UDFB",
  "what does the motor starter rung do",
];

async function guardDev() {
  const { rows } = await pool.query(
    "select inet_server_addr() is null AS pooled, current_database() AS db",
  );
  const host = process.env.NEON_DATABASE_URL ?? "";
  const looksDev = host.includes("ep-lingering-salad");
  if (!looksDev && process.env.BENCH_ALLOW_NON_DEV !== "1") {
    throw new Error(
      `Refusing to run: NEON_DATABASE_URL host is not the known dev endpoint. ` +
        `db=${rows[0].db}. Set BENCH_ALLOW_NON_DEV=1 only if you are SURE this is dev.`,
    );
  }
}

async function cleanup(): Promise<number> {
  await pool.query(`delete from knowledge_entries where metadata->>'filename' like 'BENCH\\_%'`);
  await pool.query(`delete from hub_uploads where filename like 'BENCH\\_%'`);
  const left = await pool.query(
    `select count(*)::int n from knowledge_entries where metadata->>'filename' like 'BENCH\\_%'`,
  );
  return left.rows[0].n as number;
}

async function main() {
  await guardDev();
  await cleanup(); // clear any leftovers from a prior aborted run

  const results: Record<string, unknown>[] = [];
  for (let i = 0; i < FILES.length; i++) {
    const path = ROOT + FILES[i];
    const short = FILES[i].split("/").pop()!;
    if (!existsSync(path)) {
      results.push({ file: short, error: "missing fixture" });
      continue;
    }
    const buf = readFileSync(path);
    const filename = `BENCH_${i}_${short}`;
    try {
      const t0 = Date.now();
      const res = await ingestPdfToNode({
        tenantId: TENANT, nodeId: NODE, unsPath: UNS,
        filename, mimeType: "application/pdf", sizeBytes: buf.length, buffer: buf,
      });
      const ms = Date.now() - t0;
      const v = (await pool.query(
        `select count(*)::int rows, max(page_end)::int pages,
                bool_and(is_private) priv, bool_and(ingest_route='v2') v2,
                count(distinct (metadata->>'chunk_index'))::int uniq
           from knowledge_entries where doc_id=$1`, [res.uploadId])).rows[0];
      results.push({
        file: short, kb: Math.round(buf.length / 1024), pages: v.pages,
        chunks: res.chunkCount, rows_db: v.rows, ms,
        chunks_per_s: +(res.chunkCount / (ms / 1000)).toFixed(1),
        kb_per_s: Math.round((buf.length / 1024) / (ms / 1000)),
        ok: v.rows === res.chunkCount && v.priv && v.v2 && v.uniq === res.chunkCount,
      });
    } catch (e) {
      results.push({ file: short, error: String((e as Error).message ?? e) });
    }
  }

  console.log("\n=== CITATION (real retrieveNodeChunks over the ingested set) ===");
  for (const query of CITE_QUERIES) {
    const hits = await withTenantContext(TENANT, (c) =>
      retrieveNodeChunks(c, TENANT, query, { nodeId: NODE, unsPath: UNS, topK: 3 }));
    console.log(`Q: "${query}" -> ${hits.length} hits`);
    hits.forEach((h, j) =>
      console.log(`  #${j + 1} "${h.title}" p${h.sourcePage} rank=${h.rank.toFixed(4)} :: ${String(h.content).slice(0, 80).replace(/\n/g, " ")}`));
  }

  const remaining = await cleanup();

  console.log("\n=== SUMMARY ===");
  console.log("| File | KB | Pages | Chunks | Rows in DB | ms | chunks/s | KB/s | verified |");
  console.log("|---|--:|--:|--:|--:|--:|--:|--:|:--:|");
  for (const r of results) {
    if (r.error) { console.log(`| ${r.file} | — | — | — | — | — | — | — | ERROR: ${r.error} |`); continue; }
    console.log(`| ${r.file} | ${r.kb} | ${r.pages} | ${r.chunks} | ${r.rows_db} | ${r.ms} | ${r.chunks_per_s} | ${r.kb_per_s} | ${r.ok ? "PASS" : "FAIL"} |`);
  }
  console.log(`\nleftover BENCH rows after cleanup: ${remaining} (must be 0)`);
  await pool.end();
}

main().catch(async (e) => { console.error("BENCH FAILED:", e); await pool.end(); process.exit(1); });

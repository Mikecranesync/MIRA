/**
 * Zero-token retrieval replay (retrieval core spec, Phase 0 / layer L7).
 *
 * For every stranger-walk golden question it runs the PRODUCTION retrieval function
 * (`retrieveNodeChunks`, src/lib/manual-rag.ts) with the notebook chat route's exact options,
 * inside the route's own tenant-context transaction (`withTenantContext`), against the persistent
 * staging replay tenant built by provision.ts. No answer model and no judge is called.
 *
 * What it records per question:
 *   - rank of the expected page (±corpus.tolerance) in the six chunks the model would receive;
 *   - recall@K for K in {6, 12, 24, 50, 100}, each from a call with topK = K. The pool scales with
 *     topK (POOL = max(4·topK, 24)), so recall@K means "if the final cut were widened to K",
 *     NOT "where the page sits in today's pool";
 *   - a deterministic miss class from the corpus `anchor` text against the stored chunks:
 *       A  the anchor is not in the stored text on the expected page (unreadable / extraction /
 *          anchor wording) — retrieval cannot fix this;
 *       B  anchor present on the expected page, but the page is not in the top 100;
 *       C  in the top 100 but not in the top 6;
 *       D  in the top 6 (a walk miss here is the model citing the wrong one of its six);
 *     plus `dup` when the anchor text also appears on pages outside the tolerance.
 *
 * Modes (pinned, never inherited from the shell):
 *   --mode lexical  NOTEBOOK_HYBRID_RETRIEVAL=0
 *   --mode hybrid   NOTEBOOK_HYBRID_RETRIEVAL=1, OLLAMA_BASE_URL (default http://localhost:11434,
 *                   nomic-embed-text). Every question first proves the query embedding is a
 *                   768-d vector; a run where the vector lane could not run FAILS — it would
 *                   otherwise silently equal the lexical run.
 * The approval gate is pinned to staging's value (MIRA_ENFORCE_APPROVED_RETRIEVAL=true).
 *
 *   doppler run -p factorylm -c stg -- npx tsx tests/retrieval-replay/replay.ts --mode lexical
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import corpusJson from "../stranger-walk/corpus.json";
import type { Corpus, Question } from "../stranger-walk/score";
import { classify, hitRank, KS, norm, summarize, type Mode, type ReplayRow } from "./lib";
import { loadState, STATE_PATH } from "./provision";

const corpus = corpusJson as Corpus;

function parseArgs(): { mode: Mode; only: Set<string> | null; out: string } {
  const a = process.argv.slice(2);
  const mode = (a[a.indexOf("--mode") + 1] ?? "") as Mode;
  if (a.indexOf("--mode") < 0 || (mode !== "lexical" && mode !== "hybrid")) throw new Error("--mode lexical|hybrid is required");
  const onlyArg = process.env.REPLAY_ONLY;
  const out = process.env.REPLAY_OUT ?? path.resolve(__dirname, "../../../.planning/retrieval-phase0/replay-out");
  return { mode, only: onlyArg ? new Set(onlyArg.split(",")) : null, out };
}

function walkClasses(): Map<string, string> {
  const m = new Map<string, string>();
  const dir = process.env.REPLAY_WALK_DIR;
  if (!dir) return m;
  for (const sub of ["sw-full", "sw-full2"]) {
    const f = path.join(dir, sub, "scored.json");
    if (!existsSync(f)) continue;
    const rows = (JSON.parse(readFileSync(f, "utf8")) as { rows: { id: string; classification: string; reason: string }[] }).rows;
    for (const r of rows) if (!/budget stop/.test(r.reason)) m.set(r.id, r.classification);
  }
  return m;
}

async function main(): Promise<void> {
  const { mode, only, out } = parseArgs();
  // Pin every switch the retrieval reads BEFORE importing it.
  process.env.NOTEBOOK_HYBRID_RETRIEVAL = mode === "hybrid" ? "1" : "0";
  process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL = "true";
  delete process.env.NOTEBOOK_RETRIEVAL_DEBUG;
  if (mode === "hybrid") process.env.OLLAMA_BASE_URL = process.env.REPLAY_OLLAMA_BASE_URL ?? "http://localhost:11434";
  else delete process.env.OLLAMA_BASE_URL;
  if (!process.env.NEON_DATABASE_URL) throw new Error("NEON_DATABASE_URL unset — run under doppler -c stg");

  const { retrieveNodeChunks } = await import("../../src/lib/manual-rag");
  const { withTenantContext } = await import("../../src/lib/tenant-context");
  const { getNotebook } = await import("../../src/lib/equipment-notebooks");
  const { buildRetrievalQuery } = await import("../../src/lib/notebook-query");
  const { englishSearchQuery } = await import("../../src/capabilities/answer-language");
  const { embedQuery } = await import("../../src/capabilities/hybrid-retrieval");
  const pool = (await import("../../src/lib/db")).default;

  const st = loadState();
  if (!st.account) throw new Error(`no replay tenant — run provision.ts (state ${STATE_PATH})`);
  const tenantId = st.account.tenantId;
  // Staging guard: the replay tenant was registered on staging only, so the connected database
  // must hold it AND its account email. Anything else (prod, another branch) is refused before
  // a single retrieval runs. Read-only.
  const guard = await pool.query(`SELECT 1 FROM hub_users WHERE tenant_id = $1 AND email = $2 LIMIT 1`, [tenantId, st.account.email]).catch(() => ({ rows: [] }));
  if (guard.rows.length === 0) throw new Error("refusing: the connected database does not hold the staging replay tenant");
  const walk = walkClasses();

  // Every stored chunk per document, once, on the owner connection (anchor classification only).
  const chunksByDoc = new Map<string, { page: number | null; text: string }[]>();
  for (const rm of Object.values(st.manuals)) {
    const { rows } = await pool.query(
      `SELECT page_start, content FROM knowledge_entries WHERE tenant_id = $1 AND ingest_route = 'v2' AND doc_id = $2::uuid`,
      [tenantId, rm.docId],
    );
    chunksByDoc.set(String(rm.docId), rows.map((r) => ({ page: r.page_start == null ? null : Number(r.page_start), text: norm(String(r.content ?? "")) })));
  }

  const rows: ReplayRow[] = [];
  const questions: Question[] = corpus.questions.filter((q) => !only || only.has(q.id));
  for (const q of questions) {
    const m = corpus.manuals.find((x) => x.id === q.manual)!;
    const rm = st.manuals[m.id];
    const base = { id: q.id, manual: m.id, family: m.family, expectedPage: q.expectedPage };
    try {
      if (!rm?.docId) throw new Error(`manual ${m.id} not provisioned`);
      const nb = await getNotebook(tenantId, rm.notebookId);
      if (!nb) throw new Error(`notebook ${rm.notebookId} not readable`);
      const message = q.question;
      const query = await englishSearchQuery(buildRetrievalQuery(message, []), async () => {
        throw new Error("replay never translates (no model calls)");
      });
      if (mode === "hybrid") {
        const v = await embedQuery(message);
        if (!v || v.length !== 768) throw new Error("hybrid mode: query embedding unavailable — the vector lane would not run");
      }
      const run = (topK: number) =>
        withTenantContext(tenantId, (client) =>
          retrieveNodeChunks(client, tenantId, query, {
            nodeId: rm.nodeId,
            unsPath: null,
            topK,
            docIds: [rm.docId!],
            rawQuery: message,
            identity: { manufacturer: nb.manufacturer ?? null, model: nb.model ?? null },
            identityStatus: nb.identityStatus ?? null,
            validatedDocScope: true,
            approvedSourceDocIds: [rm.docId!],
          }),
        );
      const pagesAt: Record<number, (number | null)[]> = {};
      for (const k of KS) pagesAt[k] = (await run(k)).map((c) => c.sourcePage);
      const tol = corpus.tolerance;
      const rankTop6 = hitRank(pagesAt[6], q.expectedPage, tol);
      // rankTop6 is over EVERYTHING the model receives (a broad question gets a page-diverse slice
      // of up to 12+ chunks). recall@K is capped at K so a broad question's longer list cannot
      // count a rank-173 page as "within 100".
      const firstRankWithin100 = hitRank(pagesAt[100].slice(0, 100), q.expectedPage, tol);
      const recallAt = Object.fromEntries(KS.map((k) => [String(k), hitRank(pagesAt[k].slice(0, k), q.expectedPage, tol) !== null]));
      const modelInput = pagesAt[6].length;
      const anchor = norm(q.anchor);
      const chunks = chunksByDoc.get(rm.docId) ?? [];
      const anchorPages = [...new Set(chunks.filter((c) => c.page !== null && c.text.includes(anchor)).map((c) => c.page!))].sort((a, b) => a - b);
      const onExpected = anchorPages.some((p) => Math.abs(p - q.expectedPage) <= tol);
      const dup = anchorPages.some((p) => Math.abs(p - q.expectedPage) > tol);
      rows.push({
        ...base,
        top6Pages: pagesAt[6],
        modelInput,
        rankTop6,
        recallAt,
        firstRankWithin100,
        missClass: classify(onExpected, rankTop6, firstRankWithin100),
        dup,
        anchorPages,
        walk: walk.get(q.id) ?? null,
      });
      const r = rows.at(-1)!;
      console.log(`${q.id} ${r.missClass}${dup ? "+dup" : ""} top6=${rankTop6 ?? "-"} @100=${firstRankWithin100 ?? "-"} walk=${r.walk ?? "?"} pages=${JSON.stringify(r.top6Pages)}`);
    } catch (e) {
      rows.push({ ...base, top6Pages: [], rankTop6: null, recallAt: {}, firstRankWithin100: null, missClass: "B", dup: false, anchorPages: [], error: (e as Error).message });
      console.log(`${q.id} ERROR ${(e as Error).message}`);
    }
  }
  await pool.end();

  const errors = rows.filter((r) => r.error);
  const summary = summarize(rows, mode, st.provisionedOn?.gitSha ?? null);
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, `replay-${mode}.json`), JSON.stringify({ mode, tenantId, provisionedOn: st.provisionedOn, summary, rows }, null, 2));
  writeFileSync(path.join(out, `replay-${mode}.md`), summary.markdown);
  console.log(summary.markdown);
  if (errors.length) {
    console.error(`${errors.length} question(s) errored — the run is NOT a measurement`);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error((e as Error).message);
    process.exit(1);
  });
}

/**
 * tools/investigator/fusion_arms.ts — offline bench runner for retrieval arms
 * B0p/B2/B4 (pre-registration §2, docs/evals/2026-10-30-investigator-harness/
 * PREREGISTRATION.md). LANE BENCH-B. $0 — local Postgres + local Ollama only,
 * never a paid API.
 *
 * Arms:
 *   B0p = B0 (`retrieveNodeChunks`, arm "off", exactly as
 *         tools/investigator/bench/retrieval_dev.ts computes it) collapsed to
 *         one row per PAGE, first-occurrence order. Reported alongside B2/B4
 *         so a "lift" isn't just the dedup itself (B0's own ranked_pages is a
 *         per-CHUNK list with repeats — "97,97" — so a page-level arm reaches
 *         more distinct pages in the same top-k slots for free; B0p isolates
 *         that from the fusion's real contribution).
 *   B2  = weighted RRF (lexical weight 3, vector weight 1, k=60) of B0p's
 *         page order with a vector PAGE order built from nomic-embed-text
 *         USING THE MODEL'S DOCUMENTED ASYMMETRIC PREFIXES ("search_query: " /
 *         "search_document: "). Production's own vector lane
 *         (`@/capabilities/hybrid-retrieval`'s `embedQuery`) does NOT use
 *         these prefixes — that omission is exactly what makes B2 a distinct,
 *         $0 "stronger embedding" arm worth measuring, not a reimplementation
 *         of the hub's existing (default-off) hybrid lane.
 *   B4  = pages from B0p whose own retrieved chunk text contains an exact
 *         spelling of a code the question asks about (reusing the hub's own
 *         code matcher: `extractFaultCodes` + `codeSpellings` +
 *         `codeTokenMatcher`) stay first, in B0p order; B2's order fills the
 *         rest. A question with no codes ⇒ B4 === B2 (see tests).
 *
 * Never ingests (exits if the tenant has 0 rows — run retrieval_dev.ts's
 * ingest for that BENCH_SET first) and never writes/updates/deletes
 * `knowledge_entries`. The ONLY write is an additive INSERT into a NEW bench
 * table, `inv_prefixed_embeddings(entry_id uuid primary key, tenant_id uuid,
 * embedding vector(768))`, created IF NOT EXISTS, filled only for rows that
 * don't have one yet.
 *
 * Output: same JSONL shape as retrieval_dev.ts / baseline/*.jsonl (id,
 * dataset, arm, kind, accepted, regression_case, top_k, ranked_pages,
 * vector_lane, latency_ms, error) so score_retrieval.py and the existing
 * docs/evals score.py scripts can score it. One output FILE = one arm (the
 * existing score.py scripts read a whole file as one arm and ignore the
 * `arm` field inside each row) — run this once per arm, never concatenate.
 *
 * Usage (same shape as retrieval_dev.ts):
 *   cd mira-hub && OLLAMA_BASE_URL=http://localhost:11434 \
 *     BENCH_PG=postgres://bench:bench@127.0.0.1:55450/bench BENCH_SET=forum-fresh \
 *     env -u OPENAI_API_KEY npx vite-node --config vitest.config.ts \
 *     ../tools/investigator/fusion_arms.ts -- <b0p|b2|b4> <topK> <questions.json> <out.jsonl>
 *
 * All DB/network/argv-parsing I/O lives inside `main()`, guarded to run only
 * when this file is executed directly — importing this module (as the tests
 * under tools/investigator/tests/ do) never opens a connection or calls Ollama.
 */

/** Same derivation retrieval_dev.ts uses for its `uuidOf` — reused verbatim so
 *  B2/B4 hit the exact tenant/doc rows retrieval_dev.ts's ingest already
 *  wrote; this file never ingests and never recomputes a different id
 *  scheme. Takes the hashing primitive as a parameter (rather than importing
 *  `node:crypto` at module scope) purely so the id scheme itself is
 *  unit-testable with a fake hash and has no top-level Node-API dependency. */
export function makeUuidOf(sha256Hex: (s: string) => string): (s: string) => string {
  return (s: string) => {
    const h = sha256Hex(s);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  };
}

/** Dedupe a per-chunk page list to one row per page, keeping first-occurrence
 *  rank — this is the "B0p" transform. Pure, no I/O. */
export function dedupeFirstOccurrence(pages: readonly (number | null)[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const p of pages) {
    if (p === null || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

export type WeightedRrfOpts = { wLex?: number; wVec?: number; k?: number };

/**
 * Weighted Reciprocal Rank Fusion over two PAGE-id lists (1-based rank inside
 * each list). score(page) = wLex/(k+rankLex) + wVec/(k+rankVec), summed over
 * whichever list(s) contain it. Ties break toward the lexical list's own
 * order (lexical-only and lexical-ranked-higher pages win ties); among two
 * vector-only pages with an exact tie, the stable sort keeps their relative
 * vector order. `rrfMerge` in `@/capabilities/hybrid-retrieval` is the
 * production unweighted (1/1) version over full row objects — this is a new,
 * small, page-id-only variant because production has no weighted variant and
 * weighting lexical 3x vector 1x is the arm's own definition
 * (PREREGISTRATION §2, arm B2). Empty vector list ⇒ output IS the lexical
 * list, same contract as `rrfMerge`.
 */
export function weightedRrfPages(
  lexical: readonly number[],
  vector: readonly number[],
  opts: WeightedRrfOpts = {},
): number[] {
  const wLex = opts.wLex ?? 3;
  const wVec = opts.wVec ?? 1;
  const k = opts.k ?? 60;
  if (vector.length === 0) return [...lexical];
  const score = new Map<number, number>();
  const lexicalPos = new Map<number, number>();
  const order: number[] = [];
  const seen = new Set<number>();
  lexical.forEach((p, i) => {
    if (seen.has(p)) return;
    seen.add(p);
    order.push(p);
    lexicalPos.set(p, i);
    score.set(p, wLex / (k + i + 1));
  });
  vector.forEach((p, i) => {
    if (!seen.has(p)) {
      seen.add(p);
      order.push(p);
    }
    score.set(p, (score.get(p) ?? 0) + wVec / (k + i + 1));
  });
  return [...order].sort((a, b) => {
    const d = (score.get(b) ?? 0) - (score.get(a) ?? 0);
    if (d !== 0) return d;
    const la = lexicalPos.get(a) ?? Number.POSITIVE_INFINITY;
    const lb = lexicalPos.get(b) ?? Number.POSITIVE_INFINITY;
    return la - lb; // equal (both Infinity) ⇒ Array#sort is stable ⇒ keeps `order`'s sequence
  });
}

/** Which of `chunksByPage`'s pages have at least one chunk matching at least
 *  one of `matchers`. Empty `matchers` ⇒ empty set (a question with no codes
 *  contributes no B4 precedence — B4 falls back to B2's order exactly). */
export function pagesWithCodeMatch(
  chunksByPage: ReadonlyMap<number, readonly string[]>,
  matchers: readonly RegExp[],
): Set<number> {
  const out = new Set<number>();
  if (matchers.length === 0) return out;
  for (const [page, texts] of chunksByPage) {
    if (texts.some((t) => matchers.some((re) => re.test(t)))) out.add(page);
  }
  return out;
}

/**
 * B4's reorder: pages with an exact code match stay first, in `lexicalOrder`
 * (B0p) order; everything else follows in `restOrder` (B2's fused order),
 * with the already-placed pages removed from the tail so no page repeats.
 * `codePages` empty ⇒ returns `restOrder` unchanged (B4 === B2).
 */
export function codePrecedenceOrder(
  lexicalOrder: readonly number[],
  codePages: ReadonlySet<number>,
  restOrder: readonly number[],
): number[] {
  if (codePages.size === 0) return [...restOrder];
  const first = lexicalOrder.filter((p) => codePages.has(p));
  const rest = restOrder.filter((p) => !codePages.has(p));
  return [...first, ...rest];
}

/** Extract the question's codes via the hub's own detector
 *  (`extractFaultCodes`) widened to both zero-padding spellings
 *  (`codeSpellings`) — same two functions `expandIndustrialQuery` composes
 *  internally in `@/lib/notebook-query`, reused directly rather than
 *  reimplemented. Dynamic import: this is the only place fusion_arms.ts
 *  touches hub code from a function tests call directly, and dynamic import
 *  keeps it lazy (no load-time cost for callers that never need it). */
export async function extractQuestionCodes(question: string): Promise<string[]> {
  const [{ extractFaultCodes }, { codeSpellings }] = await Promise.all([
    import("@/lib/manual-rag"),
    import("@/lib/notebook-query"),
  ]);
  const spellings = new Set<string>();
  for (const code of extractFaultCodes(question)) for (const s of codeSpellings(code)) spellings.add(s);
  return [...spellings];
}

/** `codeTokenMatcher(tok).re` for each code — the SAME whole-token,
 *  case-insensitive regex the hub's exact-code lane and rerank boost use
 *  (`notebook-query.ts:287`), not a new pattern. */
export async function codeMatchers(codes: readonly string[]): Promise<RegExp[]> {
  const { codeTokenMatcher } = await import("@/lib/notebook-query");
  return codes.map((c) => codeTokenMatcher(c).re);
}

/** Same pool-depth formula the hub's own vector lane uses for its candidate
 *  pull (`manual-rag.ts:1415`, `const POOL = Math.max(topK * 4, 24)`), reused
 *  here as the bench vector lane's depth so B2 isn't tuned to a depth
 *  production never runs at. */
export function vectorPoolDepth(topK: number): number {
  return Math.max(topK * 4, 24);
}

// ---------------------------------------------------------------------------
// I/O (DB + Ollama). Nothing below this line runs on import — only from
// main(), which runs only when this file is the process entry point.
// ---------------------------------------------------------------------------

/** nomic-embed-text v1.5 — PREREGISTRATION §2 names this tag explicitly (not
 *  bare "nomic-embed-text", which production's `embedQuery` uses and which on
 *  this host also resolves to a DIFFERENT pulled tag, `:latest`). Pinning the
 *  tag keeps the bench arm's embedder identity reproducible. */
export const BENCH_EMBED_MODEL = "nomic-embed-text:v1.5";
export const BENCH_EMBED_DIM = 768;

interface PgClientLike {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

async function embedOllama(base: string, text: string): Promise<number[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const resp = await fetch(`${base}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: BENCH_EMBED_MODEL, prompt: text }),
      signal: AbortSignal.timeout(60_000),
    });
    if (resp.ok) {
      const data = (await resp.json()) as { embedding?: number[] };
      if (Array.isArray(data.embedding) && data.embedding.length === BENCH_EMBED_DIM) return data.embedding;
      throw new Error(`bad embedding dimension ${data.embedding?.length}`);
    }
  }
  throw new Error("embedder failed 3 times");
}

async function ensureBenchTable(db: PgClientLike): Promise<void> {
  await db.query(
    `CREATE TABLE IF NOT EXISTS inv_prefixed_embeddings (
       entry_id uuid PRIMARY KEY,
       tenant_id uuid,
       embedding vector(768)
     )`,
  );
}

/** INSERT-only backfill: every `knowledge_entries` row for this tenant that
 *  has no `inv_prefixed_embeddings` row yet gets one, embedded as
 *  "search_document: " + its own content. Never touches `knowledge_entries`
 *  itself (no UPDATE, no DELETE — read-only on that table). */
async function fillMissingPrefixedEmbeddings(
  db: PgClientLike,
  tenantId: string,
  ollamaBase: string,
  vectorLiteral: (v: readonly number[]) => string,
): Promise<{ filled: number }> {
  const { rows } = await db.query(
    `SELECT k.id AS entry_id, k.content AS content
       FROM knowledge_entries k
       LEFT JOIN inv_prefixed_embeddings e ON e.entry_id = k.id
      WHERE k.tenant_id = $1 AND e.entry_id IS NULL`,
    [tenantId],
  );
  for (const row of rows) {
    const vec = await embedOllama(ollamaBase, `search_document: ${String(row.content)}`);
    await db.query(
      `INSERT INTO inv_prefixed_embeddings (entry_id, tenant_id, embedding) VALUES ($1, $2, $3::vector)
       ON CONFLICT (entry_id) DO NOTHING`,
      [row.entry_id, tenantId, vectorLiteral(vec)],
    );
  }
  return { filled: rows.length };
}

/** Vector PAGE order for one question: max cosine within the doc, grouped by
 *  page, scoped to this tenant + doc set — joined through
 *  `inv_prefixed_embeddings` → `knowledge_entries`, never queried alone (a
 *  bare scan of the bench table alone has no tenant/doc predicate). */
async function vectorPageOrder(
  db: PgClientLike,
  tenantId: string,
  docIds: readonly string[],
  queryVec: readonly number[],
  limit: number,
  vectorLiteral: (v: readonly number[]) => string,
): Promise<number[]> {
  const { rows } = await db.query(
    `SELECT k.source_page AS page, MAX(1 - (e.embedding <=> $1::vector)) AS score
       FROM inv_prefixed_embeddings e
       JOIN knowledge_entries k ON k.id = e.entry_id
      WHERE e.tenant_id = $2 AND k.tenant_id = $2 AND k.doc_id = ANY($3::uuid[]) AND k.source_page IS NOT NULL
      GROUP BY k.source_page
      ORDER BY score DESC
      LIMIT $4`,
    [vectorLiteral(queryVec), tenantId, docIds, limit],
  );
  return rows.map((r) => Number(r.page));
}

type Q = {
  id: string;
  set: string;
  manual: string;
  pdf: string;
  question: string;
  accepted: number[];
  regression_case?: string | null;
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2).filter((a) => a !== "--");
  // Imported as a module (every test under tools/investigator/tests/ does
  // this) rather than invoked as a CLI ⇒ no trailing argv at all. `vite-node`
  // rewrites `process.argv[1]` to its OWN bin path for every run (confirmed:
  // it is never this file's path, whether this file is the vite-node target
  // or merely imported by one) — an import.meta.url/argv[1] identity check is
  // not a reliable "am I the entry point" signal under it. An empty argv is:
  // no-op, no DB connection, no process.exitCode write.
  if (argv.length === 0) return;
  const [arm, topKArg, qPath, outPath] = argv;
  const topK = Number(topKArg);
  if (!/^(b0p|b2|b4)$/.test(arm ?? "") || !(topK > 0) || !qPath || !outPath) {
    throw new Error("usage: <b0p|b2|b4> <topK> <questions.json> <out.jsonl>");
  }
  // These three must stay off: B0p/B2/B4 compute their own lexical+vector
  // fusion on top of a CLEAN "off" B0 — the hub's own hybrid/rerank/lexical-v2
  // lanes firing underneath would mean B2/B4 are fusing an already-fused list.
  if (process.env.NOTEBOOK_HYBRID_RETRIEVAL === "1") throw new Error("fusion_arms computes its own vector lane; NOTEBOOK_HYBRID_RETRIEVAL must stay off");
  if (process.env.NOTEBOOK_RERANK === "1") throw new Error("fusion_arms scores unreranked B0; NOTEBOOK_RERANK must stay off");
  if (process.env.NOTEBOOK_LEXICAL_V2 === "1") throw new Error("lexical-v2 is not the production arm");

  const needsVector = arm !== "b0p";
  const ollamaBase = process.env.OLLAMA_BASE_URL;
  if (needsVector && !ollamaBase) throw new Error("OLLAMA_BASE_URL required for b2/b4");
  if (!process.env.BENCH_PG) throw new Error("BENCH_PG required");

  const { readFileSync, writeFileSync } = await import("node:fs");
  const { createHash } = await import("node:crypto");
  const { Client } = await import("pg");
  const { retrieveNodeChunks } = await import("@/lib/manual-rag");
  const { vectorLiteral } = await import("@/capabilities/hybrid-retrieval");

  const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");
  const uuid = makeUuidOf(sha256Hex);

  const qs: Q[] = JSON.parse(readFileSync(qPath, "utf8"));
  // Same tenant/doc/node derivation as retrieval_dev.ts — reuses its ingest,
  // never recomputes a different id scheme for the same BENCH_SET corpus.
  const tenant = uuid(`hyb-tenant-${process.env.BENCH_SET ?? "x"}`);
  const nodeId = uuid("bench-node");
  const docOf = new Map<string, string>();
  for (const q of qs) if (!docOf.has(q.manual)) docOf.set(q.manual, uuid(`bench-doc-${q.manual}`));

  const db = new Client({ connectionString: process.env.BENCH_PG }) as unknown as PgClientLike & { connect(): Promise<void>; end(): Promise<void> };
  await db.connect();
  try {
    const { rows: have } = await db.query("SELECT count(*)::int AS n FROM knowledge_entries WHERE tenant_id = $1", [tenant]);
    const n = Number((have[0] as { n: number }).n);
    if (n === 0) {
      throw new Error(
        `tenant ${tenant} has 0 knowledge_entries rows for BENCH_SET=${process.env.BENCH_SET ?? "(unset)"} — ` +
          `fusion_arms.ts never ingests; run retrieval_dev.ts's "off" arm once first to build the corpus`,
      );
    }

    if (needsVector) {
      await ensureBenchTable(db);
      const { filled } = await fillMissingPrefixedEmbeddings(db, tenant, ollamaBase!, vectorLiteral);
      console.error(`inv_prefixed_embeddings: backfilled ${filled} row(s) for tenant ${tenant} (${n} total rows)`);
    }

    const lines: string[] = [];
    for (const q of qs) {
      const rowBase = {
        id: q.id,
        dataset: q.set,
        arm,
        kind: q.accepted.length ? "answerable" : "unanswerable",
        accepted: q.accepted,
        regression_case: q.regression_case ?? null,
        top_k: topK,
      };
      const t0 = performance.now();
      try {
        const diagnostics: { vectorLane?: string } = {};
        const chunks = await retrieveNodeChunks(db as never, tenant, q.question, {
          nodeId,
          unsPath: null,
          topK,
          docIds: [docOf.get(q.manual)!],
          rawQuery: q.question,
          validatedDocScope: true,
          diagnostics,
        });
        const lexical = dedupeFirstOccurrence(chunks.map((c) => c.sourcePage));

        let rankedPages: number[] = lexical;
        let vectorLane = "off";
        if (needsVector) {
          const qVec = await embedOllama(ollamaBase!, `search_query: ${q.question}`);
          const pool = vectorPoolDepth(topK);
          const vectorPages = await vectorPageOrder(db, tenant, [docOf.get(q.manual)!], qVec, pool, vectorLiteral);
          vectorLane = vectorPages.length ? "ran" : "skipped_empty_vector_list";
          const fused = weightedRrfPages(lexical, vectorPages, { wLex: 3, wVec: 1, k: 60 });
          if (arm === "b2") {
            rankedPages = fused;
          } else {
            const chunksByPage = new Map<number, string[]>();
            for (const c of chunks) {
              if (c.sourcePage == null) continue;
              const arr = chunksByPage.get(c.sourcePage) ?? [];
              arr.push(c.content);
              chunksByPage.set(c.sourcePage, arr);
            }
            const codes = await extractQuestionCodes(q.question);
            const matchers = await codeMatchers(codes);
            const codePages = pagesWithCodeMatch(chunksByPage, matchers);
            rankedPages = codePrecedenceOrder(lexical, codePages, fused);
          }
        }
        lines.push(
          JSON.stringify({ ...rowBase, ranked_pages: rankedPages, vector_lane: vectorLane, latency_ms: performance.now() - t0, error: null }),
        );
      } catch (e) {
        lines.push(JSON.stringify({ ...rowBase, ranked_pages: [], vector_lane: null, latency_ms: null, error: String(e).slice(0, 300) }));
      }
    }
    writeFileSync(outPath, lines.join("\n") + "\n");
    console.log(`wrote ${lines.length} rows (${arm}, topK ${topK}) to ${outPath}`);
  } finally {
    await db.end();
  }
}

// Always called — see the empty-argv early return in main() above for why
// this is safe to import from a test with no identity check.
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

/**
 * ingest.ts — ensure the chunks for a question set exist in a NEW bench
 * tenant, using the SAME chunker + embedder as the pinned harness
 * (`tools/investigator/bench/retrieval_dev.ts`, a dev variant of the #4983
 * harness — read for DB/tenant/ingest conventions, never edited: it is NOT
 * one of this lane's owned files).
 *
 * Conventions reused verbatim from the pinned harness (byte-identical logic,
 * duplicated here rather than imported, so this script has no import-order
 * dependency on a sibling script and can run standalone via vite-node):
 *   - `uuidOf(s)` — deterministic sha256-derived UUID.
 *   - tenant = `uuidOf(\`hyb-tenant-${set}\`)`.
 *   - doc id  = `uuidOf(\`bench-doc-${manual}\`)`.
 *   - chunker/embedder: `chunkText`/`EMBED_MODEL`/`EMBED_DIM` from
 *     `@/lib/node-knowledge-ingest` (the Hub's own write-path chunker —
 *     `nomic-embed-text`, dim 768, Ollama `/api/embeddings`).
 *   - `INSERT INTO knowledge_entries (...)` column list/shape.
 *
 * Deliberate DIFFERENCE from the pinned harness (per this lane's task brief):
 * the harness treats a tenant as reusable once `count(*) > 0 && count(*) ===
 * count(embedding)` (a single tenant-wide check), and silently
 * DELETE-and-re-ingests on any partial match. This script instead:
 *   1. Refuses outright (throws, before touching the DB) to ingest any of the
 *      8 reserved set names the main #4983 harness already owns.
 *   2. Checks completeness PER EXPECTED doc_id, not just tenant-wide —
 *      a tenant-wide `count(*)===count(embedding)` can be true while an
 *      entire manual this question set needs is simply absent (zero rows
 *      for that doc_id), which the harness's check cannot catch because
 *      `doc_id = uuidOf('bench-doc-'+manual)` does not depend on the tenant.
 *   3. THROWS on any incomplete match rather than deleting and re-ingesting —
 *      a bench run must never silently discard another run's in-progress or
 *      partially-written rows.
 *
 * ## `pg`/`unpdf` are loaded dynamically, not via a top-level `import`
 * `tools/investigator/` lives OUTSIDE `mira-hub/`, so TypeScript's bare-
 * specifier module resolution (a Node-style ancestor-directory walk starting
 * at THIS file's own location) never reaches `mira-hub/node_modules` — even
 * though the exact same import resolves fine at RUNTIME via vite-node's
 * project-root-based resolver (verified empirically: `vite-node
 * bench/retrieval_dev.ts`, which has the identical top-level `import { Client
 * } from "pg"`, runs past its imports with no resolution error). This is a
 * real gap under the project's OWN `tsc -p tsconfig.json`, not just this
 * lane's temporary cross-directory typecheck config — a test file under
 * `src/capabilities/investigator/__tests__/` that imports this module pulls
 * it into that compilation too. Fix: load `pg`/`unpdf` via a dynamic
 * `import()` whose specifier is a VARIABLE, not a string literal — tsc only
 * attempts (and can only fail) static resolution on a literal specifier, so
 * this sidesteps the gap entirely rather than papering over it with an
 * ambient `declare module` (which would silently erase real type-checking
 * project-wide for every other file that imports these packages normally).
 * Type safety is recovered with the two small structural interfaces below
 * (`PgClientLike`, `UnpdfLike`), which the real packages satisfy at runtime.
 */

import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { chunkText, EMBED_DIM, EMBED_MODEL } from "@/lib/node-knowledge-ingest";

/** The slice of `pg.Client` this file actually uses. */
interface PgClientLike {
  connect(): Promise<void>;
  query<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  end(): Promise<void>;
}

/** The slice of `unpdf` this file actually uses. */
interface UnpdfLike {
  getDocumentProxy(data: Uint8Array): Promise<unknown>;
  extractText(doc: unknown, opts: { mergePages: boolean }): Promise<{ text: string | string[] }>;
}

async function loadPg(): Promise<new (opts: { connectionString: string }) => PgClientLike> {
  const specifier = "pg";
  const mod = (await import(specifier)) as { Client: new (opts: { connectionString: string }) => PgClientLike };
  return mod.Client;
}

async function loadUnpdf(): Promise<UnpdfLike> {
  const specifier = "unpdf";
  return (await import(specifier)) as UnpdfLike;
}

/** Set names already loaded by the main #4983/T-1 harness — refused outright,
 *  per PREREGISTRATION.md §1 (DEV/REGRESSION/R-80 splits) and the task brief.
 *  Mutation-check target: dropping any one entry from this list is exactly
 *  the kind of silent regression a named test must catch (see README). */
export const RESERVED_SETS: readonly string[] = [
  "forum-fresh",
  "forum-new",
  "forum-fresh2",
  "forum-fresh3",
  "t4-77",
  "oem-fault",
  "oem-index",
  "robust",
];

/** Copied verbatim from `tools/investigator/bench/retrieval_dev.ts` — keep
 *  byte-identical so this script and the pinned harness always compute the
 *  SAME tenant/doc ids for the same input string. */
export function uuidOf(s: string): string {
  const h = createHash("sha256").update(s).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function tenantIdFor(set: string): string {
  return uuidOf(`hyb-tenant-${set}`);
}

export function docIdFor(manual: string): string {
  return uuidOf(`bench-doc-${manual}`);
}

export function assertSetAllowed(set: string): void {
  if (RESERVED_SETS.includes(set)) {
    throw new Error(
      `ingest.ts: refusing set "${set}" — already loaded by the main #4983/T-1 harness. ` +
        `Pick a new set name for the investigator bench (see docs/evals/2026-10-30-investigator-harness/PREREGISTRATION.md).`,
    );
  }
}

export interface IngestDocRow {
  docId: string;
  hasEmbedding: boolean;
}

export type CompletenessVerdict = "empty" | "complete" | "incomplete";

/** Pure function: given the rows actually present for a tenant and the set of
 *  doc ids this question set expects, decide whether ingest may be skipped
 *  (`"complete"`), must run fresh (`"empty"`), or must be refused
 *  (`"incomplete"` — some rows exist but do not fully cover what's expected). */
export function checkCompleteness(rows: IngestDocRow[], expectedDocIds: readonly string[]): CompletenessVerdict {
  if (rows.length === 0) return "empty";
  const byDoc = new Map<string, { total: number; embedded: number }>();
  for (const r of rows) {
    const e = byDoc.get(r.docId) ?? { total: 0, embedded: 0 };
    e.total += 1;
    if (r.hasEmbedding) e.embedded += 1;
    byDoc.set(r.docId, e);
  }
  for (const docId of expectedDocIds) {
    const e = byDoc.get(docId);
    if (!e || e.total === 0 || e.embedded !== e.total) return "incomplete";
  }
  // Defensive: an unexpected doc_id in this tenant with a partial embed is
  // also "incomplete" — never silently reuse a half-written row.
  for (const e of byDoc.values()) {
    if (e.embedded !== e.total) return "incomplete";
  }
  return "complete";
}

export interface QuestionRow {
  id: string;
  set?: string;
  manual: string;
  pdf: string;
  question: string;
  accepted?: number[];
}

async function embed(text: string, ollamaBaseUrl: string): Promise<number[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const resp = await fetch(`${ollamaBaseUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
      signal: AbortSignal.timeout(60000),
    });
    if (resp.ok) {
      const data = (await resp.json()) as { embedding?: number[] };
      if (Array.isArray(data.embedding) && data.embedding.length === EMBED_DIM) return data.embedding;
      throw new Error(`ingest.ts: bad embedding dimension ${data.embedding?.length}`);
    }
    if (attempt === 2) throw new Error(`ingest.ts: embedder HTTP ${resp.status} after 3 attempts`);
  }
  throw new Error("ingest.ts: embedder failed 3 times");
}

async function main(): Promise<void> {
  const [set, ...qFiles] = process.argv.slice(2).filter((a) => a !== "--");
  if (!set || qFiles.length === 0) {
    throw new Error("usage: ingest.ts <set> <questions.json> [more-questions.json ...]");
  }
  assertSetAllowed(set);

  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL;
  if (!ollamaBaseUrl) throw new Error("ingest.ts: OLLAMA_BASE_URL required (chunks are embedded at ingest)");
  const connectionString = process.env.BENCH_PG;
  if (!connectionString) throw new Error("ingest.ts: BENCH_PG required");

  const questions: QuestionRow[] = qFiles.flatMap((f) => JSON.parse(readFileSync(f, "utf8")) as QuestionRow[]);
  const tenant = tenantIdFor(set);
  const manualToPdf = new Map<string, string>();
  for (const q of questions) manualToPdf.set(q.manual, q.pdf);
  const expectedDocIds = [...manualToPdf.keys()].map(docIdFor);

  const PgClient = await loadPg();
  const { getDocumentProxy, extractText } = await loadUnpdf();
  const db = new PgClient({ connectionString });
  await db.connect();
  try {
    const { rows } = await db.query<{ doc_id: string; has_embedding: boolean }>(
      `SELECT doc_id, (embedding IS NOT NULL) AS has_embedding FROM knowledge_entries WHERE tenant_id = $1`,
      [tenant],
    );
    const verdict = checkCompleteness(
      rows.map((r: { doc_id: string; has_embedding: boolean }) => ({ docId: r.doc_id, hasEmbedding: r.has_embedding })),
      expectedDocIds,
    );
    if (verdict === "complete") {
      console.log(`ingest.ts: tenant ${tenant} (set "${set}") already complete — ${rows.length} rows, reusing.`);
      return;
    }
    if (verdict === "incomplete") {
      throw new Error(
        `ingest.ts: refusing to insert into tenant ${tenant} (set "${set}") — it already has rows but they ` +
          `do not completely cover the expected doc set (${expectedDocIds.length} manuals). Inspect and resolve ` +
          `by hand; this script never deletes existing rows.`,
      );
    }

    // verdict === "empty" — safe to ingest fresh.
    let embedded = 0;
    for (const [manual, pdf] of manualToPdf) {
      const doc = docIdFor(manual);
      const { text } = await extractText(await getDocumentProxy(new Uint8Array(readFileSync(pdf))), {
        mergePages: false,
      });
      const pages = Array.isArray(text) ? text : [text];
      let idx = 0;
      for (let p = 0; p < pages.length; p++) {
        for (const c of chunkText(pages[p] ?? "")) {
          const vec = await embed(c, ollamaBaseUrl);
          embedded += 1;
          await db.query(
            `INSERT INTO knowledge_entries (id, tenant_id, source_type, content, is_private, verified, source_url, source_page,
               page_start, page_end, doc_id, ingest_route, metadata, embedding)
             VALUES ($1,$2,'node_attachment',$3,true,true,$4,$5,$5,$5,$6,'v2',$7,$8::vector)`,
            [
              randomUUID(),
              tenant,
              c,
              `node-doc/${doc}/${manual}.pdf`,
              p + 1,
              doc,
              JSON.stringify({ chunk_index: idx++, filename: `${manual}.pdf`, investigator_bench_set: set }),
              `[${vec.join(",")}]`,
            ],
          );
        }
      }
      console.log(`ingest.ts: ingested ${manual} for set "${set}" (${embedded} chunks embedded so far)`);
    }
    console.log(`ingest.ts: done — tenant ${tenant}, ${manualToPdf.size} manuals, ${embedded} chunks embedded.`);
  } finally {
    await db.end();
  }
}

// Guard: running this file via vite-node executes `main()`; importing its
// pure exports (for tests, or from run_cases.ts) never touches the DB.
const isMain = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
  } catch {
    return false;
  }
})();
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}

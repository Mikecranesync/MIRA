/**
 * One-off operator helper for #4859 — re-chunk ONE existing node document
 * through the current A2 writer (writePdfChunksForNode / writeChunkRowsForNode).
 *
 * This is NOT a product rechunk API and not a backfill. The CLI
 * (`scripts/rechunk-node-doc.ts`) is the only caller. Writes happen only when
 * NOTEBOOK_RECHUNK_APPLY=1 AND --apply AND --doc-id are set.
 *
 * Apply uses ONE raw-owner transaction: DELETE knowledge_entries for that
 * tenant_id + doc_id only, then insert via writeChunkRowsForNode on the same
 * client. hub_uploads, attachments, and the uploadId stay put.
 * The orphan-ingest deleter is never called (it drops hub_uploads).
 *
 * Intended prod fixture (Mike applies via BRAVO — this module never connects
 * to prod from a code session):
 *   doc      b28a0960-476c-4485-8482-ca7a35cab80b
 *   node     e57c47cd-49a6-49f8-95a2-1f8cc519bafc
 *   notebook 1417666e-2bd7-4fa4-aff7-6f306252e3f0
 */

import pool from "@/lib/db";
import {
  chunkText,
  embedPendingNodeChunks,
  extractPdfPagesForNode,
  nodeAttachmentSourceUrl,
  writeChunkRowsForNode,
  type NodeChunkClient,
  type NodeChunkOpts,
  type TextRepair,
} from "@/lib/node-knowledge-ingest";

export const F005_NEEDLE = "F005";
export const DECEL_NEEDLE = "Extend the decel";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseArg(argv: string[], flag: string): string | null {
  const idx = argv.indexOf(flag);
  return idx !== -1 ? (argv[idx + 1] ?? null) : null;
}

export interface RechunkMode {
  tenantId: string | null;
  docId: string | null;
  applyRequested: boolean;
  envOn: boolean;
  /** True only when --apply AND NOTEBOOK_RECHUNK_APPLY=1 AND --doc-id. */
  apply: boolean;
}

export interface RechunkEnv {
  NOTEBOOK_RECHUNK_APPLY?: string;
  NEON_DATABASE_URL?: string;
}

export function resolveRechunkMode(argv: string[], env: RechunkEnv): RechunkMode {
  const tenantId = parseArg(argv, "--tenant-id");
  const docId = parseArg(argv, "--doc-id");
  const applyRequested = argv.includes("--apply");
  const envOn = env.NOTEBOOK_RECHUNK_APPLY === "1";
  return {
    tenantId,
    docId,
    applyRequested,
    envOn,
    apply: applyRequested && envOn && !!docId,
  };
}

export function chunkKeepsF005Decel(content: string): boolean {
  return content.includes(F005_NEEDLE) && content.includes(DECEL_NEEDLE);
}

export interface SqlResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount?: number | null;
}

export type QueryFn = <T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
) => Promise<SqlResult<T>>;

export interface RechunkTxClient extends NodeChunkClient {
  query: QueryFn;
  release?: () => void;
}

export interface RechunkDeps {
  query: QueryFn;
  connect: () => Promise<RechunkTxClient>;
  extractPdfPages: (
    buffer: Buffer | Uint8Array,
    opts: NodeChunkOpts,
  ) => Promise<{ pages: string[]; repairs: Array<TextRepair | null> }>;
  writeChunkRows: (
    pages: string[],
    opts: NodeChunkOpts,
    repairs?: ReadonlyArray<TextRepair | null>,
    runtime?: { client?: NodeChunkClient; deferEmbed?: boolean },
  ) => Promise<number>;
  embedPending: (tenantId: string, sourceUrl: string) => Promise<unknown>;
  log?: (msg: string) => void;
  error?: (msg: string) => void;
}

async function queryVia<T = Record<string, unknown>>(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number | null }> },
  sql: string,
  params?: unknown[],
): Promise<SqlResult<T>> {
  const res = await client.query(sql, params);
  return { rows: res.rows as T[], rowCount: res.rowCount };
}

export function defaultRechunkDeps(): RechunkDeps {
  return {
    query: (sql, params) => queryVia(pool, sql, params),
    connect: async () => {
      const client = await pool.connect();
      return {
        query: (sql, params) => queryVia(client, sql, params),
        release: () => client.release(),
      };
    },
    extractPdfPages: extractPdfPagesForNode,
    writeChunkRows: writeChunkRowsForNode,
    embedPending: embedPendingNodeChunks,
    log: (msg) => console.log(msg),
    error: (msg) => console.error(msg),
  };
}

export interface DocSource {
  docId: string;
  filename: string;
  nodeId: string;
  unsPath: string | null;
  buffer: Buffer;
  oldChunkCount: number;
}

export interface RechunkPlan {
  oldChunkCount: number;
  newChunks: string[];
  newChunkCount: number;
  f005DecelOk: boolean;
  pages: string[];
  repairs: Array<TextRepair | null>;
  opts: NodeChunkOpts;
  sourceUrl: string;
}

export interface RechunkResult {
  mode: "dry-run" | "APPLY";
  oldChunkCount: number;
  newChunkCount: number;
  f005DecelOk: boolean;
  written: boolean;
  deleted?: number;
  embedded?: unknown;
}

function requireUuid(label: string, value: string | null): string {
  if (!value || !UUID_RE.test(value)) {
    throw new Error(`${label} must be a UUID`);
  }
  return value;
}

function asBuffer(content: unknown): Buffer {
  // BYTEA comes back as Buffer (pg). A string here is not a file — refuse rather
  // than guess base64/hex and feed unpdf garbage.
  if (Buffer.isBuffer(content)) return content;
  if (content instanceof Uint8Array) return Buffer.from(content);
  throw new Error("canonical file has no readable bytes");
}

export async function loadDocSource(
  deps: RechunkDeps,
  tenantId: string,
  docId: string,
): Promise<DocSource> {
  const found = await deps.query<{
    doc_id: string;
    filename: string;
    node_id: string | null;
    uns_path: string | null;
    entity_uns_path: string | null;
    content: unknown;
  }>(
    `SELECT u.id::text AS doc_id,
            u.filename,
            u.kg_entity_id::text AS node_id,
            u.uns_path,
            e.uns_path::text AS entity_uns_path,
            f.content
       FROM hub_uploads u
       JOIN namespace_direct_uploads f
         ON f.tenant_id = u.tenant_id AND f.upload_id = u.id
       LEFT JOIN kg_entities e
         ON e.id = u.kg_entity_id
      WHERE u.tenant_id = $1::uuid AND u.id = $2::uuid
      LIMIT 2`,
    [tenantId, docId],
  );
  if (found.rows.length === 0) {
    throw new Error(`no canonical file for tenant=${tenantId} doc=${docId}`);
  }
  if (found.rows.length > 1) {
    throw new Error(`multiple canonical files for tenant=${tenantId} doc=${docId}`);
  }
  const row = found.rows[0];
  if (!row.node_id || !UUID_RE.test(row.node_id)) {
    throw new Error(`doc ${docId} has no kg_entity_id node`);
  }
  const counted = await deps.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n
       FROM knowledge_entries
      WHERE tenant_id = $1::uuid AND doc_id = $2::uuid`,
    [tenantId, docId],
  );
  return {
    docId: row.doc_id,
    filename: row.filename,
    nodeId: row.node_id,
    unsPath: row.uns_path ?? row.entity_uns_path ?? null,
    buffer: asBuffer(row.content),
    oldChunkCount: counted.rows[0]?.n ?? 0,
  };
}

export async function planRechunk(
  deps: RechunkDeps,
  tenantId: string,
  doc: DocSource,
): Promise<RechunkPlan> {
  const opts: NodeChunkOpts = {
    tenantId,
    uploadId: doc.docId,
    nodeId: doc.nodeId,
    unsPath: doc.unsPath,
    filename: doc.filename,
  };
  const { pages, repairs } = await deps.extractPdfPages(doc.buffer, opts);
  const newChunks = pages.flatMap((page) => chunkText(page));
  return {
    oldChunkCount: doc.oldChunkCount,
    newChunks,
    newChunkCount: newChunks.length,
    f005DecelOk: newChunks.some(chunkKeepsF005Decel),
    pages,
    repairs,
    opts,
    sourceUrl: nodeAttachmentSourceUrl(doc.docId, doc.filename),
  };
}

async function applyRechunk(
  deps: RechunkDeps,
  tenantId: string,
  docId: string,
  plan: RechunkPlan,
): Promise<{ deleted: number; written: number; embedded: unknown }> {
  const client = await deps.connect();
  let deleted = 0;
  try {
    await client.query("BEGIN");
    // Tenant + this upload only. source_type pins node attachments; source_url
    // is included so a leftover unique-key row with a different/NULL doc_id
    // cannot ON CONFLICT the re-insert into a silent no-op.
    const del = await client.query(
      `DELETE FROM knowledge_entries
        WHERE tenant_id = $1::uuid
          AND source_type = 'node_attachment'
          AND (doc_id = $2::uuid OR source_url = $3)`,
      [tenantId, docId, plan.sourceUrl],
    );
    deleted = del.rowCount ?? 0;
    if (plan.oldChunkCount > 0 && deleted === 0) {
      throw new Error(
        `refusing apply: counted ${plan.oldChunkCount} chunks but DELETE removed 0 (tenant/doc mismatch?)`,
      );
    }
    // Same A2 insert path; same client so delete+insert are one transaction.
    // A provided client implies deferEmbed inside the writer; we still pass it
    // so embedPendingNodeChunks runs only after COMMIT.
    const written = await deps.writeChunkRows(plan.pages.slice(), plan.opts, plan.repairs, {
      client,
      deferEmbed: true,
    });
    if (written !== plan.newChunkCount) {
      throw new Error(
        `refusing apply: writer returned ${written} chunks, A2 plan had ${plan.newChunkCount}`,
      );
    }
    await client.query("COMMIT");
    const embedded = await deps.embedPending(tenantId, plan.sourceUrl);
    return { deleted, written, embedded };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The failed write is the error to surface.
    }
    throw err;
  } finally {
    client.release?.();
  }
}

export async function runRechunk(
  argv: string[],
  env: RechunkEnv,
  deps: RechunkDeps = defaultRechunkDeps(),
): Promise<RechunkResult> {
  const mode = resolveRechunkMode(argv, env);
  const log = deps.log ?? console.log;
  const error = deps.error ?? console.error;

  if (!mode.tenantId) {
    error("Usage: bun run scripts/rechunk-node-doc.ts --tenant-id <uuid> --doc-id <uuid> [--apply]");
    throw new Error("missing --tenant-id");
  }
  if (!mode.docId) {
    error("Usage: bun run scripts/rechunk-node-doc.ts --tenant-id <uuid> --doc-id <uuid> [--apply]");
    throw new Error("missing --doc-id");
  }
  const tenantId = requireUuid("--tenant-id", mode.tenantId);
  const docId = requireUuid("--doc-id", mode.docId);

  if (mode.applyRequested && !mode.apply) {
    if (!mode.envOn) {
      error("--apply ignored: NOTEBOOK_RECHUNK_APPLY=1 is required to write (dry run only)");
    } else if (!mode.docId) {
      error("--apply requires --doc-id: an apply is scoped to ONE document");
    }
  }

  log(`[rechunk-node-doc] tenant=${tenantId} doc=${docId} mode=${mode.apply ? "APPLY" : "dry-run"}`);

  const doc = await loadDocSource(deps, tenantId, docId);
  const plan = await planRechunk(deps, tenantId, doc);
  log(`[rechunk-node-doc] old_chunks=${plan.oldChunkCount} new_chunks=${plan.newChunkCount}`);
  log(`[rechunk-node-doc] f005_decel_check=${plan.f005DecelOk ? "PASS" : "FAIL"}`);
  if (plan.f005DecelOk) {
    const hit = plan.newChunks.find(chunkKeepsF005Decel)!;
    log(`[rechunk-node-doc] f005_sample: ${hit.slice(0, 120).replace(/\s+/g, " ")}`);
  }

  if (!mode.apply) {
    log("[rechunk-node-doc] dry run — nothing written");
    return {
      mode: "dry-run",
      oldChunkCount: plan.oldChunkCount,
      newChunkCount: plan.newChunkCount,
      f005DecelOk: plan.f005DecelOk,
      written: false,
    };
  }

  if (!plan.f005DecelOk) {
    throw new Error("refusing apply: no new chunk contains both 'F005' and 'Extend the decel'");
  }
  if (plan.newChunkCount === 0) {
    throw new Error("refusing apply: A2 chunker produced zero chunks");
  }

  const applied = await applyRechunk(deps, tenantId, docId, plan);
  log(`[rechunk-node-doc] deleted=${applied.deleted} written=${applied.written}`);
  log(`[rechunk-node-doc] embed=${JSON.stringify(applied.embedded)}`);
  return {
    mode: "APPLY",
    oldChunkCount: plan.oldChunkCount,
    newChunkCount: applied.written,
    f005DecelOk: true,
    written: true,
    deleted: applied.deleted,
    embedded: applied.embedded,
  };
}

export async function runRechunkCli(argv: string[], env: RechunkEnv): Promise<number> {
  if (!env.NEON_DATABASE_URL) {
    console.error("Error: NEON_DATABASE_URL is required");
    return 1;
  }
  try {
    await runRechunk(argv, env);
    return 0;
  } catch (err) {
    console.error(`[rechunk-node-doc] ${err instanceof Error ? err.message : err}`);
    return 1;
  } finally {
    await pool.end();
  }
}

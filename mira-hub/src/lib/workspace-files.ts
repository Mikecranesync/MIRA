/**
 * Workspace Files domain service — one canonical file, many explicit links.
 *
 * namespace_direct_uploads (027/059/075) is the canonical file record; the
 * product-facing name is "Files". workspace_file_links (075) is the
 * many-to-many attachment table. This module is the ONLY place relationship
 * SQL lives — routes call these functions, they do not scatter link queries.
 *
 * Invariants enforced here (spec: nameplate→manual + centralized files):
 *   - Exact-byte identity: SHA-256 per tenant. Identical bytes resolve to the
 *     existing canonical fileId; the partial unique index is the concurrency
 *     guard. Never dedup across tenants.
 *   - Detach removes ONE relationship — never bytes, chunks, or sibling links.
 *   - Move = add new links + remove only explicitly named old links, atomically.
 *   - Delete refuses while relationships remain (FK RESTRICT is the DB
 *     backstop) and respects verified-file retention (059 trigger).
 *   - Every polymorphic insert goes through a target-specific tenant
 *     ownership validator. Cross-tenant ids look like "not found".
 */
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import pool from "@/lib/db";
import { withTenantContext } from "@/lib/tenant-context";
import { upsertNotebookSourceTx, type MatchState } from "@/lib/equipment-notebooks";

export function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

// ── Capability model ─────────────────────────────────────────────────────────
// Three levels (spec "Supported file capabilities"):
//   indexable — parsed into knowledge_entries, citable in chat (PDF/text/CSV/log)
//   viewable  — rendered inline but not indexed (safe raster images ONLY)
//   stored    — parked bytes, download-only ("Stored file—not searchable in chat")

export type FileCapability = "indexable" | "viewable" | "stored";

const INDEXABLE_MIME_PREFIXES = ["application/pdf", "text/"];
const INDEXABLE_EXTENSIONS = [".pdf", ".txt", ".md", ".csv", ".log"];
// Explicit raster safelist — SVG is deliberately absent (scriptable → stored).
const VIEWABLE_IMAGE_MIMES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export function normalizeMime(mime: string | null | undefined): string {
  const m = (mime ?? "").trim().toLowerCase().split(";")[0];
  return m || "application/octet-stream";
}

export function fileCapability(
  mimeType: string | null | undefined,
  filename: string | null | undefined,
): FileCapability {
  const mime = normalizeMime(mimeType);
  const name = (filename ?? "").toLowerCase();
  if (mime === "image/svg+xml") return "stored";
  if (
    INDEXABLE_MIME_PREFIXES.some((p) => mime.startsWith(p)) ||
    INDEXABLE_EXTENSIONS.some((ext) => name.endsWith(ext))
  ) {
    return "indexable";
  }
  if (VIEWABLE_IMAGE_MIMES.includes(mime)) return "viewable";
  return "stored";
}

/**
 * Strict inline-render safelist for the byte-serving door. Everything else is
 * served with `Content-Disposition: attachment` + nosniff (SVG/HTML/scripts/
 * archives/Office/unknown must never render in the browser context).
 */
export function inlineRenderAllowed(mimeType: string | null | undefined): boolean {
  const mime = normalizeMime(mimeType);
  return mime === "application/pdf" || mime === "text/plain" || VIEWABLE_IMAGE_MIMES.includes(mime);
}

// ── Link targets ─────────────────────────────────────────────────────────────

export const LINK_TARGET_TYPES = [
  "equipment_notebook",
  "cmms_asset",
  "namespace_node",
  "work_order",
] as const;
export type LinkTargetType = (typeof LINK_TARGET_TYPES)[number];

export function isLinkTargetType(x: unknown): x is LinkTargetType {
  return typeof x === "string" && (LINK_TARGET_TYPES as readonly string[]).includes(x);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AttachTarget {
  targetType: LinkTargetType;
  targetId: string;
  role?: string | null;
  displayLabel?: string | null;
  isPrimary?: boolean;
  /** Notebook targets only: source membership options for the indexed doc. */
  matchState?: MatchState;
  matchEvidence?: unknown;
}

export interface WorkspaceFileLink {
  id: string;
  fileId: string;
  targetType: LinkTargetType;
  targetId: string;
  role: string | null;
  displayLabel: string | null;
  isPrimary: boolean;
  createdAt: string;
}

export interface WorkspaceFile {
  id: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number;
  contentSha256: string | null;
  uploadId: string | null;
  verified: boolean;
  createdAt: string;
  capability: FileCapability;
  /** True when the file has a parsed, citable document (docId = uploadId). */
  indexed: boolean;
  linkCount: number;
}

interface FileRow {
  id: string;
  filename: string;
  mime_type: string | null;
  size_bytes: string | null;
  content_sha256: string | null;
  upload_id: string | null;
  verified: boolean;
  created_at: string;
  link_count: string;
}

const FILE_COLS = `
  f.id::text AS id, f.filename, f.mime_type, f.size_bytes::text AS size_bytes,
  f.content_sha256, f.upload_id::text AS upload_id, f.verified, f.created_at,
  (SELECT COUNT(*) FROM workspace_file_links l
    WHERE l.tenant_id = f.tenant_id AND l.file_id = f.id)::text AS link_count`;

function rowToFile(r: FileRow): WorkspaceFile {
  return {
    id: r.id,
    filename: r.filename,
    mimeType: r.mime_type,
    sizeBytes: Number(r.size_bytes ?? 0),
    contentSha256: r.content_sha256,
    uploadId: r.upload_id,
    verified: r.verified === true,
    createdAt: r.created_at,
    capability: fileCapability(r.mime_type, r.filename),
    indexed: r.upload_id !== null,
    linkCount: Number(r.link_count ?? 0),
  };
}

interface LinkRow {
  id: string;
  file_id: string;
  target_type: LinkTargetType;
  target_id: string;
  role: string | null;
  display_label: string | null;
  is_primary: boolean;
  created_at: string;
}

function rowToLink(r: LinkRow): WorkspaceFileLink {
  return {
    id: r.id,
    fileId: r.file_id,
    targetType: r.target_type,
    targetId: r.target_id,
    role: r.role,
    displayLabel: r.display_label,
    isPrimary: r.is_primary === true,
    createdAt: r.created_at,
  };
}

// ── Canonical park / reuse ───────────────────────────────────────────────────

export interface ParkResult {
  fileId: string;
  /** True when identical bytes already existed for this tenant. */
  reused: boolean;
  /** The existing parsed document id, when the canonical file already has one. */
  uploadId: string | null;
}

/**
 * Park original bytes as a canonical file, or resolve identical bytes to the
 * existing canonical row. Concurrency-safe: the partial unique index on
 * (tenant_id, content_sha256) makes the losing insert a no-op that re-selects
 * the winner. Never re-parks, re-parses, or re-chunks on reuse — the caller
 * checks `uploadId` before ingesting.
 */
export async function parkOrReuseFile(opts: {
  tenantId: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number;
  buffer: Buffer;
  createdBy?: string | null;
  /** Legacy single-node filing column — kept in sync for backward compat. */
  nodeId?: string | null;
  source?: string;
}): Promise<ParkResult> {
  const sha = sha256Hex(opts.buffer);
  const mime = normalizeMime(opts.mimeType);
  return withTenantContext(opts.tenantId, async (c) => {
    const existing = await c.query<{ id: string; upload_id: string | null }>(
      `SELECT id::text AS id, upload_id::text AS upload_id
         FROM namespace_direct_uploads
        WHERE tenant_id = $1::uuid AND content_sha256 = $2
        LIMIT 1`,
      [opts.tenantId, sha],
    );
    if (existing.rows.length > 0) {
      return { fileId: existing.rows[0].id, reused: true, uploadId: existing.rows[0].upload_id };
    }
    const ins = await c.query<{ id: string }>(
      `INSERT INTO namespace_direct_uploads
          (tenant_id, node_id, filename, mime_type, size_bytes, content,
           created_by, content_sha256, source)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::uuid, $8, $9)
       ON CONFLICT (tenant_id, content_sha256) WHERE content_sha256 IS NOT NULL
       DO NOTHING
       RETURNING id::text AS id`,
      [
        opts.tenantId,
        opts.nodeId ?? null,
        opts.filename,
        mime,
        opts.sizeBytes,
        opts.buffer,
        opts.createdBy ?? null,
        sha,
        opts.source ?? "user_upload",
      ],
    );
    if (ins.rows.length > 0) {
      return { fileId: ins.rows[0].id, reused: false, uploadId: null };
    }
    // Lost a concurrent race — the winner's row is the canonical file.
    const winner = await c.query<{ id: string; upload_id: string | null }>(
      `SELECT id::text AS id, upload_id::text AS upload_id
         FROM namespace_direct_uploads
        WHERE tenant_id = $1::uuid AND content_sha256 = $2
        LIMIT 1`,
      [opts.tenantId, sha],
    );
    if (winner.rows.length === 0) {
      throw new Error("canonical file insert race resolved to no row");
    }
    return { fileId: winner.rows[0].id, reused: true, uploadId: winner.rows[0].upload_id };
  });
}

/**
 * Record the parsed document id on the canonical file (post-ingest) and
 * release the ingestion claim in the same statement.
 *
 * TOKEN-FENCED (Codex round 2, 2026-08-16): when `claimToken` is given the
 * finalize only succeeds if THIS worker still holds the claim — a slow
 * original whose claim was stolen after the stale window cannot commit its
 * `upload_id` over the winner's and create a duplicate pointer. Returns
 * whether the finalize landed; a `false` means ownership was lost and the
 * caller must treat its own ingest as orphaned (not report the doc attached).
 */
export async function linkFileToUpload(
  tenantId: string,
  fileId: string,
  uploadId: string,
  claimToken?: string,
): Promise<boolean> {
  return withTenantContext(tenantId, async (c) => {
    const res = await c.query(
      `UPDATE namespace_direct_uploads
          SET upload_id = $1::uuid, ingest_claim_token = NULL, ingest_claimed_at = NULL
        WHERE id = $2::uuid AND tenant_id = $3::uuid
          AND upload_id IS NULL
          ${claimToken ? "AND ingest_claim_token = $4::uuid" : ""}`,
      claimToken ? [uploadId, fileId, tenantId, claimToken] : [uploadId, fileId, tenantId],
    );
    return (res.rowCount ?? 0) > 0;
  });
}

// ── Atomic ingestion claim (Codex P1, 2026-08-16 — migration 077) ────────────
//
// Exactly ONE request may ingest a given canonical file. parkOrReuseFile's
// pre-check window let a concurrent identical upload observe `reused=true,
// uploadId=null` while the winner was still ingesting, and ingest AGAIN.
// The claim is a test-and-set on the row: winners ingest and release via
// linkFileToUpload; losers report an explicit "ingest_in_progress" partial.

const INGEST_CLAIM_STALE_MINUTES = 10;

export type IngestClaim =
  | { claimed: true; claimToken: string }
  | { claimed: false; reason: "already_ingested" | "ingest_in_progress"; uploadId: string | null };

/** Try to claim the file for ingestion. Atomic: the UPDATE's WHERE clause is
 * the whole decision, so two racers cannot both win. A stale claim (crashed
 * worker) is taken over after INGEST_CLAIM_STALE_MINUTES. */
export async function claimIngest(tenantId: string, fileId: string): Promise<IngestClaim> {
  const token = crypto.randomUUID();
  return withTenantContext(tenantId, async (c) => {
    const res = await c.query<{ id: string }>(
      `UPDATE namespace_direct_uploads
          SET ingest_claim_token = $1::uuid, ingest_claimed_at = now()
        WHERE id = $2::uuid AND tenant_id = $3::uuid
          AND upload_id IS NULL
          AND (ingest_claim_token IS NULL
               OR ingest_claimed_at < now() - interval '${INGEST_CLAIM_STALE_MINUTES} minutes')
        RETURNING id::text AS id`,
      [token, fileId, tenantId],
    );
    if (res.rows.length > 0) return { claimed: true as const, claimToken: token };
    const row = await c.query<{ upload_id: string | null }>(
      `SELECT upload_id::text AS upload_id FROM namespace_direct_uploads
        WHERE id = $1::uuid AND tenant_id = $2::uuid`,
      [fileId, tenantId],
    );
    const uploadId = row.rows[0]?.upload_id ?? null;
    return uploadId !== null
      ? { claimed: false as const, reason: "already_ingested" as const, uploadId }
      : { claimed: false as const, reason: "ingest_in_progress" as const, uploadId: null };
  });
}

/** Release a claim WITHOUT an upload (the ingest failed) so another request
 * can retry immediately instead of waiting out the stale window. Token-scoped:
 * only the claim's own holder can release it. */
export async function releaseIngestClaim(
  tenantId: string,
  fileId: string,
  claimToken: string,
): Promise<void> {
  await withTenantContext(tenantId, async (c) => {
    await c.query(
      `UPDATE namespace_direct_uploads
          SET ingest_claim_token = NULL, ingest_claimed_at = NULL
        WHERE id = $1::uuid AND tenant_id = $2::uuid AND ingest_claim_token = $3::uuid`,
      [fileId, tenantId, claimToken],
    );
  });
}

// ── Target validation ────────────────────────────────────────────────────────

export interface ValidatedTarget {
  ok: true;
  /** Equipment notebooks resolve to their backing namespace node. */
  nodeId: string | null;
}

/**
 * Target-specific tenant ownership validator. Runs the UUID-family checks on
 * the tenant-scoped client (RLS tables with factorylm_app grants) and the
 * TEXT-tenant CMMS tables on the raw pool with an explicit tenant predicate —
 * factorylm_app has no guaranteed grants there (mira-hub-migrations.md §3).
 * A missing or cross-tenant id is indistinguishable: { ok: false }.
 */
export async function validateTargetTx(
  c: PoolClient,
  tenantId: string,
  targetType: LinkTargetType,
  targetId: string,
): Promise<ValidatedTarget | { ok: false }> {
  if (!UUID_RE.test(targetId)) return { ok: false };
  switch (targetType) {
    case "equipment_notebook": {
      const r = await c.query<{ node_id: string | null }>(
        `SELECT node_id::text AS node_id FROM equipment_notebooks
          WHERE tenant_id = $1::uuid AND id = $2::uuid`,
        [tenantId, targetId],
      );
      if (r.rows.length === 0) return { ok: false };
      return { ok: true, nodeId: r.rows[0].node_id };
    }
    case "namespace_node": {
      const r = await c.query(
        `SELECT id FROM kg_entities WHERE tenant_id = $1::uuid AND id = $2::uuid`,
        [tenantId, targetId],
      );
      if (r.rows.length === 0) return { ok: false };
      return { ok: true, nodeId: targetId };
    }
    case "cmms_asset": {
      const r = await pool.query(
        `SELECT id FROM cmms_equipment WHERE tenant_id = $1 AND id = $2::uuid`,
        [tenantId, targetId],
      );
      if (r.rows.length === 0) return { ok: false };
      return { ok: true, nodeId: null };
    }
    case "work_order": {
      const r = await pool.query(
        `SELECT id FROM work_orders WHERE tenant_id = $1 AND id = $2::uuid`,
        [tenantId, targetId],
      );
      if (r.rows.length === 0) return { ok: false };
      return { ok: true, nodeId: null };
    }
  }
}

// ── Attach / detach / relocate ───────────────────────────────────────────────

export interface AttachOutcome {
  linkId: string;
  targetType: LinkTargetType;
  targetId: string;
}

export type AttachError =
  | { ok: false; error: "file_not_found" }
  | { ok: false; error: "target_not_found"; targetType: LinkTargetType; targetId: string };

class TargetNotFoundError extends Error {
  constructor(
    public targetType: LinkTargetType,
    public targetId: string,
  ) {
    super(`target not found: ${targetType}/${targetId}`);
  }
}

async function attachTargetsTx(
  c: PoolClient,
  tenantId: string,
  file: { id: string; uploadId: string | null },
  targets: AttachTarget[],
  createdBy: string | null,
): Promise<AttachOutcome[]> {
  const outcomes: AttachOutcome[] = [];
  for (const t of targets) {
    const validated = await validateTargetTx(c, tenantId, t.targetType, t.targetId);
    if (!validated.ok) throw new TargetNotFoundError(t.targetType, t.targetId);

    if (t.isPrimary === true) {
      await c.query(
        `UPDATE workspace_file_links SET is_primary = false
          WHERE tenant_id = $1::uuid AND file_id = $2::uuid AND is_primary`,
        [tenantId, file.id],
      );
    }
    const link = await c.query<{ id: string }>(
      `INSERT INTO workspace_file_links
          (tenant_id, file_id, target_type, target_id, role, display_label,
           is_primary, created_by)
       VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6, $7, $8)
       ON CONFLICT ON CONSTRAINT uq_workspace_file_links_relationship
       DO UPDATE SET role          = COALESCE(EXCLUDED.role, workspace_file_links.role),
                     display_label = COALESCE(EXCLUDED.display_label, workspace_file_links.display_label),
                     is_primary    = workspace_file_links.is_primary OR EXCLUDED.is_primary
       RETURNING id::text AS id`,
      [
        tenantId,
        file.id,
        t.targetType,
        t.targetId,
        t.role ?? null,
        t.displayLabel ?? null,
        t.isPrimary === true,
        createdBy,
      ],
    );
    outcomes.push({ linkId: link.rows[0].id, targetType: t.targetType, targetId: t.targetId });

    // Notebook link + indexed doc → source membership rides in the SAME
    // transaction (spec "File relationship versus notebook source membership").
    // Stored-only files get the link (they appear in the notebook's Files
    // section) but never a chat-scope source row.
    if (t.targetType === "equipment_notebook" && file.uploadId) {
      await upsertNotebookSourceTx(c, {
        tenantId,
        notebookId: t.targetId,
        docId: file.uploadId,
        matchState: t.matchState ?? "user_confirmed",
        sourceRole: t.role ?? null,
        addedBy: createdBy,
        matchEvidence: t.matchEvidence,
      });
    }
  }
  return outcomes;
}

/**
 * Idempotently attach a file to one or more validated targets — all-or-nothing.
 * Replays return the existing link ids without duplicating relationships.
 */
export async function attachFileToTargets(
  tenantId: string,
  fileId: string,
  targets: AttachTarget[],
  opts: { createdBy?: string | null } = {},
): Promise<{ ok: true; links: AttachOutcome[] } | AttachError> {
  if (!UUID_RE.test(fileId)) return { ok: false, error: "file_not_found" };
  try {
    return await withTenantContext(tenantId, async (c) => {
      const f = await c.query<{ id: string; upload_id: string | null }>(
        `SELECT id::text AS id, upload_id::text AS upload_id
           FROM namespace_direct_uploads
          WHERE tenant_id = $1::uuid AND id = $2::uuid`,
        [tenantId, fileId],
      );
      if (f.rows.length === 0) {
        return { ok: false as const, error: "file_not_found" as const };
      }
      const links = await attachTargetsTx(
        c,
        tenantId,
        { id: f.rows[0].id, uploadId: f.rows[0].upload_id },
        targets,
        opts.createdBy ?? null,
      );
      return { ok: true as const, links };
    });
  } catch (err) {
    if (err instanceof TargetNotFoundError) {
      return { ok: false, error: "target_not_found", targetType: err.targetType, targetId: err.targetId };
    }
    throw err;
  }
}

/**
 * Remove ONE relationship. Never deletes bytes, chunks, or other links. When
 * the link points at a notebook and the file has an indexed doc, that
 * notebook's source membership goes with it (same transaction); every other
 * notebook's membership is untouched.
 */
export async function detachLink(
  tenantId: string,
  fileId: string,
  linkId: string,
): Promise<boolean> {
  if (!UUID_RE.test(fileId) || !UUID_RE.test(linkId)) return false;
  return withTenantContext(tenantId, async (c) => {
    const link = await c.query<{ target_type: LinkTargetType; target_id: string }>(
      `DELETE FROM workspace_file_links
        WHERE tenant_id = $1::uuid AND id = $2::uuid AND file_id = $3::uuid
        RETURNING target_type, target_id::text AS target_id`,
      [tenantId, linkId, fileId],
    );
    if (link.rows.length === 0) return false;
    const { target_type, target_id } = link.rows[0];
    if (target_type === "equipment_notebook") {
      const f = await c.query<{ upload_id: string | null }>(
        `SELECT upload_id::text AS upload_id FROM namespace_direct_uploads
          WHERE tenant_id = $1::uuid AND id = $2::uuid`,
        [tenantId, fileId],
      );
      const uploadId = f.rows[0]?.upload_id;
      if (uploadId) {
        await c.query(
          `DELETE FROM equipment_notebook_sources
            WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid AND doc_id = $3::uuid`,
          [tenantId, target_id, uploadId],
        );
      }
    }
    return true;
  });
}

/**
 * Move / change filing location: add the new destinations and remove only the
 * explicitly named old links, in one transaction. Nothing implicit is removed.
 */
export async function relocateFile(
  tenantId: string,
  fileId: string,
  changes: { add: AttachTarget[]; removeLinkIds: string[] },
  opts: { createdBy?: string | null } = {},
): Promise<{ ok: true; links: AttachOutcome[]; removed: number } | AttachError> {
  if (!UUID_RE.test(fileId)) return { ok: false, error: "file_not_found" };
  for (const id of changes.removeLinkIds) {
    if (!UUID_RE.test(id)) return { ok: false, error: "file_not_found" };
  }
  try {
    return await withTenantContext(tenantId, async (c) => {
      const f = await c.query<{ id: string; upload_id: string | null }>(
        `SELECT id::text AS id, upload_id::text AS upload_id
           FROM namespace_direct_uploads
          WHERE tenant_id = $1::uuid AND id = $2::uuid`,
        [tenantId, fileId],
      );
      if (f.rows.length === 0) {
        return { ok: false as const, error: "file_not_found" as const };
      }
      const file = { id: f.rows[0].id, uploadId: f.rows[0].upload_id };
      const links = await attachTargetsTx(c, tenantId, file, changes.add, opts.createdBy ?? null);
      let removed = 0;
      for (const linkId of changes.removeLinkIds) {
        const del = await c.query<{ target_type: LinkTargetType; target_id: string }>(
          `DELETE FROM workspace_file_links
            WHERE tenant_id = $1::uuid AND id = $2::uuid AND file_id = $3::uuid
            RETURNING target_type, target_id::text AS target_id`,
          [tenantId, linkId, fileId],
        );
        if (del.rows.length === 0) continue;
        removed += 1;
        if (del.rows[0].target_type === "equipment_notebook" && file.uploadId) {
          await c.query(
            `DELETE FROM equipment_notebook_sources
              WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid AND doc_id = $3::uuid`,
            [tenantId, del.rows[0].target_id, file.uploadId],
          );
        }
      }
      return { ok: true as const, links, removed };
    });
  } catch (err) {
    if (err instanceof TargetNotFoundError) {
      return { ok: false, error: "target_not_found", targetType: err.targetType, targetId: err.targetId };
    }
    throw err;
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function getFile(
  tenantId: string,
  fileId: string,
): Promise<{ file: WorkspaceFile; links: WorkspaceFileLink[] } | null> {
  if (!UUID_RE.test(fileId)) return null;
  return withTenantContext(tenantId, async (c) => {
    const f = await c.query<FileRow>(
      `SELECT ${FILE_COLS} FROM namespace_direct_uploads f
        WHERE f.tenant_id = $1::uuid AND f.id = $2::uuid`,
      [tenantId, fileId],
    );
    if (f.rows.length === 0) return null;
    const l = await c.query<LinkRow>(
      `SELECT id::text AS id, file_id::text AS file_id, target_type,
              target_id::text AS target_id, role, display_label, is_primary, created_at
         FROM workspace_file_links
        WHERE tenant_id = $1::uuid AND file_id = $2::uuid
        ORDER BY created_at ASC`,
      [tenantId, fileId],
    );
    return { file: rowToFile(f.rows[0]), links: l.rows.map(rowToLink) };
  });
}

export async function listFiles(
  tenantId: string,
  opts: {
    q?: string | null;
    capability?: FileCapability | null;
    unfiled?: boolean;
    limit?: number;
    offset?: number;
  } = {},
): Promise<WorkspaceFile[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const files = await withTenantContext(tenantId, async (c) => {
    const params: unknown[] = [tenantId];
    let where = `f.tenant_id = $1::uuid`;
    if (opts.q && opts.q.trim()) {
      params.push(`%${opts.q.trim()}%`);
      where += ` AND f.filename ILIKE $${params.length}`;
    }
    if (opts.unfiled === true) {
      where += ` AND NOT EXISTS (SELECT 1 FROM workspace_file_links l
                   WHERE l.tenant_id = f.tenant_id AND l.file_id = f.id)`;
    }
    params.push(limit, offset);
    const r = await c.query<FileRow>(
      `SELECT ${FILE_COLS} FROM namespace_direct_uploads f
        WHERE ${where}
        ORDER BY f.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return r.rows.map(rowToFile);
  });
  // Capability is derived (mime + filename), so it filters app-side.
  return opts.capability ? files.filter((f) => f.capability === opts.capability) : files;
}

/** Files attached to one target — the notebook/asset/node/WO Files section. */
export async function listFilesForTarget(
  tenantId: string,
  targetType: LinkTargetType,
  targetId: string,
): Promise<Array<WorkspaceFile & { link: WorkspaceFileLink }>> {
  if (!UUID_RE.test(targetId)) return [];
  return withTenantContext(tenantId, async (c) => {
    const r = await c.query<FileRow & LinkRow & { link_id: string; link_created_at: string }>(
      `SELECT ${FILE_COLS},
              l.id::text AS link_id, l.file_id::text AS file_id, l.target_type,
              l.target_id::text AS target_id, l.role, l.display_label,
              l.is_primary, l.created_at AS link_created_at
         FROM workspace_file_links l
         JOIN namespace_direct_uploads f
           ON f.id = l.file_id AND f.tenant_id = l.tenant_id
        WHERE l.tenant_id = $1::uuid AND l.target_type = $2 AND l.target_id = $3::uuid
        ORDER BY l.created_at DESC`,
      [tenantId, targetType, targetId],
    );
    return r.rows.map((row) => ({
      ...rowToFile(row),
      link: rowToLink({
        id: row.link_id,
        file_id: row.file_id,
        target_type: row.target_type,
        target_id: row.target_id,
        role: row.role,
        display_label: row.display_label,
        is_primary: row.is_primary,
        created_at: row.link_created_at,
      }),
    }));
  });
}

/**
 * Document ids (hub_uploads.id = knowledge_entries.doc_id) explicitly linked to
 * ONE target — the retrieval derivation for chat over reused documents. Only
 * indexed files contribute (a stored-only file has no document to retrieve).
 *
 * This IS the membership proof: the row exists, in this tenant, for this exact
 * target. A caller may therefore pass the result to `retrieveNodeChunks` with
 * `validatedDocScope: true`, which is what lets one canonical document answer
 * for every place it is filed instead of only the node it happened to be
 * ingested under.
 */
export async function linkedDocIdsForTarget(
  tenantId: string,
  targetType: LinkTargetType,
  targetId: string,
): Promise<string[]> {
  if (!UUID_RE.test(targetId)) return [];
  return withTenantContext(tenantId, async (c) => {
    const r = await c.query<{ upload_id: string }>(
      `SELECT DISTINCT f.upload_id::text AS upload_id
         FROM workspace_file_links l
         JOIN namespace_direct_uploads f
           ON f.id = l.file_id AND f.tenant_id = l.tenant_id
        WHERE l.tenant_id = $1::uuid AND l.target_type = $2
          AND l.target_id = $3::uuid AND f.upload_id IS NOT NULL`,
      [tenantId, targetType, targetId],
    );
    return r.rows.map((row) => row.upload_id);
  });
}

/** Namespace-node specialization of {@link linkedDocIdsForTarget}. */
export async function linkedDocIdsForNode(
  tenantId: string,
  nodeId: string,
): Promise<string[]> {
  return linkedDocIdsForTarget(tenantId, "namespace_node", nodeId);
}

// ── Delete ───────────────────────────────────────────────────────────────────

export type DeleteFileResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "has_links" | "verified_retained" };

/**
 * Destructive delete — a separate action from detach. Refuses while any
 * relationship remains (the FK RESTRICT would refuse anyway; this returns a
 * clean error instead of a constraint violation) and respects verified-file
 * retention (059 trigger is the DB backstop).
 */
export async function deleteFile(tenantId: string, fileId: string): Promise<DeleteFileResult> {
  if (!UUID_RE.test(fileId)) return { ok: false, error: "not_found" };
  return withTenantContext(tenantId, async (c) => {
    const f = await c.query<{ verified: boolean; links: string }>(
      `SELECT f.verified,
              (SELECT COUNT(*) FROM workspace_file_links l
                WHERE l.tenant_id = f.tenant_id AND l.file_id = f.id)::text AS links
         FROM namespace_direct_uploads f
        WHERE f.tenant_id = $1::uuid AND f.id = $2::uuid`,
      [tenantId, fileId],
    );
    if (f.rows.length === 0) return { ok: false as const, error: "not_found" as const };
    if (Number(f.rows[0].links) > 0) return { ok: false as const, error: "has_links" as const };
    if (f.rows[0].verified === true) {
      return { ok: false as const, error: "verified_retained" as const };
    }
    await c.query(
      `DELETE FROM namespace_direct_uploads WHERE tenant_id = $1::uuid AND id = $2::uuid`,
      [tenantId, fileId],
    );
    return { ok: true as const };
  });
}

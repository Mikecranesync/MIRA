// mira-hub/src/lib/uploads.ts
import pool from "@/lib/db";
import { DEFAULT_TENANT_ID } from "@/lib/bindings";

export type UploadStatus =
  | "queued"
  | "fetching"
  | "parsing"
  | "parsed"
  | "failed"
  | "cancelled";

export type UploadProvider = "google" | "dropbox" | "local";

export type UploadKind = "document" | "photo";

export interface Upload {
  id: string;
  tenantId: string;
  provider: UploadProvider;
  kind: UploadKind;
  externalFileId: string | null;
  externalDownloadUrl: string | null;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  externalCreatedAt: string | null;
  status: UploadStatus;
  statusDetail: string | null;
  kbFileId: string | null;
  kbChunkCount: number | null;
  assetTag: string | null;
  unsPath: string | null;
  /** Confirmed kg_entities node this drop is attached to (Inbox node for blind PDFs, #1806). */
  kgEntityId: string | null;
  /** 'v2' = chunks written to knowledge_entries (citable); null/'ow' = legacy OW-only. */
  ingestRoute: string | null;
  /** sha256 hex of the uploaded bytes — server-side content dedup (ARPK 1b, migration 072). */
  contentSha256: string | null;
  createdAt: string;
  updatedAt: string;
}

let schemaReady: Promise<void> | null = null;

/**
 * hub_uploads' schema is now owned by mira-hub/db/migrations/068_hub_uploads.sql
 * (#703) — this no longer runs DDL. It's a cheap, memoized-per-process check
 * that the newest known column exists, and fails loud (not silently creates)
 * if migration 068 hasn't been applied to this environment yet.
 */
export function ensureUploadsSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'hub_uploads' AND column_name = 'content_sha256'`,
    );
    if (rows.length === 0) {
      schemaReady = null; // don't cache a failure — allow retry once the migration lands
      throw new Error(
        "hub_uploads schema is out of date — apply mira-hub/db/migrations/072_hub_uploads_content_sha256.sql",
      );
    }
  })();
  return schemaReady;
}

export interface CreateUploadInput {
  tenantId?: string;
  provider: UploadProvider;
  kind?: UploadKind;
  externalFileId?: string | null;
  externalDownloadUrl?: string | null;
  filename: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  externalCreatedAt?: string | Date | null;
  initialStatus?: UploadStatus;
  assetTag?: string | null;
  unsPath?: string | null;
  /** mira-ingest-v2 / Hub folder=brain: the confirmed kg_entities node this drop is attached to. */
  kgEntityId?: string | null;
  /** 'v2' = chunks written to knowledge_entries; null/'ow' = legacy Open-WebUI-only path. */
  ingestRoute?: string | null;
  /** sha256 hex of the uploaded bytes; enables findDuplicateUpload (ARPK 1b). */
  contentSha256?: string | null;
}

/**
 * pg returns `Date` objects for `timestamptz` columns by default (no
 * setTypeParser override in this codebase) — but the `Upload` interface
 * declares createdAt/updatedAt/externalCreatedAt as `string`. Convert here so
 * the declared type is actually true, rather than casting a Date through
 * `as string`. Tolerates a driver/config that already hands back a string.
 */
function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toIsoStringOrNull(value: Date | string | null): string | null {
  return value == null ? null : toIsoString(value);
}

function rowToUpload(r: Record<string, unknown>): Upload {
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    provider: r.provider as UploadProvider,
    kind: ((r.kind as string) ?? "document") as UploadKind,
    externalFileId: (r.external_file_id as string | null) ?? null,
    externalDownloadUrl: (r.external_download_url as string | null) ?? null,
    filename: r.filename as string,
    mimeType: (r.mime_type as string | null) ?? null,
    sizeBytes: r.size_bytes != null ? Number(r.size_bytes) : null,
    externalCreatedAt: toIsoStringOrNull(r.external_created_at as Date | string | null),
    status: r.status as UploadStatus,
    statusDetail: (r.status_detail as string | null) ?? null,
    kbFileId: (r.kb_file_id as string | null) ?? null,
    kbChunkCount: r.kb_chunk_count != null ? Number(r.kb_chunk_count) : null,
    assetTag: (r.asset_tag as string | null) ?? null,
    unsPath: (r.uns_path as string | null) ?? null,
    kgEntityId: (r.kg_entity_id as string | null) ?? null,
    ingestRoute: (r.ingest_route as string | null) ?? null,
    contentSha256: (r.content_sha256 as string | null) ?? null,
    createdAt: toIsoString(r.created_at as Date | string),
    updatedAt: toIsoString(r.updated_at as Date | string),
  };
}

export async function createUpload(input: CreateUploadInput): Promise<Upload> {
  await ensureUploadsSchema();
  const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
  const status = input.initialStatus ?? "queued";
  const kind = input.kind ?? "document";
  const createdAt =
    input.externalCreatedAt instanceof Date
      ? input.externalCreatedAt.toISOString()
      : (input.externalCreatedAt ?? null);

  const { rows } = await pool.query(
    `
    INSERT INTO hub_uploads
      (tenant_id, provider, kind, external_file_id, external_download_url,
       filename, mime_type, size_bytes, external_created_at, status, asset_tag, uns_path,
       kg_entity_id, ingest_route, content_sha256)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    RETURNING *
  `,
    [
      tenantId,
      input.provider,
      kind,
      input.externalFileId ?? null,
      input.externalDownloadUrl ?? null,
      input.filename,
      input.mimeType ?? null,
      input.sizeBytes ?? null,
      createdAt,
      status,
      input.assetTag ?? null,
      input.unsPath ?? null,
      input.kgEntityId ?? null,
      input.ingestRoute ?? null,
      input.contentSha256 ?? null,
    ],
  );
  return rowToUpload(rows[0]);
}

/**
 * ARPK Phase 1b — find an existing PARSED v2 document with the same bytes on
 * the same node. Scoped to (tenant, hash, node) deliberately: an exact
 * re-upload to the same node/Inbox is a duplicate (skip re-chunking — the
 * 158x-ingest class), but the same bytes attached to a DIFFERENT node must
 * still ingest, because chunks carry that node's node_id. Failed/legacy rows
 * never match (status/ingest_route predicates), so a failed first attempt
 * doesn't block a retry.
 */
export async function findDuplicateUpload(
  tenantId: string,
  contentSha256: string,
  kgEntityId: string,
): Promise<Upload | null> {
  await ensureUploadsSchema();
  const { rows } = await pool.query(
    `
    SELECT * FROM hub_uploads
     WHERE tenant_id = $1
       AND content_sha256 = $2
       AND kg_entity_id = $3
       AND status = 'parsed'
       AND ingest_route = 'v2'
       AND kind = 'document'
     ORDER BY created_at DESC
     LIMIT 1
  `,
    [tenantId, contentSha256, kgEntityId],
  );
  return rows.length > 0 ? rowToUpload(rows[0]) : null;
}

export async function listUploads(tenantId = DEFAULT_TENANT_ID): Promise<Upload[]> {
  await ensureUploadsSchema();
  const { rows } = await pool.query(
    `
    SELECT * FROM hub_uploads
     WHERE tenant_id = $1
       AND (status != 'parsed' OR updated_at > NOW() - INTERVAL '24 hours')
       AND status != 'cancelled'
     ORDER BY created_at DESC
     LIMIT 50
  `,
    [tenantId],
  );
  return rows.map(rowToUpload);
}

export async function getUpload(
  id: string,
  tenantId = DEFAULT_TENANT_ID,
): Promise<Upload | null> {
  await ensureUploadsSchema();
  const { rows } = await pool.query(
    `SELECT * FROM hub_uploads WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    [id, tenantId],
  );
  return rows[0] ? rowToUpload(rows[0]) : null;
}

/**
 * Look up an existing upload by its cloud-source identity (tenant + provider
 * + external_file_id). Returns null when none exists. Used for idempotency
 * (#700) — re-picking the same Drive/Dropbox file finds the prior row
 * instead of duplicating the pipeline.
 */
export async function findUploadByExternalFileId(
  tenantId: string,
  provider: UploadProvider,
  externalFileId: string,
): Promise<Upload | null> {
  await ensureUploadsSchema();
  const { rows } = await pool.query(
    `SELECT * FROM hub_uploads
       WHERE tenant_id = $1
         AND provider = $2
         AND external_file_id = $3
       LIMIT 1`,
    [tenantId, provider, externalFileId],
  );
  return rows[0] ? rowToUpload(rows[0]) : null;
}

export async function updateUploadStatus(
  id: string,
  tenantId: string,
  status: UploadStatus,
  detail?: string | null,
  extras?: { kbFileId?: string; kbChunkCount?: number; kgEntityId?: string; ingestRoute?: string },
): Promise<void> {
  // kgEntityId + ingestRoute let a blind-door upload (#1806) be re-stamped to the
  // Inbox node + 'v2' once its PDF is chunked into knowledge_entries, so the node
  // Documents panel + provenance match the citable chunks. COALESCE — only set
  // when provided, never clobber an existing value with NULL.
  await pool.query(
    `
    UPDATE hub_uploads
       SET status = $3,
           status_detail = COALESCE($4, status_detail),
           kb_file_id = COALESCE($5, kb_file_id),
           kb_chunk_count = COALESCE($6, kb_chunk_count),
           kg_entity_id = COALESCE($7::uuid, kg_entity_id),
           ingest_route = COALESCE($8, ingest_route),
           updated_at = NOW()
     WHERE id = $1
       AND tenant_id = $2
  `,
    [
      id,
      tenantId,
      status,
      detail ?? null,
      extras?.kbFileId ?? null,
      extras?.kbChunkCount ?? null,
      extras?.kgEntityId ?? null,
      extras?.ingestRoute ?? null,
    ],
  );
}

export async function deleteUpload(id: string, tenantId = DEFAULT_TENANT_ID): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM hub_uploads WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId],
  );
  return (rowCount ?? 0) > 0;
}

export interface UploadCounts {
  pm_tasks_count: number;
  fault_codes_count: number;
  knowledge_chunks_count: number;
}

/**
 * Query ingest-result counts for a completed upload.
 *
 * - knowledge_chunks_count: taken directly from hub_uploads.kb_chunk_count
 *   (written by the pipeline when mira-ingest returns the chunk count).
 * - pm_tasks_count: count of pm_schedules rows whose source_citation matches
 *   the upload filename. Falls back to 0 if the table/column doesn't exist.
 * - fault_codes_count: count of kb_chunks rows tagged as fault-code chunks
 *   whose source matches the upload filename. Falls back to 0 gracefully.
 *
 * All fallbacks return 0 — never throws on missing tables/columns.
 */
export async function getUploadCounts(
  upload: Upload,
  tenantId = DEFAULT_TENANT_ID,
): Promise<UploadCounts> {
  // kb_chunk_count is written directly by the ingest pipeline
  const knowledge_chunks_count = upload.kbChunkCount ?? 0;

  // PM tasks: pm_schedules rows linked to this filename via source_citation
  let pm_tasks_count = 0;
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n
         FROM pm_schedules
        WHERE tenant_id = $1
          AND source_citation ILIKE $2`,
      [tenantId, `%${upload.filename}%`],
    );
    pm_tasks_count = rows[0]?.n ?? 0;
  } catch {
    // Table or column doesn't exist yet — return 0
  }

  // Fault codes: kb_chunks tagged as fault codes linked to this filename
  let fault_codes_count = 0;
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n
         FROM kb_chunks
        WHERE tenant_id = $1
          AND source ILIKE $2
          AND (doc_type ILIKE '%fault%' OR doc_type ILIKE '%error%' OR title ILIKE '%fault%' OR title ILIKE '%error code%')`,
      [tenantId, `%${upload.filename}%`],
    );
    fault_codes_count = rows[0]?.n ?? 0;
  } catch {
    // Table or column doesn't exist yet — return 0
  }

  return { pm_tasks_count, fault_codes_count, knowledge_chunks_count };
}

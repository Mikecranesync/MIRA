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
  createdAt: string;
  updatedAt: string;
}

let schemaReady: Promise<void> | null = null;

export function ensureUploadsSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hub_uploads (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id             TEXT NOT NULL DEFAULT 'mike',
        provider              TEXT NOT NULL,
        external_file_id      TEXT,
        external_download_url TEXT,
        filename              TEXT NOT NULL,
        mime_type             TEXT,
        size_bytes            BIGINT,
        external_created_at   TIMESTAMPTZ,
        status                TEXT NOT NULL DEFAULT 'queued',
        status_detail         TEXT,
        kb_file_id            TEXT,
        kb_chunk_count        INTEGER,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    // In-place migrations for pre-existing deployments (idempotent)
    await pool.query(`
      ALTER TABLE hub_uploads
        ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'document'
    `);
    await pool.query(`
      ALTER TABLE hub_uploads
        ADD COLUMN IF NOT EXISTS asset_tag TEXT
    `);
    await pool.query(`
      ALTER TABLE hub_uploads
        ADD COLUMN IF NOT EXISTS uns_path TEXT
    `);
    // mira-ingest-v2 (ADR-0019) / Hub folder=brain: a drop attached to a namespace node
    // records the confirmed kg_entities node id, so retrieval resolves the chunk → node
    // address (knowledge_entries.doc_id → hub_uploads.kg_entity_id → kg_entities.uns_path).
    await pool.query(`
      ALTER TABLE hub_uploads
        ADD COLUMN IF NOT EXISTS kg_entity_id UUID
    `);
    // 'v2' = mira-ingest-v2 / Hub-node attachment (chunks land in knowledge_entries);
    // NULL / 'ow' = legacy Open-WebUI-only path. Discriminator for cutover.
    await pool.query(`
      ALTER TABLE hub_uploads
        ADD COLUMN IF NOT EXISTS ingest_route TEXT
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_hub_uploads_tenant_status
        ON hub_uploads (tenant_id, status, created_at DESC)
    `);
    // Fetch all v2 drops bound to a node (node Documents panel + subtree retrieval join).
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_hub_uploads_kg_entity
        ON hub_uploads (tenant_id, kg_entity_id)
        WHERE kg_entity_id IS NOT NULL
    `);
    // Idempotency for cloud-source uploads (#700) — re-picking the same
    // Drive/Dropbox file should return the existing row, not duplicate
    // the entire fetch → forward → KB pipeline.
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_uploads_dedup
        ON hub_uploads (tenant_id, provider, external_file_id)
        WHERE external_file_id IS NOT NULL
    `);
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
    externalCreatedAt: (r.external_created_at as string | null) ?? null,
    status: r.status as UploadStatus,
    statusDetail: (r.status_detail as string | null) ?? null,
    kbFileId: (r.kb_file_id as string | null) ?? null,
    kbChunkCount: r.kb_chunk_count != null ? Number(r.kb_chunk_count) : null,
    assetTag: (r.asset_tag as string | null) ?? null,
    unsPath: (r.uns_path as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
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
       kg_entity_id, ingest_route)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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
    ],
  );
  return rowToUpload(rows[0]);
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
  extras?: { kbFileId?: string; kbChunkCount?: number },
): Promise<void> {
  await pool.query(
    `
    UPDATE hub_uploads
       SET status = $3,
           status_detail = COALESCE($4, status_detail),
           kb_file_id = COALESCE($5, kb_file_id),
           kb_chunk_count = COALESCE($6, kb_chunk_count),
           updated_at = NOW()
     WHERE id = $1
       AND tenant_id = $2
  `,
    [id, tenantId, status, detail ?? null, extras?.kbFileId ?? null, extras?.kbChunkCount ?? null],
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

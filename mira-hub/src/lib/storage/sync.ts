import pool from "@/lib/db";
import { ensureFreshAccessToken } from "@/lib/token-refresh";
import { forwardToIngest, SUPPORTED_MIMES } from "@/lib/mira-ingest-client";
import { getProviderClient } from "./index";
import type { StorageProviderKind, StorageFile } from "./types";

export interface SyncResult {
  indexed: number;
  skipped: number;
  failed: number;
  removed: number;
}

interface ProviderRow {
  id: string;
  tenant_id: string;
  provider: StorageProviderKind;
  root_path: string | null;
}

interface IndexRow {
  id: string;
  external_file_id: string;
  last_modified_at: string | null;
}

export async function storageSyncJob(providerId: string): Promise<SyncResult> {
  const result: SyncResult = { indexed: 0, skipped: 0, failed: 0, removed: 0 };

  // Load provider config (bypass RLS — this is a server-side job)
  const { rows: pRows } = await pool.query<ProviderRow>(
    `SELECT id, tenant_id, provider, root_path FROM connected_storage_providers WHERE id = $1`,
    [providerId],
  );
  if (!pRows[0]) throw new Error(`provider ${providerId} not found`);
  const prov = pRows[0];

  await pool.query(
    `UPDATE connected_storage_providers SET sync_status = 'syncing', sync_error = NULL WHERE id = $1`,
    [providerId],
  );

  try {
    const { accessToken } = await ensureFreshAccessToken(
      mapProviderToBinding(prov.provider),
      prov.tenant_id,
    );

    const client = getProviderClient(prov.provider, accessToken);
    const remoteFiles = await client.listFiles(prov.root_path ?? undefined);

    // Load existing index for this provider
    const { rows: existing } = await pool.query<IndexRow>(
      `SELECT id, external_file_id, last_modified_at
         FROM storage_file_index
        WHERE provider_id = $1`,
      [providerId],
    );
    const existingMap = new Map(existing.map((r) => [r.external_file_id, r]));
    const seenIds = new Set<string>();

    for (const file of remoteFiles) {
      seenIds.add(file.id);
      const prev = existingMap.get(file.id);
      const changed =
        !prev || (prev.last_modified_at ?? "") < file.modifiedAt;

      if (!changed) continue;

      const mimeSupported = SUPPORTED_MIMES.has(file.mimeType);

      if (!mimeSupported) {
        await upsertFileRow(prov, file, "skipped", null);
        result.skipped++;
        continue;
      }

      await upsertFileRow(prov, file, "indexing", null);

      try {
        const contentRes = await client.getFileContent(file.id);
        if (!contentRes.ok || !contentRes.body) {
          throw new Error(`download failed: ${contentRes.status}`);
        }
        const ingestResult = await forwardToIngest(
          contentRes.body as ReadableStream<Uint8Array>,
          file.name,
          file.mimeType,
        );
        await upsertFileRow(prov, file, "indexed", ingestResult.chunkCount ?? 0);
        result.indexed++;
      } catch (err) {
        console.error(`[storage-sync] failed to index ${file.name}:`, err);
        await pool.query(
          `UPDATE storage_file_index
              SET index_status = 'failed', indexed_at = now()
            WHERE provider_id = $1 AND external_file_id = $2`,
          [providerId, file.id],
        );
        result.failed++;
      }
    }

    // Mark files no longer present in provider as removed
    for (const [extId, row] of existingMap) {
      if (!seenIds.has(extId)) {
        await pool.query(
          `UPDATE storage_file_index SET index_status = 'removed' WHERE id = $1`,
          [row.id],
        );
        result.removed++;
      }
    }

    const fileCount = remoteFiles.length;
    await pool.query(
      `UPDATE connected_storage_providers
          SET sync_status = 'idle', last_synced_at = now(), file_count = $2, sync_error = NULL
        WHERE id = $1`,
      [providerId, fileCount],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await pool.query(
      `UPDATE connected_storage_providers
          SET sync_status = 'error', sync_error = $2
        WHERE id = $1`,
      [providerId, msg],
    );
    throw err;
  }

  return result;
}

async function upsertFileRow(
  prov: ProviderRow,
  file: StorageFile,
  status: string,
  kbEntryCount: number | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO storage_file_index
       (tenant_id, provider_id, external_file_id, external_url, filename, mime_type,
        file_size_bytes, last_modified_at, index_status, kb_entry_count, indexed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, 0),
             CASE WHEN $9 IN ('indexed','failed') THEN now() ELSE NULL END)
     ON CONFLICT (tenant_id, provider_id, external_file_id) DO UPDATE SET
       external_url     = EXCLUDED.external_url,
       filename         = EXCLUDED.filename,
       mime_type        = EXCLUDED.mime_type,
       file_size_bytes  = EXCLUDED.file_size_bytes,
       last_modified_at = EXCLUDED.last_modified_at,
       index_status     = EXCLUDED.index_status,
       kb_entry_count   = COALESCE(EXCLUDED.kb_entry_count, storage_file_index.kb_entry_count),
       indexed_at       = CASE WHEN EXCLUDED.index_status IN ('indexed','failed') THEN now()
                               ELSE storage_file_index.indexed_at END`,
    [
      prov.tenant_id,
      prov.id,
      file.id,
      file.webUrl,
      file.name,
      file.mimeType,
      file.sizeBytes,
      file.modifiedAt,
      status,
      kbEntryCount,
    ],
  );
}

function mapProviderToBinding(
  kind: StorageProviderKind,
): "google" | "microsoft" | "dropbox" {
  switch (kind) {
    case "google_drive":
      return "google";
    case "sharepoint":
      return "microsoft";
    case "dropbox":
      return "dropbox";
  }
}

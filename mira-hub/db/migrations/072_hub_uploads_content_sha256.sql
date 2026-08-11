-- Migration 072: hub_uploads.content_sha256 — server-side content dedup (ARPK 1b).
--
-- PRD: docs/plans/2026-08-10-prd-agent-readable-product-knowledge-t2108.md
-- § "Ingestion fixes required": "Server-side SHA-256 content dedup."
--
-- The v2 chunk writer embeds the uploadId in knowledge_entries.source_url, so
-- its chunk-level ON CONFLICT only protects a retry of the SAME upload row —
-- re-uploading identical bytes produced a full second chunk set (the
-- "gs10_fault_codes.pdf ingested 158x" incident class, #2968 steps 2-4). The
-- upload doors now hash the bytes (node:crypto sha256 hex) and consult
-- findDuplicateUpload(tenant, hash, node) before chunking again.
--
-- Plain (non-UNIQUE) partial index: dedup is an app-level decision keyed on
-- (tenant_id, content_sha256, kg_entity_id, status='parsed', ingest_route='v2')
-- — the same bytes attached to a DIFFERENT node must still ingest (chunks must
-- carry that node's node_id), and failed/legacy rows must not block a re-try.
-- All legacy rows keep NULL (backfill unnecessary: dedup only needs to catch
-- re-uploads from now on).
--
-- Companion change: uploads.ts ensureUploadsSchema() now probes THIS column and
-- fails loud if 072 hasn't been applied (same pattern as 068's ingest_route).
--
-- Idempotent, additive-only, single transaction (§5, §8 mira-hub-migrations.md).
-- Rollback: ALTER TABLE hub_uploads DROP COLUMN IF EXISTS content_sha256;
--           DROP INDEX IF EXISTS idx_hub_uploads_content_sha;

BEGIN;

ALTER TABLE hub_uploads
  ADD COLUMN IF NOT EXISTS content_sha256 TEXT;

CREATE INDEX IF NOT EXISTS idx_hub_uploads_content_sha
  ON hub_uploads (tenant_id, content_sha256)
  WHERE content_sha256 IS NOT NULL;

COMMIT;

BEGIN;

-- Migration 065: evidence_item byte storage (Visual Focus Workspace, PR V2).
--
-- WHY
--   Migration 063 gave evidence_item only URI/hash columns (original_uri,
--   original_hash, ...). The bot ingest path (mira-bots/shared/visual/
--   session_service.py) persists the sha256 hash and DROPS the bytes — no row
--   on any environment has a non-NULL original_uri, and mira-hub and the bot
--   containers share no filesystem (only Neon). For the Hub Visual Workspace
--   (PRD docs/prd/2026-07-20-printsense-visual-focus-workspace.md §20 PR V2)
--   the browser must be able to load the evidence image back, so the original
--   bytes need a durable, tenant-scoped home both sides can reach: Neon.
--
-- WHAT
--   Two nullable columns on evidence_item, mirroring the proven
--   namespace_direct_uploads.content BYTEA pattern (migrations 027 + 059):
--     content       BYTEA — the original uploaded bytes (FR-1: original always
--                   retained, never overwritten; rows stay INSERT+UPDATE only,
--                   DELETE remains revoked from 063).
--     content_mime  TEXT  — server-sniffed MIME (magic bytes, never the
--                   client's declared type).
--   Nullable on purpose: existing hash-only bot rows remain valid; the Hub
--   upload path populates both.
--
--   Natural image dimensions (the geometry normalization reference for
--   factorylm.visual-region.v1) go in the EXISTING capture_meta JSONB —
--   no new columns needed for them.
--
-- ACCESS
--   063's table-level GRANT SELECT, INSERT, UPDATE TO factorylm_app covers the
--   new columns; RLS policies are row-level and unchanged. No new grants.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS); safe to re-run.

ALTER TABLE evidence_item ADD COLUMN IF NOT EXISTS content BYTEA;
ALTER TABLE evidence_item ADD COLUMN IF NOT EXISTS content_mime TEXT;

COMMENT ON COLUMN evidence_item.content IS
    'Original uploaded evidence bytes (Hub upload path, PR V2). NULL for bot-ingested hash-only rows.';
COMMENT ON COLUMN evidence_item.content_mime IS
    'Server-sniffed MIME of content (magic bytes). NULL when content is NULL.';

COMMIT;

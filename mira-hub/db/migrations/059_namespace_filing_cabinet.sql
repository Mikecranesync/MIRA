BEGIN;

-- Migration 059: namespace filing cabinet — retain originals + verified-forever.
--
-- The /namespace panel is the tenant's filing cabinet: pics, manuals, and any
-- other uploads are filed against UNS nodes. Two guarantees this migration adds:
--
--   1. Every upload keeps its original bytes. PDFs were previously chunked into
--      knowledge_entries and the raw file discarded (hub_uploads holds metadata
--      only) — the cabinet now parks the original in namespace_direct_uploads,
--      linked to its hub_uploads row via upload_id, so it stays downloadable.
--   2. Verified documents are retained forever. `verified` marks a document a
--      human vouched for; a BEFORE DELETE trigger refuses to remove it at the
--      database layer (the API also 409s first — the trigger is the backstop
--      against hand-run cleanup scripts). Un-verify (an admin action) first if
--      a verified document truly must go.
--
-- Also reconciles drift: the routes have inserted/selected a `content` BYTEA
-- column since Phase 2 Slice 1, but no migration ever defined it (027 predates
-- it). ADD COLUMN IF NOT EXISTS makes this a no-op where the column was
-- hand-applied and a fix where it wasn't.
--
-- upload_id is a plain UUID (no FK): hub_uploads is created at runtime by
-- ensureUploadsSchema(), so a fresh environment may run this migration before
-- that table exists.

ALTER TABLE namespace_direct_uploads
    ADD COLUMN IF NOT EXISTS content     BYTEA,
    ADD COLUMN IF NOT EXISTS upload_id   UUID,
    ADD COLUMN IF NOT EXISTS verified    BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS verified_by UUID;

-- Dedupe joins: the files list and tree count exclude hub_uploads rows already
-- represented by a parked original.
CREATE INDEX IF NOT EXISTS idx_namespace_uploads_upload_id
    ON namespace_direct_uploads (upload_id)
    WHERE upload_id IS NOT NULL;

-- Verified documents are kept forever — enforced in the database, not just the UI.
CREATE OR REPLACE FUNCTION namespace_uploads_block_verified_delete()
RETURNS trigger AS $$
BEGIN
    IF OLD.verified THEN
        RAISE EXCEPTION 'verified document % is retained forever — un-verify it before deleting', OLD.id;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_namespace_uploads_verified_retention ON namespace_direct_uploads;
CREATE TRIGGER trg_namespace_uploads_verified_retention
    BEFORE DELETE ON namespace_direct_uploads
    FOR EACH ROW
    EXECUTE FUNCTION namespace_uploads_block_verified_delete();

COMMIT;

-- ─── Rollback ────────────────────────────────────────────────────────────────
-- BEGIN;
-- DROP TRIGGER IF EXISTS trg_namespace_uploads_verified_retention ON namespace_direct_uploads;
-- DROP FUNCTION IF EXISTS namespace_uploads_block_verified_delete();
-- ALTER TABLE namespace_direct_uploads
--     DROP COLUMN IF EXISTS upload_id,
--     DROP COLUMN IF EXISTS verified,
--     DROP COLUMN IF EXISTS verified_at,
--     DROP COLUMN IF EXISTS verified_by;
-- -- (content is load-bearing for pre-059 rows; do not drop it on rollback.)
-- COMMIT;

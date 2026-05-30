-- Staging-only: dedupe orphan tenant_id='mike' hub_uploads rows that block
-- creation of idx_hub_uploads_dedup. The duplicate rows are all from the
-- legacy 'mike' seed (no user has tenant_id='mike' after PR #1432's remap),
-- so they are unreachable from the UI and safe to deduplicate.
-- Strategy: keep the oldest row per (tenant_id, provider, external_file_id),
-- delete the rest. Then create the unique index so ensureSchema() stops failing.
-- Fixes issue #1424 (uploads 503).

\set ON_ERROR_STOP on
BEGIN;

WITH ranked AS (
    SELECT id,
           row_number() OVER (
               PARTITION BY tenant_id, provider, external_file_id
               ORDER BY created_at ASC, id ASC
           ) AS rn
    FROM hub_uploads
    WHERE external_file_id IS NOT NULL
)
DELETE FROM hub_uploads
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_uploads_dedup
    ON hub_uploads (tenant_id, provider, external_file_id)
    WHERE external_file_id IS NOT NULL;

-- Post-condition: no duplicates remain.
DO $$
DECLARE dups INT;
BEGIN
    SELECT COUNT(*) INTO dups FROM (
        SELECT 1 FROM hub_uploads
        WHERE external_file_id IS NOT NULL
        GROUP BY tenant_id, provider, external_file_id
        HAVING COUNT(*) > 1
    ) d;
    IF dups > 0 THEN
        RAISE EXCEPTION 'still % duplicate groups in hub_uploads', dups;
    END IF;
END $$;

COMMIT;

BEGIN;

-- Migration 057: historian_cursor — explicit watermark for the tag-diff
-- historizer (issue #2343).
--
-- WHAT THIS IS
--   A tiny per-(tenant, source) cursor table recording how far the historizer
--   has processed the raw ``tag_events`` stream (migration 033). One row per
--   tenant per logical source ('tag_diff' for the tag-diff historizer).
--
-- WHY IT EXISTS
--   The historizer previously derived its watermark from
--   ``MAX(event_timestamp) FROM tag_event_diffs``. But ``tag_diff_logger``
--   emits NO diff for a tag's first observation, so a batch that produced no
--   diffs never advanced the watermark — the same ``tag_events`` slice was
--   re-read every run (and if the earliest events never diffed, ALL of
--   tag_events forever). This table is an EXPLICIT cursor, independent of
--   whether any diffs were written, so the watermark always advances past the
--   events that were processed.
--
-- LIVING ROW — unlike tag_events / tag_event_diffs (append-only), this is a
--   living cursor: INSERT once, then UPDATE in place as the watermark advances.
--   UPDATE is therefore granted; DELETE is not (a cursor is never deleted).
--
-- NOTE — migration number: 051 was originally sketched for this table but is
--   already taken (051_backfill_tenants_from_hub_tenants.sql). This lands as 057
--   (the next free number above the current max, 056).
--
-- TENANT ISOLATION — RLS dual-setting form, matching migration 037.

CREATE TABLE IF NOT EXISTS historian_cursor (
    tenant_id UUID NOT NULL,
    source TEXT NOT NULL,
    last_event_ts TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, source)
);

ALTER TABLE historian_cursor ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS historian_cursor_tenant ON historian_cursor;
CREATE POLICY historian_cursor_tenant
    ON historian_cursor
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID
           OR tenant_id = current_setting('app.current_tenant_id', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID
                OR tenant_id = current_setting('app.current_tenant_id', true)::UUID);

-- Living cursor: SELECT + INSERT + UPDATE. No DELETE.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factorylm_app') THEN
        GRANT SELECT, INSERT, UPDATE ON historian_cursor TO factorylm_app;
    END IF;
END $$;
REVOKE DELETE ON historian_cursor FROM PUBLIC;

COMMIT;

-- ─── Rollback ─────────────────────────────────────────────────────────
-- BEGIN;
-- DROP POLICY IF EXISTS historian_cursor_tenant ON historian_cursor;
-- DROP TABLE IF EXISTS historian_cursor;
-- COMMIT;

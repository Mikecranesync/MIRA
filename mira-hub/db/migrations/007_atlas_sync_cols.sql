-- Migration 007: NeonDB ↔ Atlas CMMS sync columns
--
-- Decision: NeonDB is the source of truth (recorded 2026-05-06 in
-- docs/specs/hub-cmms-integration-spec.md §3.4 #1). Atlas receives synced
-- copies via one-way push from a sync worker. Reverse sync pulls Atlas-side
-- changes back into NeonDB; NeonDB wins on conflict.
--
-- This migration adds the cross-reference + watermark columns the worker
-- needs on every table that has an Atlas counterpart:
--
--   atlas_id          — Atlas-side ID, populated after the first successful
--                       create push. NULL means "never synced to Atlas yet."
--   cmms_synced_at    — last successful sync (either direction). The worker's
--                       forward-sync predicate is:
--                         cmms_synced_at IS NULL OR cmms_synced_at < updated_at
--   cmms_synced_etag  — last value pushed/pulled, used as a cheap optimistic
--                       lock for conflict detection on reverse sync. Worker
--                       compares etag on pull; if it differs from the last
--                       push, a NeonDB writer raced — NeonDB wins.

-- ─── work_orders ──────────────────────────────────────────────────────────────

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS atlas_id         TEXT,
  ADD COLUMN IF NOT EXISTS cmms_synced_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cmms_synced_etag TEXT;

CREATE INDEX IF NOT EXISTS idx_work_orders_sync_pending
  ON work_orders (tenant_id, cmms_synced_at);

-- Reverse-sync lookup: find a WO by its Atlas ID. Partial index so it stays
-- small until rows are actually pushed.
CREATE INDEX IF NOT EXISTS idx_work_orders_atlas_id
  ON work_orders (atlas_id)
  WHERE atlas_id IS NOT NULL;

-- ─── cmms_equipment ───────────────────────────────────────────────────────────

ALTER TABLE cmms_equipment
  ADD COLUMN IF NOT EXISTS atlas_id         TEXT,
  ADD COLUMN IF NOT EXISTS cmms_synced_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cmms_synced_etag TEXT;

CREATE INDEX IF NOT EXISTS idx_cmms_equipment_sync_pending
  ON cmms_equipment (tenant_id, cmms_synced_at);

CREATE INDEX IF NOT EXISTS idx_cmms_equipment_atlas_id
  ON cmms_equipment (atlas_id)
  WHERE atlas_id IS NOT NULL;

-- ─── pm_schedules ─────────────────────────────────────────────────────────────

ALTER TABLE pm_schedules
  ADD COLUMN IF NOT EXISTS atlas_id         TEXT,
  ADD COLUMN IF NOT EXISTS cmms_synced_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cmms_synced_etag TEXT;

CREATE INDEX IF NOT EXISTS idx_pm_schedules_sync_pending
  ON pm_schedules (tenant_id, cmms_synced_at);

CREATE INDEX IF NOT EXISTS idx_pm_schedules_atlas_id
  ON pm_schedules (atlas_id)
  WHERE atlas_id IS NOT NULL;

-- ─── cmms_sync_state — worker checkpoint table ────────────────────────────────
-- Reverse sync polls Atlas /<resource>/search filtered by updatedAt > cursor.
-- One row per (tenant_id, resource); resource ∈ ('work_orders', 'assets',
-- 'preventive_maintenances'). Updated by the worker after each successful pull.

CREATE TABLE IF NOT EXISTS cmms_sync_state (
  tenant_id     UUID        NOT NULL,
  resource      TEXT        NOT NULL,
  last_poll_at  TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01T00:00:00Z',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, resource)
);

ALTER TABLE cmms_sync_state ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY cmms_sync_state_tenant ON cmms_sync_state
    AS PERMISSIVE FOR ALL
    USING (tenant_id = (current_setting('app.tenant_id', TRUE))::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── cmms_sync_conflicts — reverse-sync rejection log ─────────────────────────
-- When reverse sync sees an Atlas change but the NeonDB row was edited more
-- recently, NeonDB wins and the rejected Atlas payload lands here for review.

CREATE TABLE IF NOT EXISTS cmms_sync_conflicts (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL,
  resource       TEXT        NOT NULL,             -- 'work_orders' | 'assets' | 'preventive_maintenances'
  neondb_id      UUID,                             -- our row's id, if matched
  atlas_id       TEXT        NOT NULL,
  atlas_payload  JSONB       NOT NULL,
  reason         TEXT        NOT NULL,             -- 'neondb_newer' | 'orphan_atlas_id' | 'parse_error'
  detected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cmms_sync_conflicts_tenant
  ON cmms_sync_conflicts (tenant_id, detected_at DESC);

ALTER TABLE cmms_sync_conflicts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY cmms_sync_conflicts_tenant ON cmms_sync_conflicts
    AS PERMISSIVE FOR ALL
    USING (tenant_id = (current_setting('app.tenant_id', TRUE))::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Rollback notes ───────────────────────────────────────────────────────────
-- ALTER TABLE work_orders     DROP COLUMN IF EXISTS atlas_id, cmms_synced_at, cmms_synced_etag;
-- ALTER TABLE cmms_equipment  DROP COLUMN IF EXISTS atlas_id, cmms_synced_at, cmms_synced_etag;
-- ALTER TABLE pm_schedules    DROP COLUMN IF EXISTS atlas_id, cmms_synced_at, cmms_synced_etag;
-- DROP INDEX IF EXISTS idx_work_orders_sync_pending,    idx_work_orders_atlas_id,
--                      idx_cmms_equipment_sync_pending, idx_cmms_equipment_atlas_id,
--                      idx_pm_schedules_sync_pending,   idx_pm_schedules_atlas_id;
-- DROP TABLE IF EXISTS cmms_sync_state, cmms_sync_conflicts;

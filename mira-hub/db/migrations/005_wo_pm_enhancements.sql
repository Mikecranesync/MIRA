-- Migration 005: WO completion validation (#897) + PM multi-trigger scheduling (#898)

-- ─── #897: Work order completion fields ──────────────────────────────────────

-- Separate fault_description from the blob description field, add resolution,
-- and closed_at timestamp for audit trail.
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS fault_description TEXT,
  ADD COLUMN IF NOT EXISTS resolution        TEXT,
  ADD COLUMN IF NOT EXISTS closed_at         TIMESTAMPTZ;

-- Add needs_completion to the workorderstatus enum so stale WOs can be flagged
-- without being auto-closed. Safe no-op if the value already exists.
DO $$ BEGIN
  ALTER TYPE workorderstatus ADD VALUE IF NOT EXISTS 'needs_completion';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Backfill fault_description from description for existing WOs (best-effort).
-- WOs whose description contains "Fault: " already have structured content.
UPDATE work_orders
SET fault_description = TRIM(REGEXP_REPLACE(description, E'^Fault:\\s*', ''))
WHERE fault_description IS NULL
  AND description IS NOT NULL
  AND description != ''
  AND description NOT LIKE 'Resolution:%';  -- don't stomp pure-resolution rows

-- ─── #898: PM multi-trigger scheduling ───────────────────────────────────────

-- trigger_type controls which condition(s) fire the PM:
--   'calendar'          — next_due_at <= NOW() (existing behaviour)
--   'meter'             — meter_current >= meter_threshold
--   'calendar_or_meter' — EITHER condition triggers
ALTER TABLE pm_schedules
  ADD COLUMN IF NOT EXISTS trigger_type        TEXT    NOT NULL DEFAULT 'calendar',
  ADD COLUMN IF NOT EXISTS meter_type         TEXT,            -- 'run_hours'|'cycles'|'miles'|'custom'
  ADD COLUMN IF NOT EXISTS meter_threshold    NUMERIC,         -- e.g. 500 (hours)
  ADD COLUMN IF NOT EXISTS meter_current      NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS meter_last_reset_at TIMESTAMPTZ;

-- CHECK constraint keeps trigger_type to known values (non-blocking ADD)
DO $$ BEGIN
  ALTER TABLE pm_schedules
    ADD CONSTRAINT pm_trigger_type_check
    CHECK (trigger_type IN ('calendar', 'meter', 'calendar_or_meter'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Index for meter-triggered PM queries
CREATE INDEX IF NOT EXISTS idx_pm_meter_due
  ON pm_schedules (tenant_id, meter_current, meter_threshold)
  WHERE trigger_type IN ('meter', 'calendar_or_meter');

-- ─── Rollback notes ───────────────────────────────────────────────────────────
-- ALTER TABLE work_orders DROP COLUMN IF EXISTS fault_description, resolution, closed_at;
-- ALTER TABLE pm_schedules DROP COLUMN IF EXISTS trigger_type, meter_type, meter_threshold, meter_current, meter_last_reset_at;
-- DROP INDEX IF EXISTS idx_pm_meter_due;

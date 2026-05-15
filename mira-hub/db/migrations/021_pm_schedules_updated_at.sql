BEGIN;

-- Migration 021: add updated_at column to pm_schedules.
--
-- The cmms-sync worker (scripts/cmms-sync-worker.ts) reads pm.updated_at to
-- decide which rows need pushing to Atlas (gate: cmms_synced_at < updated_at).
-- The column was missing from the table, causing pushPendingPMs to throw
-- `column pm.updated_at does not exist` on every tick. That exception had no
-- try/catch around it in runForwardSync's resource loop, so it killed the
-- whole tick — forward work_orders + reverse sync never ran.
--
-- Applied directly to prod NeonDB on 2026-05-15 during sync end-to-end
-- testing. This file backfills the migration so a fresh DB matches prod.

ALTER TABLE pm_schedules
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();

COMMIT;

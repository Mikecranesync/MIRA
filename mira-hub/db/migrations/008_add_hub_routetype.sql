-- Migration 008: add 'Hub' to routetype enum
--
-- Companion to migration 006 (which added 'hub_ui' to sourcetype). The
-- WO POST handler at mira-hub/src/app/api/work-orders/route.ts inserts
-- work_orders.route_taken = NULL today, but downstream sync paths and
-- future hub-originated routing decisions need 'Hub' as a valid value.
--
-- Applied directly to NeonDB on 2026-05-07 alongside the demo-readiness
-- hotfix; this file codifies the change so any environment built from
-- migrations end up in the same shape.

DO $$ BEGIN
  ALTER TYPE routetype ADD VALUE IF NOT EXISTS 'Hub';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Rollback notes ───────────────────────────────────────────────────────────
-- Postgres has no DROP VALUE for enums. To remove 'Hub' you'd need to
-- recreate the type with the desired values, ALTER TABLE the column to use
-- the new type, drop the old type, rename. Destructive — any rows with
-- route_taken='Hub' would fail the cast.

-- Migration 006: add 'hub_ui' to sourcetype enum
--
-- Hotfix for the production 500 introduced by PR #1022 (P0 fix that wired
-- up POST /api/work-orders). The route inserts work_orders.source = 'hub_ui',
-- but the sourcetype enum only had:
--   telegram_text, telegram_voice, telegram_photo,
--   telegram_print_qa, telegram_manual_gap, auto_pm
-- Every hub-side WO submit failed with "invalid input value for enum
-- sourcetype: \"hub_ui\"".
--
-- Applied directly to NeonDB on 2026-05-06 as the live hotfix; this file
-- codifies the change so any environment built from migrations end up in
-- the same shape.

DO $$ BEGIN
  ALTER TYPE sourcetype ADD VALUE IF NOT EXISTS 'hub_ui';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Rollback notes ───────────────────────────────────────────────────────────
-- Postgres has no DROP VALUE for enums. To remove 'hub_ui' you'd need to:
--   1. CREATE TYPE sourcetype_new AS ENUM (... without 'hub_ui' ...);
--   2. ALTER TABLE work_orders ALTER COLUMN source TYPE sourcetype_new
--        USING source::text::sourcetype_new;
--   3. DROP TYPE sourcetype; ALTER TYPE sourcetype_new RENAME TO sourcetype;
-- This is destructive — any rows with source='hub_ui' would fail step 2.

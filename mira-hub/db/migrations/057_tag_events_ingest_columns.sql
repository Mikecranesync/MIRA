BEGIN;

-- Migration 057: backfill the ingest columns onto tag_events (drift repair).
--
-- WHY THIS EXISTS
--   `mira-relay/tag_ingest.py` (ingest_batch -> NeonTagStore.persist_batch)
--   INSERTs tag_events with the columns defined by 033_tag_events.sql:
--     value, value_type, quality, source_system, source_connection_id,
--     equipment_entity_id, metadata.
--   On environments where an EARLIER, diff-style `tag_events` (event_type /
--   prev_value / new_value / threshold / window_start|end / severity ...) was
--   created before the current 033, `CREATE TABLE IF NOT EXISTS` in 033 SKIPPED
--   the table, so those ingest columns were never added. The SimLab->relay
--   ingest landing then fails with `column "source_system" does not exist`.
--   (Confirmed on STAGING 2026-06-24: tag_events was missing all 7 columns;
--   live_signal_cache was already correct.) This is the CREATE-TABLE-IF-NOT-EXISTS
--   drift hazard documented in .claude/rules/mira-hub-migrations.md.
--
-- WHAT THIS DOES
--   Purely ADDITIVE: ALTER TABLE ... ADD COLUMN IF NOT EXISTS for each of the 7
--   columns, with the EXACT types / defaults / CHECKs from 033_tag_events.sql.
--   It does NOT drop, rename, rewrite, truncate, or backfill any existing
--   column, and it does not change runtime behavior beyond making the documented
--   ingest write path schema-valid. Idempotent (IF NOT EXISTS) and safe to
--   re-run. On a tag_events that already matches 033, every statement is a no-op.
--
--   NOTE on source_system (NOT NULL, no default — matching 033): this is safe
--   because the only environments needing this migration have an EMPTY tag_events
--   (verified 0 rows on staging). If a target env ever has rows in a drifted
--   tag_events, add a one-off DEFAULT for the ADD COLUMN there — do not weaken
--   the column shape here.
--
-- PROMOTION: dev -> staging -> prod via apply-migrations.yml (dry-run then
--   apply). Applied to STAGING directly 2026-06-24 to unblock the SimLab->UNS
--   ingest staging validation; this file is the durable artifact for prod.

ALTER TABLE tag_events ADD COLUMN IF NOT EXISTS equipment_entity_id UUID;

ALTER TABLE tag_events ADD COLUMN IF NOT EXISTS value TEXT;

ALTER TABLE tag_events ADD COLUMN IF NOT EXISTS value_type TEXT NOT NULL DEFAULT 'string'
    CHECK (value_type IN ('bool', 'int', 'float', 'string', 'enum'));

ALTER TABLE tag_events ADD COLUMN IF NOT EXISTS quality TEXT NOT NULL DEFAULT 'good'
    CHECK (quality IN ('good', 'bad', 'stale', 'uncertain'));

ALTER TABLE tag_events ADD COLUMN IF NOT EXISTS source_system TEXT NOT NULL;

ALTER TABLE tag_events ADD COLUMN IF NOT EXISTS source_connection_id TEXT;

ALTER TABLE tag_events ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMIT;

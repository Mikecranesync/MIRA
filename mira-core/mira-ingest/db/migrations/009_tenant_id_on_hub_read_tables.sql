-- mira-core/mira-ingest/db/migrations/009_tenant_id_on_hub_read_tables.sql
--
-- The hub reads from two tables it does not own:
--   * cmms_equipment — populated by Atlas CMMS / ingest pipeline
--   * kb_chunks      — populated by knowledge ingest pipeline
--
-- Both lacked tenant_id columns, leaving the hub's API routes
-- unable to scope queries by session tenant. This migration adds
-- nullable tenant_id columns defaulting to 'mike' (preserving the
-- single-tenant-of-record convention used by hub_channel_bindings
-- and hub_uploads). Existing rows backfill to 'mike' so Mike's
-- equipment and KB chunks remain visible after he signs in.
--
-- Atlas CMMS and the ingest pipeline can continue inserting
-- without specifying tenant_id — they'll inherit the default.
-- Once those services are tenant-aware, the default can be
-- dropped in a follow-up migration.

BEGIN;

ALTER TABLE cmms_equipment
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'mike';

CREATE INDEX IF NOT EXISTS idx_cmms_equipment_tenant
  ON cmms_equipment (tenant_id);

ALTER TABLE kb_chunks
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'mike';

CREATE INDEX IF NOT EXISTS idx_kb_chunks_tenant
  ON kb_chunks (tenant_id);

COMMIT;

-- Verification:
--   \d cmms_equipment    -- tenant_id column should appear
--   \d kb_chunks
--   SELECT DISTINCT tenant_id FROM cmms_equipment;   -- expect 'mike'
--   SELECT DISTINCT tenant_id FROM kb_chunks;        -- expect 'mike'
--
-- Rollback:
--   DROP INDEX IF EXISTS idx_cmms_equipment_tenant;
--   DROP INDEX IF EXISTS idx_kb_chunks_tenant;
--   ALTER TABLE cmms_equipment DROP COLUMN IF EXISTS tenant_id;
--   ALTER TABLE kb_chunks DROP COLUMN IF EXISTS tenant_id;

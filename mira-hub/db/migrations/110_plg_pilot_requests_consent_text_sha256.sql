-- 110_plg_pilot_requests_consent_text_sha256.sql — governed schema change for
-- the pilot-request consent hash (#4935; Codex MEDIUM F2 on PR #4930).
--
-- Table ownership: plg_pilot_requests belongs to mira-web. It is created at
-- runtime by mira-web/src/capabilities/pilot-request.ts ensurePilotRequestSchema
-- (#4877); no file in this directory creates it. mira-web and mira-hub read the
-- same NEON_DATABASE_URL in each environment (docker-compose.saas.yml, and
-- docker-compose.staging-vps.yml under Doppler factorylm/stg), and
-- apply-migrations.yml is the governed dev -> staging -> prod path for that
-- database, so the column lands here even though mira-hub never reads it.
--
-- Why: PR #4930 makes every INSERT INTO plg_pilot_requests name
-- consent_text_sha256, but adds the column only through a runtime ALTER that
-- mira-web/src/server.ts starts without awaiting and whose failure is logged
-- and swallowed. Applied on staging and prod BEFORE any deploy that contains
-- #4930, this file makes the column a precondition instead of a race.
--
-- Shape: identical to #4930's runtime statement — TEXT, nullable, NO DEFAULT,
-- no back-fill. Rows that already exist were stamped pilot-consent-v1, whose
-- wording was never recorded, so NULL ("not recorded") is the honest value.
--
-- ALTER TABLE IF EXISTS: on a database where mira-web has never booted, the
-- table does not exist and this file is a no-op. #4930's own CREATE TABLE
-- already declares consent_text_sha256, so a table created later by #4930 code
-- has the column. F2 needs an EXISTING table, and this file always upgrades
-- one. Post-apply check (read-only), expected 1 row on a DB that has the table:
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_name = 'plg_pilot_requests' AND column_name = 'consent_text_sha256';
--
-- Compatibility: expand. main's INSERT does not name this column (it stays
-- NULL) and no main code reads it.
--
-- lock_timeout: ADD COLUMN with no default is a catalog-only change, but it
-- still takes a brief ACCESS EXCLUSIVE lock. SET LOCAL makes a lock conflict
-- fail this run loudly instead of queueing live traffic behind it.
--
-- Rollback (valid ONLY before any deploy that contains #4930 — after that,
-- every insert names this column and dropping it 500s /api/pilot-request;
-- forward-fix only. Dropping also discards any recorded consent hashes):
--   BEGIN;
--   ALTER TABLE IF EXISTS plg_pilot_requests DROP COLUMN IF EXISTS consent_text_sha256;
--   DELETE FROM schema_migrations
--    WHERE migration_name = '110_plg_pilot_requests_consent_text_sha256.sql';
--   COMMIT;
-- The ledger DELETE matters: without it a later migrations=all run skips this
-- file as already applied.

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE IF EXISTS plg_pilot_requests
  ADD COLUMN IF NOT EXISTS consent_text_sha256 TEXT;

COMMIT;

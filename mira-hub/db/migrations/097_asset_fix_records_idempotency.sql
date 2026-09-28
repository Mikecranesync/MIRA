-- Migration 097: a recorded fix is saved at most once per client request.
--
-- Codex adversarial review of #4057 (post-split F2): the database could commit
-- a fix while the client lost the 201, and a retry inserted a second row.
-- asset_fix_records is append-only for the app (095 grants SELECT, INSERT), so
-- a duplicate could never be removed through the product.
--
-- The client now sends a stable `clientRequestId` (UUID) per fix. It is unique
-- per (tenant, notebook); the insert uses ON CONFLICT DO NOTHING against this
-- partial index and a retry returns the record already stored. Rows written
-- before this migration (and clients that send no id) keep a NULL id, which the
-- partial index ignores — behaviour for them is unchanged.
--
-- A new file rather than an edit to 095/096: migration-verify has already
-- applied both to staging, and an applied migration is immutable
-- (.claude/rules/mira-hub-migrations.md §8). Idempotent.

BEGIN;

ALTER TABLE asset_fix_records
  ADD COLUMN IF NOT EXISTS client_request_id UUID NULL;

CREATE UNIQUE INDEX IF NOT EXISTS asset_fix_records_client_request_uniq
  ON asset_fix_records (tenant_id, notebook_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

COMMIT;

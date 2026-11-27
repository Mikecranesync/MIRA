-- #6085: numbers the technician ticked on the identity card ("6AV2124-0GC01-0AX0 is this
-- machine's number"). Read only by the thread status scope (manual-status-subject.ts); never by
-- the catalog number, the lookup key, the manual search, manual matching or retrieval.
-- Entries: {"number","manufacturer","model","confirmedAt"}; the identity is stored with the
-- number so entries for an identity the notebook no longer has are ignored on read.
-- Additive. Table-level grants on equipment_notebooks (073) cover the column. The revoke
-- trigger (101) fires only on UPDATE OF manufacturer, model, catalog_number, identity_status.
BEGIN;
ALTER TABLE equipment_notebooks
  ADD COLUMN IF NOT EXISTS confirmed_numbers JSONB NOT NULL DEFAULT '[]'::jsonb;
COMMIT;

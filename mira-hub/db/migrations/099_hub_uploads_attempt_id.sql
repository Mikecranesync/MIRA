-- Migration 099: hub_uploads.attempt_id — one identity per import attempt.
--
-- Why: an upload's pipeline runs fire-and-forget. Before this, nothing tied a
-- running pipeline to the attempt that started it, so after a cancel, a delete,
-- or a re-pick/retry requeue, a still-running older pipeline could overwrite the
-- newer attempt's status or write chunks back under a deleted upload id
-- (Codex review of #4084/#4085/#4088; issues #4080/#4081).
--
-- Contract (mira-hub/src/lib/uploads.ts):
--   * createUpload and every requeue claim mint a fresh attempt_id;
--   * cancel rotates it (revokes the running attempt) and removes that attempt's
--     chunks; delete removes the row;
--   * a pipeline's status writes and chunk inserts succeed only while the row
--     still carries ITS attempt_id and is not cancelled (chunk inserts hold the
--     row FOR SHARE for their transaction, so delete/cancel serialize with them).
--
-- Additive and nullable. Existing rows keep NULL (their pipelines ended with the
-- deploy that ships this); only new rows get a value, via the column default.
-- Idempotent, single transaction (mira-hub-migrations.md §5, §8).
-- Rollback: ALTER TABLE hub_uploads DROP COLUMN IF EXISTS attempt_id;

BEGIN;

ALTER TABLE hub_uploads
  ADD COLUMN IF NOT EXISTS attempt_id UUID;

ALTER TABLE hub_uploads
  ALTER COLUMN attempt_id SET DEFAULT gen_random_uuid();

COMMIT;

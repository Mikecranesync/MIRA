-- 087: THRD-0 — stable conversation identity inside an Equipment Notebook.
--
-- A notebook remains the shared Project/context container. This adds only the
-- missing thread identity on persisted turns so multiple conversations can
-- coexist under one notebook without changing retrieval, providers, sources,
-- machine evidence, or ownership. NULL means the pre-087 legacy/default thread.
--
-- Idempotent; additive; no backfill. Existing rows stay in the legacy thread.
BEGIN;

ALTER TABLE equipment_notebook_turns
  ADD COLUMN IF NOT EXISTS thread_id TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'equipment_notebook_turns_thread_id_shape'
       AND conrelid = 'equipment_notebook_turns'::regclass
  ) THEN
    ALTER TABLE equipment_notebook_turns
      ADD CONSTRAINT equipment_notebook_turns_thread_id_shape
      CHECK (thread_id IS NULL OR thread_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$');
  END IF;
END $$;

COMMENT ON COLUMN equipment_notebook_turns.thread_id IS
  'Client-generated conversation id within one notebook/project. NULL = pre-087 legacy/default thread.';

CREATE INDEX IF NOT EXISTS idx_equipment_notebook_turns_thread
  ON equipment_notebook_turns (tenant_id, notebook_id, owner_user_id, thread_id, created_at DESC);

COMMIT;

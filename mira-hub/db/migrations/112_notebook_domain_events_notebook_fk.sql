-- Migration 112: the notebook event outbox follows its notebook's lifetime.
--
-- Codex adversarial review of #5024, round 5 (F12): 111 gave
-- notebook_domain_events.notebook_id no foreign key, so deleting a notebook
-- (deleteNotebook in src/lib/equipment-notebooks.ts) removed its fix records
-- (096's cascade) but left the event payload — symptom, repair text,
-- technician — and its queued delivery behind. A later dispatch tick could
-- then export a deleted repair to the customer's CMMS.
--
-- Same fix as 096 for asset_fix_records: an ON DELETE CASCADE foreign key.
-- Deleting the notebook removes its events in the same statement, and the
-- events' deliveries go with them (111's delivery → event cascade).
-- Referential actions run with the table owner's rights, so factorylm_app
-- still needs no DELETE grant on either table. An INSERT racing a notebook
-- delete fails the FK — and the fix-record insert in the same transaction
-- with it — instead of creating an orphan. A dispatcher that planned before
-- the delete finds its delivery row gone at PIN time and never writes.
--
-- A new file rather than an edit to 111: migration-verify has already applied
-- 111 to staging, and an applied migration is immutable
-- (.claude/rules/mira-hub-migrations.md §8).
--
-- Any pre-existing orphan (a notebook deleted after 111 ran) is exactly the
-- leak F12 describes, so it is removed before the constraint is added —
-- otherwise the constraint could not validate.
--
-- Idempotent: the constraint is added only when absent.
--
-- Rollback (old code never relies on the constraint):
--   ALTER TABLE notebook_domain_events DROP CONSTRAINT IF EXISTS notebook_domain_events_notebook_fk;
BEGIN;
SET LOCAL lock_timeout = '5s';
DELETE FROM notebook_domain_events e
 WHERE NOT EXISTS (SELECT 1 FROM equipment_notebooks n WHERE n.id = e.notebook_id);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'notebook_domain_events_notebook_fk'
       AND conrelid = 'notebook_domain_events'::regclass
  ) THEN
    ALTER TABLE notebook_domain_events
      ADD CONSTRAINT notebook_domain_events_notebook_fk
      FOREIGN KEY (notebook_id) REFERENCES equipment_notebooks(id) ON DELETE CASCADE;
  END IF;
END
$$;
COMMIT;

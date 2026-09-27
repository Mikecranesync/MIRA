-- Migration 096: asset_fix_records follow their notebook's lifetime.
--
-- Codex adversarial review of #4057 (F1): 095 gave notebook_id no foreign key
-- and the app role no DELETE, so deleting a notebook left its fix records —
-- symptom, repair text, recorder — behind, and a fix POST racing a notebook
-- delete could create an orphan after the route's ownership check.
--
-- An ON DELETE CASCADE foreign key closes both: the delete removes the records
-- in the same statement (referential actions run with the table owner's
-- rights, so factorylm_app still needs no DELETE grant and the table stays
-- append-only for the app), and an INSERT that loses the race fails the FK
-- instead of creating an orphan.
--
-- A new file rather than an edit to 095: migration-verify has already applied
-- 095 to staging, and an applied migration is immutable
-- (.claude/rules/mira-hub-migrations.md §8).
--
-- Any pre-existing orphan (a notebook deleted between 095 and this migration)
-- is exactly the leak F1 describes, so it is removed before the constraint is
-- added — otherwise the constraint could not validate.
--
-- Idempotent: the constraint is added only when absent.

BEGIN;

DELETE FROM asset_fix_records f
 WHERE NOT EXISTS (SELECT 1 FROM equipment_notebooks n WHERE n.id = f.notebook_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'asset_fix_records_notebook_fk'
       AND conrelid = 'asset_fix_records'::regclass
  ) THEN
    ALTER TABLE asset_fix_records
      ADD CONSTRAINT asset_fix_records_notebook_fk
      FOREIGN KEY (notebook_id) REFERENCES equipment_notebooks(id) ON DELETE CASCADE;
  END IF;
END
$$;

COMMIT;

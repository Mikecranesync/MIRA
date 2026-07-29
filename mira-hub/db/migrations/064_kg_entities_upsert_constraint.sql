BEGIN;

-- Migration 064: Promote kg_entities natural-key unique index to a named constraint.
--
-- Issue #2564: kg_writer.py:upsert_entity uses ON CONFLICT (tenant_id, entity_type, name),
-- but prod reports "no unique or exclusion constraint matching the ON CONFLICT specification"
-- despite the unique index kg_entities_tenant_type_name_key existing. Promoting the index
-- to a named constraint makes ON CONFLICT inference unambiguous; kg_writer targets
-- ON CONFLICT ON CONSTRAINT kg_entities_tenant_type_name_uq once this applies (and probes
-- pg_constraint first, so environments where this migration hasn't run yet keep the
-- pre-064 column-inference behavior).
--
-- Background:
--   Migrations 025/026 created UNIQUE INDEX kg_entities_tenant_type_name_key on
--   (tenant_id, entity_type, name) to replace the (tenant_id, entity_type, entity_id)
--   constraint that kg_writer never populated.
--
-- Idempotency (rule 5, .claude/rules/mira-hub-migrations.md):
--   ADD CONSTRAINT ... UNIQUE USING INDEX has no IF NOT EXISTS form, and it RENAMES the
--   index to the constraint name — so a bare re-run fails twice over (constraint exists;
--   index gone). The DO block below makes every path a safe no-op on re-run:
--     1. Constraint already exists            -> no-op.
--     2. Index exists (first application)     -> promote it (index is renamed).
--     3. Neither exists (fresh/odd schema)    -> create the constraint outright.
--
-- Tenant type / RLS: structural change only — no RLS or GRANT changes needed.
--
-- NOTE: numbered 064 because PR #2635 ships 063_ai_suggestions_wiring_connection_type.sql
-- (duplicate prefixes are cosmetic per rule 7, but new migrations take the next free int).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'kg_entities_tenant_type_name_uq'
      AND conrelid = 'kg_entities'::regclass
  ) THEN
    IF EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = 'kg_entities_tenant_type_name_key'
        AND c.relkind = 'i'
    ) THEN
      ALTER TABLE kg_entities
        ADD CONSTRAINT kg_entities_tenant_type_name_uq
        UNIQUE USING INDEX kg_entities_tenant_type_name_key;
    ELSE
      ALTER TABLE kg_entities
        ADD CONSTRAINT kg_entities_tenant_type_name_uq
        UNIQUE (tenant_id, entity_type, name);
    END IF;
  END IF;
END
$$;

COMMIT;

-- ─── Rollback (safe) ───────────────────────────────────────────────────
-- BEGIN;
-- ALTER TABLE kg_entities DROP CONSTRAINT IF EXISTS kg_entities_tenant_type_name_uq;
-- CREATE UNIQUE INDEX IF NOT EXISTS kg_entities_tenant_type_name_key
--   ON kg_entities (tenant_id, entity_type, name);
-- COMMIT;
-- (Dropping the constraint drops its backing index; the CREATE INDEX restores the
--  pre-064 shape so column-inference upserts keep working. kg_writer's probe caches
--  per-process — restart crawler services after a rollback.)

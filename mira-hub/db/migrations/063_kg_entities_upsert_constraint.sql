BEGIN;

-- Migration 063: Promote kg_entities natural-key unique index to a named constraint.
--
-- Issue #2564: kg_writer.py:upsert_entity uses ON CONFLICT (tenant_id, entity_type, name),
-- but prod reports "no unique or exclusion constraint matching the ON CONFLICT specification"
-- despite the unique index kg_entities_tenant_type_name_key existing. The error is anomalous
-- (index is non-partial, on the right columns), but the fix is clear: promote the index to
-- a named constraint so inference is unambiguous.
--
-- Background:
--   Migrations 025/026 created UNIQUE INDEX kg_entities_tenant_type_name_key on
--   (tenant_id, entity_type, name) to replace the (tenant_id, entity_type, entity_id)
--   constraint that kg_writer never populated. The index works fine for queries (BTree lookup).
--   However, ON CONFLICT inference in PostgreSQL may have subtleties with:
--   - Unnamed indexes (though this shouldn't matter)
--   - Column type / collation / opclass matching
--   - Stale query plans on long-lived connections
--
--   PostgreSQL 15+ supports "ADD CONSTRAINT ... UNIQUE USING INDEX", which converts
--   an existing unique index to a named constraint without rebuilding the index.
--   This guarantees inference will recognize it and eliminates ambiguity.
--
-- This migration:
--   1. Creates a named constraint kg_entities_tenant_type_name_uq using the existing index.
--   2. Is idempotent (ADD CONSTRAINT IF NOT EXISTS in PostgreSQL 15+ equivalent).
--   3. Does not drop the index (the constraint owns it now).
--
-- Idempotency:
--   If the constraint already exists, the ADD CONSTRAINT statement is a no-op.
--   Re-running against the same environment is safe.
--
-- Tenant type / RLS:
--   kg_entities.tenant_id is UUID (system-tenant rows have is_private=false, per the
--   knowledge_entries hybrid corpus law). The constraint is a structural change (no
--   RLS additions), so no GRANT changes needed.

ALTER TABLE kg_entities
  ADD CONSTRAINT kg_entities_tenant_type_name_uq
  UNIQUE USING INDEX kg_entities_tenant_type_name_key;

COMMIT;

-- ─── Rollback (safe) ───────────────────────────────────────────────────
-- BEGIN;
-- ALTER TABLE kg_entities DROP CONSTRAINT IF EXISTS kg_entities_tenant_type_name_uq;
-- COMMIT;
-- (The index kg_entities_tenant_type_name_key remains, available for future use or re-creation.)

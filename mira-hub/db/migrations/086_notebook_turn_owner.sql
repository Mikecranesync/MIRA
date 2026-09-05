-- 086: private technician conversations on a SHARED Equipment Notebook.
--
-- The Notebook itself (manuals, evidence, asset identity, machine history)
-- stays shared by the tenant. Each NEW chat turn belongs to the technician who
-- asked it: `owner_user_id` is the authenticated hub_users.id the SERVER derived
-- from the session at write time (mira-hub/src/lib/equipment-notebooks.ts
-- recordTurn) — never a client-supplied value.
--
-- Type: TEXT, because hub_users.id is TEXT (mira-hub/src/lib/users.ts) and
-- session.userId is the same string. No FK: hub_users lives in the auth-side
-- schema that users.ts creates lazily, not in this migration lineage, and a
-- turn must outlive account churn as history.
--
-- NULL = LEGACY SHARED HISTORY. Every pre-086 turn stays exactly as it is:
-- readable by every tenant user (listTurns labels it `sharedLegacy`), never
-- deleted, never silently assigned an owner. There is deliberately no backfill.
--
-- Read rule (listTurns): a viewer sees rows WHERE owner_user_id = viewer
-- OR owner_user_id IS NULL, always inside the tenant. Another user's owned rows
-- are never returned. Tenant isolation is unchanged (073 RLS + explicit
-- tenant_id predicates); this column narrows WITHIN a tenant, it never widens.
--
-- Idempotent; single transaction.
BEGIN;

ALTER TABLE equipment_notebook_turns
  ADD COLUMN IF NOT EXISTS owner_user_id TEXT NULL;

COMMENT ON COLUMN equipment_notebook_turns.owner_user_id IS
  'hub_users.id of the technician who asked (server-derived at write). NULL = legacy shared history, readable by every tenant user; never backfilled.';

-- History reads are (tenant, notebook, viewer-or-null, recent-first).
CREATE INDEX IF NOT EXISTS idx_equipment_notebook_turns_owner
  ON equipment_notebook_turns (tenant_id, notebook_id, owner_user_id, created_at DESC);

COMMIT;

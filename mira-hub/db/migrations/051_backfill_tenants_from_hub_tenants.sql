-- Migration 051: backfill the data-side `tenants` table from auth-side `hub_tenants`.
--
-- #1899b — folder=brain (and Knowledge) PDF upload 500 for fresh signups.
--
-- Two tenant tables share one NeonDB:
--   * hub_tenants (auth side, TEXT id) — created by signup (mira-hub/src/lib/users.ts createUser).
--   * tenants     (data side, TEXT id) — FK target of knowledge_entries.tenant_id
--                  (constraint knowledge_entries_tenant_id_fkey, verified present on prod).
--
-- Signup historically created ONLY hub_tenants, never a matching `tenants` row. So a
-- brand-new tenant's first manual/document upload threw
--   ERROR 23503: insert or update on knowledge_entries violates foreign key
--   constraint "knowledge_entries_tenant_id_fkey" — Key is not present in table "tenants"
-- → HTTP 500 ("Server storage error while saving the document"). This blocked the beta
-- gate (a stranger could not attach their own manual). createUser now creates the
-- `tenants` row at signup; this migration backfills every PRE-EXISTING hub_tenants that
-- has no matching tenants row, so already-registered fresh tenants can upload too.
--
-- Idempotent + safe: ON CONFLICT DO NOTHING; only inserts missing ids; never updates
-- or deletes. tenants.name AND tenants.contact_email are NOT NULL (no default), so both
-- must be supplied; the owner's email comes from hub_users via hub_tenants.owner_user_id,
-- with a non-null fallback so the backfill never violates the NOT NULL on contact_email.

BEGIN;

INSERT INTO tenants (id, name, contact_email)
SELECT ht.id,
       ht.name,
       COALESCE(hu.email, ht.id || '@unknown.local')
  FROM hub_tenants ht
  LEFT JOIN hub_users hu ON hu.id = ht.owner_user_id
 WHERE NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = ht.id)
ON CONFLICT (id) DO NOTHING;

COMMIT;

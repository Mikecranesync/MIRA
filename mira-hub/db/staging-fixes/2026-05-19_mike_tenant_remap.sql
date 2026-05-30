-- Staging-only minimal fix: remap hub_users.tenant_id='mike' (legacy string) to a real UUID.
-- Root cause: hub_tenants.id is TEXT but kg_entities and namespace tables are UUID. A
-- legacy seed used the slug 'mike' as a tenant id; the value works for TEXT-typed tables
-- but the API casts $1::uuid in `kg_entities` queries and blows up with
-- `invalid input syntax for type uuid: "mike"`.
-- Affected endpoints: /api/namespace/tree, /api/readiness, /api/wizard/[step],
-- /api/proposals, /api/usage. See issues #1421, #1422, #1423, #1426, #1431.
--
-- This script ONLY touches hub_users and hub_tenants. It does NOT migrate orphaned data in
-- TEXT-typed tables (hub_uploads, kb_chunks, cmms_equipment, work_orders, etc.). Those rows
-- stay where they are and become invisible until a follow-up data migration moves them. The
-- trade-off is intentional: a narrow fix that unblocks the API without destroying anything
-- via conflict-resolution shortcuts.
--
-- Safe to run multiple times — gated on tenant_id='mike'.

\set ON_ERROR_STOP on
BEGIN;

-- Idempotent: create a fresh, dedicated staging tenant if it doesn't already exist.
INSERT INTO hub_tenants (name, slug)
SELECT 'Mike (Staging)', 'mike-staging'
WHERE NOT EXISTS (SELECT 1 FROM hub_tenants WHERE slug = 'mike-staging');

DO $$
DECLARE
    target_uuid TEXT;
    n INT;
BEGIN
    SELECT id INTO target_uuid FROM hub_tenants WHERE slug = 'mike-staging';
    IF target_uuid IS NULL THEN
        RAISE EXCEPTION 'failed to resolve mike-staging tenant id';
    END IF;
    -- Sanity: the resolved id must be a valid UUID, otherwise we'd just shift the problem.
    PERFORM target_uuid::uuid;

    UPDATE hub_users SET tenant_id = target_uuid WHERE tenant_id = 'mike';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'hub_users remapped: % rows (mike → %)', n, target_uuid;

    PERFORM 1 FROM hub_users WHERE tenant_id = 'mike';
    IF FOUND THEN
        RAISE EXCEPTION 'hub_users still has tenant_id=''mike'' after remap';
    END IF;
END $$;

COMMIT;

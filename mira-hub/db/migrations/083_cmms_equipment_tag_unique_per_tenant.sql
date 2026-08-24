-- 083: asset tags are unique PER TENANT, not globally.
--
-- WHAT WAS WRONG. `cmms_equipment` carries TWO unique indexes on
-- equipment_number in the deployed database:
--
--   cmms_equipment_equipment_number_key     (equipment_number)              <- global
--   idx_cmms_equipment_number_tenant_unique (tenant_id, equipment_number)   <- per tenant
--
-- Only the second is declared by a migration (012_qr_permanent_binding.sql:44).
-- The first is a table-level UNIQUE from the original CMMS schema — Postgres's
-- default constraint name — that no migration in this repo creates and no
-- migration ever dropped. 012 added the per-tenant index alongside it and left
-- the global one in place, so the stricter constraint kept winning.
--
-- WHY IT MATTERS. Asset tags are customer-chosen and collide constantly across
-- plants: CV-101, P-101, M-1. With a global constraint the FIRST tenant to
-- create "CV-101" permanently denies that tag to every other tenant. Two
-- symptoms, both observed on production 2026-08-23:
--
--   * Onboarding breaks. A brand-new tenant creating an asset tagged CV-101 got
--     `409 tag already exists` for a tag it does not have — while the
--     tenant-scoped read of the same tag returned 404. Read is scoped; write
--     was not.
--   * It is an existence oracle. Because the failure is observable, any
--     signed-up user could probe 409-vs-201 to learn which asset tags exist in
--     OTHER tenants. Asset tags describe real equipment.
--
-- WHY NOT "JUST" A DROP. Dropping the wrong index would remove tag uniqueness
-- altogether and let one tenant hold two CV-101s, which breaks QR resolution
-- (`/api/assets/by-tag/[tag]` does LIMIT 1 and would silently pick one). So this
-- migration asserts the per-tenant index still exists afterwards rather than
-- assuming 012 ran here.
--
-- Also refuses to run if any foreign key references equipment_number: such an
-- FK can only point at the global constraint, and dropping it underneath would
-- either fail or cascade. None exist today (012's own note says FKs target
-- `id`), but "none today" is not something a migration should assume.
--
-- Read-only verification of the deployed state before this ran:
--   .github/workflows/db-inspect.yml -> "cmms_equipment tag uniqueness"
--
-- Rollback: recreating the global constraint requires that no two tenants share
-- a tag by then. See the rollback note at the bottom.

BEGIN;

-- Guard 1: no FK may depend on the constraint being dropped.
DO $$
DECLARE
  eq_attnum smallint;
  dep       record;
BEGIN
  SELECT attnum INTO eq_attnum
    FROM pg_attribute
   WHERE attrelid = 'public.cmms_equipment'::regclass
     AND attname  = 'equipment_number'
     AND NOT attisdropped;

  IF eq_attnum IS NULL THEN
    RAISE EXCEPTION '083: cmms_equipment.equipment_number does not exist — refusing to guess.';
  END IF;

  FOR dep IN
    SELECT c.conname, c.conrelid::regclass::text AS child
      FROM pg_constraint c
     WHERE c.confrelid = 'public.cmms_equipment'::regclass
       AND c.contype   = 'f'
       AND eq_attnum   = ANY (c.confkey)
  LOOP
    RAISE EXCEPTION
      '083: foreign key %.% references cmms_equipment(equipment_number); resolve it before dropping the global unique.',
      dep.child, dep.conname;
  END LOOP;
END $$;

-- The global uniqueness. It may exist as a table constraint or as a bare index
-- depending on how the original schema was created, so both forms are handled;
-- IF EXISTS makes a re-run a no-op.
ALTER TABLE public.cmms_equipment
  DROP CONSTRAINT IF EXISTS cmms_equipment_equipment_number_key;
DROP INDEX IF EXISTS public.cmms_equipment_equipment_number_key;

-- The per-tenant replacement. Created here rather than assumed, because this
-- migration must not be able to leave the table with NO tag uniqueness — that
-- would let one tenant hold two CV-101s and make QR resolution ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cmms_equipment_number_tenant_unique
  ON public.cmms_equipment (tenant_id, equipment_number)
  WHERE equipment_number IS NOT NULL;

-- Guard 2: prove the end state, rather than trusting the two statements above.
DO $$
DECLARE
  global_left  integer;
  tenant_index integer;
BEGIN
  SELECT count(*) INTO global_left
    FROM pg_index ix
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_class t ON t.oid = ix.indrelid
   WHERE t.relname = 'cmms_equipment'
     AND ix.indisunique
     AND pg_get_indexdef(ix.indexrelid) LIKE '%equipment_number%'
     AND pg_get_indexdef(ix.indexrelid) NOT LIKE '%tenant_id%';

  SELECT count(*) INTO tenant_index
    FROM pg_indexes
   WHERE schemaname = 'public'
     AND tablename  = 'cmms_equipment'
     AND indexname  = 'idx_cmms_equipment_number_tenant_unique';

  IF global_left > 0 THEN
    RAISE EXCEPTION '083: % global unique index(es) on equipment_number survive; tags would still collide across tenants.', global_left;
  END IF;
  IF tenant_index <> 1 THEN
    RAISE EXCEPTION '083: the per-tenant unique index is missing; a tenant could hold two assets with the same tag.';
  END IF;
END $$;

COMMIT;

-- ─── Rollback notes ───────────────────────────────────────────────────────────
-- ALTER TABLE public.cmms_equipment
--   ADD CONSTRAINT cmms_equipment_equipment_number_key UNIQUE (equipment_number);
-- This will FAIL once two tenants legitimately hold the same tag, which is the
-- whole point of the migration. Rolling back means first choosing which tenant
-- loses its tag.

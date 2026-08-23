-- staging-cv101-probe.sql — CV-101 bench-conveyor equipment row for the PR 5 live probe
--
-- WHY: the 2026-08-02 live probe (PRD #3048 PR 5, runbook
-- docs/runbooks/factorylm-machine-evidence-integration-proof.md) publishes real
-- Micro820 bench snapshots into the staging live_signal_cache under
-- enterprise.home_garage.conveyor_lab.conveyor_1 (the approved_tags seed's
-- subtree). The FactoryLM live overlay resolves the turn's asset to that
-- subtree via cmms_equipment (equipment_number → uns_path). Staging had NO
-- CV-101 row, so the overlay could never attach. This seeds the ONE probe row.
--
-- Idempotent: NOT EXISTS guard; re-running is a no-op.
-- Run via .github/workflows/apply-seeds.yml:
--   target=staging  seeds=staging-cv101-probe
--   tenant_id=78917b56-f85f-43bb-9a08-1bb98a6cd6c3   (staging probe tenant)
--
-- STAGING-ONLY by intent: prod already carries CV-101 under the garage tenant
-- (tools/seeds/garage-cv101-kg-bridge.sql). Do not apply to prod.

-- NOTE: apply-seeds.yml passes tenant_id PRE-QUOTED (the bridge-seed
-- convention) — so reference it BARE (:tenant_id), never :tenant_id,
-- or the stored value gains literal quotes.
\set tenant_id_default '''78917b56-f85f-43bb-9a08-1bb98a6cd6c3'''
\if :{?tenant_id}
\else
\set tenant_id :tenant_id_default
\endif

BEGIN;

-- Every statement keys on equipment_number alone: repair or claim the one
-- CV-101 row (fixes the quoted-tenant row from the bad first apply), else
-- insert it. Idempotent either way. The tenant-free predicate IS the repair
-- mechanism here — do not add a tenant filter, or a mis-tenanted row becomes
-- unreachable instead of reclaimed.
--
-- CORRECTION (2026-08-23): an earlier version of this comment cited a GLOBAL
-- unique constraint `cmms_equipment_equipment_number_key`. No migration creates
-- it. What exists is the PER-TENANT partial unique index
-- `idx_cmms_equipment_number_tenant_unique` (012_qr_permanent_binding.sql:44),
-- so two tenants may each hold a CV-101 and the singular phrasing above is an
-- assumption, not a guarantee. The assertion below makes it true at run time
-- rather than trusting a constraint that was never there.
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM cmms_equipment WHERE equipment_number = 'CV-101';
  IF n > 1 THEN
    RAISE EXCEPTION
      'staging-cv101-probe: % CV-101 rows exist; the tenant-free UPDATE below would claim an arbitrary one. Resolve the duplicate first.', n;
  END IF;
END $$;
UPDATE cmms_equipment
   SET tenant_id = :tenant_id,
       uns_path = 'enterprise.home_garage.conveyor_lab.conveyor_1'::ltree,
       description = 'Conv_Simple Bench Conveyor (staging probe seed 2026-08-02, PRD #3048 PR 5)'
 WHERE equipment_number = 'CV-101';

INSERT INTO cmms_equipment
  (tenant_id, equipment_number, manufacturer, model_number, equipment_type,
   description, uns_path)
SELECT
  :tenant_id,
  'CV-101',
  'Automation Direct',
  'GS10 + Micro820',
  'conveyor',
  'Conv_Simple Bench Conveyor (staging probe seed 2026-08-02, PRD #3048 PR 5)',
  'enterprise.home_garage.conveyor_lab.conveyor_1'::ltree
WHERE NOT EXISTS (
  SELECT 1 FROM cmms_equipment WHERE equipment_number = 'CV-101'
);

COMMIT;

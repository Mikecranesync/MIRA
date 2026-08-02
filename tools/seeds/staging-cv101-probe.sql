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

\set tenant_id_default '''78917b56-f85f-43bb-9a08-1bb98a6cd6c3'''
\if :{?tenant_id}
\else
\set tenant_id :tenant_id_default
\endif

BEGIN;

INSERT INTO cmms_equipment
  (tenant_id, equipment_number, manufacturer, model_number, equipment_type,
   description, uns_path)
SELECT
  :'tenant_id',
  'CV-101',
  'Automation Direct',
  'GS10 + Micro820',
  'conveyor',
  'Conv_Simple Bench Conveyor (staging probe seed 2026-08-02, PRD #3048 PR 5)',
  'enterprise.home_garage.conveyor_lab.conveyor_1'::ltree
WHERE NOT EXISTS (
  SELECT 1 FROM cmms_equipment
   WHERE tenant_id = :'tenant_id' AND equipment_number = 'CV-101'
);

-- Backfill uns_path if the row pre-exists without one (same idempotent shape
-- as garage-cv101-kg-bridge.sql).
UPDATE cmms_equipment
   SET uns_path = 'enterprise.home_garage.conveyor_lab.conveyor_1'::ltree
 WHERE tenant_id = :'tenant_id'
   AND equipment_number = 'CV-101'
   AND uns_path IS NULL;

COMMIT;

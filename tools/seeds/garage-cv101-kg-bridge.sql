-- garage-cv101-kg-bridge.sql — asset → KG → UNS bridge for the CV-101 bench conveyor
--
-- WHY: the MachineMemoryCard API (/api/assets/[id]/machine-memory) resolves the
-- asset by looking up a kg_entities row WHERE entity_type='equipment' AND
-- (id::text = <asset id> OR entity_id = <asset id>), then reads machine memory
-- by that row's uns_path. The garage tenant has NO equipment kg_entities row
-- (verified via db-inspect scoreboard 2026-07-04), so the card renders empty
-- while machine_state_window rows derive live for
-- enterprise.home_garage.conveyor_lab.conveyor_1. This seed creates the ONE
-- bridge row, and backfills cmms_equipment.uns_path for the same asset
-- (UNS-compliance: every asset row carries uns_path).
--
-- Idempotent: NOT EXISTS guards; re-running is a no-op.
-- Run via .github/workflows/apply-seeds.yml:
--   seeds=garage-cv101-kg-bridge
--   tenant_id=e88bd0e8-8a84-4e30-9803-c0dc6efb07fe   (the garage tenant UUID)
--
-- Approved by Mike (owner) in the 2026-07-04 live-proof session — explicit
-- admin action, not an AI auto-verify (kg write rules honored: this is an
-- entity bridge row, no relationships asserted).

\set tenant_id_default '''e88bd0e8-8a84-4e30-9803-c0dc6efb07fe'''
\if :{?tenant_id}
\else
\set tenant_id :tenant_id_default
\endif

BEGIN;

-- 1. The kg_entities equipment bridge row (asset id ↔ uns_path).
INSERT INTO kg_entities
  (tenant_id, entity_type, entity_id, name, properties, uns_path, created_at, updated_at)
SELECT
  (:tenant_id)::uuid,
  'equipment',
  ce.id::text,
  coalesce(nullif(ce.description, ''), 'Conv_Simple Bench Conveyor (Micro820 + GS10 drive)'),
  jsonb_build_object(
    'seed', 'garage-cv101-kg-bridge',
    'equipment_number', ce.equipment_number,
    'manufacturer', ce.manufacturer,
    'model_number', ce.model_number
  ),
  'enterprise.home_garage.conveyor_lab.conveyor_1'::ltree,
  now(), now()
FROM cmms_equipment ce
WHERE ce.tenant_id = :tenant_id            -- cmms_equipment.tenant_id is TEXT
  AND ce.equipment_number = 'CV-101'
  AND NOT EXISTS (
    SELECT 1 FROM kg_entities k
     WHERE k.tenant_id = (:tenant_id)::uuid
       AND k.entity_type = 'equipment'
       AND k.entity_id = ce.id::text
  );

-- 2. Backfill the asset row's own uns_path (only if not already set).
UPDATE cmms_equipment
   SET uns_path = 'enterprise.home_garage.conveyor_lab.conveyor_1'::ltree,
       updated_at = now()
 WHERE tenant_id = :tenant_id
   AND equipment_number = 'CV-101'
   AND uns_path IS NULL;

COMMIT;

-- Verification (read-only)
\echo === garage equipment kg_entities after seed ===
SELECT id, entity_id, name, uns_path::text
  FROM kg_entities
 WHERE tenant_id = (:tenant_id)::uuid AND entity_type = 'equipment';

\echo === CV-101 cmms_equipment uns_path after seed ===
SELECT id, equipment_number, uns_path::text
  FROM cmms_equipment
 WHERE tenant_id = :tenant_id AND equipment_number = 'CV-101';

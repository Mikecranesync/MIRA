BEGIN;

-- ─── Epic Universe / Celestial Park / Stardust Racers Namespace Seed ───────
--
-- Real-world project: Stardust Racers rollercoaster at Universal Epic.
-- Enterprise: Epic Universe | Site: Celestial Park | Area: Stardust Racers
-- Subsystems: Launch 1, Launch 2, Station Load, Station Unload
--
-- Usage (substitute your tenant UUID before running):
--   doppler run --project factorylm --config prd -- \
--     python3 tools/seeds/run_demo_seed.py \
--       --tenant epic-universe --tenant-id <YOUR_TENANT_UUID> --commit
--
-- UNS paths use the compact Hub-side format (no ISA-95 type markers):
--   enterprise.{site}.{area}.{subsystem}
--
-- The __TENANT_ID__ placeholder is substituted by run_demo_seed.py.

-- ─── kg_entities hierarchy ──────────────────────────────────────────────────

INSERT INTO kg_entities
  (tenant_id, entity_type, entity_id, name, properties, uns_path)
VALUES
  (
    '__TENANT_ID__'::uuid,
    'site',
    'celestial_park',
    'Celestial Park',
    '{"location": "Epic Universe, Orlando FL", "operator": "Universal Destinations & Experiences"}'::jsonb,
    'enterprise.celestial_park'::ltree
  ),
  (
    '__TENANT_ID__'::uuid,
    'area',
    'stardust_racers',
    'Stardust Racers',
    '{"description": "High-speed multi-launch roller coaster, Celestial Park", "asset_class": "ride_attraction", "ride_type": "launched_coaster"}'::jsonb,
    'enterprise.celestial_park.stardust_racers'::ltree
  ),
  (
    '__TENANT_ID__'::uuid,
    'line',
    'launch_1',
    'Launch 1',
    '{"description": "Primary forward launch segment", "system_type": "linear_induction_motor"}'::jsonb,
    'enterprise.celestial_park.stardust_racers.launch_1'::ltree
  ),
  (
    '__TENANT_ID__'::uuid,
    'line',
    'launch_2',
    'Launch 2',
    '{"description": "Secondary reverse-boost launch segment", "system_type": "linear_induction_motor"}'::jsonb,
    'enterprise.celestial_park.stardust_racers.launch_2'::ltree
  ),
  (
    '__TENANT_ID__'::uuid,
    'line',
    'station_load',
    'Station Load',
    '{"description": "Guest loading platform, restraint check zone, and dispatch", "system_type": "station_conveyor"}'::jsonb,
    'enterprise.celestial_park.stardust_racers.station_load'::ltree
  ),
  (
    '__TENANT_ID__'::uuid,
    'line',
    'station_unload',
    'Station Unload',
    '{"description": "Guest unloading platform and return queue", "system_type": "station_conveyor"}'::jsonb,
    'enterprise.celestial_park.stardust_racers.station_unload'::ltree
  )
ON CONFLICT (tenant_id, entity_type, name) DO UPDATE
  SET properties  = EXCLUDED.properties,
      uns_path    = EXCLUDED.uns_path,
      entity_id   = EXCLUDED.entity_id,
      updated_at  = now();

-- ─── namespace_versions audit rows ─────────────────────────────────────────

INSERT INTO namespace_versions
  (tenant_id, operation, entity_id, entity_kind, from_state, to_state, actor_user_id, actor_kind, reason)
SELECT
  '__TENANT_ID__'::uuid,
  'create',
  e.id,
  e.entity_type,
  NULL,
  jsonb_build_object('uns_path', e.uns_path::text, 'name', e.name),
  NULL,
  'system',
  'Seeded from epic-universe-stardust-racers.sql'
FROM kg_entities e
WHERE e.tenant_id = '__TENANT_ID__'::uuid
  AND e.entity_id IN (
    'celestial_park', 'stardust_racers',
    'launch_1', 'launch_2', 'station_load', 'station_unload'
  )
ON CONFLICT DO NOTHING;

-- ─── relationship_proposals (pending — populate /proposals queue) ───────────
-- Three pending proposals that show MIRA's AI-extracted suggestions.
-- The user can Verify or Reject them in the Hub /proposals page.

INSERT INTO relationship_proposals
  (tenant_id,
   source_entity_id, source_entity_type,
   target_entity_id, target_entity_type,
   relationship_type, confidence, status, risk_level,
   requires_human_review, created_by, reasoning)
SELECT
  '__TENANT_ID__'::uuid,
  src.id, src.entity_type,
  tgt.id, tgt.entity_type,
  'DRIVES',
  0.82,
  'proposed',
  'high',
  true,
  'llm',
  'Launch 1 (forward) triggers Launch 2 (reverse boost) in the ride control sequence. '
  'Extracted from ride ops documentation. Flagged high-risk: sequence timing is safety-critical.'
FROM kg_entities src
JOIN kg_entities tgt
  ON tgt.tenant_id = '__TENANT_ID__'::uuid AND tgt.entity_id = 'launch_2'
WHERE src.tenant_id = '__TENANT_ID__'::uuid
  AND src.entity_id = 'launch_1'
  AND NOT EXISTS (
    SELECT 1 FROM relationship_proposals rp
    WHERE rp.tenant_id = '__TENANT_ID__'::uuid
      AND rp.source_entity_id = src.id
      AND rp.target_entity_id = tgt.id
      AND rp.relationship_type = 'DRIVES'
  );

INSERT INTO relationship_proposals
  (tenant_id,
   source_entity_id, source_entity_type,
   target_entity_id, target_entity_type,
   relationship_type, confidence, status, risk_level,
   requires_human_review, created_by, reasoning)
SELECT
  '__TENANT_ID__'::uuid,
  src.id, src.entity_type,
  tgt.id, tgt.entity_type,
  'UPSTREAM_OF',
  0.95,
  'proposed',
  'medium',
  false,
  'llm',
  'Station Load is the entry point of the ride cycle. '
  'Guest vehicles flow from the load platform into the launch zone.'
FROM kg_entities src
JOIN kg_entities tgt
  ON tgt.tenant_id = '__TENANT_ID__'::uuid AND tgt.entity_id = 'launch_1'
WHERE src.tenant_id = '__TENANT_ID__'::uuid
  AND src.entity_id = 'station_load'
  AND NOT EXISTS (
    SELECT 1 FROM relationship_proposals rp
    WHERE rp.tenant_id = '__TENANT_ID__'::uuid
      AND rp.source_entity_id = src.id
      AND rp.target_entity_id = tgt.id
      AND rp.relationship_type = 'UPSTREAM_OF'
  );

INSERT INTO relationship_proposals
  (tenant_id,
   source_entity_id, source_entity_type,
   target_entity_id, target_entity_type,
   relationship_type, confidence, status, risk_level,
   requires_human_review, created_by, reasoning)
SELECT
  '__TENANT_ID__'::uuid,
  src.id, src.entity_type,
  tgt.id, tgt.entity_type,
  'DOWNSTREAM_OF',
  0.90,
  'proposed',
  'low',
  false,
  'llm',
  'Station Unload is the final stage of the ride cycle — vehicles return here after Launch 2.'
FROM kg_entities src
JOIN kg_entities tgt
  ON tgt.tenant_id = '__TENANT_ID__'::uuid AND tgt.entity_id = 'launch_2'
WHERE src.tenant_id = '__TENANT_ID__'::uuid
  AND src.entity_id = 'station_unload'
  AND NOT EXISTS (
    SELECT 1 FROM relationship_proposals rp
    WHERE rp.tenant_id = '__TENANT_ID__'::uuid
      AND rp.source_entity_id = src.id
      AND rp.target_entity_id = tgt.id
      AND rp.relationship_type = 'DOWNSTREAM_OF'
  );

COMMIT;

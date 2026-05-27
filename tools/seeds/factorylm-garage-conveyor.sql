BEGIN;

-- ─── FactoryLM Home Garage Conveyor Namespace Seed ─────────────────────────
--
-- Real-world project: garage conveyor home lab.
-- Micro820 PLC at 192.168.1.20 | GS10 VFD via Modbus RTU RS-485
-- Enterprise: FactoryLM | Site: Home Garage | Area: Conveyor Lab
-- Asset: Conveyor 1 | Components: Micro820 PLC, GS10 VFD, Photoeye sensor
--
-- Usage:
--   doppler run --project factorylm --config prd -- \
--     python3 tools/seeds/run_demo_seed.py \
--       --tenant garage-conveyor --tenant-id <YOUR_TENANT_UUID> --commit
--
-- The __TENANT_ID__ placeholder is substituted by run_demo_seed.py.

-- ─── kg_entities hierarchy ──────────────────────────────────────────────────

INSERT INTO kg_entities
  (tenant_id, entity_type, entity_id, name, properties, uns_path)
VALUES
  (
    '__TENANT_ID__'::uuid,
    'site',
    'home_garage',
    'Home Garage',
    '{"location": "Lake Wales FL", "operator": "FactoryLM", "ip_range": "192.168.1.0/24"}'::jsonb,
    'enterprise.home_garage'::ltree
  ),
  (
    '__TENANT_ID__'::uuid,
    'area',
    'conveyor_lab',
    'Conveyor Lab',
    '{"description": "Industrial automation test lab with live PLC + VFD", "network": "192.168.1.x"}'::jsonb,
    'enterprise.home_garage.conveyor_lab'::ltree
  ),
  (
    '__TENANT_ID__'::uuid,
    'asset',
    'conveyor_1',
    'Conveyor 1',
    '{"description": "Belt conveyor with sortation, driven by Micro820 + GS10 VFD", "asset_tag": "CV-001", "status": "active"}'::jsonb,
    'enterprise.home_garage.conveyor_lab.conveyor_1'::ltree
  ),
  (
    '__TENANT_ID__'::uuid,
    'component',
    'micro820_plc',
    'Micro820 PLC',
    '{"manufacturer": "Allen-Bradley", "model": "2080-LC20-20QWB", "ip": "192.168.1.20", "protocol": "Modbus TCP :502", "firmware": "v21.011", "tag_prefix": "HR"}'::jsonb,
    'enterprise.home_garage.conveyor_lab.conveyor_1.micro820_plc'::ltree
  ),
  (
    '__TENANT_ID__'::uuid,
    'component',
    'gs10_vfd',
    'GS10 VFD',
    '{"manufacturer": "AutomationDirect", "model": "GS10-21P0", "protocol": "Modbus RTU RS-485", "address": 1, "registers": {"HR100": "motor_speed_rpm", "HR101": "output_current_A", "HR102": "drive_temp_C"}, "coils": {"C0": "run", "C1": "stop", "C2": "fault_reset"}}'::jsonb,
    'enterprise.home_garage.conveyor_lab.conveyor_1.gs10_vfd'::ltree
  ),
  (
    '__TENANT_ID__'::uuid,
    'component',
    'photoeye_1',
    'Photoeye 1',
    '{"manufacturer": "Banner Engineering", "model": "Q4XBLAF300Q8", "type": "laser_distance_sensor", "mounting": "side_rail_B16", "tag": "1.SOC_B16_2", "fault_pattern": "OCCUPIED_TOO_LONG"}'::jsonb,
    'enterprise.home_garage.conveyor_lab.conveyor_1.photoeye_1'::ltree
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
  'Seeded from factorylm-garage-conveyor.sql'
FROM kg_entities e
WHERE e.tenant_id = '__TENANT_ID__'::uuid
  AND e.entity_id IN (
    'home_garage', 'conveyor_lab', 'conveyor_1',
    'micro820_plc', 'gs10_vfd', 'photoeye_1'
  )
ON CONFLICT DO NOTHING;

-- ─── relationship_proposals (pending — populate /proposals queue) ───────────

-- GS10 VFD drives Conveyor 1 motor
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
  0.97,
  'proposed',
  'medium',
  false,
  'llm',
  'GS10 VFD (HR100-102) controls motor speed for Conveyor 1. '
  'Extracted from GS10 integration guide and Micro820 ladder logic (Rung 12, Coil0=run).'
FROM kg_entities src
JOIN kg_entities tgt
  ON tgt.tenant_id = '__TENANT_ID__'::uuid AND tgt.entity_id = 'conveyor_1'
WHERE src.tenant_id = '__TENANT_ID__'::uuid
  AND src.entity_id = 'gs10_vfd'
  AND NOT EXISTS (
    SELECT 1 FROM relationship_proposals rp
    WHERE rp.tenant_id = '__TENANT_ID__'::uuid
      AND rp.source_entity_id = src.id
      AND rp.target_entity_id = tgt.id
      AND rp.relationship_type = 'DRIVES'
  );

-- Micro820 PLC controls GS10 VFD via Modbus
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
  'USED_IN_LOGIC',
  0.99,
  'proposed',
  'low',
  false,
  'rule',
  'Micro820 at 192.168.1.20 writes Modbus coils C0/C1/C2 and reads HR100-102 to control the GS10. '
  'Derived from CLUSTER.md Modbus map and Micro820 v4.1.9 ladder logic.'
FROM kg_entities src
JOIN kg_entities tgt
  ON tgt.tenant_id = '__TENANT_ID__'::uuid AND tgt.entity_id = 'gs10_vfd'
WHERE src.tenant_id = '__TENANT_ID__'::uuid
  AND src.entity_id = 'micro820_plc'
  AND NOT EXISTS (
    SELECT 1 FROM relationship_proposals rp
    WHERE rp.tenant_id = '__TENANT_ID__'::uuid
      AND rp.source_entity_id = src.id
      AND rp.target_entity_id = tgt.id
      AND rp.relationship_type = 'USED_IN_LOGIC'
  );

-- Photoeye 1 triggers fault on Conveyor 1 (OCCUPIED_TOO_LONG pattern)
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
  'TRIGGERS',
  0.88,
  'proposed',
  'medium',
  false,
  'llm',
  'Photoeye 1 (tag 1.SOC_B16_2, Banner Q4X laser sensor) has triggered OCCUPIED_TOO_LONG '
  'fault 14 times in the last 6 months, each time stopping Conveyor 1. '
  'Pattern extracted from work order history.'
FROM kg_entities src
JOIN kg_entities tgt
  ON tgt.tenant_id = '__TENANT_ID__'::uuid AND tgt.entity_id = 'conveyor_1'
WHERE src.tenant_id = '__TENANT_ID__'::uuid
  AND src.entity_id = 'photoeye_1'
  AND NOT EXISTS (
    SELECT 1 FROM relationship_proposals rp
    WHERE rp.tenant_id = '__TENANT_ID__'::uuid
      AND rp.source_entity_id = src.id
      AND rp.target_entity_id = tgt.id
      AND rp.relationship_type = 'TRIGGERS'
  );

-- ─── Tag mapping ai_suggestions ────────────────────────────────────────────
-- PLC tag → component mappings as pending ai_suggestions (type=tag_mapping)

INSERT INTO ai_suggestions
  (tenant_id, suggestion_type, source_kind, extracted_data, confidence,
   status, risk_level, proposed_by, title, body)
SELECT
  '__TENANT_ID__'::uuid,
  'tag_mapping',
  'manifest_row',
  jsonb_build_object(
    'tag', tag_info.tag,
    'register', tag_info.register,
    'description', tag_info.description,
    'component_entity_id', plc.id
  ),
  0.99,
  'pending',
  'low',
  'rule',
  'Map PLC tag ' || tag_info.tag || ' → Micro820 PLC',
  tag_info.description || ' (Micro820 at 192.168.1.20)'
FROM kg_entities plc
CROSS JOIN (VALUES
  ('HR100', 'motor_speed_rpm',   'Motor speed in RPM from GS10 VFD output'),
  ('HR101', 'output_current_A',  'GS10 output current in Amps'),
  ('HR102', 'drive_temp_C',      'GS10 drive temperature in Celsius'),
  ('C0',    'run',               'Modbus coil: run command to GS10'),
  ('C1',    'stop',              'Modbus coil: stop command to GS10'),
  ('C2',    'fault_reset',       'Modbus coil: fault reset command to GS10')
) AS tag_info(register, tag, description)
WHERE plc.tenant_id = '__TENANT_ID__'::uuid
  AND plc.entity_id = 'micro820_plc'
  AND NOT EXISTS (
    SELECT 1 FROM ai_suggestions s
    WHERE s.tenant_id = '__TENANT_ID__'::uuid
      AND s.suggestion_type = 'tag_mapping'
      AND s.extracted_data->>'register' = tag_info.register
  );

COMMIT;

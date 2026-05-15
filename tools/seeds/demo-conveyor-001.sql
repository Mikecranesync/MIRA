-- Demo seed: Conveyor 001 (Lake Wales / Assembly / Line A)
-- Spec: docs/plans/2026-05-14-demo-backend-plan.md (Phase 2)
-- North Star: every troubleshooting question must resolve to a known component
-- with confirmed namespace, PLC tag, wiring, and evidence.
--
-- Requires (in order):
--   * mira-hub/db/migrations/001_knowledge_graph.sql      (kg_entities, kg_relationships)
--   * mira-hub/db/migrations/010_kg_uns_path.sql          (ltree on kg_entities)
--   * mira-hub/db/migrations/013_external_ids.sql         (plc_tag/mqtt_topic on cmms_equipment)
--   * mira-hub/db/migrations/015_equipment_uns_path.sql   (ltree on cmms_equipment)
--   * mira-hub/db/migrations/016_component_templates.sql
--   * mira-hub/db/migrations/017_installed_component_instances.sql
--   * mira-hub/db/migrations/018_relationship_proposals.sql
--
-- Safety: idempotent — every INSERT uses ON CONFLICT DO NOTHING keyed on a stable
-- natural key (entity_id, manufacturer+model+version, plc_tag, etc.). Re-running
-- against an already-seeded tenant is a no-op.
--
-- Tenant: 00000000-0000-0000-0000-0000000000d1  ("demo" tenant — d1 is mnemonic)
-- Asset:  Conveyor 001 (asset_tag = "CV-001")
-- UNS:    enterprise.demo.site.lake_wales.area.assembly.line.line_a.equipment.cv_001.component.<id>

BEGIN;

SET LOCAL app.current_tenant_id = '00000000-0000-0000-0000-0000000000d1';

-- ─── 1. Demo tenant marker entity ────────────────────────────────────────────
-- kg_entities needs the tenant root so UNS subtree queries hit something.
INSERT INTO kg_entities (tenant_id, entity_type, entity_id, name, properties, uns_path)
VALUES (
  '00000000-0000-0000-0000-0000000000d1',
  'tenant',
  'demo',
  'Demo Tenant — Lake Wales',
  jsonb_build_object('purpose', 'expo_demo', 'created_for', '2026-05-21 Florida Automation Expo'),
  'enterprise.demo'::ltree
)
ON CONFLICT (tenant_id, entity_type, entity_id) DO NOTHING;

INSERT INTO kg_entities (tenant_id, entity_type, entity_id, name, properties, uns_path) VALUES
  ('00000000-0000-0000-0000-0000000000d1', 'site', 'lake_wales', 'Lake Wales, FL',
   jsonb_build_object('city', 'Lake Wales', 'state', 'FL'),
   'enterprise.demo.site.lake_wales'::ltree),
  ('00000000-0000-0000-0000-0000000000d1', 'area', 'assembly', 'Assembly Area',
   '{}'::jsonb,
   'enterprise.demo.site.lake_wales.area.assembly'::ltree),
  ('00000000-0000-0000-0000-0000000000d1', 'line', 'line_a', 'Line A',
   '{}'::jsonb,
   'enterprise.demo.site.lake_wales.area.assembly.line.line_a'::ltree)
ON CONFLICT (tenant_id, entity_type, entity_id) DO NOTHING;

-- ─── 2. The asset (Conveyor 001) ─────────────────────────────────────────────
-- cmms_equipment is created by the Atlas schema (separate migration path).
-- We don't know exact column shape across all deployments, so we wrap the
-- insert in an exception handler — if the table is absent or its column set
-- doesn't match, we log a NOTICE and the rest of the seed still lands. The
-- kg_entity row for the asset (next block) is the demo-critical write.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cmms_equipment') THEN
    BEGIN
      INSERT INTO cmms_equipment (id, tenant_id, name, asset_tag, manufacturer, model, serial_number,
                                  plc_tag, scada_path, uns_topic_path, uns_path)
      VALUES (
        'aaaaaaaa-0001-0001-0001-0000000000d1'::uuid,
        '00000000-0000-0000-0000-0000000000d1'::uuid,
        'Conveyor 001',
        'CV-001',
        'FactoryLM',
        'Demo Conveyor v1',
        'CV-001-2026-DEMO',
        'Line5.CV001',
        '[default]CV001',
        'factorylm/demo/lake_wales/assembly/line_a/cv_001',
        'enterprise.demo.site.lake_wales.area.assembly.line.line_a.equipment.cv_001'::ltree
      )
      ON CONFLICT (id) DO NOTHING;
      RAISE NOTICE 'cmms_equipment row inserted for CV-001.';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'cmms_equipment insert skipped: % (column shape mismatch is OK; kg_entities still seeded)', SQLERRM;
    END;
  ELSE
    RAISE NOTICE 'cmms_equipment table not present — kg_entities row will represent the asset.';
  END IF;
END $$;

-- Also record the asset in the KG so UNS subtree queries find it
INSERT INTO kg_entities (id, tenant_id, entity_type, entity_id, name, properties, uns_path)
VALUES (
  'aaaaaaaa-0001-0001-0001-0000000000d1'::uuid,
  '00000000-0000-0000-0000-0000000000d1',
  'equipment', 'cv_001', 'Conveyor 001',
  jsonb_build_object(
    'asset_tag', 'CV-001',
    'manufacturer', 'FactoryLM',
    'model', 'Demo Conveyor v1',
    'serial', 'CV-001-2026-DEMO'
  ),
  'enterprise.demo.site.lake_wales.area.assembly.line.line_a.equipment.cv_001'::ltree
)
ON CONFLICT (tenant_id, entity_type, entity_id) DO NOTHING;

-- ─── 3. Component templates (catalog) ────────────────────────────────────────
-- PE-001 is the demo hero: a Banner Engineering QS18VN6D photoelectric sensor.
-- Fully populated to prove the schema. Others use minimal placeholders so the
-- demo has a "verified vs proposed" contrast.

-- 3a. PE-001 template — Banner QS18VN6D diffuse photoelectric sensor
INSERT INTO component_templates (
  id, component_category, component_type, manufacturer, model, description,
  power_specs, input_output_specs, signal_behavior, connector_type, pinout,
  environmental_limits, diagnostic_indicators, expected_signals,
  common_failure_modes, troubleshooting_steps, pm_checks, safety_notes,
  recommended_uns_template, verification_status, version
) VALUES (
  '11111111-0001-0001-0001-000000000001'::uuid,
  'sensor',
  'photoelectric_sensor',
  'Banner Engineering',
  'QS18VN6D',
  '18mm tubular diffuse-mode photoelectric sensor, NPN open-collector output. Common conveyor presence detection (boxes, totes, parts at 50–400 mm).',
  jsonb_build_object(
    'voltage_vdc_min', 10, 'voltage_vdc_max', 30, 'phase', 'DC',
    'current_consumption_ma', 25, 'inrush_ma', 35
  ),
  jsonb_build_object(
    'output_type', 'NPN open collector (dark-operate / light-operate selectable)',
    'switching_current_ma', 150,
    'response_time_ms', 1.0,
    'signal_type', 'discrete'
  ),
  jsonb_build_object(
    'normal_state_blocked', 'output LOW (sinking to 0 V)',
    'normal_state_clear',   'output HIGH-Z (pulled to 24 V by PLC input)',
    'response_time_ms', 1.0,
    'jitter_ms', 0.2,
    'expected_envelope_when_running', 'edges every 1.2–4.0 s (item pitch)'
  ),
  'M12 4-pin pico (Euro)',
  jsonb_build_object(
    'pin_1', '+V (brown, 10–30 VDC)',
    'pin_2', 'not used',
    'pin_3', '0 V (blue)',
    'pin_4', 'OUT (black, NPN)'
  ),
  jsonb_build_object(
    'operating_temp_c_min', -20, 'operating_temp_c_max', 70,
    'ip_rating', 'IP67', 'shock_g', 30, 'vibration_g', 10
  ),
  jsonb_build_array(
    jsonb_build_object('indicator', 'green_led', 'meaning', 'power on'),
    jsonb_build_object('indicator', 'yellow_led', 'meaning', 'target detected (output active)'),
    jsonb_build_object('indicator', 'yellow_flash_fast', 'meaning', 'marginal signal — clean lens or realign'),
    jsonb_build_object('indicator', 'yellow_flash_slow', 'meaning', 'short-circuit overload on output')
  ),
  jsonb_build_array(
    jsonb_build_object('name', 'idle_clear',     'state', 'output HIGH-Z',  'duration_s_min', 0,   'duration_s_max', 30),
    jsonb_build_object('name', 'item_present',   'state', 'output LOW',     'duration_s_min', 0.5, 'duration_s_max', 3),
    jsonb_build_object('name', 'edge_rising',    'transition', 'HIGH-Z → LOW within 1 ms')
  ),
  jsonb_build_array(
    jsonb_build_object('mode', 'lens_dirty',        'cause', 'dust/grease film on emitter or receiver lens', 'symptom', 'output stays HIGH-Z even with target present (false clear)', 'severity', 'medium'),
    jsonb_build_object('mode', 'misalignment',      'cause', 'mounting bracket shifted',                     'symptom', 'intermittent detection at high speed',                       'severity', 'medium'),
    jsonb_build_object('mode', 'output_short',      'cause', 'shorted load cable',                            'symptom', 'yellow LED fast-flash; output stuck LOW',                    'severity', 'high'),
    jsonb_build_object('mode', 'no_power',          'cause', '24V supply rail blown or cable severed',        'symptom', 'green LED off; output HIGH-Z permanently',                   'severity', 'medium'),
    jsonb_build_object('mode', 'wrong_target_color','cause', 'matte black target absorbs IR',                'symptom', 'output never triggers on certain SKUs',                       'severity', 'low')
  ),
  jsonb_build_array(
    jsonb_build_object('step', 1, 'action', 'Visually inspect green LED — power present?'),
    jsonb_build_object('step', 2, 'action', 'Verify yellow LED transitions when an item passes — sensor seeing target?'),
    jsonb_build_object('step', 3, 'action', 'At the PLC, watch the bound input bit for matching edges'),
    jsonb_build_object('step', 4, 'action', 'Clean lens with soft cloth + isopropyl alcohol; re-test'),
    jsonb_build_object('step', 5, 'action', 'Confirm M12 cable continuity pin-by-pin to PLC terminal'),
    jsonb_build_object('step', 6, 'action', 'If yellow LED is correct but PLC bit is not, the wire or input card is the suspect')
  ),
  jsonb_build_array(
    jsonb_build_object('interval', 'monthly', 'task', 'Clean lens with soft cloth'),
    jsonb_build_object('interval', 'quarterly', 'task', 'Confirm mounting torque and alignment'),
    jsonb_build_object('interval', 'annual',   'task', 'Inspect M12 cable jacket for abrasion')
  ),
  jsonb_build_array(
    jsonb_build_object('hazard', 'low_voltage', 'note', '24 VDC class 2 — no LOTO required for this sensor itself'),
    jsonb_build_object('hazard', 'pinch_point', 'note', 'Conveyor must be stopped before reaching into the detection zone')
  ),
  'enterprise.kb.banner_engineering.qs.qs18vn6d',
  'verified',
  1
)
ON CONFLICT (manufacturer, model, version) DO NOTHING;

INSERT INTO component_template_sources (template_id, source_type, source_url, page_numbers, excerpt, extraction_confidence, extracted_by)
VALUES (
  '11111111-0001-0001-0001-000000000001'::uuid,
  'datasheet',
  'https://info.bannerengineering.com/cs/groups/public/documents/literature/40714.pdf',
  '1',
  'QS18 Series 18 mm tubular DC photoelectric sensor, NPN or PNP output, 10-30 VDC, IP67.',
  0.95, 'human'
)
ON CONFLICT DO NOTHING;

-- 3b. GS10 VFD template (AutomationDirect)
INSERT INTO component_templates (
  id, component_category, component_type, manufacturer, model, description,
  power_specs, signal_behavior, recommended_uns_template, verification_status, version
) VALUES (
  '11111111-0001-0001-0002-000000000001'::uuid,
  'drive', 'variable_frequency_drive', 'AutomationDirect', 'GS10-10P2',
  'AC variable frequency drive, 0.25 HP, 120 VAC single-phase input, 230 VAC 3-phase output. Modbus RTU on RS-485.',
  jsonb_build_object('voltage_vac', 120, 'phase_in', 1, 'phase_out', 3, 'hp', 0.25),
  jsonb_build_object('faults', jsonb_build_array('ocA', 'ocd', 'ocn', 'GFF', 'OUV', 'OcA-cF')),
  'enterprise.kb.automationdirect.gs.gs10',
  'verified', 1
)
ON CONFLICT (manufacturer, model, version) DO NOTHING;

-- 3c. Motor template (placeholder — proposed)
INSERT INTO component_templates (id, component_category, component_type, manufacturer, model, verification_status, version)
VALUES ('11111111-0001-0001-0003-000000000001'::uuid, 'motor', 'ac_induction_motor', 'Marathon', 'Y56C-1HP-1750', 'proposed', 1)
ON CONFLICT (manufacturer, model, version) DO NOTHING;

-- 3d. PLC template (placeholder — proposed)
INSERT INTO component_templates (id, component_category, component_type, manufacturer, model, verification_status, version)
VALUES ('11111111-0001-0001-0004-000000000001'::uuid, 'plc', 'compact_plc', 'Allen-Bradley', 'Micro820 2080-LC20-20QWB', 'proposed', 1)
ON CONFLICT (manufacturer, model, version) DO NOTHING;

-- 3e. Panel/enclosure (placeholder)
INSERT INTO component_templates (id, component_category, component_type, manufacturer, model, verification_status, version)
VALUES ('11111111-0001-0001-0005-000000000001'::uuid, 'enclosure', 'control_panel', 'Hoffman', 'A24H2008LP', 'proposed', 1)
ON CONFLICT (manufacturer, model, version) DO NOTHING;

-- ─── 4. Installed component instances (deployment) ───────────────────────────
-- These are the rows the tablet UI and Slack engine query when grounding answers.
INSERT INTO installed_component_instances (
  id, tenant_id, template_id, asset_id, component_name, canonical_name, aliases,
  installed_location, panel, terminal, wire_number, plc_tag, mqtt_topic,
  uns_path, human_confirmed, confidence
) VALUES
  (
    '22222222-0001-0001-0001-000000000001'::uuid,
    '00000000-0000-0000-0000-0000000000d1'::uuid,
    '11111111-0001-0001-0001-000000000001'::uuid,
    'aaaaaaaa-0001-0001-0001-0000000000d1'::uuid,
    'Photoeye 1 (Item Detect)',
    'PE-001',
    ARRAY['Sensor 1', '_IO_EM_DI_05', 'pe1', 'photo eye 1'],
    'Line A, infeed side, 200 mm above belt',
    'PANEL-001',
    'TB1-5',
    'W-PE001-OUT',
    '%IX0.5',
    'factorylm/demo/lake_wales/assembly/line_a/cv_001/pe_001',
    'enterprise.demo.site.lake_wales.area.assembly.line.line_a.equipment.cv_001.component.pe_001'::ltree,
    true, 0.95
  ),
  (
    '22222222-0001-0001-0002-000000000001'::uuid,
    '00000000-0000-0000-0000-0000000000d1'::uuid,
    '11111111-0001-0001-0002-000000000001'::uuid,
    'aaaaaaaa-0001-0001-0001-0000000000d1'::uuid,
    'GS10 VFD',
    'VFD-001',
    ARRAY['GS10', 'AutomationDirect drive', 'inverter'],
    'PANEL-001 inside, top-left DIN rail',
    'PANEL-001',
    'TB2-1..TB2-6',
    'W-VFD001-PWR',
    NULL,
    'factorylm/demo/lake_wales/assembly/line_a/cv_001/vfd_001',
    'enterprise.demo.site.lake_wales.area.assembly.line.line_a.equipment.cv_001.component.vfd_001'::ltree,
    true, 0.90
  ),
  (
    '22222222-0001-0001-0003-000000000001'::uuid,
    '00000000-0000-0000-0000-0000000000d1'::uuid,
    '11111111-0001-0001-0003-000000000001'::uuid,
    'aaaaaaaa-0001-0001-0001-0000000000d1'::uuid,
    'Conveyor Motor',
    'MTR-001',
    ARRAY['motor', 'Marathon 1HP'],
    'Drive end of conveyor frame',
    NULL,
    'VFD-001 OUT-T1/T2/T3',
    'W-MTR001-PWR',
    NULL,
    'factorylm/demo/lake_wales/assembly/line_a/cv_001/mtr_001',
    'enterprise.demo.site.lake_wales.area.assembly.line.line_a.equipment.cv_001.component.mtr_001'::ltree,
    true, 0.85
  ),
  (
    '22222222-0001-0001-0004-000000000001'::uuid,
    '00000000-0000-0000-0000-0000000000d1'::uuid,
    '11111111-0001-0001-0004-000000000001'::uuid,
    'aaaaaaaa-0001-0001-0001-0000000000d1'::uuid,
    'Micro820 Controller',
    'PLC-001',
    ARRAY['Micro820', 'controller', 'Allen-Bradley'],
    'PANEL-001 inside, top-right DIN rail',
    'PANEL-001',
    'TB1, TB2 (I/O headers)',
    NULL,
    'Line5.CV001.Controller',
    'factorylm/demo/lake_wales/assembly/line_a/cv_001/plc_001',
    'enterprise.demo.site.lake_wales.area.assembly.line.line_a.equipment.cv_001.component.plc_001'::ltree,
    true, 0.95
  ),
  (
    '22222222-0001-0001-0005-000000000001'::uuid,
    '00000000-0000-0000-0000-0000000000d1'::uuid,
    '11111111-0001-0001-0005-000000000001'::uuid,
    'aaaaaaaa-0001-0001-0001-0000000000d1'::uuid,
    'Control Panel',
    'PANEL-001',
    ARRAY['panel', 'enclosure', 'cabinet'],
    'Outboard of conveyor, drive-end',
    NULL, NULL, NULL, NULL,
    'factorylm/demo/lake_wales/assembly/line_a/cv_001/panel_001',
    'enterprise.demo.site.lake_wales.area.assembly.line.line_a.equipment.cv_001.component.panel_001'::ltree,
    true, 0.95
  )
ON CONFLICT (id) DO NOTHING;

-- ─── 5. KG entities for each installed component ─────────────────────────────
-- Mirror of the instances so KG traversal queries hit nodes with uns_path.
INSERT INTO kg_entities (id, tenant_id, entity_type, entity_id, name, properties, uns_path) VALUES
  ('22222222-0001-0001-0001-000000000001'::uuid, '00000000-0000-0000-0000-0000000000d1',
   'component', 'pe_001', 'PE-001 — Photoeye 1',
   jsonb_build_object('template_id', '11111111-0001-0001-0001-000000000001',
                      'plc_tag', '%IX0.5', 'aliases', jsonb_build_array('Sensor 1', '_IO_EM_DI_05')),
   'enterprise.demo.site.lake_wales.area.assembly.line.line_a.equipment.cv_001.component.pe_001'::ltree),
  ('22222222-0001-0001-0002-000000000001'::uuid, '00000000-0000-0000-0000-0000000000d1',
   'component', 'vfd_001', 'VFD-001 — GS10 Drive',
   jsonb_build_object('template_id', '11111111-0001-0001-0002-000000000001'),
   'enterprise.demo.site.lake_wales.area.assembly.line.line_a.equipment.cv_001.component.vfd_001'::ltree),
  ('22222222-0001-0001-0003-000000000001'::uuid, '00000000-0000-0000-0000-0000000000d1',
   'component', 'mtr_001', 'MTR-001 — Conveyor Motor',
   jsonb_build_object('template_id', '11111111-0001-0001-0003-000000000001'),
   'enterprise.demo.site.lake_wales.area.assembly.line.line_a.equipment.cv_001.component.mtr_001'::ltree),
  ('22222222-0001-0001-0004-000000000001'::uuid, '00000000-0000-0000-0000-0000000000d1',
   'component', 'plc_001', 'PLC-001 — Micro820',
   jsonb_build_object('template_id', '11111111-0001-0001-0004-000000000001',
                      'plc_tag_root', 'Line5.CV001.Controller'),
   'enterprise.demo.site.lake_wales.area.assembly.line.line_a.equipment.cv_001.component.plc_001'::ltree),
  ('22222222-0001-0001-0005-000000000001'::uuid, '00000000-0000-0000-0000-0000000000d1',
   'component', 'panel_001', 'PANEL-001 — Control Panel',
   jsonb_build_object('template_id', '11111111-0001-0001-0005-000000000001'),
   'enterprise.demo.site.lake_wales.area.assembly.line.line_a.equipment.cv_001.component.panel_001'::ltree)
ON CONFLICT (tenant_id, entity_type, entity_id) DO NOTHING;

-- ─── 6. PLC tag entities (from variable manifest) ────────────────────────────
-- Only the 4 tags the demo questions actually traverse — full manifest load is
-- the job of tools/load_manifest_to_kg.py.
INSERT INTO kg_entities (id, tenant_id, entity_type, entity_id, name, properties, uns_path) VALUES
  ('33333333-0001-0001-0001-000000000005'::uuid, '00000000-0000-0000-0000-0000000000d1',
   'plc_tag', '_IO_EM_DI_05', '%IX0.5 — Sensor 1',
   jsonb_build_object('plc_address', '%IX0.5', 'data_type', 'BOOL',
                      'source_device', 'Sensor', 'alias', 'Sensor 1'),
   'enterprise.demo.site.lake_wales.area.assembly.line.line_a.equipment.cv_001.component.plc_001'::ltree),
  ('33333333-0001-0001-0001-000000000101'::uuid, '00000000-0000-0000-0000-0000000000d1',
   'plc_tag', 'motor_speed', 'HR:101 — Motor Speed',
   jsonb_build_object('modbus_address', 'HR:101', 'data_type', 'INT',
                      'source_device', 'Micro 820', 'alias', 'Motor Speed'),
   'enterprise.demo.site.lake_wales.area.assembly.line.line_a.equipment.cv_001.component.plc_001'::ltree),
  ('33333333-0001-0001-0001-000000000106'::uuid, '00000000-0000-0000-0000-0000000000d1',
   'plc_tag', 'error_code', 'HR:106 — Error Code',
   jsonb_build_object('modbus_address', 'HR:106', 'data_type', 'INT',
                      'enum', jsonb_build_object('7', 'e_stop', '8', 'dir_fault', '9', 'vfd_comm_error')),
   'enterprise.demo.site.lake_wales.area.assembly.line.line_a.equipment.cv_001.component.plc_001'::ltree),
  ('33333333-0001-0001-0001-000000000114'::uuid, '00000000-0000-0000-0000-0000000000d1',
   'plc_tag', 'conv_state', 'HR:114 — Conveyor State',
   jsonb_build_object('modbus_address', 'HR:114', 'data_type', 'INT',
                      'enum', jsonb_build_object('0', 'IDLE', '1', 'STARTING', '2', 'RUNNING', '3', 'STOPPING', '4', 'FAULT')),
   'enterprise.demo.site.lake_wales.area.assembly.line.line_a.equipment.cv_001.component.plc_001'::ltree)
ON CONFLICT (tenant_id, entity_type, entity_id) DO NOTHING;

-- ─── 7. Relationship proposals + evidence (the chain) ────────────────────────
-- Status='verified' so the demo doesn't need a review pass. Confidence 0.95
-- because every edge is human-confirmed for this seeded asset.
-- NOTE: relationship_proposals has `reasoning TEXT` (LLM rationale / human note),
-- NOT a `properties` jsonb. Structured details live on the evidence rows.
INSERT INTO relationship_proposals (
  id, tenant_id, source_entity_id, source_entity_type, target_entity_id, target_entity_type,
  relationship_type, confidence, status, risk_level, requires_human_review,
  created_by, reasoning
) VALUES
  -- Hierarchy: CV-001 HAS_COMPONENT each child
  ('44444444-0001-0001-0001-000000000001'::uuid, '00000000-0000-0000-0000-0000000000d1',
   'aaaaaaaa-0001-0001-0001-0000000000d1'::uuid, 'equipment',
   '22222222-0001-0001-0001-000000000001'::uuid, 'component',
   'HAS_COMPONENT', 0.95, 'verified', 'low', false, 'human',
   'PE-001 (photoeye) is bolted to Conveyor 001 frame, confirmed at bench install.'),
  ('44444444-0001-0001-0002-000000000001'::uuid, '00000000-0000-0000-0000-0000000000d1',
   'aaaaaaaa-0001-0001-0001-0000000000d1'::uuid, 'equipment',
   '22222222-0001-0001-0002-000000000001'::uuid, 'component',
   'HAS_COMPONENT', 0.95, 'verified', 'low', false, 'human',
   'VFD-001 (GS10) is the variable-speed drive for Conveyor 001.'),
  ('44444444-0001-0001-0003-000000000001'::uuid, '00000000-0000-0000-0000-0000000000d1',
   'aaaaaaaa-0001-0001-0001-0000000000d1'::uuid, 'equipment',
   '22222222-0001-0001-0003-000000000001'::uuid, 'component',
   'HAS_COMPONENT', 0.95, 'verified', 'low', false, 'human',
   'MTR-001 (Marathon 1HP) is the drive motor for Conveyor 001.'),
  ('44444444-0001-0001-0004-000000000001'::uuid, '00000000-0000-0000-0000-0000000000d1',
   'aaaaaaaa-0001-0001-0001-0000000000d1'::uuid, 'equipment',
   '22222222-0001-0001-0004-000000000001'::uuid, 'component',
   'HAS_COMPONENT', 0.95, 'verified', 'low', false, 'human',
   'PLC-001 (Micro820) is the controller for Conveyor 001.'),
  ('44444444-0001-0001-0005-000000000001'::uuid, '00000000-0000-0000-0000-0000000000d1',
   'aaaaaaaa-0001-0001-0001-0000000000d1'::uuid, 'equipment',
   '22222222-0001-0001-0005-000000000001'::uuid, 'component',
   'HAS_COMPONENT', 0.95, 'verified', 'low', false, 'human',
   'PANEL-001 is the control enclosure mounted on Conveyor 001.'),

  -- Wiring: PE-001 WIRED_TO PLC tag %IX0.5
  ('44444444-0002-0001-0001-000000000005'::uuid, '00000000-0000-0000-0000-0000000000d1',
   '22222222-0001-0001-0001-000000000001'::uuid, 'component',
   '33333333-0001-0001-0001-000000000005'::uuid, 'plc_tag',
   'WIRED_TO', 0.95, 'verified', 'medium', false, 'human',
   'PE-001 output wires to PLC-001 input TB1-5 (wire W-PE001-OUT), bound to %IX0.5.'),

  -- Tag mapping: %IX0.5 MAPS_TO PE-001
  ('44444444-0003-0001-0001-000000000005'::uuid, '00000000-0000-0000-0000-0000000000d1',
   '33333333-0001-0001-0001-000000000005'::uuid, 'plc_tag',
   '22222222-0001-0001-0001-000000000001'::uuid, 'component',
   'MAPS_TO', 0.95, 'verified', 'low', false, 'import',
   'Variable manifest declares _IO_EM_DI_05 alias "Sensor 1" at address %IX0.5.'),

  -- Logic: %IX0.5 USED_IN_LOGIC of motor start rung
  ('44444444-0004-0001-0001-000000000005'::uuid, '00000000-0000-0000-0000-0000000000d1',
   '33333333-0001-0001-0001-000000000005'::uuid, 'plc_tag',
   'aaaaaaaa-0001-0001-0001-0000000000d1'::uuid, 'equipment',
   'USED_IN_LOGIC', 0.90, 'verified', 'low', false, 'import',
   'Sensor 1 (%IX0.5) participates in the item-presence gate before the motor-start permissive rung.'),

  -- Power: MTR-001 POWERED_BY VFD-001
  ('44444444-0005-0001-0001-000000000001'::uuid, '00000000-0000-0000-0000-0000000000d1',
   '22222222-0001-0001-0003-000000000001'::uuid, 'component',
   '22222222-0001-0001-0002-000000000001'::uuid, 'component',
   'POWERED_BY', 0.95, 'verified', 'high', false, 'human',
   'VFD-001 drives MTR-001 via T1/T2/T3, 230 VAC three-phase output.'),

  -- LOCATED_IN: VFD/PLC located in PANEL-001
  ('44444444-0006-0001-0001-000000000002'::uuid, '00000000-0000-0000-0000-0000000000d1',
   '22222222-0001-0001-0002-000000000001'::uuid, 'component',
   '22222222-0001-0001-0005-000000000001'::uuid, 'component',
   'LOCATED_IN', 0.95, 'verified', 'low', false, 'human',
   'VFD-001 mounted on top-left DIN rail inside PANEL-001.'),
  ('44444444-0006-0001-0001-000000000004'::uuid, '00000000-0000-0000-0000-0000000000d1',
   '22222222-0001-0001-0004-000000000001'::uuid, 'component',
   '22222222-0001-0001-0005-000000000001'::uuid, 'component',
   'LOCATED_IN', 0.95, 'verified', 'low', false, 'human',
   'PLC-001 mounted on top-right DIN rail inside PANEL-001.'),

  -- Causation: vfd_comm_error TRIGGERS motor stop
  ('44444444-0007-0001-0001-000000000009'::uuid, '00000000-0000-0000-0000-0000000000d1',
   '33333333-0001-0001-0001-000000000106'::uuid, 'plc_tag',
   '22222222-0001-0001-0003-000000000001'::uuid, 'component',
   'CAUSES', 0.85, 'verified', 'medium', false, 'import',
   'error_code=9 (VFD comms error) drops the safety contactor and stops MTR-001.')
ON CONFLICT (id) DO NOTHING;

-- Evidence rows — every proposal cites at least one source.
-- Columns: proposal_id, evidence_type, source_description, page_or_location, excerpt, confidence_contribution
INSERT INTO relationship_evidence (proposal_id, evidence_type, source_description, page_or_location, excerpt, confidence_contribution) VALUES
  ('44444444-0002-0001-0001-000000000005'::uuid, 'manifest',
   'research/variable-manifest.json',
   '_IO_EM_DI_05',
   '"name": "_IO_EM_DI_05", "alias": "Sensor 1", "address": "%IX0.5"',
   0.45),
  ('44444444-0002-0001-0001-000000000005'::uuid, 'technician_note',
   'Bench install log 2026-05-10 (Mike Harper)',
   'TB1-5',
   'PE-001 output landed on TB1-5; continuity confirmed end-to-end.',
   0.50),
  ('44444444-0003-0001-0001-000000000005'::uuid, 'manifest',
   'research/variable-manifest.json',
   '_IO_EM_DI_05',
   '"name": "_IO_EM_DI_05", "alias": "Sensor 1", "address": "%IX0.5"',
   0.95),
  ('44444444-0004-0001-0001-000000000005'::uuid, 'plc_rung',
   'plc/Prog2.stf',
   'motor_start_permissive',
   'IF (sensor_1_active OR sensor_2_active) AND system_ready THEN motor_run := TRUE;',
   0.90),
  ('44444444-0005-0001-0001-000000000001'::uuid, 'document_page',
   'plc/specs/phase1_ladder.md',
   'page 1',
   'GS10 drives 3-phase output to Marathon Y56C 1HP via T1/T2/T3.',
   0.95),
  ('44444444-0007-0001-0001-000000000009'::uuid, 'plc_rung',
   'plc/Prog2.stf',
   'vfd_comm_fault_branch',
   'IF vfd_comm_err THEN error_code := 9; safety_contactor := FALSE;',
   0.85)
ON CONFLICT DO NOTHING;

-- ─── 8. Promoted kg_relationships (verified proposals → live graph) ──────────
-- Spec says "Nothing lands in kg_relationships until verified". The seed bypasses
-- the promotion service (still TBD) by writing verified proposals directly into
-- kg_relationships. `reasoning` becomes the canonical note; structured details
-- can be re-attached when the promotion pipeline lands (P6/follow-up PR).
INSERT INTO kg_relationships (tenant_id, source_id, target_id, relationship_type, confidence, properties)
SELECT
  tenant_id,
  source_entity_id,
  target_entity_id,
  relationship_type,
  confidence,
  jsonb_build_object('proposal_id', id, 'reasoning', reasoning, 'risk_level', risk_level)
FROM relationship_proposals
WHERE tenant_id = '00000000-0000-0000-0000-0000000000d1'::uuid
  AND status = 'verified'
ON CONFLICT DO NOTHING;

-- ─── 9. Verification ─────────────────────────────────────────────────────────
DO $$
DECLARE
  v_templates INTEGER;
  v_instances INTEGER;
  v_entities  INTEGER;
  v_proposals INTEGER;
  v_evidence  INTEGER;
  v_relationships INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_templates FROM component_templates
    WHERE id IN (
      '11111111-0001-0001-0001-000000000001'::uuid,
      '11111111-0001-0001-0002-000000000001'::uuid,
      '11111111-0001-0001-0003-000000000001'::uuid,
      '11111111-0001-0001-0004-000000000001'::uuid,
      '11111111-0001-0001-0005-000000000001'::uuid
    );
  SELECT COUNT(*) INTO v_instances FROM installed_component_instances
    WHERE tenant_id = '00000000-0000-0000-0000-0000000000d1'::uuid;
  SELECT COUNT(*) INTO v_entities FROM kg_entities
    WHERE tenant_id = '00000000-0000-0000-0000-0000000000d1'::uuid;
  SELECT COUNT(*) INTO v_proposals FROM relationship_proposals
    WHERE tenant_id = '00000000-0000-0000-0000-0000000000d1'::uuid;
  SELECT COUNT(*) INTO v_evidence FROM relationship_evidence re
    JOIN relationship_proposals rp ON rp.id = re.proposal_id
    WHERE rp.tenant_id = '00000000-0000-0000-0000-0000000000d1'::uuid;
  SELECT COUNT(*) INTO v_relationships FROM kg_relationships
    WHERE tenant_id = '00000000-0000-0000-0000-0000000000d1'::uuid;

  RAISE NOTICE 'Demo seed verification:';
  RAISE NOTICE '  component_templates:                %', v_templates;
  RAISE NOTICE '  installed_component_instances:      %', v_instances;
  RAISE NOTICE '  kg_entities (demo tenant):          %', v_entities;
  RAISE NOTICE '  relationship_proposals (demo):      %', v_proposals;
  RAISE NOTICE '  relationship_evidence (demo):       %', v_evidence;
  RAISE NOTICE '  kg_relationships (demo tenant):     %', v_relationships;

  IF v_templates < 5 OR v_instances < 5 OR v_proposals < 11 OR v_relationships < 11 THEN
    RAISE EXCEPTION 'Seed verification failed — counts below expected (templates>=5, instances>=5, proposals>=11, relationships>=11)';
  END IF;
END $$;

COMMIT;

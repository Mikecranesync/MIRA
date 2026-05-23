-- =============================================================================
-- Mike Harper garage tenant — structured namespace seed
-- =============================================================================
-- Tenant   : 78917b56-f85f-43bb-9a08-1bb98a6cd6c3 (Mike's real tenant)
-- Site     : garage / main_floor / conveyor_line / cv_001 (Conveyor of Destiny)
-- Components:
--    PE-001    Banner QS18VN6D photoeye
--    VFD-001   AutomationDirect GS10-10P2
--    VFD-002   AutomationDirect GS11 (Mike has both drives in his garage)
--    MTR-001   Marathon Y56C-1HP-1750 motor
--    PLC-001   Allen-Bradley Micro820 2080-LC20-20QWB
--    PANEL-001 Hoffman A24H2008LP control panel
--
-- Mirrors the demo tenant (00000000-0000-0000-0000-0000000000d1) but populates
-- BOTH kg_entities (the namespace graph) AND cmms_equipment (the asset registry
-- Atlas + Hub read from). The demo only used kg_entities; Mike's tenant needs
-- both so the Hub asset page and Atlas CMMS see his real garage gear.
--
-- UNS path company segment matches the slug Mike's existing cmms_equipment
-- rows already use: 78917b56_f85f_43bb_9a08_1bb98a6cd6c3
--   → enterprise.78917b56_f85f_43bb_9a08_1bb98a6cd6c3.site.garage.area.main_floor
--     .line.conveyor_line.equipment.cv_001.component.{...}
--
-- Idempotent: deterministic UUIDs + ON CONFLICT DO UPDATE everywhere. Safe to
-- re-run. Reconciles Mike's existing cmms_equipment rows:
--    CONV-MAIN-01 → re-purposed to CV-001 (kept its UUID so dependent rows
--                   like work orders are not orphaned)
--    VFD-LINE1    → model GS20 → GS10 + linked under CV-001
--    PLC-PANEL-01 → already Micro820, just linked under CV-001 + UNS path
--    "conveyor belt line 3" and the test-junk rows (Pump-A1, this, etc.)
--    are left untouched — out of scope for this seed.
--
-- Usage:
--    Dry run :  python3 tools/seeds/run_mike_garage_seed.py --dry-run
--    Commit  :  python3 tools/seeds/run_mike_garage_seed.py --commit
--    Verify  :  python3 tools/seeds/run_mike_garage_seed.py --verify
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- Bypass RLS so this seed can write under Mike's tenant regardless of session
-- context. Both kg_entities and installed_component_instances have tenant RLS
-- policies that compare against app.current_tenant_id / app.tenant_id.
SET LOCAL app.current_tenant_id = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3';
SET LOCAL app.tenant_id         = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3';

-- ---------------------------------------------------------------------------
-- 0. Deterministic UUIDs — define once so every INSERT lines up.
-- ---------------------------------------------------------------------------
-- Tenant entity:    78917b56-0001-0001-0000-000000000001
-- Site garage:      78917b56-0001-0001-0001-000000000001
-- Area main_floor:  78917b56-0001-0001-0002-000000000001
-- Line conveyor:    78917b56-0001-0001-0003-000000000001
-- Equipment cv_001: re-uses CONV-MAIN-01's existing id af5ecc20-e5a2-4c35-bda3-3acc251522f7
-- Components 5xxx:  78917b56-0001-0001-0005-00000000000{1..6}
-- PLC tags 6xxx:    78917b56-0001-0001-0006-00000000000{1..4}

-- ---------------------------------------------------------------------------
-- 1. CMMS_EQUIPMENT — reconcile existing rows + add new components.
-- ---------------------------------------------------------------------------
-- 1a. Re-purpose CONV-MAIN-01 → CV-001 (keep its UUID so any FKs stay valid).
UPDATE cmms_equipment
   SET equipment_number = 'CV-001',
       description      = 'Conveyor of Destiny — Mike''s garage demo conveyor',
       manufacturer     = 'Custom',
       model_number     = 'BeltConv-3HP',
       equipment_type   = 'Conveyor',
       location         = 'Garage / Main Floor / Conveyor Line',
       department       = 'Maintenance Demo',
       criticality      = 'high'::criticalitylevel,
       parent_asset_id  = NULL,
       uns_path         = 'enterprise.78917b56_f85f_43bb_9a08_1bb98a6cd6c3.site.garage.area.main_floor.line.conveyor_line.equipment.cv_001'::ltree,
       updated_at       = now()
 WHERE id = 'af5ecc20-e5a2-4c35-bda3-3acc251522f7'
   AND tenant_id = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3';

-- 1b. VFD-LINE1 — fix model GS20 → GS10, link under CV-001, set UNS path.
--     equipment_number is preserved (Mike said "update to GS10 or add alongside",
--     not "rename"). The kg_entities ↔ cmms_equipment link is by UUID, not by
--     equipment_number, so the rename is unnecessary.
UPDATE cmms_equipment
   SET description      = 'AutomationDirect GS10-10P2 conveyor drive (was mislabeled GS20 — corrected)',
       manufacturer     = 'AutomationDirect',
       model_number     = 'GS10-10P2',
       equipment_type   = COALESCE(equipment_type, 'VFD'),
       location         = 'Garage / Main Floor / Conveyor Line / PANEL-001',
       department       = COALESCE(department, 'Maintenance Demo'),
       criticality      = 'high'::criticalitylevel,
       parent_asset_id  = 'af5ecc20-e5a2-4c35-bda3-3acc251522f7',
       uns_path         = 'enterprise.78917b56_f85f_43bb_9a08_1bb98a6cd6c3.site.garage.area.main_floor.line.conveyor_line.equipment.cv_001.component.vfd_001'::ltree,
       updated_at       = now()
 WHERE id = '0259e03e-c3a2-4671-abe6-832cff8b317a'
   AND tenant_id = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3';

-- 1c. PLC-PANEL-01 — KEEP equipment_number ("keep, update UNS path" per Mike).
--     Update model_number to the full part number, link under CV-001, set UNS path.
UPDATE cmms_equipment
   SET description      = COALESCE(description,
                                   'Allen-Bradley Micro820 2080-LC20-20QWB conveyor controller'),
       model_number     = '2080-LC20-20QWB',
       equipment_type   = COALESCE(equipment_type, 'PLC'),
       location         = 'Garage / Main Floor / Conveyor Line / PANEL-001',
       department       = COALESCE(department, 'Maintenance Demo'),
       criticality      = 'high'::criticalitylevel,
       parent_asset_id  = 'af5ecc20-e5a2-4c35-bda3-3acc251522f7',
       uns_path         = 'enterprise.78917b56_f85f_43bb_9a08_1bb98a6cd6c3.site.garage.area.main_floor.line.conveyor_line.equipment.cv_001.component.plc_001'::ltree,
       updated_at       = now()
 WHERE id = '49a38d9d-d34d-414d-8f53-9d29fd067620'
   AND tenant_id = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3';

-- 1d. Insert new component rows (PE-001, VFD-002, MTR-001, PANEL-001).
INSERT INTO cmms_equipment
    (id, tenant_id, equipment_number, manufacturer, model_number, equipment_type,
     description, location, department, criticality, parent_asset_id, uns_path,
     created_at, updated_at)
VALUES
    ('78917b56-0001-0001-0005-000000000001',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
     'PE-001', 'Banner Engineering', 'QS18VN6D', 'Sensor',
     'Banner QS18VN6D photoelectric sensor — item-detect on conveyor',
     'Garage / Main Floor / Conveyor Line / In-feed',
     'Maintenance Demo', 'medium'::criticalitylevel,
     'af5ecc20-e5a2-4c35-bda3-3acc251522f7',
     'enterprise.78917b56_f85f_43bb_9a08_1bb98a6cd6c3.site.garage.area.main_floor.line.conveyor_line.equipment.cv_001.component.pe_001'::ltree,
     now(), now()),
    ('78917b56-0001-0001-0005-000000000003',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
     'VFD-002', 'AutomationDirect', 'GS11', 'VFD',
     'AutomationDirect GS11 backup/secondary drive (garage has both GS10 + GS11)',
     'Garage / Main Floor / Conveyor Line / PANEL-001',
     'Maintenance Demo', 'medium'::criticalitylevel,
     'af5ecc20-e5a2-4c35-bda3-3acc251522f7',
     'enterprise.78917b56_f85f_43bb_9a08_1bb98a6cd6c3.site.garage.area.main_floor.line.conveyor_line.equipment.cv_001.component.vfd_002'::ltree,
     now(), now()),
    ('78917b56-0001-0001-0005-000000000004',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
     'MTR-001', 'Marathon', 'Y56C-1HP-1750', 'Motor',
     'Marathon 1 HP, 1750 RPM, 56C frame AC induction motor',
     'Garage / Main Floor / Conveyor Line',
     'Maintenance Demo', 'high'::criticalitylevel,
     'af5ecc20-e5a2-4c35-bda3-3acc251522f7',
     'enterprise.78917b56_f85f_43bb_9a08_1bb98a6cd6c3.site.garage.area.main_floor.line.conveyor_line.equipment.cv_001.component.mtr_001'::ltree,
     now(), now()),
    ('78917b56-0001-0001-0005-000000000006',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
     'PANEL-001', 'Hoffman', 'A24H2008LP', 'Enclosure',
     'Hoffman A24H2008LP NEMA enclosure — houses PLC-001 + VFD-001/002',
     'Garage / Main Floor / Conveyor Line',
     'Maintenance Demo', 'low'::criticalitylevel,
     'af5ecc20-e5a2-4c35-bda3-3acc251522f7',
     'enterprise.78917b56_f85f_43bb_9a08_1bb98a6cd6c3.site.garage.area.main_floor.line.conveyor_line.equipment.cv_001.component.panel_001'::ltree,
     now(), now())
ON CONFLICT (id) DO UPDATE
   SET equipment_number = EXCLUDED.equipment_number,
       manufacturer     = EXCLUDED.manufacturer,
       model_number     = EXCLUDED.model_number,
       equipment_type   = EXCLUDED.equipment_type,
       description      = EXCLUDED.description,
       location         = EXCLUDED.location,
       department       = EXCLUDED.department,
       criticality      = EXCLUDED.criticality,
       parent_asset_id  = EXCLUDED.parent_asset_id,
       uns_path         = EXCLUDED.uns_path,
       updated_at       = now();

-- ---------------------------------------------------------------------------
-- 2. KG_ENTITIES — the structured namespace graph.
-- ---------------------------------------------------------------------------
-- Hub schema: UUID id, UUID tenant_id, TEXT entity_id, ltree uns_path,
-- approval_state TEXT. UNIQUE(tenant_id, entity_type, entity_id).

-- 2a. Hierarchy roots.
INSERT INTO kg_entities (id, tenant_id, entity_type, entity_id, name, properties, uns_path, approval_state, proposed_by, evidence_summary)
VALUES
    ('78917b56-0001-0001-0000-000000000001',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3', 'tenant', 'mike_harper',
     'Mike Harper — FactoryLM',
     '{"display_name":"Mike Harper","seed":"mike-garage-tenant.sql"}'::jsonb,
     'enterprise.78917b56_f85f_43bb_9a08_1bb98a6cd6c3'::ltree,
     'verified', 'seed', 'mike-garage-tenant.sql v1'),
    ('78917b56-0001-0001-0001-000000000001',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3', 'site', 'garage',
     'Garage (Lake Wales, FL)',
     '{"display_name":"Garage","city":"Lake Wales","state":"FL"}'::jsonb,
     'enterprise.78917b56_f85f_43bb_9a08_1bb98a6cd6c3.site.garage'::ltree,
     'verified', 'seed', 'mike-garage-tenant.sql v1'),
    ('78917b56-0001-0001-0002-000000000001',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3', 'area', 'main_floor',
     'Main Floor',
     '{"display_name":"Main Floor"}'::jsonb,
     'enterprise.78917b56_f85f_43bb_9a08_1bb98a6cd6c3.site.garage.area.main_floor'::ltree,
     'verified', 'seed', 'mike-garage-tenant.sql v1'),
    ('78917b56-0001-0001-0003-000000000001',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3', 'line', 'conveyor_line',
     'Conveyor Line',
     '{"display_name":"Conveyor Line"}'::jsonb,
     'enterprise.78917b56_f85f_43bb_9a08_1bb98a6cd6c3.site.garage.area.main_floor.line.conveyor_line'::ltree,
     'verified', 'seed', 'mike-garage-tenant.sql v1'),
    ('af5ecc20-e5a2-4c35-bda3-3acc251522f7',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3', 'equipment', 'cv_001',
     'CV-001 — Conveyor of Destiny',
     '{"display_name":"Conveyor of Destiny","manufacturer":"Custom","model":"BeltConv-3HP","cmms_equipment_id":"af5ecc20-e5a2-4c35-bda3-3acc251522f7"}'::jsonb,
     'enterprise.78917b56_f85f_43bb_9a08_1bb98a6cd6c3.site.garage.area.main_floor.line.conveyor_line.equipment.cv_001'::ltree,
     'verified', 'seed', 'mike-garage-tenant.sql v1')
ON CONFLICT (tenant_id, entity_type, entity_id) DO UPDATE
   SET name             = EXCLUDED.name,
       properties       = EXCLUDED.properties,
       uns_path         = EXCLUDED.uns_path,
       approval_state   = EXCLUDED.approval_state,
       proposed_by      = EXCLUDED.proposed_by,
       evidence_summary = EXCLUDED.evidence_summary,
       updated_at       = now();

-- 2b. Components (6 — PE-001, VFD-001, VFD-002, MTR-001, PLC-001, PANEL-001).
INSERT INTO kg_entities (id, tenant_id, entity_type, entity_id, name, properties, uns_path, approval_state, proposed_by, evidence_summary)
VALUES
    ('78917b56-0001-0001-0005-000000000001',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3', 'component', 'pe_001',
     'PE-001 — Banner QS18VN6D photoeye',
     '{"manufacturer":"Banner Engineering","model":"QS18VN6D","role":"item_detect","template_id":"11111111-0001-0001-0001-000000000001","cmms_equipment_id":"78917b56-0001-0001-0005-000000000001"}'::jsonb,
     'enterprise.78917b56_f85f_43bb_9a08_1bb98a6cd6c3.site.garage.area.main_floor.line.conveyor_line.equipment.cv_001.component.pe_001'::ltree,
     'verified', 'seed', 'mike-garage-tenant.sql v1'),
    ('0259e03e-c3a2-4671-abe6-832cff8b317a',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3', 'component', 'vfd_001',
     'VFD-001 — AutomationDirect GS10',
     '{"manufacturer":"AutomationDirect","model":"GS10-10P2","role":"conveyor_drive","template_id":"11111111-0001-0001-0002-000000000001","cmms_equipment_id":"0259e03e-c3a2-4671-abe6-832cff8b317a"}'::jsonb,
     'enterprise.78917b56_f85f_43bb_9a08_1bb98a6cd6c3.site.garage.area.main_floor.line.conveyor_line.equipment.cv_001.component.vfd_001'::ltree,
     'verified', 'seed', 'mike-garage-tenant.sql v1'),
    ('78917b56-0001-0001-0005-000000000003',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3', 'component', 'vfd_002',
     'VFD-002 — AutomationDirect GS11',
     '{"manufacturer":"AutomationDirect","model":"GS11","role":"conveyor_drive_secondary","cmms_equipment_id":"78917b56-0001-0001-0005-000000000003"}'::jsonb,
     'enterprise.78917b56_f85f_43bb_9a08_1bb98a6cd6c3.site.garage.area.main_floor.line.conveyor_line.equipment.cv_001.component.vfd_002'::ltree,
     'verified', 'seed', 'mike-garage-tenant.sql v1'),
    ('78917b56-0001-0001-0005-000000000004',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3', 'component', 'mtr_001',
     'MTR-001 — Marathon Y56C-1HP-1750',
     '{"manufacturer":"Marathon","model":"Y56C-1HP-1750","role":"conveyor_motor","template_id":"11111111-0001-0001-0003-000000000001","cmms_equipment_id":"78917b56-0001-0001-0005-000000000004"}'::jsonb,
     'enterprise.78917b56_f85f_43bb_9a08_1bb98a6cd6c3.site.garage.area.main_floor.line.conveyor_line.equipment.cv_001.component.mtr_001'::ltree,
     'verified', 'seed', 'mike-garage-tenant.sql v1'),
    ('49a38d9d-d34d-414d-8f53-9d29fd067620',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3', 'component', 'plc_001',
     'PLC-001 — Allen-Bradley Micro820 2080-LC20-20QWB',
     '{"manufacturer":"Allen-Bradley","model":"2080-LC20-20QWB","role":"conveyor_controller","template_id":"11111111-0001-0001-0004-000000000001","cmms_equipment_id":"49a38d9d-d34d-414d-8f53-9d29fd067620"}'::jsonb,
     'enterprise.78917b56_f85f_43bb_9a08_1bb98a6cd6c3.site.garage.area.main_floor.line.conveyor_line.equipment.cv_001.component.plc_001'::ltree,
     'verified', 'seed', 'mike-garage-tenant.sql v1'),
    ('78917b56-0001-0001-0005-000000000006',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3', 'component', 'panel_001',
     'PANEL-001 — Hoffman A24H2008LP enclosure',
     '{"manufacturer":"Hoffman","model":"A24H2008LP","role":"control_panel","template_id":"11111111-0001-0001-0005-000000000001","cmms_equipment_id":"78917b56-0001-0001-0005-000000000006"}'::jsonb,
     'enterprise.78917b56_f85f_43bb_9a08_1bb98a6cd6c3.site.garage.area.main_floor.line.conveyor_line.equipment.cv_001.component.panel_001'::ltree,
     'verified', 'seed', 'mike-garage-tenant.sql v1')
ON CONFLICT (tenant_id, entity_type, entity_id) DO UPDATE
   SET name             = EXCLUDED.name,
       properties       = EXCLUDED.properties,
       uns_path         = EXCLUDED.uns_path,
       approval_state   = EXCLUDED.approval_state,
       proposed_by      = EXCLUDED.proposed_by,
       evidence_summary = EXCLUDED.evidence_summary,
       updated_at       = now();

-- 2c. PLC tags (live on the PLC-001 component path — matches demo pattern).
INSERT INTO kg_entities (id, tenant_id, entity_type, entity_id, name, properties, uns_path, approval_state, proposed_by, evidence_summary)
VALUES
    ('78917b56-0001-0001-0006-000000000001',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3', 'plc_tag', '_IO_EM_DI_05',
     '%IX0.5 — Photoeye 1 input',
     '{"address":"%IX0.5","kind":"discrete_input","semantic":"item_detect","maps_to_component":"pe_001"}'::jsonb,
     'enterprise.78917b56_f85f_43bb_9a08_1bb98a6cd6c3.site.garage.area.main_floor.line.conveyor_line.equipment.cv_001.component.plc_001'::ltree,
     'verified', 'seed', 'mike-garage-tenant.sql v1'),
    ('78917b56-0001-0001-0006-000000000002',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3', 'plc_tag', 'motor_speed',
     'HR:101 — Motor Speed (GS10 0x2102)',
     '{"address":"HR:101","modbus_addr":"0x2102","kind":"holding_register","semantic":"output_freq","maps_to_component":"vfd_001"}'::jsonb,
     'enterprise.78917b56_f85f_43bb_9a08_1bb98a6cd6c3.site.garage.area.main_floor.line.conveyor_line.equipment.cv_001.component.plc_001'::ltree,
     'verified', 'seed', 'mike-garage-tenant.sql v1'),
    ('78917b56-0001-0001-0006-000000000003',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3', 'plc_tag', 'error_code',
     'HR:106 — VFD Fault Code (GS10 0x2200)',
     '{"address":"HR:106","modbus_addr":"0x2200","kind":"holding_register","semantic":"fault_code","maps_to_component":"vfd_001"}'::jsonb,
     'enterprise.78917b56_f85f_43bb_9a08_1bb98a6cd6c3.site.garage.area.main_floor.line.conveyor_line.equipment.cv_001.component.plc_001'::ltree,
     'verified', 'seed', 'mike-garage-tenant.sql v1'),
    ('78917b56-0001-0001-0006-000000000004',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3', 'plc_tag', 'conv_state',
     'HR:114 — Conveyor State',
     '{"address":"HR:114","kind":"holding_register","semantic":"conveyor_state","maps_to_component":"plc_001"}'::jsonb,
     'enterprise.78917b56_f85f_43bb_9a08_1bb98a6cd6c3.site.garage.area.main_floor.line.conveyor_line.equipment.cv_001.component.plc_001'::ltree,
     'verified', 'seed', 'mike-garage-tenant.sql v1')
ON CONFLICT (tenant_id, entity_type, entity_id) DO UPDATE
   SET name             = EXCLUDED.name,
       properties       = EXCLUDED.properties,
       uns_path         = EXCLUDED.uns_path,
       approval_state   = EXCLUDED.approval_state,
       proposed_by      = EXCLUDED.proposed_by,
       evidence_summary = EXCLUDED.evidence_summary,
       updated_at       = now();

-- ---------------------------------------------------------------------------
-- 3. INSTALLED_COMPONENT_INSTANCES — physical-component records linked to
--    cmms_equipment + the component template catalog. Mirrors demo pattern.
-- ---------------------------------------------------------------------------
INSERT INTO installed_component_instances
    (id, tenant_id, template_id, asset_id, component_name, canonical_name,
     aliases, installed_location, panel, terminal, wire_number, plc_tag,
     uns_path, human_confirmed, confidence, notes)
VALUES
    ('78917b56-0002-0001-0005-000000000001',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
     '11111111-0001-0001-0001-000000000001',
     'af5ecc20-e5a2-4c35-bda3-3acc251522f7',
     'Photoeye 1 (Item Detect)', 'PE-001',
     ARRAY['PE1','PE-1','photoeye_1','item_detect'],
     'Conveyor in-feed', 'PANEL-001', 'X1.1', 'W-001', '%IX0.5',
     'enterprise.78917b56_f85f_43bb_9a08_1bb98a6cd6c3.site.garage.area.main_floor.line.conveyor_line.equipment.cv_001.component.pe_001'::ltree,
     true, 0.98,
     'Banner QS18VN6D — 18 mm barrel, polarized retroreflective, item-detect at conveyor in-feed.'),
    ('78917b56-0002-0001-0005-000000000002',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
     '11111111-0001-0001-0002-000000000001',
     '0259e03e-c3a2-4671-abe6-832cff8b317a',
     'GS10 VFD', 'VFD-001',
     ARRAY['VFD1','VFD-1','gs10','drive_1'],
     'PANEL-001', 'PANEL-001', 'PA/+, PC/-, U/T1, V/T2, W/T3', 'W-VFD-001', NULL,
     'enterprise.78917b56_f85f_43bb_9a08_1bb98a6cd6c3.site.garage.area.main_floor.line.conveyor_line.equipment.cv_001.component.vfd_001'::ltree,
     true, 0.97,
     'AutomationDirect GS10-10P2 (was mislabeled GS20 in CMMS — corrected by seed). Modbus RTU slave to PLC-001.'),
    ('78917b56-0002-0001-0005-000000000003',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
     '11111111-0001-0001-0002-000000000001',
     '78917b56-0001-0001-0005-000000000003',
     'GS11 VFD (secondary)', 'VFD-002',
     ARRAY['VFD2','VFD-2','gs11','drive_2'],
     'PANEL-001', 'PANEL-001', 'PA/+, PC/-, U/T1, V/T2, W/T3', 'W-VFD-002', NULL,
     'enterprise.78917b56_f85f_43bb_9a08_1bb98a6cd6c3.site.garage.area.main_floor.line.conveyor_line.equipment.cv_001.component.vfd_002'::ltree,
     true, 0.95,
     'AutomationDirect GS11 — second drive in garage. Template id reuses GS10 (closest match) until a GS11 template is added.'),
    ('78917b56-0002-0001-0005-000000000004',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
     '11111111-0001-0001-0003-000000000001',
     '78917b56-0001-0001-0005-000000000004',
     'Conveyor Motor', 'MTR-001',
     ARRAY['M1','MTR-1','motor_1'],
     'Conveyor head pulley', NULL, NULL, 'W-MTR-001', NULL,
     'enterprise.78917b56_f85f_43bb_9a08_1bb98a6cd6c3.site.garage.area.main_floor.line.conveyor_line.equipment.cv_001.component.mtr_001'::ltree,
     true, 0.98,
     'Marathon Y56C-1HP-1750. Powered by VFD-001 U/V/W output.'),
    ('78917b56-0002-0001-0005-000000000005',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
     '11111111-0001-0001-0004-000000000001',
     '49a38d9d-d34d-414d-8f53-9d29fd067620',
     'Micro820 Controller', 'PLC-001',
     ARRAY['plc_1','controller','micro820'],
     'PANEL-001', 'PANEL-001', 'Ch.2 RS-485 (D+, D-, SG)', 'W-PLC-001', 'Garage.CV001.Controller',
     'enterprise.78917b56_f85f_43bb_9a08_1bb98a6cd6c3.site.garage.area.main_floor.line.conveyor_line.equipment.cv_001.component.plc_001'::ltree,
     true, 0.99,
     'Allen-Bradley Micro820 2080-LC20-20QWB. Modbus RTU master on Ch.2 to VFD-001.'),
    ('78917b56-0002-0001-0005-000000000006',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
     '11111111-0001-0001-0005-000000000001',
     '78917b56-0001-0001-0005-000000000006',
     'Control Panel', 'PANEL-001',
     ARRAY['panel_1','enclosure','cab1'],
     'Garage wall, north of conveyor', NULL, NULL, NULL, NULL,
     'enterprise.78917b56_f85f_43bb_9a08_1bb98a6cd6c3.site.garage.area.main_floor.line.conveyor_line.equipment.cv_001.component.panel_001'::ltree,
     true, 0.97,
     'Hoffman A24H2008LP NEMA enclosure. Houses PLC-001, VFD-001, VFD-002 + 24 VDC PSU.')
ON CONFLICT (id) DO UPDATE
   SET template_id        = EXCLUDED.template_id,
       asset_id           = EXCLUDED.asset_id,
       component_name     = EXCLUDED.component_name,
       canonical_name     = EXCLUDED.canonical_name,
       aliases            = EXCLUDED.aliases,
       installed_location = EXCLUDED.installed_location,
       panel              = EXCLUDED.panel,
       terminal           = EXCLUDED.terminal,
       wire_number        = EXCLUDED.wire_number,
       plc_tag            = EXCLUDED.plc_tag,
       uns_path           = EXCLUDED.uns_path,
       human_confirmed    = EXCLUDED.human_confirmed,
       confidence         = EXCLUDED.confidence,
       notes              = EXCLUDED.notes,
       updated_at         = now();

-- ---------------------------------------------------------------------------
-- 4. RELATIONSHIP_PROPOSALS — verified edges (HAS_COMPONENT, WIRED_TO,
--    POWERED_BY, MAPS_TO, LOCATED_IN). Each proposal needs evidence (step 5).
-- ---------------------------------------------------------------------------
-- HAS_COMPONENT × 6: CV-001 → each component
INSERT INTO relationship_proposals
    (id, tenant_id, source_entity_id, source_entity_type, target_entity_id,
     target_entity_type, relationship_type, confidence, status, created_by,
     risk_level, requires_human_review, reasoning, reviewed_at, reviewed_by)
VALUES
    ('78917b56-0003-0001-0001-000000000001',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
     'af5ecc20-e5a2-4c35-bda3-3acc251522f7', 'equipment',
     '78917b56-0001-0001-0005-000000000001', 'component',
     'HAS_COMPONENT', 0.98, 'verified', 'human', 'low', false,
     'CV-001 contains PE-001 (Mike confirmed in garage).',
     now(), 'mike-garage-tenant.sql v1'),
    ('78917b56-0003-0001-0001-000000000002',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
     'af5ecc20-e5a2-4c35-bda3-3acc251522f7', 'equipment',
     '0259e03e-c3a2-4671-abe6-832cff8b317a', 'component',
     'HAS_COMPONENT', 0.98, 'verified', 'human', 'low', false,
     'CV-001 contains VFD-001 (GS10 drive).',
     now(), 'mike-garage-tenant.sql v1'),
    ('78917b56-0003-0001-0001-000000000003',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
     'af5ecc20-e5a2-4c35-bda3-3acc251522f7', 'equipment',
     '78917b56-0001-0001-0005-000000000003', 'component',
     'HAS_COMPONENT', 0.98, 'verified', 'human', 'low', false,
     'CV-001 contains VFD-002 (GS11 secondary drive).',
     now(), 'mike-garage-tenant.sql v1'),
    ('78917b56-0003-0001-0001-000000000004',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
     'af5ecc20-e5a2-4c35-bda3-3acc251522f7', 'equipment',
     '78917b56-0001-0001-0005-000000000004', 'component',
     'HAS_COMPONENT', 0.98, 'verified', 'human', 'low', false,
     'CV-001 contains MTR-001 (Marathon motor).',
     now(), 'mike-garage-tenant.sql v1'),
    ('78917b56-0003-0001-0001-000000000005',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
     'af5ecc20-e5a2-4c35-bda3-3acc251522f7', 'equipment',
     '49a38d9d-d34d-414d-8f53-9d29fd067620', 'component',
     'HAS_COMPONENT', 0.98, 'verified', 'human', 'low', false,
     'CV-001 contains PLC-001 (Micro820 controller).',
     now(), 'mike-garage-tenant.sql v1'),
    ('78917b56-0003-0001-0001-000000000006',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
     'af5ecc20-e5a2-4c35-bda3-3acc251522f7', 'equipment',
     '78917b56-0001-0001-0005-000000000006', 'component',
     'HAS_COMPONENT', 0.98, 'verified', 'human', 'low', false,
     'CV-001 contains PANEL-001 (Hoffman enclosure).',
     now(), 'mike-garage-tenant.sql v1'),

    -- WIRED_TO: PLC-001 ↔ VFD-001 (RS-485 trunk)
    ('78917b56-0003-0002-0001-000000000001',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
     '49a38d9d-d34d-414d-8f53-9d29fd067620', 'component',
     '0259e03e-c3a2-4671-abe6-832cff8b317a', 'component',
     'WIRED_TO', 0.95, 'verified', 'human', 'low', false,
     '2-wire RS-485 + signal common (Ch.2 → GS10 RS+/RS-/SG). 19200 8-E-1, Slave ID per P09.00.',
     now(), 'mike-garage-tenant.sql v1'),

    -- POWERED_BY: MTR-001 ← VFD-001
    ('78917b56-0003-0003-0001-000000000001',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
     '78917b56-0001-0001-0005-000000000004', 'component',
     '0259e03e-c3a2-4671-abe6-832cff8b317a', 'component',
     'POWERED_BY', 0.97, 'verified', 'human', 'low', false,
     'MTR-001 (Marathon Y56C-1HP-1750) powered by VFD-001 U/T1, V/T2, W/T3 output.',
     now(), 'mike-garage-tenant.sql v1'),

    -- LOCATED_IN: VFD-001, VFD-002, PLC-001 inside PANEL-001
    ('78917b56-0003-0004-0001-000000000001',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
     '0259e03e-c3a2-4671-abe6-832cff8b317a', 'component',
     '78917b56-0001-0001-0005-000000000006', 'component',
     'LOCATED_IN', 0.97, 'verified', 'human', 'low', false,
     'VFD-001 mounted inside PANEL-001 (Hoffman enclosure).',
     now(), 'mike-garage-tenant.sql v1'),
    ('78917b56-0003-0004-0001-000000000002',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
     '78917b56-0001-0001-0005-000000000003', 'component',
     '78917b56-0001-0001-0005-000000000006', 'component',
     'LOCATED_IN', 0.97, 'verified', 'human', 'low', false,
     'VFD-002 mounted inside PANEL-001.',
     now(), 'mike-garage-tenant.sql v1'),
    ('78917b56-0003-0004-0001-000000000003',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
     '49a38d9d-d34d-414d-8f53-9d29fd067620', 'component',
     '78917b56-0001-0001-0005-000000000006', 'component',
     'LOCATED_IN', 0.97, 'verified', 'human', 'low', false,
     'PLC-001 mounted inside PANEL-001 on a DIN rail.',
     now(), 'mike-garage-tenant.sql v1'),

    -- MAPS_TO: %IX0.5 → PE-001
    ('78917b56-0003-0005-0001-000000000001',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
     '78917b56-0001-0001-0006-000000000001', 'plc_tag',
     '78917b56-0001-0001-0005-000000000001', 'component',
     'MAPS_TO', 0.95, 'verified', 'human', 'low', false,
     'PLC tag %IX0.5 reads PE-001 photoeye state.',
     now(), 'mike-garage-tenant.sql v1')
ON CONFLICT (id) DO UPDATE
   SET confidence            = EXCLUDED.confidence,
       status                = EXCLUDED.status,
       reasoning             = EXCLUDED.reasoning,
       reviewed_at           = EXCLUDED.reviewed_at,
       reviewed_by           = EXCLUDED.reviewed_by;

-- 5. RELATIONSHIP_EVIDENCE — 1 row per proposal so promotion is satisfied.
INSERT INTO relationship_evidence
    (id, proposal_id, evidence_type, source_id, source_description,
     page_or_location, excerpt, confidence_contribution)
SELECT
    md5(rp.id::text || 'evidence')::uuid,
    rp.id,
    'technician_note',
    NULL,
    'Mike Harper — garage walk-through 2026-05-19 (Conveyor of Destiny demo build).',
    'in-person, garage',
    rp.reasoning,
    rp.confidence
  FROM relationship_proposals rp
 WHERE rp.tenant_id = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3'
   AND rp.reviewed_by = 'mike-garage-tenant.sql v1'
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. KG_RELATIONSHIPS — engine-readable copy of the verified proposals.
--    Hub schema uses source_id/target_id (UUID FK to kg_entities.id) and
--    relationship_type. Includes approval_state = 'verified' (migration 008).
-- ---------------------------------------------------------------------------
INSERT INTO kg_relationships
    (id, tenant_id, source_id, target_id, relationship_type, properties,
     confidence, approval_state, proposed_by, evidence_summary)
VALUES
    -- HAS_COMPONENT × 6
    ('78917b56-0004-0001-0001-000000000001',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
     'af5ecc20-e5a2-4c35-bda3-3acc251522f7',
     '78917b56-0001-0001-0005-000000000001',
     'HAS_COMPONENT', '{"description":"CV-001 contains PE-001"}'::jsonb,
     0.98, 'verified', 'mike-garage-tenant.sql v1', 'Mike garage walk-through 2026-05-19'),
    ('78917b56-0004-0001-0001-000000000002',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
     'af5ecc20-e5a2-4c35-bda3-3acc251522f7',
     '0259e03e-c3a2-4671-abe6-832cff8b317a',
     'HAS_COMPONENT', '{"description":"CV-001 contains VFD-001"}'::jsonb,
     0.98, 'verified', 'mike-garage-tenant.sql v1', 'Mike garage walk-through 2026-05-19'),
    ('78917b56-0004-0001-0001-000000000003',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
     'af5ecc20-e5a2-4c35-bda3-3acc251522f7',
     '78917b56-0001-0001-0005-000000000003',
     'HAS_COMPONENT', '{"description":"CV-001 contains VFD-002"}'::jsonb,
     0.98, 'verified', 'mike-garage-tenant.sql v1', 'Mike garage walk-through 2026-05-19'),
    ('78917b56-0004-0001-0001-000000000004',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
     'af5ecc20-e5a2-4c35-bda3-3acc251522f7',
     '78917b56-0001-0001-0005-000000000004',
     'HAS_COMPONENT', '{"description":"CV-001 contains MTR-001"}'::jsonb,
     0.98, 'verified', 'mike-garage-tenant.sql v1', 'Mike garage walk-through 2026-05-19'),
    ('78917b56-0004-0001-0001-000000000005',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
     'af5ecc20-e5a2-4c35-bda3-3acc251522f7',
     '49a38d9d-d34d-414d-8f53-9d29fd067620',
     'HAS_COMPONENT', '{"description":"CV-001 contains PLC-001"}'::jsonb,
     0.98, 'verified', 'mike-garage-tenant.sql v1', 'Mike garage walk-through 2026-05-19'),
    ('78917b56-0004-0001-0001-000000000006',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
     'af5ecc20-e5a2-4c35-bda3-3acc251522f7',
     '78917b56-0001-0001-0005-000000000006',
     'HAS_COMPONENT', '{"description":"CV-001 contains PANEL-001"}'::jsonb,
     0.98, 'verified', 'mike-garage-tenant.sql v1', 'Mike garage walk-through 2026-05-19'),

    -- WIRED_TO
    ('78917b56-0004-0002-0001-000000000001',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
     '49a38d9d-d34d-414d-8f53-9d29fd067620',
     '0259e03e-c3a2-4671-abe6-832cff8b317a',
     'WIRED_TO',
     '{"description":"RS-485 trunk PLC-001 Ch.2 → VFD-001","protocol":"Modbus RTU","baud":19200,"framing":"RTU 8-E-1"}'::jsonb,
     0.95, 'verified', 'mike-garage-tenant.sql v1', 'Mike garage walk-through 2026-05-19'),

    -- POWERED_BY
    ('78917b56-0004-0003-0001-000000000001',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
     '78917b56-0001-0001-0005-000000000004',
     '0259e03e-c3a2-4671-abe6-832cff8b317a',
     'POWERED_BY', '{"description":"MTR-001 powered by VFD-001 U/V/W output"}'::jsonb,
     0.97, 'verified', 'mike-garage-tenant.sql v1', 'Mike garage walk-through 2026-05-19'),

    -- LOCATED_IN × 3
    ('78917b56-0004-0004-0001-000000000001',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
     '0259e03e-c3a2-4671-abe6-832cff8b317a',
     '78917b56-0001-0001-0005-000000000006',
     'LOCATED_IN', '{"description":"VFD-001 mounted inside PANEL-001"}'::jsonb,
     0.97, 'verified', 'mike-garage-tenant.sql v1', 'Mike garage walk-through 2026-05-19'),
    ('78917b56-0004-0004-0001-000000000002',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
     '78917b56-0001-0001-0005-000000000003',
     '78917b56-0001-0001-0005-000000000006',
     'LOCATED_IN', '{"description":"VFD-002 mounted inside PANEL-001"}'::jsonb,
     0.97, 'verified', 'mike-garage-tenant.sql v1', 'Mike garage walk-through 2026-05-19'),
    ('78917b56-0004-0004-0001-000000000003',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
     '49a38d9d-d34d-414d-8f53-9d29fd067620',
     '78917b56-0001-0001-0005-000000000006',
     'LOCATED_IN', '{"description":"PLC-001 mounted inside PANEL-001 on DIN rail"}'::jsonb,
     0.97, 'verified', 'mike-garage-tenant.sql v1', 'Mike garage walk-through 2026-05-19'),

    -- MAPS_TO
    ('78917b56-0004-0005-0001-000000000001',
     '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
     '78917b56-0001-0001-0006-000000000001',
     '78917b56-0001-0001-0005-000000000001',
     'MAPS_TO', '{"description":"PLC tag %IX0.5 reads PE-001 photoeye state"}'::jsonb,
     0.95, 'verified', 'mike-garage-tenant.sql v1', 'Mike garage walk-through 2026-05-19')
ON CONFLICT (id) DO UPDATE
   SET relationship_type = EXCLUDED.relationship_type,
       properties        = EXCLUDED.properties,
       confidence        = EXCLUDED.confidence,
       approval_state    = EXCLUDED.approval_state,
       proposed_by       = EXCLUDED.proposed_by,
       evidence_summary  = EXCLUDED.evidence_summary;

COMMIT;

-- =============================================================================
-- Verification — run after committing:
--
-- SELECT entity_type, count(*)
--   FROM kg_entities
--  WHERE tenant_id = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3'
--    AND uns_path  <@ 'enterprise.78917b56_f85f_43bb_9a08_1bb98a6cd6c3'::ltree
--  GROUP BY entity_type;
--
-- SELECT equipment_number, manufacturer, model_number, uns_path::text
--   FROM cmms_equipment
--  WHERE tenant_id = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3'
--    AND parent_asset_id = 'af5ecc20-e5a2-4c35-bda3-3acc251522f7'
--  ORDER BY equipment_number;
--
-- SELECT relationship_type, count(*)
--   FROM kg_relationships
--  WHERE tenant_id = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3'
--    AND proposed_by = 'mike-garage-tenant.sql v1'
--  GROUP BY relationship_type;
-- =============================================================================

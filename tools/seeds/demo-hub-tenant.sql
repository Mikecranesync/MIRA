-- =============================================================================
-- MIRA Hub Demo Tenant Seed — Garage Conveyor Cell
-- =============================================================================
-- Purpose  : Populate the Hub UI tables so /feed, /workorders, /schedule,
--            /assets, /namespace, and /knowledge/map show realistic data on
--            camera for Mike's demo videos.
--
-- Narrative: Mike's garage conveyor cell — Micro820 PLC (Modbus RTU master)
--            driving a GS10 VFD over RS-485, running a belt conveyor with
--            two photoeye sensors. All data is consistent with the Ignition
--            demo and the garage PLC ladder logic (v4.1.9).
--
-- Does NOT duplicate demo-conveyor-001.sql which seeds knowledge_entries
-- (GS10 + Micro820 component templates). This seed targets the Hub UI
-- tables only: kg_entities, cmms_equipment, work_orders, pm_schedules.
--
-- Tenant   : psql variable :tenant_id (UUID)
--            Default (applied when no -v is passed): 00000000-0000-0000-0000-0000000000d1
--            Override: psql -v tenant_id="<your-uuid>" -f this-file.sql
--            The \if guard below prevents the in-file default from clobbering
--            a -v argument supplied on the command line.
--
-- SCOPE WARNING: kg_entities entity UUIDs (10000000-0001-*) are stable and
--   globally unique in Postgres (PK). Applying this seed to a second tenant
--   UUID will fail with PK collision on those rows. This seed is designed for
--   a single target tenant (the demo tenant d1). To apply to a different
--   tenant on a clean DB, this is fine; to apply to a second tenant in the
--   same DB as d1, the entity UUIDs must be made tenant-scoped (TODO if needed).
--
-- Target tables (migration that defines each):
--   kg_entities     — 001_knowledge_graph.sql + 010_kg_uns_path.sql
--                     + 026 (natural key: tenant_id, entity_type, name)
--   cmms_equipment  — pre-migrations Atlas init (criticalitylevel enum)
--                     + 012 (equipment_number, parent_asset_id)
--                     + 013 (plc_tag, scada_path, uns_topic_path …)
--                     + 015 (uns_path ltree)
--   work_orders     — pre-migrations Atlas init (workorderstatus, prioritylevel,
--                     sourcetype, routetype enums)
--                     + 005 (fault_description, suggested_actions, safety_warnings)
--                     + 007 (atlas_id)
--   pm_schedules    — pre-migrations Atlas init
--                     + 005 (trigger_type, meter_type, meter_threshold, meter_current)
--                     + 007 (atlas_id)
--                     + 021 (updated_at)
--   kg_relationships — 001 (source_id/target_id/relationship_type)
--                      + 003 (dedup index: tenant_id, source_id, target_id, type)
--   health_scores   — 021_namespace_builder.sql
--
-- IMPORTANT — pre-migration tables:
--   cmms_equipment, work_orders, pm_schedules and their associated enums
--   (criticalitylevel, workorderstatus, prioritylevel, sourcetype, routetype)
--   are NOT created by any file in mira-hub/db/migrations/. They existed in
--   the production NeonDB before the migrations directory was started (original
--   Atlas CMMS init). These tables MUST already exist in the target Neon branch
--   before running this seed. Local validation was performed against a
--   throwaway Postgres whose DDL was reconstructed from route handler SQL and
--   existing seed files — not from a migration file. Verify against the DEV
--   Neon branch before staging promotion:
--     doppler run -p factorylm -c dev -- \
--       psql "$NEON_DATABASE_URL" --single-transaction \
--       -v tenant_id=00000000-0000-0000-0000-0000000000d1 \
--       -f tools/seeds/demo-hub-tenant.sql
--   (--single-transaction = auto-rollback on any error, safe for dry-run)
--
-- Idempotency:
--   cmms_equipment  — ON CONFLICT (id) DO UPDATE (stable UUIDs)
--   kg_entities     — ON CONFLICT (tenant_id, entity_type, name) DO UPDATE
--                     (migration 026 natural-key: entity_id is nullable auxiliary)
--   work_orders     — ON CONFLICT (id) DO NOTHING (stable UUIDs)
--   pm_schedules    — ON CONFLICT (id) DO NOTHING (stable UUIDs)
--   kg_relationships — ON CONFLICT (tenant_id, source_id, target_id, rel_type) DO NOTHING
--   health_scores   — ON CONFLICT (tenant_id, scope, scope_path) DO UPDATE
--
-- RLS : Tables use app.tenant_id / app.current_tenant_id as RLS setting.
--       neondb_owner has BYPASSRLS=true so no SET LOCAL ROLE is required when
--       applying via doppler/psql as the DB owner. Mirrors the pattern in
--       demo-conveyor-001.sql and factorylm-garage-conveyor.sql.
--
-- routetype enum values (confirmed from 008_add_hub_routetype.sql):
--   'PM'  — auto-PM generated work order (confirmed: pm_scheduler.py uses 'PM')
--   'Hub' — Hub-UI-originated work order  (added by migration 008)
--   NULL  — engine/telegram routes (no route_taken set)
--   Invented values like 'diagnostic' / 'plc_diagnostic' are NOT valid enum members.
--
-- Application path (dev → staging → prod, per docs/environments.md):
--   1. DEV:     psql "$NEON_DATABASE_URL_DEV" -v tenant_id=… -f tools/seeds/demo-hub-tenant.sql
--   2. STAGING: apply-seeds.yml (stg config) → verify SELECTs → gate pass
--   3. PROD:    apply-seeds.yml (prd config) after staging gate passes
--
-- Quick verify after apply:
--   SELECT count(*) FROM kg_entities    WHERE tenant_id = :'tenant_id'::uuid;  -- expect 11
--   SELECT count(*) FROM cmms_equipment WHERE tenant_id = :'tenant_id'::uuid;  -- expect 5
--   SELECT count(*) FROM work_orders    WHERE tenant_id = :'tenant_id'::uuid;  -- expect 7
--   SELECT count(*) FROM pm_schedules   WHERE tenant_id = :'tenant_id'::uuid;  -- expect 8
-- =============================================================================

-- Guard: only set the default if the caller did NOT pass -v tenant_id=…
-- psql \set inside the file clobbers -v arguments — use \if to check first.
\if :{?tenant_id}
\else
\set tenant_id '00000000-0000-0000-0000-0000000000d1'
\endif

BEGIN;

-- ─── Stable UUIDs (deterministic — idempotency depends on these never changing) ─

-- kg_entities
\set ent_site        '10000000-0001-0000-0000-000000000001'
\set ent_area        '10000000-0001-0000-0000-000000000002'
\set ent_line        '10000000-0001-0000-0000-000000000003'
\set ent_conveyor    '10000000-0001-0000-0000-000000000004'
\set ent_vfd         '10000000-0001-0000-0000-000000000005'
\set ent_plc         '10000000-0001-0000-0000-000000000006'
\set ent_pe1         '10000000-0001-0000-0000-000000000007'
\set ent_pe2         '10000000-0001-0000-0000-000000000008'
\set ent_motor       '10000000-0001-0000-0000-000000000009'
\set ent_panel       '10000000-0001-0000-0000-000000000010'
\set ent_belt        '10000000-0001-0000-0000-000000000011'

-- cmms_equipment
\set eq_conveyor     '20000000-0001-0000-0000-000000000001'
\set eq_vfd          '20000000-0001-0000-0000-000000000002'
\set eq_plc          '20000000-0001-0000-0000-000000000003'
\set eq_pe1          '20000000-0001-0000-0000-000000000004'
\set eq_pe2          '20000000-0001-0000-0000-000000000005'

-- work_orders (7 rows)
\set wo1 '30000000-0001-0000-0000-000000000001'
\set wo2 '30000000-0001-0000-0000-000000000002'
\set wo3 '30000000-0001-0000-0000-000000000003'
\set wo4 '30000000-0001-0000-0000-000000000004'
\set wo5 '30000000-0001-0000-0000-000000000005'
\set wo6 '30000000-0001-0000-0000-000000000006'
\set wo7 '30000000-0001-0000-0000-000000000007'

-- pm_schedules (8 rows)
\set pm1 '40000000-0001-0000-0000-000000000001'
\set pm2 '40000000-0001-0000-0000-000000000002'
\set pm3 '40000000-0001-0000-0000-000000000003'
\set pm4 '40000000-0001-0000-0000-000000000004'
\set pm5 '40000000-0001-0000-0000-000000000005'
\set pm6 '40000000-0001-0000-0000-000000000006'
\set pm7 '40000000-0001-0000-0000-000000000007'
\set pm8 '40000000-0001-0000-0000-000000000008'


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. kg_entities — ISA-95 UNS tree (11 rows)
--    enterprise.garage.area.demo_cell.line.conveyor_line.equipment.*
--
--    Idempotency key (migration 026): (tenant_id, entity_type, name)
--    entity_id is a nullable auxiliary after 025/026.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO kg_entities
  (id, tenant_id, entity_type, entity_id, name, properties, uns_path, created_at, updated_at)
VALUES
  -- enterprise.garage (site)
  (:'ent_site'::uuid, :'tenant_id'::uuid, 'site', 'garage',
   'Garage Lab',
   '{"location": "Lake Wales FL", "operator": "FactoryLM", "ip_range": "192.168.1.0/24"}'::jsonb,
   'enterprise.garage'::ltree,
   now(), now()),

  -- enterprise.garage.area.demo_cell (area)
  (:'ent_area'::uuid, :'tenant_id'::uuid, 'area', 'demo_cell',
   'Demo Cell',
   '{"description": "Industrial automation demo area — PLC + VFD + belt conveyor", "network": "192.168.1.x"}'::jsonb,
   'enterprise.garage.area.demo_cell'::ltree,
   now(), now()),

  -- enterprise.garage.area.demo_cell.line.conveyor_line (line)
  (:'ent_line'::uuid, :'tenant_id'::uuid, 'line', 'conveyor_line',
   'Conveyor Line',
   '{"description": "Belt conveyor driven by Micro820 + GS10 VFD over RS-485"}'::jsonb,
   'enterprise.garage.area.demo_cell.line.conveyor_line'::ltree,
   now(), now()),

  -- enterprise.garage.area.demo_cell.line.conveyor_line.equipment.conveyor_001
  (:'ent_conveyor'::uuid, :'tenant_id'::uuid, 'equipment', 'conveyor_001',
   'Conveyor 001',
   '{"description": "Belt conveyor sortation system", "asset_tag": "CV-001", "status": "active"}'::jsonb,
   'enterprise.garage.area.demo_cell.line.conveyor_line.equipment.conveyor_001'::ltree,
   now(), now()),

  -- equipment.vfd_001 — GS10 VFD (sibling equipment on the line)
  (:'ent_vfd'::uuid, :'tenant_id'::uuid, 'equipment', 'vfd_001',
   'GS10 VFD 001',
   '{"manufacturer": "AutomationDirect", "model": "GS10-21P0", "protocol": "Modbus RTU RS-485",
     "address": 1,
     "registers": {"HR100": "motor_speed_rpm", "HR101": "output_current_A", "HR102": "drive_temp_C",
                   "HR400110": "dc_bus_voltage_V"},
     "coils": {"C0": "run", "C1": "stop", "C2": "fault_reset"}}'::jsonb,
   'enterprise.garage.area.demo_cell.line.conveyor_line.equipment.vfd_001'::ltree,
   now(), now()),

  -- equipment.plc_001 — Micro820
  (:'ent_plc'::uuid, :'tenant_id'::uuid, 'equipment', 'plc_001',
   'Micro820 PLC 001',
   '{"manufacturer": "Allen-Bradley", "model": "2080-LC20-20QWB",
     "ip": "192.168.1.20", "port": 502, "protocol": "Modbus TCP + Modbus RTU master",
     "firmware": "v21.011", "serial_port": "CH1 RS-485"}'::jsonb,
   'enterprise.garage.area.demo_cell.line.conveyor_line.equipment.plc_001'::ltree,
   now(), now()),

  -- component.photoeye_001 — infeed sensor (child of conveyor_001)
  (:'ent_pe1'::uuid, :'tenant_id'::uuid, 'component', 'photoeye_001',
   'Photoeye 001 (Infeed)',
   '{"manufacturer": "Banner Engineering", "model": "Q4XBLAF300Q8",
     "type": "laser_distance_sensor", "mounting": "infeed_B14",
     "tag": "1.SOC_B14_1", "fault_pattern": "OCCUPIED_TOO_LONG"}'::jsonb,
   'enterprise.garage.area.demo_cell.line.conveyor_line.equipment.conveyor_001.component.photoeye_001'::ltree,
   now(), now()),

  -- component.photoeye_002 — outfeed sensor (child of conveyor_001)
  (:'ent_pe2'::uuid, :'tenant_id'::uuid, 'component', 'photoeye_002',
   'Photoeye 002 (Outfeed)',
   '{"manufacturer": "Banner Engineering", "model": "Q4XBLAF300Q8",
     "type": "laser_distance_sensor", "mounting": "outfeed_B16",
     "tag": "1.SOC_B16_2", "fault_pattern": "OCCUPIED_TOO_LONG"}'::jsonb,
   'enterprise.garage.area.demo_cell.line.conveyor_line.equipment.conveyor_001.component.photoeye_002'::ltree,
   now(), now()),

  -- component.motor_001 — conveyor drive motor (child of conveyor_001)
  (:'ent_motor'::uuid, :'tenant_id'::uuid, 'component', 'motor_001',
   'Drive Motor 001',
   '{"manufacturer": "AutomationDirect", "model": "GSD5-21P0",
     "type": "AC induction motor", "hp": 1, "voltage": "115/208-230V AC",
     "wired_to": "GS10-21P0 T1/T2/T3"}'::jsonb,
   'enterprise.garage.area.demo_cell.line.conveyor_line.equipment.conveyor_001.component.motor_001'::ltree,
   now(), now()),

  -- component.control_panel_001 — enclosure (child of conveyor_001)
  (:'ent_panel'::uuid, :'tenant_id'::uuid, 'component', 'control_panel_001',
   'Control Panel 001',
   '{"type": "NEMA 4X enclosure", "contents": ["Micro820 PLC", "GS10 VFD", "24VDC PSU"],
     "location": "side rail, left end"}'::jsonb,
   'enterprise.garage.area.demo_cell.line.conveyor_line.equipment.conveyor_001.component.control_panel_001'::ltree,
   now(), now()),

  -- component.drive_belt_001 (child of conveyor_001)
  (:'ent_belt'::uuid, :'tenant_id'::uuid, 'component', 'drive_belt_001',
   'Drive Belt 001',
   '{"type": "flat belt", "material": "polyurethane", "length_m": 1.8,
     "replacement_interval_hours": 2000, "last_replaced": "2025-09-01"}'::jsonb,
   'enterprise.garage.area.demo_cell.line.conveyor_line.equipment.conveyor_001.component.drive_belt_001'::ltree,
   now(), now())

ON CONFLICT (tenant_id, entity_type, name) DO UPDATE
  SET properties  = EXCLUDED.properties,
      uns_path    = EXCLUDED.uns_path,
      entity_id   = EXCLUDED.entity_id,
      updated_at  = now();


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. cmms_equipment — 5 assets for /assets page
--    Column source: seed-stardust-racers.ts + assets/route.ts rowToAsset()
--    + migration 012 (qr_generated_at, parent_asset_id)
--    + migration 013 (plc_tag, scada_path, uns_topic_path …)
--    + migration 015 (uns_path ltree)
--    + migration 007 (atlas_id, cmms_synced_at)
--    Idempotency: ON CONFLICT (id) DO UPDATE (stable UUIDs)
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO cmms_equipment
  (id, tenant_id,
   equipment_number, description, manufacturer, model_number,
   serial_number, equipment_type, location, department,
   criticality,
   last_reported_fault, qr_generated_at,
   plc_tag, scada_path, uns_topic_path,
   uns_path,
   work_order_count, total_downtime_hours,
   created_at, updated_at)
VALUES
  -- Belt Conveyor
  (:'eq_conveyor'::uuid, :'tenant_id'::uuid,
   'CV-001', 'Belt Conveyor — Garage Demo Cell',
   'FactoryLM', 'DIY-CV-001',
   'CV001-2024', 'Conveyor', 'Garage Lab — Demo Cell, south wall', 'Maintenance',
   'high'::criticalitylevel,
   'Conveyor stalled — belt slip during high-load sort cycle; photoeye OCCUPIED_TOO_LONG at B16',
   now() - interval '180 days',
   'CONV_001',
   'Garage/DemoCell/ConveyorLine/CV001',
   'enterprise/garage/demo_cell/conveyor_line/cv_001',
   'enterprise.garage.area.demo_cell.line.conveyor_line.equipment.conveyor_001'::ltree,
   5, 4.5,
   now() - interval '400 days', now()),

  -- GS10 VFD
  (:'eq_vfd'::uuid, :'tenant_id'::uuid,
   'VFD-001', 'GS10 Variable Frequency Drive — Conveyor Drive',
   'AutomationDirect', 'GS10-21P0',
   'GS10-21P0-SN-7842', 'VFD', 'Control Panel 001 — DIN rail slot A', 'Maintenance',
   'critical'::criticalitylevel,
   'CE10 comm fault — Modbus RTU timeout after PLC serial port hung; drive tripped',
   now() - interval '180 days',
   'VFD_001',
   'Garage/DemoCell/ConveyorLine/VFD001',
   'enterprise/garage/demo_cell/conveyor_line/vfd_001',
   'enterprise.garage.area.demo_cell.line.conveyor_line.equipment.vfd_001'::ltree,
   4, 2.0,
   now() - interval '400 days', now()),

  -- Micro820 PLC
  (:'eq_plc'::uuid, :'tenant_id'::uuid,
   'PLC-001', 'Allen-Bradley Micro820 PLC — Conveyor Controller',
   'Allen-Bradley', '2080-LC20-20QWB',
   'AB-M820-2024-001', 'PLC', 'Control Panel 001 — DIN rail slot B', 'Maintenance',
   'critical'::criticalitylevel,
   'MSG_MODBUS .ErrorID = 16#0206 — serial port timeout on RS-485 bus; PLC ladder watchdog latched fault_alarm',
   now() - interval '180 days',
   'PLC_001',
   'Garage/DemoCell/ConveyorLine/PLC001',
   'enterprise/garage/demo_cell/conveyor_line/plc_001',
   'enterprise.garage.area.demo_cell.line.conveyor_line.equipment.plc_001'::ltree,
   3, 1.5,
   now() - interval '400 days', now()),

  -- Photoeye 001 (infeed)
  (:'eq_pe1'::uuid, :'tenant_id'::uuid,
   'PE-001', 'Banner Q4X Photoeye — Infeed Sensor',
   'Banner Engineering', 'Q4XBLAF300Q8',
   'BAN-Q4X-PE001', 'Sensor', 'Side rail B14 — infeed end', 'Maintenance',
   'medium'::criticalitylevel,
   'False trips on bright-light days — sensor gain calibration drifted',
   NULL,
   'PE_001',
   'Garage/DemoCell/ConveyorLine/PE001',
   'enterprise/garage/demo_cell/conveyor_line/pe_001',
   'enterprise.garage.area.demo_cell.line.conveyor_line.equipment.conveyor_001.component.photoeye_001'::ltree,
   1, 0.5,
   now() - interval '300 days', now()),

  -- Photoeye 002 (outfeed)
  (:'eq_pe2'::uuid, :'tenant_id'::uuid,
   'PE-002', 'Banner Q4X Photoeye — Outfeed Sensor',
   'Banner Engineering', 'Q4XBLAF300Q8',
   'BAN-Q4X-PE002', 'Sensor', 'Side rail B16 — outfeed end', 'Maintenance',
   'medium'::criticalitylevel,
   'OCCUPIED_TOO_LONG fault 14× in last 6 months — lens contamination suspected',
   NULL,
   'PE_002',
   'Garage/DemoCell/ConveyorLine/PE002',
   'enterprise/garage/demo_cell/conveyor_line/pe_002',
   'enterprise.garage.area.demo_cell.line.conveyor_line.equipment.conveyor_001.component.photoeye_002'::ltree,
   2, 1.0,
   now() - interval '300 days', now())

ON CONFLICT (id) DO UPDATE
  SET description          = EXCLUDED.description,
      manufacturer         = EXCLUDED.manufacturer,
      model_number         = EXCLUDED.model_number,
      location             = EXCLUDED.location,
      criticality          = EXCLUDED.criticality,
      last_reported_fault  = EXCLUDED.last_reported_fault,
      uns_path             = EXCLUDED.uns_path,
      plc_tag              = EXCLUDED.plc_tag,
      scada_path           = EXCLUDED.scada_path,
      uns_topic_path       = EXCLUDED.uns_topic_path,
      work_order_count     = EXCLUDED.work_order_count,
      total_downtime_hours = EXCLUDED.total_downtime_hours,
      updated_at           = now();


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. work_orders — 7 rows for /workorders page
--    Enum values:
--      workorderstatus: open / in_progress / needs_completion / completed / cancelled
--      prioritylevel:   low / medium / high / critical
--      sourcetype:      telegram_text / hub_ui / auto_pm (+ others added by mig 006)
--      routetype:       PM / Hub / NULL (confirmed from mig 008; no other values used)
--    Required: work_order_number, source, equipment_id, description, priority,
--              status, tenant_id, user_id (TEXT; nullable in Atlas schema but
--              always set by both real writers — use 'pm_scheduler' for auto_pm
--              rows, 'hub_ui_seed' for hub-originated rows)
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO work_orders
  (id, tenant_id,
   work_order_number, source, created_by_agent, user_id,
   manufacturer, model_number, equipment_id,
   title, description, fault_description,
   suggested_actions, safety_warnings,
   status, priority, route_taken,
   created_at, updated_at)
VALUES
  -- WO-1: CE10 comm fault — OPEN / CRITICAL / auto_pm (has citation + safety warning)
  (:'wo1'::uuid, :'tenant_id'::uuid,
   'WO-CV001-001', 'auto_pm'::sourcetype, 'pm_scheduler', 'pm_scheduler',
   'AutomationDirect', 'GS10-21P0', :'eq_vfd'::uuid,
   'GS10 tripped CE10 Comm Fault — RS-485 Modbus RTU timeout',
   E'GS10 VFD (VFD-001) tripped fault code CE10 (Comm Fault) at 14:22.\n'
   'PLC MSG_MODBUS .ErrorID = 16#0206 (timeout). Conveyor stopped.\n\n'
   'Manual reference: GS10 User Manual §9.3 — CE10 Comm Fault: check P09.01 baud rate (19200), '
   'P09.02 data format (8-N-2), P09.03 loss-of-comms timeout (5 s). '
   'Verify 120Ω termination resistors at both ends of RS-485 bus.',
   'CE10 Comm Fault — Modbus RTU serial timeout. VFD stopped; conveyor down.',
   ARRAY[
     'Check RS-485 wire crimp at PLC CH1 terminal block',
     'Verify GS10 P09.01=6 (19200 baud), P09.02=3 (8-N-2), P09.03=5',
     'Measure bus impedance: should be ~120Ω with both terminators in',
     'Cycle GS10 power after confirming wiring; fault clears on comms restore'
   ]::TEXT[],
   ARRAY[
     'Electrical hazard — VFD output terminals at 230V AC when energized. '
     'De-energize and LOTO control panel before touching T1/T2/T3 wiring.',
     'RS-485 bus — do NOT short the A/B conductors; can damage PLC serial port'
   ]::TEXT[],
   'open'::workorderstatus, 'critical'::prioritylevel, 'PM'::routetype,
   now() - interval '2 days', now() - interval '2 days'),

  -- WO-2: Belt slip — IN_PROGRESS / HIGH / telegram_text
  (:'wo2'::uuid, :'tenant_id'::uuid,
   'WO-CV001-002', 'telegram_text'::sourcetype, 'MIRA', 'mira_bot',
   'FactoryLM', 'DIY-CV-001', :'eq_conveyor'::uuid,
   'Conveyor stalled — belt slip during high-load sort cycle',
   E'Conveyor (CV-001) stopped mid-cycle. Load: 3 boxes on belt simultaneously.\n'
   'Belt slipping on drive pulley — visual inspection shows belt tension too low.\n\n'
   'Manual reference: Belt conveyor maintenance guide §4.2 — belt tension check: '
   'deflection should be 1/64" per inch of span under 2 lb force. '
   'Retension via take-up roller adjuster bolts (x2) at tail end.',
   'Belt slip — insufficient tension under high sortation load.',
   ARRAY[
     'Measure belt tension deflection: target 1/64" per inch span',
     'Adjust take-up roller adjuster bolts (tail end) to increase tension',
     'Run 10-cycle test under full sortation load after adjustment',
     'Inspect drive pulley lagging for wear — replace if >20% surface lost'
   ]::TEXT[],
   ARRAY[
     'Nip-point hazard at drive and tail pulleys — keep hands clear during run test',
     'Lock-out conveyor before manually adjusting take-up roller'
   ]::TEXT[],
   'in_progress'::workorderstatus, 'high'::prioritylevel, NULL,
   now() - interval '5 days', now() - interval '1 day'),

  -- WO-3: Photoeye false trips — IN_PROGRESS / MEDIUM / telegram_text
  (:'wo3'::uuid, :'tenant_id'::uuid,
   'WO-CV001-003', 'telegram_text'::sourcetype, 'MIRA', 'mira_bot',
   'Banner Engineering', 'Q4XBLAF300Q8', :'eq_pe1'::uuid,
   'PE-001 false trips on bright-light days — gain calibration needed',
   E'Infeed photoeye (PE-001, tag 1.SOC_B14_1) triggering false OCCUPIED_TOO_LONG faults '
   'on sunny afternoons. Ambient light entering via garage door.\n\n'
   'Manual reference: Banner Q4X user manual §3.4 — gain adjustment: turn potentiometer '
   'counterclockwise (reduce gain) until false trips stop; verify target detect at max 300mm.',
   'PE-001 false-tripping — gain too high for ambient light conditions.',
   ARRAY[
     'Reduce PE-001 gain: rotate potentiometer CCW 1/4 turn, test, repeat',
     'Verify target detect at 250mm (box leading edge) after gain reduction',
     'Consider adding polarizing filter if ambient light persists'
   ]::TEXT[],
   ARRAY[]::TEXT[],
   'in_progress'::workorderstatus, 'medium'::prioritylevel, NULL,
   now() - interval '10 days', now() - interval '3 days'),

  -- WO-4: Micro820 MSG_MODBUS error — OPEN / HIGH / hub_ui
  (:'wo4'::uuid, :'tenant_id'::uuid,
   'WO-CV001-004', 'hub_ui'::sourcetype, NULL, 'hub_ui_seed',
   'Allen-Bradley', '2080-LC20-20QWB', :'eq_plc'::uuid,
   'Micro820 MSG_MODBUS .ErrorID = 16#0206 — check RS-485 serial port',
   E'PLC ladder logic reporting MSG_MODBUS2 .Done=false, .ErrorID=16#0206 (comm timeout) '
   'on every scan cycle. RS-485 bus idle; GS10 not responding to any Modbus RTU query.\n\n'
   'Manual reference: Micro820 MSG_MODBUS Instruction Ref — ErrorID 0x0206 = '
   'request timed out; check baud rate match (PLC CH1 vs GS10 P09.01) '
   'and confirm MSG_MODBUS (RTU/serial) is used, not MSG_MODBUS2 (TCP/Ethernet). '
   'Common source of confusion: the two instructions differ by number suffix only.',
   'MSG_MODBUS .ErrorID=16#0206 — PLC→VFD Modbus RTU timeout.',
   ARRAY[
     'Confirm ladder is using MSG_MODBUS (RTU) not MSG_MODBUS2 (TCP) — check instruction block',
     'Verify CH1 serial port config in CCW: 19200 baud, 8-N-2, RS-485',
     'Check GS10 P09.01 baud matches PLC CH1 baud rate exactly',
     'Inspect DB9 → terminal block wiring at PLC end (A+/B- polarity)'
   ]::TEXT[],
   ARRAY[
     'Do not attempt serial port wiring changes with PLC in RUN mode — download requires PROG mode'
   ]::TEXT[],
   'open'::workorderstatus, 'high'::prioritylevel, 'Hub'::routetype,
   now() - interval '3 days', now() - interval '3 days'),

  -- WO-5: Drive belt inspection — COMPLETED / LOW / auto_pm
  (:'wo5'::uuid, :'tenant_id'::uuid,
   'WO-CV001-005', 'auto_pm'::sourcetype, 'pm_scheduler', 'pm_scheduler',
   'FactoryLM', 'DIY-CV-001', :'eq_conveyor'::uuid,
   'Routine drive belt inspection and tension check — Q2 2026',
   E'Quarterly belt inspection completed per PM schedule.\n'
   'Belt tension: within spec (1/64" deflection at 2lb force).\n'
   'Surface wear: 8% — acceptable, next replacement at 20%.\n'
   'Drive pulley lagging: intact, no cracks.\n\n'
   'Resolution: No action required. Schedule next inspection in 90 days.',
   'Routine quarterly belt inspection.',
   ARRAY[
     'Measure belt tension deflection',
     'Inspect drive pulley lagging condition',
     'Check tail pulley alignment'
   ]::TEXT[],
   ARRAY[]::TEXT[],
   'completed'::workorderstatus, 'low'::prioritylevel, 'PM'::routetype,
   now() - interval '45 days', now() - interval '44 days'),

  -- WO-6: PE-002 lens contamination — OPEN / MEDIUM / telegram_text (with citation)
  (:'wo6'::uuid, :'tenant_id'::uuid,
   'WO-CV001-006', 'telegram_text'::sourcetype, 'MIRA', 'mira_bot',
   'Banner Engineering', 'Q4XBLAF300Q8', :'eq_pe2'::uuid,
   'PE-002 OCCUPIED_TOO_LONG fault recurring — outfeed sensor lens fouled',
   E'Outfeed photoeye (PE-002, tag 1.SOC_B16_2) tripping OCCUPIED_TOO_LONG '
   '14 times in 6 months — pattern matches slow signal-strength degradation '
   'consistent with lens contamination (dust/oil).\n\n'
   'Manual reference: Banner Q4X installation manual §5.1 — cleaning: '
   'use dry lint-free cloth only; do NOT use solvents on the sensing window.',
   'PE-002 recurring OCCUPIED_TOO_LONG — lens contamination pattern.',
   ARRAY[
     'Clean PE-002 lens with dry lint-free cloth',
     'Verify signal strength indicator (green LED) at >50% duty after cleaning',
     'Check mounting bracket for vibration-induced drift',
     'Log fault count before and after cleaning to confirm resolution'
   ]::TEXT[],
   ARRAY[]::TEXT[],
   'open'::workorderstatus, 'medium'::prioritylevel, NULL,
   now() - interval '7 days', now() - interval '7 days'),

  -- WO-7: GS10 parameter backup — COMPLETED / LOW / auto_pm
  (:'wo7'::uuid, :'tenant_id'::uuid,
   'WO-CV001-007', 'auto_pm'::sourcetype, 'pm_scheduler', 'pm_scheduler',
   'AutomationDirect', 'GS10-21P0', :'eq_vfd'::uuid,
   'GS10 VFD parameter backup — annual archival',
   E'Annual GS10 parameter backup completed using GS-Soft software.\n'
   'Parameters saved to: docs/plc/GS10-21P0-params-2026-04.par\n'
   'Key verified: P09.01=6 (19200 baud), P09.02=3 (8-N-2), P09.03=5 (5s timeout), '
   'P00.00=60Hz, P01.00=Hz (freq source = Modbus).\n\n'
   'Resolution: Complete. Archive committed to git: plc/backups/.',
   'Annual GS10 parameter backup procedure.',
   ARRAY[
     'Connect GS-Soft to GS10 via USB-485 adapter',
     'Read all parameters and save .par file',
     'Commit to git repository under plc/backups/'
   ]::TEXT[],
   ARRAY[]::TEXT[],
   'completed'::workorderstatus, 'low'::prioritylevel, 'PM'::routetype,
   now() - interval '60 days', now() - interval '59 days')

ON CONFLICT (id) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. pm_schedules — 8 rows for /schedule page
--    Mix: 3 overdue + 5 upcoming; 4 auto_extracted with source_citation.
--    Idempotency: ON CONFLICT (id) DO NOTHING (stable UUIDs)
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO pm_schedules
  (id, tenant_id,
   manufacturer, model_number, equipment_id,
   task, interval_value, interval_unit, interval_type,
   parts_needed, tools_needed, estimated_duration_minutes,
   safety_requirements, criticality, source_citation, confidence,
   next_due_at, last_completed_at, auto_extracted,
   trigger_type, meter_current,
   created_at, updated_at)
VALUES
  -- PM-1: Inspect RS-485 termination resistors — OVERDUE / high / auto_extracted
  (:'pm1'::uuid, :'tenant_id'::uuid,
   'AutomationDirect', 'GS10-21P0', :'eq_vfd'::uuid,
   'Inspect and verify RS-485 termination resistors at both bus ends',
   3, 'months', 'fixed',
   '["120Ω 0.25W resistor (x2)"]'::jsonb,
   '["multimeter", "small flathead screwdriver"]'::jsonb,
   30,
   '["De-energize control panel before accessing terminal block", "Verify LOTO"]'::jsonb,
   'high',
   'GS10 User Manual §9.1 — RS-485 bus termination required at both ends of bus segment; '
   '120Ω resistors prevent signal reflection that causes CE10 Comm Fault.',
   0.97,
   now() - interval '15 days',
   now() - interval '105 days',
   TRUE,
   'calendar', 0,
   now() - interval '400 days', now()),

  -- PM-2: Verify GS10 parameter backup — UPCOMING / medium / auto_extracted
  (:'pm2'::uuid, :'tenant_id'::uuid,
   'AutomationDirect', 'GS10-21P0', :'eq_vfd'::uuid,
   'Verify and archive GS10 VFD parameter backup',
   12, 'months', 'fixed',
   '[]'::jsonb,
   '["GS-Soft software", "USB-485 adapter"]'::jsonb,
   45,
   '[]'::jsonb,
   'medium',
   'GS10 User Manual §10.2 — parameter backup: connect GS-Soft, read all params, '
   'save .par file; restore after drive replacement to preserve comm and speed config.',
   0.93,
   now() + interval '45 days',
   now() - interval '60 days',
   TRUE,
   'calendar', 0,
   now() - interval '400 days', now()),

  -- PM-3: Lubricate conveyor bearings — OVERDUE / medium
  (:'pm3'::uuid, :'tenant_id'::uuid,
   'FactoryLM', 'DIY-CV-001', :'eq_conveyor'::uuid,
   'Lubricate conveyor drive and tail pulley bearings',
   6, 'months', 'fixed',
   '["bearing grease (NLGI 2)", "grease gun"]'::jsonb,
   '["grease gun", "rags"]'::jsonb,
   20,
   '["LOTO conveyor before lubricating — do not apply grease with belt running"]'::jsonb,
   'medium',
   NULL, 0.80,
   now() - interval '30 days',
   now() - interval '210 days',
   FALSE,
   'calendar', 0,
   now() - interval '400 days', now()),

  -- PM-4: Drive belt inspection — UPCOMING / medium / auto_extracted
  (:'pm4'::uuid, :'tenant_id'::uuid,
   'FactoryLM', 'DIY-CV-001', :'eq_conveyor'::uuid,
   'Inspect drive belt tension, wear, and drive pulley lagging',
   3, 'months', 'fixed',
   '["drive belt (spare, 1.8m polyurethane)"]'::jsonb,
   '["tension gauge", "calipers", "flashlight"]'::jsonb,
   30,
   '["LOTO conveyor before hands-on inspection", "Nip-point hazard at pulleys"]'::jsonb,
   'medium',
   'Belt conveyor maintenance guide §4.2 — belt tension: 1/64" deflection per inch span '
   'under 2 lb force. Replace belt when surface wear exceeds 20%.',
   0.88,
   now() + interval '14 days',
   now() - interval '44 days',
   TRUE,
   'calendar', 0,
   now() - interval '400 days', now()),

  -- PM-5: Clean photoeye lenses — OVERDUE / medium
  (:'pm5'::uuid, :'tenant_id'::uuid,
   'Banner Engineering', 'Q4XBLAF300Q8', :'eq_pe2'::uuid,
   'Clean PE-001 and PE-002 sensing windows and verify signal strength',
   1, 'months', 'fixed',
   '[]'::jsonb,
   '["lint-free cloth"]'::jsonb,
   15,
   '[]'::jsonb,
   'medium',
   NULL, 0.75,
   now() - interval '5 days',
   now() - interval '35 days',
   FALSE,
   'calendar', 0,
   now() - interval '300 days', now()),

  -- PM-6: Micro820 CCW project backup — UPCOMING / high
  (:'pm6'::uuid, :'tenant_id'::uuid,
   'Allen-Bradley', '2080-LC20-20QWB', :'eq_plc'::uuid,
   'Back up Micro820 CCW project and Modbus map config',
   6, 'months', 'fixed',
   '[]'::jsonb,
   '["Connected Components Workbench", "USB cable"]'::jsonb,
   30,
   '["Place PLC in PROG mode before download — do not modify while conveyor is running"]'::jsonb,
   'high',
   NULL, 0.85,
   now() + interval '60 days',
   now() - interval '120 days',
   FALSE,
   'calendar', 0,
   now() - interval '400 days', now()),

  -- PM-7: Replace drive belt — meter-triggered / high / auto_extracted
  --   trigger_type 'calendar_or_meter' + meter_current=1450 of 2000h demonstrates
  --   the multi-trigger PM feature (#898)
  (:'pm7'::uuid, :'tenant_id'::uuid,
   'FactoryLM', 'DIY-CV-001', :'eq_conveyor'::uuid,
   'Replace drive belt — 2000-hour service life',
   2000, 'hours', 'meter',
   '["drive belt 1.8m polyurethane (part# BELT-180-PU)"]'::jsonb,
   '["tension gauge", "wrenches", "pry bar", "calipers"]'::jsonb,
   90,
   '["LOTO conveyor before belt removal", "Two-person lift for belt installation"]'::jsonb,
   'high',
   'Belt conveyor maintenance guide §4.4 — replace belt at 2000 hr or when wear >20%; '
   'record replacement date and reset run-hour counter.',
   0.91,
   now() + interval '180 days',
   now() - interval '400 days',
   TRUE,
   'calendar_or_meter', 1450,
   now() - interval '400 days', now()),

  -- PM-8: Inspect GS10 cooling fan — UPCOMING / medium / auto_extracted
  (:'pm8'::uuid, :'tenant_id'::uuid,
   'AutomationDirect', 'GS10-21P0', :'eq_vfd'::uuid,
   'Inspect GS10 cooling fan for dust accumulation and airflow',
   12, 'months', 'fixed',
   '[]'::jsonb,
   '["compressed air", "flashlight"]'::jsonb,
   20,
   '["De-energize VFD and wait 5 minutes for DC bus discharge before removing cover"]'::jsonb,
   'medium',
   'GS10 User Manual §11.1 — periodic inspection: clean cooling fan vents with '
   'compressed air; blocked airflow causes over-temperature trip (OHn fault).',
   0.90,
   now() + interval '90 days',
   now() - interval '275 days',
   TRUE,
   'calendar', 0,
   now() - interval '400 days', now())

ON CONFLICT (id) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. kg_relationships — 2 graph edges for /namespace knowledge map
--    Confirmed type names:
--      DRIVES — added by 028_drives_relationship_type.sql (on relationship_proposals
--               CHECK; kg_relationships itself has no type CHECK — types are
--               free-form strings constrained only by the app layer)
--      CONTROLS — not in any CHECK; safe as a free-form type in kg_relationships.
--    Idempotency: ON CONFLICT (tenant_id, source_id, target_id, relationship_type)
--    Source UUIDs resolved from the stable kg_entities IDs seeded above.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO kg_relationships
  (tenant_id, source_id, target_id, relationship_type, confidence, properties)
SELECT
  :'tenant_id'::uuid,
  plc.id,
  vfd.id,
  'CONTROLS',
  0.99,
  '{"protocol": "Modbus RTU RS-485", "baud": 19200, "parity": "None",
    "stop_bits": 2, "slave_address": 1,
    "notes": "Micro820 CH1 serial port → GS10 A+/B- terminals; PLC is RS-485 master"}'::jsonb
FROM kg_entities plc, kg_entities vfd
WHERE plc.id = :'ent_plc'::uuid
  AND vfd.id = :'ent_vfd'::uuid
  AND plc.tenant_id = :'tenant_id'::uuid
  AND vfd.tenant_id = :'tenant_id'::uuid
ON CONFLICT (tenant_id, source_id, target_id, relationship_type) DO NOTHING;

INSERT INTO kg_relationships
  (tenant_id, source_id, target_id, relationship_type, confidence, properties)
SELECT
  :'tenant_id'::uuid,
  vfd.id,
  conveyor.id,
  'DRIVES',
  0.98,
  '{"output_phases": 3, "motor_hp": 1,
    "registers": {"HR100": "speed_rpm", "HR101": "current_A", "HR102": "temp_C"},
    "notes": "GS10 T1/T2/T3 → motor; speed commanded via Modbus HR100"}'::jsonb
FROM kg_entities vfd, kg_entities conveyor
WHERE vfd.id = :'ent_vfd'::uuid
  AND conveyor.id = :'ent_conveyor'::uuid
  AND vfd.tenant_id = :'tenant_id'::uuid
  AND conveyor.tenant_id = :'tenant_id'::uuid
ON CONFLICT (tenant_id, source_id, target_id, relationship_type) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. health_scores — tenant-level score for /feed readiness widget
--    Table: 021_namespace_builder.sql
--    Idempotency: ON CONFLICT (tenant_id, scope, scope_path) DO UPDATE
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO health_scores
  (tenant_id, scope, scope_path, level, next_step, counts, computed_at)
VALUES
  (:'tenant_id'::uuid, 'tenant', '', 3,
   'Verify 2 pending proposals to reach L4',
   '{"assets": 5, "components": 6, "docs": 2, "proposals_pending": 2,
     "proposals_verified": 11, "uns_paths": 11, "wizard_completed": false}'::jsonb,
   now())
ON CONFLICT (tenant_id, scope, scope_path) DO UPDATE
  SET level        = EXCLUDED.level,
      next_step    = EXCLUDED.next_step,
      counts       = EXCLUDED.counts,
      computed_at  = now(),
      updated_at   = now();


-- ═══════════════════════════════════════════════════════════════════════════
-- Verify counts (uncomment to run inline after apply)
-- ═══════════════════════════════════════════════════════════════════════════
-- SELECT 'kg_entities'    AS tbl, count(*) FROM kg_entities    WHERE tenant_id = :'tenant_id'::uuid
-- UNION ALL
-- SELECT 'cmms_equipment',         count(*) FROM cmms_equipment WHERE tenant_id = :'tenant_id'::uuid
-- UNION ALL
-- SELECT 'work_orders',            count(*) FROM work_orders    WHERE tenant_id = :'tenant_id'::uuid
-- UNION ALL
-- SELECT 'pm_schedules',           count(*) FROM pm_schedules   WHERE tenant_id = :'tenant_id'::uuid
-- UNION ALL
-- SELECT 'kg_relationships',       count(*) FROM kg_relationships WHERE tenant_id = :'tenant_id'::uuid
-- ORDER BY tbl;

COMMIT;

-- =============================================================================
-- MIRA Hub Demo Tenant Seed — Northwind Beverage / Riverside Plant (Bottling Line)
-- =============================================================================
-- Purpose : Populate the Hub UI tables so /feed, /namespace, /assets, /workorders,
--           /schedule, /knowledge/map show a generic bottling line for the
--           FactoryLM Hub promo video — no Stardust Racers, no Mike-specific data.
--           ONE exception (2026-06-28): Discharge Conveyor CV-200 is the REAL
--           physical rig (Micro820 + GS10), added end-of-line so a desk user can
--           troubleshoot it LIVE (Ignition + MQTT). The other 6 assets stay
--           generic. Counts grew 18→21 entities / 6→7 assets vs the original
--           promo cut — plant-spec-bottling.md + narration updated to match.
--
-- Single source of truth: marketing/videos/mission-control-hub-walkthrough/
--   plant-spec-bottling.md  (counts here MUST match it).
--
-- Tenant  : psql variable :tenant_id (UUID). Default below = the dedicated
--           bottling demo tenant. Override with -v tenant_id="<uuid>".
--             DEDICATED tenant: 00000000-0000-0000-0000-0000000000b1
--           Do NOT reuse the shared demo tenant d1.
--
-- SCOPE WARNING (same as demo-hub-tenant.sql): kg_entities / cmms_equipment /
--   work_orders / pm_schedules ids are global PKs. This file uses the
--   1000…-0002-* / 2000…-0002-* / 3000…-0002-* / 4000…-0002-* prefixes so it does
--   NOT collide with demo-hub-tenant.sql (which uses -0001-*). Apply to the
--   bottling tenant only.
--
-- Prereqs : same pre-migration Atlas tables (cmms_equipment, work_orders,
--   pm_schedules + enums) + Hub migrations through 026 must exist on the target
--   Neon branch. The tenant row (hub_tenants) + a demo login user must already
--   exist — see northwind-bottling-tenant.sql (run that FIRST).
--
-- Apply   : staging dry-run first (auto-rollback), then staging commit, then prod.
--   doppler run -p factorylm -c stg -- psql "$NEON_DATABASE_URL" --single-transaction \
--     -v tenant_id=00000000-0000-0000-0000-0000000000b1 -f tools/seeds/northwind-bottling-hub.sql
--   (--single-transaction = rollback on any error → safe dry-run; drop it to commit.)
--
-- Verify  : kg_entities=21  cmms_equipment=7  work_orders=7 (5 open)  pm_schedules=7
-- =============================================================================

\if :{?tenant_id}
\else
\set tenant_id '00000000-0000-0000-0000-0000000000b1'
\endif

BEGIN;

-- ─── Stable UUIDs (-0002- prefix; never reuse demo-hub-tenant's -0001-) ────────
-- kg_entities (18)
\set e_ent   '10000000-0002-0000-0000-000000000001'
\set e_site  '10000000-0002-0000-0000-000000000002'
\set e_area  '10000000-0002-0000-0000-000000000003'
\set e_line  '10000000-0002-0000-0000-000000000004'
\set e_rinser   '10000000-0002-0000-0000-000000000005'
\set e_filler   '10000000-0002-0000-0000-000000000006'
\set e_fvalve   '10000000-0002-0000-0000-000000000007'
\set e_fmotor   '10000000-0002-0000-0000-000000000008'
\set e_capper   '10000000-0002-0000-0000-000000000009'
\set e_labeler  '10000000-0002-0000-0000-000000000010'
\set e_lpe      '10000000-0002-0000-0000-000000000011'
\set e_casepk   '10000000-0002-0000-0000-000000000012'
\set e_pall     '10000000-0002-0000-0000-000000000013'
\set e_conv     '10000000-0002-0000-0000-000000000014'
\set e_cmotor   '10000000-0002-0000-0000-000000000015'
\set e_plc      '10000000-0002-0000-0000-000000000016'
\set e_vfd      '10000000-0002-0000-0000-000000000017'
\set e_kb       '10000000-0002-0000-0000-000000000018'
-- Discharge Conveyor CV-200 — the REAL physical rig (Micro820 + GS10), live-backed.
\set e_dconv    '10000000-0002-0000-0000-000000000019'
\set e_dcmotor  '10000000-0002-0000-0000-000000000020'
\set e_dvfd     '10000000-0002-0000-0000-000000000021'

-- cmms_equipment (7 headline assets — CV-200 = live discharge conveyor)
\set q_filler '20000000-0002-0000-0000-000000000001'
\set q_capper '20000000-0002-0000-0000-000000000002'
\set q_label  '20000000-0002-0000-0000-000000000003'
\set q_casepk '20000000-0002-0000-0000-000000000004'
\set q_pall   '20000000-0002-0000-0000-000000000005'
\set q_conv   '20000000-0002-0000-0000-000000000006'
\set q_dconv  '20000000-0002-0000-0000-000000000007'

-- work_orders (7: 5 open/in_progress + 2 completed)
\set w1 '30000000-0002-0000-0000-000000000001'
\set w2 '30000000-0002-0000-0000-000000000002'
\set w3 '30000000-0002-0000-0000-000000000003'
\set w4 '30000000-0002-0000-0000-000000000004'
\set w5 '30000000-0002-0000-0000-000000000005'
\set w6 '30000000-0002-0000-0000-000000000006'
\set w7 '30000000-0002-0000-0000-000000000007'

-- pm_schedules (7)
\set p1 '40000000-0002-0000-0000-000000000001'
\set p2 '40000000-0002-0000-0000-000000000002'
\set p3 '40000000-0002-0000-0000-000000000003'
\set p4 '40000000-0002-0000-0000-000000000004'
\set p5 '40000000-0002-0000-0000-000000000005'
\set p6 '40000000-0002-0000-0000-000000000006'
\set p7 '40000000-0002-0000-0000-000000000007'

-- ═══ 1. kg_entities — ISA-95 tree (18 rows) ══════════════════════════════════
-- enterprise.northwind.site.riverside.area.packaging.line.line1.* (bottling)
INSERT INTO kg_entities
  (id, tenant_id, entity_type, entity_id, name, properties, uns_path, created_at, updated_at)
VALUES
  (:'e_ent'::uuid,  :'tenant_id'::uuid, 'enterprise', 'northwind', 'Northwind Beverage Co.',
   '{"industry": "beverage", "demo": true}'::jsonb,
   'enterprise'::ltree, now(), now()),
  (:'e_site'::uuid, :'tenant_id'::uuid, 'site', 'riverside', 'Riverside Plant',
   '{"location": "Midwest (demo)", "demo": true}'::jsonb,
   'enterprise.riverside'::ltree, now(), now()),
  (:'e_area'::uuid, :'tenant_id'::uuid, 'area', 'packaging', 'Packaging',
   '{"description": "Primary bottling + packaging area", "demo": true}'::jsonb,
   'enterprise.riverside.area.packaging'::ltree, now(), now()),
  (:'e_line'::uuid, :'tenant_id'::uuid, 'line', 'line1', 'Line 1 — Bottling',
   '{"description": "PET bottle fill / cap / label / case / palletize", "demo": true}'::jsonb,
   'enterprise.riverside.area.packaging.line.line1'::ltree, now(), now()),
  (:'e_rinser'::uuid, :'tenant_id'::uuid, 'equipment', 'rinser_r100', 'Rinser R-100',
   '{"asset_tag": "RNS-100", "function": "bottle rinse"}'::jsonb,
   'enterprise.riverside.area.packaging.line.line1.equipment.rinser_r100'::ltree, now(), now()),
  (:'e_filler'::uuid, :'tenant_id'::uuid, 'equipment', 'filler_f100', 'Filler F-100',
   '{"asset_tag": "FIL-100", "function": "volumetric fill", "valves": 24}'::jsonb,
   'enterprise.riverside.area.packaging.line.line1.equipment.filler_f100'::ltree, now(), now()),
  (:'e_fvalve'::uuid, :'tenant_id'::uuid, 'component', 'fill_valve_bank', 'Fill Valve Bank',
   '{"count": 24, "type": "gravity fill valve"}'::jsonb,
   'enterprise.riverside.area.packaging.line.line1.equipment.filler_f100.component.fill_valve_bank'::ltree, now(), now()),
  (:'e_fmotor'::uuid, :'tenant_id'::uuid, 'component', 'fill_carousel_motor', 'Fill Carousel Motor',
   '{"type": "AC induction", "vfd_controlled": true}'::jsonb,
   'enterprise.riverside.area.packaging.line.line1.equipment.filler_f100.component.fill_carousel_motor'::ltree, now(), now()),
  (:'e_capper'::uuid, :'tenant_id'::uuid, 'equipment', 'capper_c100', 'Capper C-100',
   '{"asset_tag": "CAP-100", "function": "screw cap + torque"}'::jsonb,
   'enterprise.riverside.area.packaging.line.line1.equipment.capper_c100'::ltree, now(), now()),
  (:'e_labeler'::uuid, :'tenant_id'::uuid, 'equipment', 'labeler_l100', 'Labeler L-100',
   '{"asset_tag": "LAB-100", "function": "pressure-sensitive label"}'::jsonb,
   'enterprise.riverside.area.packaging.line.line1.equipment.labeler_l100'::ltree, now(), now()),
  (:'e_lpe'::uuid, :'tenant_id'::uuid, 'component', 'label_photo_eye', 'Label Registration Photo-eye',
   '{"type": "photoelectric", "function": "label index"}'::jsonb,
   'enterprise.riverside.area.packaging.line.line1.equipment.labeler_l100.component.label_photo_eye'::ltree, now(), now()),
  (:'e_casepk'::uuid, :'tenant_id'::uuid, 'equipment', 'case_packer_cp100', 'Case Packer CP-100',
   '{"asset_tag": "CSP-100", "function": "drop-pack 24-count"}'::jsonb,
   'enterprise.riverside.area.packaging.line.line1.equipment.case_packer_cp100'::ltree, now(), now()),
  (:'e_pall'::uuid, :'tenant_id'::uuid, 'equipment', 'palletizer_pl100', 'Palletizer PL-100',
   '{"asset_tag": "PAL-100", "function": "layer palletize"}'::jsonb,
   'enterprise.riverside.area.packaging.line.line1.equipment.palletizer_pl100'::ltree, now(), now()),
  (:'e_conv'::uuid, :'tenant_id'::uuid, 'equipment', 'conveyor_cv100', 'Accumulation Conveyor CV-100',
   '{"asset_tag": "CNV-100", "function": "accumulation between fill and case"}'::jsonb,
   'enterprise.riverside.area.packaging.line.line1.equipment.conveyor_cv100'::ltree, now(), now()),
  (:'e_cmotor'::uuid, :'tenant_id'::uuid, 'component', 'conveyor_motor', 'Conveyor Drive Motor',
   '{"type": "AC induction", "vfd_controlled": true}'::jsonb,
   'enterprise.riverside.area.packaging.line.line1.equipment.conveyor_cv100.component.conveyor_motor'::ltree, now(), now()),
  (:'e_plc'::uuid, :'tenant_id'::uuid, 'equipment', 'line_plc', 'Line 1 PLC',
   '{"role": "line controller", "protocol": "EtherNet/IP + Modbus TCP"}'::jsonb,
   'enterprise.riverside.area.packaging.line.line1.equipment.line_plc'::ltree, now(), now()),
  (:'e_vfd'::uuid, :'tenant_id'::uuid, 'equipment', 'conveyor_vfd', 'Conveyor VFD',
   '{"function": "drives accumulation conveyor motor"}'::jsonb,
   'enterprise.riverside.area.packaging.line.line1.equipment.conveyor_vfd'::ltree, now(), now()),
  -- ── Discharge Conveyor CV-200 (end-of-line) — the REAL physical rig, live-backed ──
  --    Controller = Micro820 v4.1.9, drive = AutomationDirect GS10 VFD. Its uns_path is
  --    the subtree the live nervous system (display_endpoints + approved_tags + MQTT/
  --    Ignition feed) binds to so a desk user can troubleshoot it live. See
  --    docs/plans/2026-06-28-discharge-conveyor-desk-troubleshooting.md.
  (:'e_dconv'::uuid, :'tenant_id'::uuid, 'equipment', 'discharge_conveyor_cv200', 'Discharge Conveyor CV-200',
   '{"asset_tag": "CNV-200", "function": "discharge finished cases — end of line", "live": true, "controller": "Allen-Bradley Micro820 v4.1.9", "drive": "AutomationDirect GS10 VFD", "note": "Physical rig — live-backed via Ignition/MQTT for desk troubleshooting"}'::jsonb,
   'enterprise.riverside.area.packaging.line.line1.equipment.discharge_conveyor_cv200'::ltree, now(), now()),
  (:'e_dcmotor'::uuid, :'tenant_id'::uuid, 'component', 'discharge_conveyor_motor', 'Discharge Conveyor Drive Motor',
   '{"type": "AC induction", "vfd_controlled": true}'::jsonb,
   'enterprise.riverside.area.packaging.line.line1.equipment.discharge_conveyor_cv200.component.discharge_conveyor_motor'::ltree, now(), now()),
  (:'e_dvfd'::uuid, :'tenant_id'::uuid, 'equipment', 'discharge_conveyor_vfd', 'Discharge Conveyor VFD (GS10)',
   '{"function": "drives discharge conveyor motor", "model": "AutomationDirect GS10", "protocol": "Modbus RTU/TCP"}'::jsonb,
   'enterprise.riverside.area.packaging.line.line1.equipment.discharge_conveyor_vfd'::ltree, now(), now()),
  (:'e_kb'::uuid, :'tenant_id'::uuid, 'folder', 'knowledge_base', 'Knowledge Base',
   '{"description": "Manuals + extracted knowledge for Line 1", "demo": true}'::jsonb,
   'enterprise.riverside.knowledge_base'::ltree, now(), now())
ON CONFLICT (tenant_id, entity_type, name) DO UPDATE
  SET properties = EXCLUDED.properties, uns_path = EXCLUDED.uns_path,
      entity_id = EXCLUDED.entity_id, updated_at = now();

-- ═══ 2. cmms_equipment — 6 headline assets ═══════════════════════════════════
INSERT INTO cmms_equipment
  (id, tenant_id, equipment_number, description, manufacturer, model_number,
   serial_number, equipment_type, location, department, criticality,
   last_reported_fault, qr_generated_at, plc_tag, scada_path, uns_topic_path, uns_path,
   work_order_count, total_downtime_hours, created_at, updated_at)
VALUES
  (:'q_filler'::uuid, :'tenant_id'::uuid, 'FIL-100', 'Volumetric Filler — Line 1',
   'Generic Packaging Systems', 'VF-24', 'FIL-100-2025', 'Filler',
   'Riverside Plant — Packaging, Line 1', 'Maintenance', 'high'::criticalitylevel,
   'Fill-volume drift on valves 7 and 12 — under-fill rejects rising',
   now() - interval '120 days', 'FIL_100', 'Riverside/Line1/Filler',
   'enterprise/riverside/packaging/line1/filler_f100',
   'enterprise.riverside.area.packaging.line.line1.equipment.filler_f100'::ltree,
   1, 3.0, now() - interval '300 days', now()),
  (:'q_capper'::uuid, :'tenant_id'::uuid, 'CAP-100', 'Screw Capper — Line 1',
   'Generic Packaging Systems', 'SC-12', 'CAP-100-2025', 'Capper',
   'Riverside Plant — Packaging, Line 1', 'Maintenance', 'medium'::criticalitylevel,
   'Application torque trending low — clutch check due',
   now() - interval '120 days', 'CAP_100', 'Riverside/Line1/Capper',
   'enterprise/riverside/packaging/line1/capper_c100',
   'enterprise.riverside.area.packaging.line.line1.equipment.capper_c100'::ltree,
   1, 1.0, now() - interval '300 days', now()),
  (:'q_label'::uuid, :'tenant_id'::uuid, 'LAB-100', 'Pressure-Sensitive Labeler — Line 1',
   'Generic Packaging Systems', 'PSL-8', 'LAB-100-2025', 'Labeler',
   'Riverside Plant — Packaging, Line 1', 'Maintenance', 'high'::criticalitylevel,
   'Label misfeed — registration photo-eye intermittently missing index mark',
   now() - interval '120 days', 'LAB_100', 'Riverside/Line1/Labeler',
   'enterprise/riverside/packaging/line1/labeler_l100',
   'enterprise.riverside.area.packaging.line.line1.equipment.labeler_l100'::ltree,
   1, 2.5, now() - interval '300 days', now()),
  (:'q_casepk'::uuid, :'tenant_id'::uuid, 'CSP-100', 'Drop Case Packer — Line 1',
   'Generic Packaging Systems', 'DCP-24', 'CSP-100-2025', 'Case Packer',
   'Riverside Plant — Packaging, Line 1', 'Maintenance', 'medium'::criticalitylevel,
   NULL, now() - interval '120 days', 'CSP_100', 'Riverside/Line1/CasePacker',
   'enterprise/riverside/packaging/line1/case_packer_cp100',
   'enterprise.riverside.area.packaging.line.line1.equipment.case_packer_cp100'::ltree,
   0, 0.0, now() - interval '300 days', now()),
  (:'q_pall'::uuid, :'tenant_id'::uuid, 'PAL-100', 'Layer Palletizer — Line 1',
   'Generic Packaging Systems', 'LP-2', 'PAL-100-2025', 'Palletizer',
   'Riverside Plant — Packaging, end of Line 1', 'Maintenance', 'medium'::criticalitylevel,
   'Idle — awaiting downstream pallet wrapper PM',
   now() - interval '120 days', 'PAL_100', 'Riverside/Line1/Palletizer',
   'enterprise/riverside/packaging/line1/palletizer_pl100',
   'enterprise.riverside.area.packaging.line.line1.equipment.palletizer_pl100'::ltree,
   0, 0.0, now() - interval '300 days', now()),
  (:'q_conv'::uuid, :'tenant_id'::uuid, 'CNV-100', 'Accumulation Conveyor — Line 1',
   'Generic Conveyor Co.', 'AC-3', 'CNV-100-2025', 'Conveyor',
   'Riverside Plant — Packaging, Line 1 mid-section', 'Maintenance', 'high'::criticalitylevel,
   'Belt tracking drift — edge wear on non-drive side',
   now() - interval '120 days', 'CNV_100', 'Riverside/Line1/Conveyor',
   'enterprise/riverside/packaging/line1/conveyor_cv100',
   'enterprise.riverside.area.packaging.line.line1.equipment.conveyor_cv100'::ltree,
   1, 1.5, now() - interval '300 days', now()),
  -- CV-200: the live discharge conveyor (physical rig). uns_topic_path is the live-binding key.
  (:'q_dconv'::uuid, :'tenant_id'::uuid, 'CNV-200', 'Discharge Conveyor — Line 1 (live, end-of-line)',
   'Generic Conveyor Co.', 'DC-4', 'CNV-200-2025', 'Conveyor',
   'Riverside Plant — Packaging, end of Line 1', 'Maintenance', 'high'::criticalitylevel,
   'Intermittent discharge jam — photo-eye index dropouts + one VFD comm fault (CE10) logged',
   now() - interval '120 days', 'CONV_DISCHARGE', 'Riverside/Line1/DischargeConveyor',
   'enterprise/riverside/packaging/line1/discharge_conveyor_cv200',
   'enterprise.riverside.area.packaging.line.line1.equipment.discharge_conveyor_cv200'::ltree,
   1, 0.5, now() - interval '300 days', now())
ON CONFLICT (id) DO UPDATE
  SET description = EXCLUDED.description, manufacturer = EXCLUDED.manufacturer,
      model_number = EXCLUDED.model_number, location = EXCLUDED.location,
      criticality = EXCLUDED.criticality, last_reported_fault = EXCLUDED.last_reported_fault,
      uns_path = EXCLUDED.uns_path, plc_tag = EXCLUDED.plc_tag, scada_path = EXCLUDED.scada_path,
      uns_topic_path = EXCLUDED.uns_topic_path, work_order_count = EXCLUDED.work_order_count,
      total_downtime_hours = EXCLUDED.total_downtime_hours, updated_at = now();

-- ═══ 3. work_orders — 6 rows (4 open/in_progress on Line 1 + 2 completed) ═════
INSERT INTO work_orders
  (id, tenant_id, work_order_number, source, created_by_agent, user_id,
   manufacturer, model_number, equipment_id, title, description, fault_description,
   suggested_actions, safety_warnings, status, priority, route_taken, created_at, updated_at)
VALUES
  (:'w1'::uuid, :'tenant_id'::uuid, 'WO-L1-001', 'hub_ui'::sourcetype, NULL, 'hub_ui_seed',
   'Generic Packaging Systems', 'VF-24', :'q_filler'::uuid,
   'Filler F-100 fill-volume drift — valves 7 & 12 under-filling',
   'Under-fill rejects rising on Line 1. Checkweigher flagging valves 7 and 12.',
   'Fill-volume drift — suspected valve seat wear.',
   ARRAY['Inspect fill valves 7 and 12 for seat wear','Verify fill timing setpoint','Run 50-bottle checkweigher trend after correction']::TEXT[],
   ARRAY['LOTO filler carousel before valve service','Food-contact: sanitize after any valve work']::TEXT[],
   'open'::workorderstatus, 'high'::prioritylevel, 'Hub'::routetype,
   now() - interval '2 days', now() - interval '2 days'),
  (:'w2'::uuid, :'tenant_id'::uuid, 'WO-L1-002', 'telegram_text'::sourcetype, 'MIRA', 'mira_bot',
   'Generic Packaging Systems', 'PSL-8', :'q_label'::uuid,
   'Labeler L-100 label misfeed — registration photo-eye missing index',
   'Label misfeeds ~1 in 30 bottles. Registration photo-eye intermittently misses the index mark.',
   'Label registration fault — photo-eye gain or web tension.',
   ARRAY['Clean label registration photo-eye lens','Check label web tension','Verify photo-eye gain against index mark contrast']::TEXT[],
   ARRAY['Pinch-point at label applicator — keep clear during jog']::TEXT[],
   'in_progress'::workorderstatus, 'high'::prioritylevel, NULL,
   now() - interval '4 days', now() - interval '1 day'),
  (:'w3'::uuid, :'tenant_id'::uuid, 'WO-L1-003', 'hub_ui'::sourcetype, NULL, 'hub_ui_seed',
   'Generic Packaging Systems', 'SC-12', :'q_capper'::uuid,
   'Capper C-100 application torque trending low',
   'Cap removal-torque audit trending below spec. Capper clutch check due.',
   'Low application torque — clutch wear suspected.',
   ARRAY['Audit application torque on 20-cap sample','Inspect and adjust capper clutch','Re-verify torque after adjustment']::TEXT[],
   ARRAY['LOTO capper head before clutch service']::TEXT[],
   'open'::workorderstatus, 'medium'::prioritylevel, 'Hub'::routetype,
   now() - interval '3 days', now() - interval '3 days'),
  (:'w4'::uuid, :'tenant_id'::uuid, 'WO-L1-004', 'telegram_text'::sourcetype, 'MIRA', 'mira_bot',
   'Generic Conveyor Co.', 'AC-3', :'q_conv'::uuid,
   'Accumulation Conveyor CV-100 belt tracking drift',
   'Belt drifting toward non-drive side; edge wear visible. Tracking adjustment needed.',
   'Belt mistracking — alignment/tension.',
   ARRAY['Square the tail pulley','Adjust tracking guides','Inspect belt edge wear and log']::TEXT[],
   ARRAY['LOTO conveyor before tracking adjustment','Nip-point hazard at pulleys']::TEXT[],
   'open'::workorderstatus, 'medium'::prioritylevel, NULL,
   now() - interval '5 days', now() - interval '5 days'),
  (:'w5'::uuid, :'tenant_id'::uuid, 'WO-L1-005', 'auto_pm'::sourcetype, 'pm_scheduler', 'pm_scheduler',
   'Generic Packaging Systems', 'VF-24', :'q_filler'::uuid,
   'Filler F-100 quarterly seal inspection — complete',
   'Quarterly filler seal + valve inspection completed. All within spec.',
   'Routine quarterly inspection.',
   ARRAY['Inspect fill valve seals','Verify CIP coverage']::TEXT[], ARRAY[]::TEXT[],
   'completed'::workorderstatus, 'low'::prioritylevel, 'PM'::routetype,
   now() - interval '40 days', now() - interval '39 days'),
  (:'w6'::uuid, :'tenant_id'::uuid, 'WO-L1-006', 'auto_pm'::sourcetype, 'pm_scheduler', 'pm_scheduler',
   'Generic Conveyor Co.', 'AC-3', :'q_conv'::uuid,
   'Conveyor CV-100 bearing lubrication — complete',
   'Six-month bearing lubrication completed on drive and tail pulleys.',
   'Routine lubrication PM.',
   ARRAY['Lubricate drive/tail bearings']::TEXT[], ARRAY['LOTO before lubrication']::TEXT[],
   'completed'::workorderstatus, 'low'::prioritylevel, 'PM'::routetype,
   now() - interval '50 days', now() - interval '49 days'),
  (:'w7'::uuid, :'tenant_id'::uuid, 'WO-L1-007', 'hub_ui'::sourcetype, NULL, 'hub_ui_seed',
   'Generic Conveyor Co.', 'DC-4', :'q_dconv'::uuid,
   'Discharge Conveyor CV-200 — intermittent jam at discharge photo-eye',
   'Finished cases intermittently backing up at the discharge. Photo-eye index dropouts suspected; one VFD comm fault (CE10) logged. Live troubleshooting target from the Command Center.',
   'Intermittent jam / sensor dropout at discharge end-of-line.',
   ARRAY['Clean and re-align discharge jam photo-eye','Check GS10 VFD comm wiring + termination (CE10)','Verify belt tracking and discharge transfer gap','Correlate with live tag history in MIRA']::TEXT[],
   ARRAY['LOTO discharge conveyor before clearing a jam','Nip-point hazard at drive/tail pulleys']::TEXT[],
   'open'::workorderstatus, 'high'::prioritylevel, 'Hub'::routetype,
   now() - interval '1 day', now() - interval '1 day')
ON CONFLICT (id) DO NOTHING;

-- ═══ 4. pm_schedules — 6 rows (3 auto_extracted w/ citation; mix overdue/upcoming) ═
INSERT INTO pm_schedules
  (id, tenant_id, manufacturer, model_number, equipment_id, task,
   interval_value, interval_unit, interval_type, parts_needed, tools_needed,
   estimated_duration_minutes, safety_requirements, criticality, source_citation,
   confidence, next_due_at, last_completed_at, auto_extracted, trigger_type, meter_current,
   created_at, updated_at)
VALUES
  (:'p1'::uuid, :'tenant_id'::uuid, 'Generic Packaging Systems', 'VF-24', :'q_filler'::uuid,
   'Inspect and reseat fill valves; verify fill accuracy with checkweigher',
   3, 'months', 'fixed', '["fill valve seal kit"]'::jsonb, '["checkweigher", "torque driver"]'::jsonb,
   45, '["LOTO filler", "sanitize food-contact surfaces"]'::jsonb, 'high',
   'Filler VF-24 service manual §6.2 — quarterly valve seat inspection prevents fill drift.',
   0.95, now() - interval '10 days', now() - interval '100 days', TRUE, 'calendar', 0,
   now() - interval '300 days', now()),
  (:'p2'::uuid, :'tenant_id'::uuid, 'Generic Packaging Systems', 'PSL-8', :'q_label'::uuid,
   'Clean label registration photo-eye and verify index detection',
   1, 'months', 'fixed', '[]'::jsonb, '["lint-free cloth"]'::jsonb,
   15, '[]'::jsonb, 'medium',
   'Labeler PSL-8 manual §4.1 — monthly photo-eye cleaning maintains label registration.',
   0.92, now() + interval '8 days', now() - interval '22 days', TRUE, 'calendar', 0,
   now() - interval '300 days', now()),
  (:'p3'::uuid, :'tenant_id'::uuid, 'Generic Packaging Systems', 'SC-12', :'q_capper'::uuid,
   'Audit capper application torque and inspect clutch',
   3, 'months', 'fixed', '[]'::jsonb, '["torque tester"]'::jsonb,
   30, '["LOTO capper head"]'::jsonb, 'medium',
   'Capper SC-12 manual §5.3 — quarterly torque audit catches clutch wear.',
   0.90, now() + interval '20 days', now() - interval '70 days', TRUE, 'calendar', 0,
   now() - interval '300 days', now()),
  (:'p4'::uuid, :'tenant_id'::uuid, 'Generic Conveyor Co.', 'AC-3', :'q_conv'::uuid,
   'Lubricate conveyor drive and tail pulley bearings',
   6, 'months', 'fixed', '["NLGI 2 grease"]'::jsonb, '["grease gun"]'::jsonb,
   20, '["LOTO conveyor"]'::jsonb, 'medium', NULL,
   0.80, now() + interval '30 days', now() - interval '49 days', FALSE, 'calendar', 0,
   now() - interval '300 days', now()),
  (:'p5'::uuid, :'tenant_id'::uuid, 'Generic Conveyor Co.', 'AC-3', :'q_conv'::uuid,
   'Inspect belt tracking, tension, and edge wear',
   2000, 'hours', 'meter', '["spare belt"]'::jsonb, '["tension gauge"]'::jsonb,
   40, '["LOTO conveyor", "nip-point hazard"]'::jsonb, 'high',
   'Conveyor AC-3 manual §4.4 — inspect/replace belt at 2000 run-hours or 20% wear.',
   0.88, now() + interval '120 days', now() - interval '300 days', TRUE, 'calendar_or_meter', 1500,
   now() - interval '300 days', now()),
  (:'p6'::uuid, :'tenant_id'::uuid, 'Generic Packaging Systems', 'LP-2', :'q_pall'::uuid,
   'Inspect palletizer layer-sheet dispenser and vacuum cups',
   6, 'months', 'fixed', '[]'::jsonb, '["flashlight"]'::jsonb,
   25, '["LOTO palletizer", "guard interlock check"]'::jsonb, 'medium', NULL,
   0.78, now() + interval '55 days', now() - interval '125 days', FALSE, 'calendar', 0,
   now() - interval '300 days', now()),
  (:'p7'::uuid, :'tenant_id'::uuid, 'Generic Conveyor Co.', 'DC-4', :'q_dconv'::uuid,
   'Inspect discharge photo-eye, belt tracking, and GS10 VFD comm wiring',
   3, 'months', 'fixed', '["spare photo-eye"]'::jsonb, '["lint-free cloth", "meter"]'::jsonb,
   30, '["LOTO discharge conveyor", "nip-point hazard"]'::jsonb, 'high', NULL,
   0.82, now() + interval '15 days', now() - interval '75 days', FALSE, 'calendar', 0,
   now() - interval '300 days', now())
ON CONFLICT (id) DO NOTHING;

-- ═══ 5. kg_relationships — line topology edges ════════════════════════════════
INSERT INTO kg_relationships (tenant_id, source_id, target_id, relationship_type, confidence, properties)
SELECT :'tenant_id'::uuid, vfd.id, conv.id, 'DRIVES', 0.98, '{"notes": "Conveyor VFD drives accumulation conveyor motor"}'::jsonb
FROM kg_entities vfd, kg_entities conv
WHERE vfd.id = :'e_vfd'::uuid AND conv.id = :'e_conv'::uuid
  AND vfd.tenant_id = :'tenant_id'::uuid AND conv.tenant_id = :'tenant_id'::uuid
ON CONFLICT (tenant_id, source_id, target_id, relationship_type) DO NOTHING;

INSERT INTO kg_relationships (tenant_id, source_id, target_id, relationship_type, confidence, properties)
SELECT :'tenant_id'::uuid, dvfd.id, dmotor.id, 'DRIVES', 0.98, '{"notes": "GS10 VFD drives discharge conveyor motor (live rig)"}'::jsonb
FROM kg_entities dvfd, kg_entities dmotor
WHERE dvfd.id = :'e_dvfd'::uuid AND dmotor.id = :'e_dcmotor'::uuid
  AND dvfd.tenant_id = :'tenant_id'::uuid AND dmotor.tenant_id = :'tenant_id'::uuid
ON CONFLICT (tenant_id, source_id, target_id, relationship_type) DO NOTHING;

INSERT INTO kg_relationships (tenant_id, source_id, target_id, relationship_type, confidence, properties)
SELECT :'tenant_id'::uuid, plc.id, line.id, 'CONTROLS', 0.99, '{"protocol": "EtherNet/IP"}'::jsonb
FROM kg_entities plc, kg_entities line
WHERE plc.id = :'e_plc'::uuid AND line.id = :'e_line'::uuid
  AND plc.tenant_id = :'tenant_id'::uuid AND line.tenant_id = :'tenant_id'::uuid
ON CONFLICT (tenant_id, source_id, target_id, relationship_type) DO NOTHING;

-- ═══ 6. health_scores — /feed readiness widget ════════════════════════════════
INSERT INTO health_scores
  (tenant_id, scope, scope_path, level, next_step, counts, computed_at)
VALUES
  (:'tenant_id'::uuid, 'tenant', '', 3, 'Verify 3 pending proposals to reach L4',
   '{"assets": 7, "components": 5, "docs": 2, "proposals_pending": 3, "proposals_verified": 6, "uns_paths": 21, "wizard_completed": false}'::jsonb,
   now())
ON CONFLICT (tenant_id, scope, scope_path) DO UPDATE
  SET level = EXCLUDED.level, next_step = EXCLUDED.next_step,
      counts = EXCLUDED.counts, computed_at = now(), updated_at = now();

COMMIT;

-- Verify (run after apply):
--   SELECT 'kg_entities' t, count(*) FROM kg_entities WHERE tenant_id = :'tenant_id'::uuid
--   UNION ALL SELECT 'cmms_equipment', count(*) FROM cmms_equipment WHERE tenant_id = :'tenant_id'::uuid
--   UNION ALL SELECT 'work_orders', count(*) FROM work_orders WHERE tenant_id = :'tenant_id'::uuid
--   UNION ALL SELECT 'work_orders_open', count(*) FROM work_orders WHERE tenant_id = :'tenant_id'::uuid AND status IN ('open','in_progress')
--   UNION ALL SELECT 'pm_schedules', count(*) FROM pm_schedules WHERE tenant_id = :'tenant_id'::uuid;

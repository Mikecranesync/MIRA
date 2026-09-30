-- =============================================================================
-- Demo Conveyor 001 — VFD-001 / PLC-001 component templates + RS-485 wiring
-- =============================================================================
-- Purpose : Seed MIRA's NeonDB knowledge_entries with the component-level
--           topology of Mike's garage demo conveyor so the diagnostic
--           engine can retrieve:
--             - the GS10 VFD-001 "component template" (register map,
--               RS-485 comm params, failure modes, diagnostic steps,
--               safety notes)
--             - the Micro820 PLC-001 component template (Modbus RTU master,
--               CCW serial port config, MSG_MODBUS .ErrorID bands)
--             - the PLC-001 ↔ VFD-001 RS-485 wiring relationship
--             - the VFD-001 Modbus RTU communication relationship
--           during the 2026-05-16 garage demo.
--
-- Target  : knowledge_entries  (NeonDB, pgvector)
--           Schema: docs/migrations/001_knowledge_entries.sql
--           VERIFIED DEPLOYED — currently holds 25K+ production rows.
--
-- WHY THIS TABLE (not kg_entities / kg_relationships):
--   The dedicated knowledge-graph tables exist in two incompatible
--   variants in this repo:
--     - mira-hub/db/migrations/001_knowledge_graph.sql  → UUID tenant,
--       source_id/target_id/relationship_type, no_self_loop CHECK, RLS.
--     - docs/migrations/004_kg_entities.sql + 005_kg_relationships.sql
--       → both marked "PLANNED — do not run until GraphRAG phase starts".
--   Whichever variant is live, the diagnostic engine's live recall path
--   is knowledge_entries (verified, with tsvector + pgvector retrieval).
--   Encoding the topology as knowledge_entries chunks therefore guarantees
--   the demo works regardless of GraphRAG deployment state.
--
--   A commented-out kg_entities / kg_relationships block is included at
--   the bottom for the day GraphRAG ships. Uncomment + adapt to the live
--   schema then.
--
-- Tenant  : Set via psql variable. Default 'mike-garage-demo'.
--
-- Usage   :
--   psql "$DATABASE_URL" \
--        -v tenant_id="'mike-garage-demo'" \
--        -f tools/seeds/demo-conveyor-001.sql
--
-- Idempotent (v2 reconciles; see the note after BEGIN). Keyed on
--   (tenant_id, source_url, source_page). Re-running is safe — no
--   duplicate rows, no errors.
--
-- Companion seed: tools/seeds/gs10-vfd-knowledge.sql (manufacturer-level
--   GS10 integration guide chunks). Run BOTH for a complete demo.
-- =============================================================================

\set ON_ERROR_STOP on
\set tenant_id_default '''78917b56-f85f-43bb-9a08-1bb98a6cd6c3'''
\if :{?tenant_id}
\else
\set tenant_id :tenant_id_default
\endif

BEGIN;

-- v2 (2026-09-27): rows are staged in seed_rows, then reconciled into
-- knowledge_entries: a missing row is inserted; an existing row whose content
-- or metadata differs is updated in place, and its embedding is cleared when
-- the content changed (the old vector describes the old text — re-run
-- tools/backfill_knowledge_embeddings.py). v1 was insert-only, so a corrected
-- chunk could never reach an environment that already had the old one (#4031).
CREATE TEMP TABLE seed_rows (LIKE knowledge_entries INCLUDING DEFAULTS) ON COMMIT DROP;

-- ---------------------------------------------------------------------------
-- Component template: VFD-001 (AutomationDirect GS10)
-- ---------------------------------------------------------------------------
INSERT INTO seed_rows (
    id, tenant_id, source_type, manufacturer, model_number, equipment_type,
    content, source_url, source_page, metadata,
    is_private, verified, chunk_type, created_at
)
SELECT
    gen_random_uuid(),
    :tenant_id,
    'component_template',
    'AutomationDirect',
    'GS10',
    'vfd',
$content$
COMPONENT TEMPLATE — VFD-001 (AutomationDirect GS10).

Role           : Conveyor drive on Mike's garage demo (2026-05-16).
Criticality    : Demo-critical — single VFD on the conveyor.
Comm role      : Modbus RTU slave on the RS-485 trunk shared with PLC-001.

RS-485 / MODBUS RTU COMMUNICATION PARAMETERS (bench-verified; source
plc/GS10_Integration_Guide.md and device-profiles/gs10.yaml):

  P00.21 = 2    Run command source = RS-485 Modbus (0 = keypad,
                1 = terminals). Left at 0, run/stop writes to 0x2000
                are ignored and the keypad still commands the drive.
                **#1 failure mode.**
  P00.20        Frequency command source (default 0 = keypad). The rig
                writes speed to 0x2001; if speed writes are ignored,
                check P00.20.
  P09.00 = 1    Modbus slave address (1..254). Must match the Micro820
                MSG_MODBUS Slave field exactly.
  P09.01 = 96   Baud rate, value = baud / 100 (96 = 9600).
  P09.04 = 13   Frame = RTU 8 data, No parity, 2 stop (8N2).
                (12 = 8N1, 14 = 8E1, 15 = 8O1, 17 = 8O2.)
  P09.03 = 5.0  Comm timeout (s). Silence longer trips CE10 (code 58).

Power-cycle the GS10 after changing P09.xx — the port is set up at boot.

MODBUS REGISTER MAP — WRITE (master → slave, FC 06):
  0x2000 (8192)  Control command, bit field: 18 = RUN forward,
                 20 = RUN reverse, 1 = STOP.
  0x2001 (8193)  Frequency setpoint, Hz x 10 (600 = 60.0 Hz).
  0x2002 (8194)  Control code 2: write 0x0002 (bit 1) = fault reset.

MODBUS REGISTER MAP — READ (FC 03):
  0x2100 (8448)  Status monitor 1: low byte = fault code, high byte =
                 warning. 0 = no fault.
  0x2101 (8449)  Status monitor 2: operation status bits.
  0x2102 (8450)  Frequency command, Hz x 10.
  0x2103 (8451)  Output frequency, Hz x 10.
  0x2104 (8452)  Output current, A x 10.
  0x2105 (8453)  DC bus voltage, V.
  0x2106 (8454)  Output voltage, V.

FAILURE MODES — ranked by first-time-integration frequency:
  1. **P00.21 not set to 2 (RS-485).** Reads work, run/stop writes
     silently ignored, keypad still commands drive. Fix: P00.21 = 2.
  2. Baud / parity mismatch. MSG_MODBUS .ErrorID 0x0001..0x0010
     (framing/parity reject). Fix: align CCW serial port (9600, 8N2)
     with P09.01=96 and P09.04=13.
  3. Missing 120 Ω termination at far end of trunk. Intermittent
     ErrorID 0x0100..0x0200 (timeout). Fix: 120 Ω across D+/D- at GS10
     end; enable Micro820 internal termination at PLC end.
  4. D+/D- polarity swapped. 100 % timeout. Fix: swap one end. A/B
     labelling is NOT universal — verify per nameplate.
  5. Slave ID mismatch (P09.00 ≠ MSG_MODBUS Slave). Timeout on one
     slave only. Fix: read P09.00 on keypad, align Micro820 config.
  6. EMI from VFD output picked up on RS-485 pair. CRC errors under
     load, clean when motor stops. Fix: dedicated conduit; shielded
     twisted pair (Belden 3105A); shield grounded at PLC end ONLY.
  7. SGND not connected across panels. Bench works, cabinet fails.
     Fix: pull a third conductor for SGND alongside D+/D-.

DIAGNOSTIC STEPS — keyed to Micro820 MSG_MODBUS .ErrorID bands:
  .ErrorID 0x0001..0x0010  (protocol / framing)
     → CCW serial port = 9600, 8 data, No parity, 2 stop, RTU Master?
     → GS10 P09.04 = 13 (RTU 8N2)?
     → GS10 P09.01 = 96 (9600)?
  .ErrorID 0x0100..0x0200  (timeout / wiring)
     → D+/D- idle ~2.5 V, ~200 mV swing on traffic?
     → P09.00 == MSG_MODBUS Slave field?
     → 120 Ω across D+/D- at GS10 end?
     → Swap D+/D- as the cheapest polarity test.
  .ErrorID > 0x0200        (Modbus exception from slave)
     → Register address valid per the map above?
     → Map: 0x2000 command, 0x2001 frequency, 0x2002 fault reset.
       If run/stop is ignored: re-verify P00.21=2.

SAFETY NOTES:
  - RS-485 cable MUST be separated from VFD output (U/T1, V/T2, W/T3)
    by ≥ 300 mm of air OR routed in a separate metallic conduit. VFD
    PWM is the largest EMI source in the panel.
  - RS-485 cable MUST be shielded twisted pair (Belden 3105A or
    equivalent). Ground the shield at the PLC end ONLY — never both
    ends (ground loop induces 60 Hz hum).
  - Before opening the GS10 enclosure: lock out the disconnect, wait
    5 minutes for DC bus to drain, verify < 24 VDC across PA/+ and PC/-.

Manual reference: AutomationDirect GS10 User Manual, P/N GS1-M
  (parameters: ch.5, fault codes: ch.6, wiring: ch.3).
$content$,
    'mira://seeds/demo-conveyor-001/VFD-001',
    0,
    jsonb_build_object(
        'asset_tag', 'VFD-001',
        'manufacturer', 'AutomationDirect',
        'model', 'GS10',
        'document_type', 'component_template',
        'role', 'conveyor_drive',
        'criticality', 'demo-critical',
        'protocol', 'modbus_rtu',
        'transport', 'rs485',
        'comm_role', 'slave',
        'required_drive_params', jsonb_build_object(
            'P00.21', 2,
            'P09.00', 1,
            'P09.01', 96,
            'P09.04', 13
        ),
        'register_anchors', jsonb_build_object(
            'control_cmd', '0x2000',
            'freq_ref',    '0x2001',
            'fault_reset', '0x2002',
            'fault_code',  '0x2100',
            'status_word', '0x2101',
            'output_freq', '0x2103',
            'output_amps', '0x2104',
            'dc_bus_v',    '0x2105'
        ),
        'top_failure_mode', 'P00.21 not set to RS-485 (2)',
        'errorid_bands', jsonb_build_object(
            '0x0001..0x0010', 'protocol/framing — parity/stop/data/mode/CRC',
            '0x0100..0x0200', 'timeout/wiring — open/polarity/termination/slave_id/SGND',
            '>0x0200',        'Modbus exception — illegal function/address/value'
        ),
        'safety_keywords', jsonb_build_array(
            'arc_flash_DC_bus',
            'shielded_twisted_pair_required',
            'shield_ground_PLC_end_only',
            'separate_conduit_from_VFD_power'
        ),
        'seed_source', 'tools/seeds/demo-conveyor-001.sql',
        'seed_version', '2',
        'seed_date', '2026-09-27'
    ),
    false, true, 'component_template', now()
WHERE NOT EXISTS (
    SELECT 1 FROM seed_rows
     WHERE tenant_id = :tenant_id
       AND source_url = 'mira://seeds/demo-conveyor-001/VFD-001'
       AND source_page = 0
);

-- ---------------------------------------------------------------------------
-- Component template: PLC-001 (Allen-Bradley Micro820, Modbus RTU master)
-- ---------------------------------------------------------------------------
INSERT INTO seed_rows (
    id, tenant_id, source_type, manufacturer, model_number, equipment_type,
    content, source_url, source_page, metadata,
    is_private, verified, chunk_type, created_at
)
SELECT
    gen_random_uuid(),
    :tenant_id,
    'component_template',
    'Allen-Bradley',
    'Micro820',
    'plc',
$content$
COMPONENT TEMPLATE — PLC-001 (Allen-Bradley Micro820).

Role           : Conveyor controller on Mike's garage demo (2026-05-16).
Criticality    : Demo-critical — sole controller.
Comm role      : Modbus RTU master on the RS-485 trunk to VFD-001.

CCW (CONNECTED COMPONENTS WORKBENCH) SERIAL PORT CONFIG:
  Project tree → Micro820 → Embedded Serial Port (or plug-in module)
                          → Properties.

    Driver            : Modbus RTU Master
    Baud rate         : 9600
    Data bits         : 8
    Parity            : None
    Stop bits         : 2
    Media             : RS-485
    Response timeout  : 1000 ms (raise to 2000 ms while debugging
                        on a noisy plant)
    Retries           : 3

  Channel number is typically Ch.2 for the embedded port and Ch.5+ for
  plug-ins — confirm in CCW under Communication Ports. MSG_MODBUS
  instances must reference the channel by its CCW-assigned number.

MSG_MODBUS .ErrorID DECODE — these three bands cover almost every
RS-485 / Modbus RTU fault you will see at startup:

  0x0001 .. 0x0010   PROTOCOL / FRAMING — bytes arriving, malformed.
                     Causes: parity, stop bits, data bits, mode (ASCII
                     vs RTU), CRC mismatch.
                     Check: CCW serial port settings vs GS10 P09.01,
                     P09.04.

  0x0100 .. 0x0200   TIMEOUT / WIRING — no response inside window.
                     Causes: cable open, D+/D- swapped, missing 120 Ω
                     termination, slave ID mismatch, SGND missing
                     across panels.
                     Check: probe D+/D- (~2.5 V idle, ~200 mV swing on
                     traffic); P09.00 vs MSG_MODBUS Slave; terminator
                     at GS10 end; swap D+/D- as a free polarity test.

  > 0x0200           MODBUS EXCEPTION — slave rejected the request
                     (illegal function/address/value). Comms is OK.
                     Check: register address matches GS10 map. For
                     run/stop ignored: re-verify GS10 P00.21=2.

CANONICAL POLL EXAMPLE — read 4 live telemetry registers:
  MSG_MODBUS
    Slave         = P09.00 value (from GS10 keypad)
    Function      = 0x03 (Read Holding Registers)
    Starting addr = 8451 (0x2103, output freq)
    Quantity      = 4      (output freq, current, dc bus, output volt)
    Local addr    = HoldingReg[100]  (lands in HR100..HR103)
  Poll 8448 (0x2100) on a 1 Hz cadence for faults: low byte = fault code.

SAFETY NOTES:
  - Download programs to the Micro820 with the panel disconnect
    locked out if the program controls live equipment.
  - The 2080-SERIALISOL plug-in offers isolated RS-485 (recommended
    in noisy panels). The embedded port shares the PLC's reference,
    which can pick up motor PWM noise on long shared returns.

Manual reference: Rockwell Automation Micro820 Programmable Controllers
User Manual, P/N 2080-UM005.
$content$,
    'mira://seeds/demo-conveyor-001/PLC-001',
    0,
    jsonb_build_object(
        'asset_tag', 'PLC-001',
        'manufacturer', 'Allen-Bradley',
        'model', 'Micro820',
        'document_type', 'component_template',
        'role', 'conveyor_controller',
        'criticality', 'demo-critical',
        'protocol', 'modbus_rtu',
        'transport', 'rs485',
        'comm_role', 'master',
        'ccw_config', jsonb_build_object(
            'driver', 'Modbus RTU Master',
            'baud', 9600,
            'data_bits', 8,
            'parity', 'None',
            'stop_bits', 2,
            'media', 'RS-485',
            'response_timeout_ms', 1000,
            'retries', 3
        ),
        'function_block', 'MSG_MODBUS',
        'errorid_bands', jsonb_build_object(
            '0x0001..0x0010', 'protocol/framing',
            '0x0100..0x0200', 'timeout/wiring',
            '>0x0200',        'modbus_exception'
        ),
        'seed_source', 'tools/seeds/demo-conveyor-001.sql',
        'seed_version', '2',
        'seed_date', '2026-09-27'
    ),
    false, true, 'component_template', now()
WHERE NOT EXISTS (
    SELECT 1 FROM seed_rows
     WHERE tenant_id = :tenant_id
       AND source_url = 'mira://seeds/demo-conveyor-001/PLC-001'
       AND source_page = 0
);

-- ---------------------------------------------------------------------------
-- Relationship proposal: PLC-001 (Serial Port Ch.2) WIRED_TO VFD-001 (RS-485)
-- ---------------------------------------------------------------------------
INSERT INTO seed_rows (
    id, tenant_id, source_type, manufacturer, model_number, equipment_type,
    content, source_url, source_page, metadata,
    is_private, verified, chunk_type, created_at
)
SELECT
    gen_random_uuid(),
    :tenant_id,
    'relationship_proposal',
    NULL,
    NULL,
    'system',
$content$
RELATIONSHIP PROPOSAL — PLC-001 WIRED_TO VFD-001.

Topology      : Point-to-point 2-wire RS-485 + signal common, Micro820
                serial port Ch.2 → GS10 RS+/RS-/SG terminal block.

Description   : "2-wire RS-485: D+→D+, D-→D-, SGND→Common"

Pinout:
  PLC-001 Ch.2 D+ (TX+ / A)   →   VFD-001 RS+ (D+ / A)
  PLC-001 Ch.2 D- (TX- / B)   →   VFD-001 RS- (D- / B)
  PLC-001 Ch.2 SGND (0V)      →   VFD-001 SG  (Signal Common)

Cable          : Shielded twisted pair, 22-24 AWG, 120 Ω characteristic
                 impedance. Belden 3105A is canonical; Alpha 6412
                 acceptable.

Termination    : 120 Ω resistor across D+/D- at the GS10 end. Enable
                 the Micro820 internal termination at the PLC end
                 (typically a dip-switch on the serial port plug-in or
                 the embedded port). Two terminators total — not one
                 per device on a multi-drop bus.

Shield ground  : Bond shield at the PLC end ONLY. Never both ends —
                 a double bond creates a ground loop and induces 60 Hz
                 hum on the RS-485 pair.

Physical separation (SAFETY):
  ≥ 300 mm of air gap or routed in a separate metallic conduit from:
    - VFD output power (U/T1, V/T2, W/T3)
    - DC bus wiring (PA/+, PC/-)
    - Motor cable
  Parallel routing with VFD output = guaranteed intermittent comms.

Status         : proposal (auto-generated by demo seed; verify in the
                 field before commissioning).
$content$,
    'mira://seeds/demo-conveyor-001/REL/PLC-001-WIRED_TO-VFD-001',
    0,
    jsonb_build_object(
        'relation_type', 'WIRED_TO',
        'source_entity', 'PLC-001',
        'source_port', 'Serial Port Ch.2',
        'target_entity', 'VFD-001',
        'target_port', 'RS-485 terminals (RS+, RS-, SG)',
        'description', '2-wire RS-485: D+→D+, D-→D-, SGND→Common',
        'cable_type', 'Shielded twisted pair, 22-24 AWG, 120 Ohm (Belden 3105A or equivalent)',
        'termination', '120 Ohm at GS10 end; Micro820 internal termination enabled at PLC end',
        'shield_ground', 'PLC end ONLY',
        'physical_separation_mm', 300,
        'status', 'proposal',
        'seed_source', 'tools/seeds/demo-conveyor-001.sql',
        'seed_version', '2',
        'seed_date', '2026-09-27'
    ),
    false, true, 'relationship_proposal', now()
WHERE NOT EXISTS (
    SELECT 1 FROM seed_rows
     WHERE tenant_id = :tenant_id
       AND source_url = 'mira://seeds/demo-conveyor-001/REL/PLC-001-WIRED_TO-VFD-001'
       AND source_page = 0
);

-- ---------------------------------------------------------------------------
-- Relationship proposal: VFD-001 COMMUNICATES_VIA Modbus RTU
-- ---------------------------------------------------------------------------
INSERT INTO seed_rows (
    id, tenant_id, source_type, manufacturer, model_number, equipment_type,
    content, source_url, source_page, metadata,
    is_private, verified, chunk_type, created_at
)
SELECT
    gen_random_uuid(),
    :tenant_id,
    'relationship_proposal',
    NULL,
    NULL,
    'system',
$content$
RELATIONSHIP PROPOSAL — VFD-001 COMMUNICATES_VIA Modbus RTU.

Description   : "Modbus RTU, Slave ID per P09.00, 9600 baud, 8N2"

Bus spec:
  Protocol           : Modbus RTU
  Transport          : RS-485 (2-wire D+/D- + signal common)
  Baud               : 9600 bps
  Framing            : 8 data bits, No parity, 2 stop bits  (RTU 8N2)
  Slave ID source    : GS10 keypad parameter P09.00 (1..254 — set per
                       multi-drop topology, default 1)

Required GS10 parameters (must all be set for the bus to function):
  P00.21 = 2   (run command source = RS-485)
  P09.01 = 96  (9600 baud)
  P09.04 = 13  (RTU 8N2)
  (See VFD-001 component template for encoding details.)

Register anchors most often used by the diagnostic engine:
  Control command     → 0x2000 (18 fwd run, 20 rev run, 1 stop)
  Frequency setpoint  → 0x2001 (Hz x 10)
  Fault reset         → 0x2002 (write 0x0002)
  Fault code (current)→ 0x2100 low byte
  Status monitor 2    → 0x2101
  Output frequency    → 0x2103
  Output current      → 0x2104
  DC bus voltage      → 0x2105

Status         : proposal (auto-generated by demo seed; verify P09.00
                 on the keypad before commissioning).
$content$,
    'mira://seeds/demo-conveyor-001/REL/VFD-001-COMMUNICATES_VIA-ModbusRTU',
    0,
    jsonb_build_object(
        'relation_type', 'COMMUNICATES_VIA',
        'source_entity', 'VFD-001',
        'description', 'Modbus RTU, Slave ID per P09.00, 9600 baud, 8N2',
        'protocol', 'Modbus RTU',
        'transport', 'RS-485',
        'baud', 9600,
        'data_bits', 8,
        'parity', 'None',
        'stop_bits', 2,
        'framing', 'RTU 8N2',
        'slave_id_source', 'GS10 parameter P09.00',
        'required_drive_params', jsonb_build_object(
            'P00.21', 2,
            'P09.01', 96,
            'P09.04', 13
        ),
        'register_anchors', jsonb_build_object(
            'control_cmd', '0x2000',
            'freq_ref',    '0x2001',
            'fault_reset', '0x2002',
            'fault_code',  '0x2100',
            'status_word', '0x2101',
            'output_freq', '0x2103',
            'output_amps', '0x2104',
            'dc_bus_v',    '0x2105'
        ),
        'status', 'proposal',
        'seed_source', 'tools/seeds/demo-conveyor-001.sql',
        'seed_version', '2',
        'seed_date', '2026-09-27'
    ),
    false, true, 'relationship_proposal', now()
WHERE NOT EXISTS (
    SELECT 1 FROM seed_rows
     WHERE tenant_id = :tenant_id
       AND source_url = 'mira://seeds/demo-conveyor-001/REL/VFD-001-COMMUNICATES_VIA-ModbusRTU'
       AND source_page = 0
);

-- Reconcile staged rows into knowledge_entries (see header note).
UPDATE knowledge_entries k
   SET content  = s.content,
       metadata = s.metadata,
       embedding = CASE WHEN k.content IS DISTINCT FROM s.content THEN NULL ELSE k.embedding END
  FROM seed_rows s
 WHERE k.tenant_id = s.tenant_id
   AND k.source_url = s.source_url
   AND k.source_page = s.source_page
   AND (k.content, k.metadata) IS DISTINCT FROM (s.content, s.metadata);

INSERT INTO knowledge_entries (
    id, tenant_id, source_type, manufacturer, model_number, equipment_type,
    content, source_url, source_page, metadata,
    is_private, verified, chunk_type, created_at
)
SELECT id, tenant_id, source_type, manufacturer, model_number, equipment_type,
       content, source_url, source_page, metadata,
       is_private, verified, chunk_type, created_at
  FROM seed_rows s
 WHERE NOT EXISTS (
    SELECT 1 FROM knowledge_entries k
     WHERE k.tenant_id = s.tenant_id
       AND k.source_url = s.source_url
       AND k.source_page = s.source_page
);

COMMIT;

-- ---------------------------------------------------------------------------
-- GraphRAG optional block — kg_entities / kg_relationships
-- ---------------------------------------------------------------------------
-- The diagnostic engine's live recall path is knowledge_entries (above).
-- The kg_entities / kg_relationships layer is a planned GraphRAG enhancement
-- with two incompatible schema variants observed in this repo:
--
--   A) mira-hub/db/migrations/001_knowledge_graph.sql
--      UUID tenant_id, source_id/target_id, relationship_type,
--      no_self_loop CHECK, RLS on app.current_tenant_id.
--
--   B) docs/migrations/004_kg_entities.sql + 005_kg_relationships.sql
--      TEXT tenant_id, source_entity/target_entity, relation_type,
--      no RLS, no self-loop CHECK. (Both marked "PLANNED — do not run".)
--
-- Before uncommenting either block: confirm the live schema with
--   psql "$DATABASE_URL" -c "\d kg_entities" -c "\d kg_relationships"
-- and pick the matching variant.
--
-- ============ Variant A: mira-hub UUID schema ============
-- SET LOCAL app.current_tenant_id = :tenant_id::uuid;
--
-- INSERT INTO kg_entities (tenant_id, entity_type, entity_id, name, properties)
-- VALUES (:tenant_id::uuid, 'component', 'VFD-001',
--         'GS10 VFD — Conveyor Drive (VFD-001)',
--         '{"manufacturer":"AutomationDirect","model":"GS10",
--           "role":"conveyor_drive"}'::jsonb)
-- ON CONFLICT (tenant_id, entity_type, entity_id) DO NOTHING;
--
-- INSERT INTO kg_entities (tenant_id, entity_type, entity_id, name, properties)
-- VALUES (:tenant_id::uuid, 'component', 'PLC-001',
--         'Micro820 PLC — Conveyor Controller (PLC-001)',
--         '{"manufacturer":"Allen-Bradley","model":"Micro820",
--           "role":"conveyor_controller"}'::jsonb)
-- ON CONFLICT (tenant_id, entity_type, entity_id) DO NOTHING;
--
-- -- For COMMUNICATES_VIA we need a third entity (no self-loops).
-- INSERT INTO kg_entities (tenant_id, entity_type, entity_id, name, properties)
-- VALUES (:tenant_id::uuid, 'comm_bus', 'BUS-RS485-001',
--         'RS-485 Modbus RTU trunk (PLC-001 Ch.2 ↔ VFD-001)',
--         '{"protocol":"Modbus RTU","transport":"RS-485",
--           "baud":9600,"framing":"RTU 8N2"}'::jsonb)
-- ON CONFLICT (tenant_id, entity_type, entity_id) DO NOTHING;
--
-- INSERT INTO kg_relationships
--        (tenant_id, source_id, target_id, relationship_type, properties)
-- SELECT :tenant_id::uuid, plc.id, vfd.id, 'WIRED_TO',
--        '{"description":"2-wire RS-485: D+→D+, D-→D-, SGND→Common",
--          "status":"proposal"}'::jsonb
--   FROM kg_entities plc, kg_entities vfd
--  WHERE plc.tenant_id = :tenant_id::uuid AND plc.entity_id = 'PLC-001'
--    AND vfd.tenant_id = :tenant_id::uuid AND vfd.entity_id = 'VFD-001';
--
-- INSERT INTO kg_relationships
--        (tenant_id, source_id, target_id, relationship_type, properties)
-- SELECT :tenant_id::uuid, vfd.id, bus.id, 'COMMUNICATES_VIA',
--        '{"description":"Modbus RTU, Slave ID per P09.00, 9600 baud, 8N2",
--          "status":"proposal"}'::jsonb
--   FROM kg_entities vfd, kg_entities bus
--  WHERE vfd.tenant_id = :tenant_id::uuid AND vfd.entity_id = 'VFD-001'
--    AND bus.tenant_id = :tenant_id::uuid AND bus.entity_id = 'BUS-RS485-001';
--
-- ============ Variant B: docs-migrations TEXT schema ============
-- Replace the column names (source_id→source_entity, target_id→target_entity,
-- relationship_type→relation_type) and drop the ::uuid casts; the BUS-RS485-001
-- bridge entity is optional (no CHECK constraint on self-loops in variant B).
-- ---------------------------------------------------------------------------

-- Verification (run manually after \i'ing this file):
--
--   SELECT chunk_type, metadata->>'asset_tag' AS tag,
--          metadata->>'relation_type' AS rel,
--          length(content) AS content_len
--     FROM knowledge_entries
--    WHERE tenant_id = :tenant_id
--      AND source_url LIKE 'mira://seeds/demo-conveyor-001/%'
--    ORDER BY chunk_type, source_url;
--
-- Expect 4 rows: 2 component_template, 2 relationship_proposal.

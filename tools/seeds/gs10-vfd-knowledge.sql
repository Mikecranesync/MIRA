-- =============================================================================
-- GS10 VFD Modbus RTU Integration Knowledge Seed
-- =============================================================================
-- Purpose : Seed MIRA's NeonDB knowledge_entries with AutomationDirect GS10
--           VFD integration content so the diagnostic engine can answer
--           live RS-485 / Modbus RTU troubleshooting questions during the
--           Micro820 + GS10 garage demo (2026-05-16).
--
-- Target  : knowledge_entries  (NeonDB, pgvector)
-- Schema  : docs/migrations/001_knowledge_entries.sql
-- Tenant  : Set via psql variable. Default 'mike-garage-demo'.
--
-- Usage   :
--   psql "$DATABASE_URL" \
--        -v tenant_id="'mike-garage-demo'" \
--        -f tools/seeds/gs10-vfd-knowledge.sql
--
-- Embeddings:
--   embedding column is left NULL. Run the ingest pipeline's backfill
--   (mira-core/mira-ingest/db/neon.py :: insert_knowledge_entries_batch)
--   to populate. Until then, recall_knowledge() will still hit these rows
--   via the tsvector fulltext path (migration 006_knowledge_tsvector).
--
-- Idempotent: each chunk uses WHERE NOT EXISTS guarded on
-- (tenant_id, source_url, source_page). Re-running this seed is safe —
-- no duplicate rows. The dedup index in 001_knowledge_entries.sql is a
-- plain (non-UNIQUE) btree, so ON CONFLICT is not usable here.
-- =============================================================================

\set ON_ERROR_STOP on
\set tenant_id_default '''78917b56-f85f-43bb-9a08-1bb98a6cd6c3'''
\if :{?tenant_id}
\else
\set tenant_id :tenant_id_default
\endif

BEGIN;

-- ---------------------------------------------------------------------------
-- Helper: make INSERTs idempotent against the dedup index
-- ---------------------------------------------------------------------------
-- knowledge_entries_dedup_idx is (tenant_id, source_url, source_page). We
-- give every chunk a stable source_url + chunk-index so re-seeding is a
-- no-op.
-- ---------------------------------------------------------------------------

-- chunk 0: Critical Modbus parameters
INSERT INTO knowledge_entries (
    id, tenant_id, source_type, manufacturer, model_number, equipment_type,
    content, source_url, source_page, metadata,
    is_private, verified, chunk_type, created_at
)
SELECT
    gen_random_uuid(),
    :tenant_id,
    'integration_guide',
    'AutomationDirect',
    'GS10',
    'vfd',
$content$
AutomationDirect GS10 VFD — Critical Modbus RTU parameters (RS-485 slave).

These five parameters MUST be set before the GS10 will accept run / freq
commands from a Modbus RTU master (e.g. Micro820 MSG_MODBUS instruction):

  P00.20 = 5   Frequency command source = RS-485 (Modbus RTU)
               Default is 0 (digital keypad). If left at default, the
               drive will ignore frequency writes to register 0x2000.

  P00.21 = 5   Run command source       = RS-485 (Modbus RTU)
               Default is 0 (digital keypad). If left at default, the
               drive will ignore the run bit at register 0x2001.

  P09.00 = 1..254  Modbus slave ID (station number)
               Must match the slave address in the Micro820 MSG_MODBUS
               configuration. Default 1. Two GS10s on the same RS-485
               trunk MUST have distinct IDs.

  P09.01 = 2   Baud rate = 19200 bps
               Encoded as: 0=4800, 1=9600, 2=19200, 3=38400, 4=57600,
               5=115200. (Confirm against the GS10 User Manual revision
               in use — the encoding has been consistent across rev D–H
               but always verify on the keypad before commissioning.)

  P09.04 = 4   Modbus mode / data frame = RTU, 8-E-1 (8 data, even, 1 stop)
               Common values: 0=ASCII 7-N-2, 1=ASCII 7-E-1, 2=ASCII 7-O-1,
               3=RTU 8-N-2, 4=RTU 8-E-1, 5=RTU 8-O-1, 6=RTU 8-N-1.
               P09.04 MUST match the Micro820 serial port framing exactly
               or every Modbus read/write returns ErrorID 0x0001..0x0010
               (parity / framing mismatch — see error code reference).

Power-cycle the GS10 after changing P00.20 / P00.21 / P09.xx — these
parameters are read at boot.
$content$,
    'mira://seeds/gs10-vfd-integration',
    0,
    jsonb_build_object(
        'manufacturer', 'AutomationDirect',
        'model', 'GS10',
        'document_type', 'integration_guide',
        'topic', 'modbus_rtu_parameters',
        'protocol', 'modbus_rtu',
        'transport', 'rs485',
        'seed_version', '1',
        'seed_date', '2026-05-15'
    ),
    false, true, 'integration_guide', now()
WHERE NOT EXISTS (
    SELECT 1 FROM knowledge_entries
     WHERE tenant_id = :tenant_id
       AND source_url = 'mira://seeds/gs10-vfd-integration'
       AND source_page = 0
);

-- chunk 1: Modbus register map
INSERT INTO knowledge_entries (
    id, tenant_id, source_type, manufacturer, model_number, equipment_type,
    content, source_url, source_page, metadata,
    is_private, verified, chunk_type, created_at
)
SELECT
    gen_random_uuid(),
    :tenant_id,
    'integration_guide',
    'AutomationDirect',
    'GS10',
    'vfd',
$content$
AutomationDirect GS10 VFD — Modbus RTU register map (master writes / reads).

Write registers (function code 0x06 single, 0x10 multiple):
  0x2000   Frequency reference          0.01 Hz / count, write target freq
                                        (e.g. 6000 = 60.00 Hz).
  0x2001   Run / stop command word
           Bit 0..1  = 00 stop, 10 run, 01 jog, 11 reserved
           Bit 4..5  = direction (00 fwd, 10 rev)
           Bit 12    = external fault trigger (1 = trip)
           Bit 13    = fault reset (1 = clear)
                       (Always pulse — set, wait one scan, clear.)

Read registers (function code 0x03 holding, 0x04 input):
  0x2100   Drive status word
           Bit 0..1  = run state (00 stop, 01 decel, 10 standby, 11 run)
           Bit 3     = jog
           Bit 4..5  = direction
           Bit 6     = DC braking
           Bit 7     = fault
           Bit 8     = freq reached
           Bit 12    = at command speed
  0x2101   Frequency command           0.01 Hz / count
  0x2102   Output frequency            0.01 Hz / count (actual drive output)
  0x2103   Output current              0.1 A / count
  0x2104   DC bus voltage              1 V / count
  0x2105   Output voltage              0.1 V / count
  0x2106   Motor RPM (calc)            1 RPM / count
  0x2107   Motor torque                0.1 % / count, signed
  0x2108   Heatsink temperature        1 °C / count
  0x2200   Fault code (current)        0 = no fault, see GS10 manual ch.6
  0x2201   Fault code (last)
  0x2202   Fault code (2nd last)

Typical Micro820 MSG_MODBUS configuration to read live telemetry:
  Slave           = P09.00 value
  Function        = 0x03 (Read Holding Registers)
  Starting addr   = 0x2102  (output freq)
  Quantity        = 4       (freq, current, dc bus, output volt)
  Local addr      = HoldingReg[100]  (lands in HR100..HR103)

Same MSG_MODBUS block can be retargeted to 0x2200 for fault polling on a
slower (1 Hz) scan.
$content$,
    'mira://seeds/gs10-vfd-integration',
    1,
    jsonb_build_object(
        'manufacturer', 'AutomationDirect',
        'model', 'GS10',
        'document_type', 'integration_guide',
        'topic', 'modbus_register_map',
        'protocol', 'modbus_rtu',
        'seed_version', '1',
        'seed_date', '2026-05-15'
    ),
    false, true, 'integration_guide', now()
WHERE NOT EXISTS (
    SELECT 1 FROM knowledge_entries
     WHERE tenant_id = :tenant_id
       AND source_url = 'mira://seeds/gs10-vfd-integration'
       AND source_page = 1
);

-- chunk 2: Common failure modes
INSERT INTO knowledge_entries (
    id, tenant_id, source_type, manufacturer, model_number, equipment_type,
    content, source_url, source_page, metadata,
    is_private, verified, chunk_type, created_at
)
SELECT
    gen_random_uuid(),
    :tenant_id,
    'integration_guide',
    'AutomationDirect',
    'GS10',
    'vfd',
$content$
AutomationDirect GS10 VFD — Common Modbus RTU / RS-485 failure modes.

Ranked by frequency on first-time integrations (highest first):

1. P00.20 / P00.21 not set to 5 (RS-485).
   Symptom: Modbus reads return valid data (status word, output freq) but
   writes to 0x2000 (freq ref) and 0x2001 (run command) appear to succeed
   yet the drive never spins or accepts the target frequency. Keypad still
   commands the drive.
   Fix:    set P00.20=5 and P00.21=5, cycle power.

2. Baud rate / parity mismatch between Micro820 and GS10.
   Symptom: MSG_MODBUS .ErrorID in the 0x0001..0x0010 range (RTU framing
   error, parity error, CRC mismatch — protocol-level rejection).
   Fix:    confirm Micro820 serial port = 19200, 8 data, Even, 1 stop, RTU
           AND P09.01=2 (19200) AND P09.04=4 (RTU 8-E-1).

3. Missing 120 Ω termination resistor at far end of the RS-485 trunk.
   Symptom: intermittent ErrorID 0x0100..0x0200 (timeout / no response),
   worsens with cable length > 3 m, worse at higher baud rates.
   Fix:    install 120 Ω resistor across D+/D- at the GS10 end (or last
           device on the trunk if multi-drop). Micro820 end usually has
           selectable internal termination — enable it.

4. D+ / D- swapped (polarity inversion).
   Symptom: 100 % timeout. ErrorID 0x0100..0x0200 on every request.
   Fix:    swap the two RS-485 conductors at one end. If labelled A/B
           instead of +/-: A == D+ (TX+/RX+) and B == D- on most
           AutomationDirect / AB hardware, but verify per nameplate — the
           A/B convention is NOT universal.

5. Slave ID mismatch (P09.00 ≠ MSG_MODBUS Slave).
   Symptom: ErrorID 0x0100..0x0200 timeout for the target slave only;
           other slaves on the same trunk continue to respond.
   Fix:    read P09.00 from the GS10 keypad, set Micro820 MSG_MODBUS
           Slave field to match.

6. EMI on the RS-485 line (VFD output cabling running parallel to the
   RS-485 pair, motor PWM picked up as common-mode noise).
   Symptom: sporadic CRC errors (ErrorID 0x0001..0x0010) under load,
           clean when motor is stopped, gets worse at higher carrier
           frequencies.
   Fix:    route the RS-485 cable in a separate conduit from VFD output
           power. Use shielded twisted pair (Belden 3105A or equivalent).
           Ground the shield at the PLC end ONLY (single-point ground —
           never both ends, or you create a ground loop).

7. SGND (signal common) not connected.
   Symptom: works on the bench, fails in the cabinet — particularly
           across panels at different ground potentials.
   Fix:    pull a third conductor for SGND alongside D+/D-. The RS-485
           standard requires a common reference within ±7 V across all
           nodes; long runs between separately grounded panels can drift
           outside that window.
$content$,
    'mira://seeds/gs10-vfd-integration',
    2,
    jsonb_build_object(
        'manufacturer', 'AutomationDirect',
        'model', 'GS10',
        'document_type', 'integration_guide',
        'topic', 'failure_modes',
        'protocol', 'modbus_rtu',
        'seed_version', '1',
        'seed_date', '2026-05-15'
    ),
    false, true, 'integration_guide', now()
WHERE NOT EXISTS (
    SELECT 1 FROM knowledge_entries
     WHERE tenant_id = :tenant_id
       AND source_url = 'mira://seeds/gs10-vfd-integration'
       AND source_page = 2
);

-- chunk 3: MSG_MODBUS .ErrorID diagnostic decode
INSERT INTO knowledge_entries (
    id, tenant_id, source_type, manufacturer, model_number, equipment_type,
    content, source_url, source_page, metadata,
    is_private, verified, chunk_type, created_at
)
SELECT
    gen_random_uuid(),
    :tenant_id,
    'integration_guide',
    'AutomationDirect',
    'GS10',
    'vfd',
$content$
Micro820 MSG_MODBUS .ErrorID decode — diagnostic checklist for GS10 RS-485.

The .ErrorID output of the MSG_MODBUS function block on a Micro820
classifies most RS-485 / Modbus RTU faults into two bands:

  0x0001 .. 0x0010   PROTOCOL / FRAMING errors
                     The wire is electrically fine — bytes are reaching
                     the master — but they are malformed. Causes:
                       - Parity mismatch (e.g. master = Even, drive = None)
                       - Stop-bit mismatch
                       - Data-bit mismatch (7 vs 8)
                       - CRC mismatch (rare on its own; usually means
                         framing is wrong and CRC fails downstream)
                       - Wrong Modbus mode (ASCII vs RTU)
                     Where to look first:
                       1. Micro820 serial port config in CCW (Connected
                          Components Workbench): right-click serial port
                          channel → Properties → Modbus RTU Master,
                          19200, 8 data, Even parity, 1 stop bit.
                       2. GS10 P09.04 = 4 (RTU 8-E-1).
                       3. GS10 P09.01 = 2 (19200).

  0x0100 .. 0x0200   TIMEOUT / WIRING errors
                     The GS10 never responded inside the MSG_MODBUS
                     timeout window. Causes:
                       - Cable open or D+/D- swapped (no electrical path)
                       - Missing 120 Ω termination (reflections kill the
                         request mid-flight, especially at 19200+)
                       - Slave ID mismatch (P09.00 ≠ MSG_MODBUS Slave)
                       - GS10 powered down or RS-485 port disabled
                       - SGND not connected across panels (common-mode
                         drift > ±7 V violates RS-485 spec)
                     Where to look first:
                       1. Probe D+ / D- with a multimeter — should idle
                          near 2.5 V with ~200 mV swing during traffic.
                       2. Confirm GS10 P09.00 matches MSG_MODBUS Slave.
                       3. Add / verify the 120 Ω terminator at the GS10
                          end of the trunk.
                       4. Swap D+/D- conductors at one end (the cheapest
                          test for polarity inversion).

Other ErrorID bands (0x0011 .. 0x00FF or > 0x0200) usually indicate
Modbus exception responses from the slave (illegal function, illegal
address, illegal value) — these mean comms is working but you are
addressing a register the drive doesn't expose. Re-check the register
map (chunk 1) and confirm P00.20 / P00.21 are set to 5 if the
exception is on write to 0x2000 / 0x2001.
$content$,
    'mira://seeds/gs10-vfd-integration',
    3,
    jsonb_build_object(
        'manufacturer', 'AutomationDirect',
        'model', 'GS10',
        'document_type', 'integration_guide',
        'topic', 'msg_modbus_errorid_decode',
        'protocol', 'modbus_rtu',
        'plc', 'micro820',
        'seed_version', '1',
        'seed_date', '2026-05-15'
    ),
    false, true, 'integration_guide', now()
WHERE NOT EXISTS (
    SELECT 1 FROM knowledge_entries
     WHERE tenant_id = :tenant_id
       AND source_url = 'mira://seeds/gs10-vfd-integration'
       AND source_page = 3
);

-- chunk 4: RS-485 wiring + CCW serial port config
INSERT INTO knowledge_entries (
    id, tenant_id, source_type, manufacturer, model_number, equipment_type,
    content, source_url, source_page, metadata,
    is_private, verified, chunk_type, created_at
)
SELECT
    gen_random_uuid(),
    :tenant_id,
    'integration_guide',
    'AutomationDirect',
    'GS10',
    'vfd',
$content$
RS-485 wiring (Micro820 ↔ GS10) and CCW serial port configuration.

Wiring — 3-conductor RS-485 (D+, D-, SGND):
  Micro820 (Embedded serial Ch.2, or 2080-SERIALISOL plug-in)
                                    GS10  (terminal block, top of drive)
    D+ / TX+ / A   ─────────────────  D+ / RS+ / A
    D- / TX- / B   ─────────────────  D- / RS- / B
    SGND / 0V      ─────────────────  SG  / COM

Cable:
  Shielded twisted pair, 22-24 AWG, 120 Ω characteristic impedance.
  Belden 3105A is the canonical pick; Alpha 6412 acceptable.
  Bundle: D+/D- twisted as the primary pair; SGND can ride the drain
  or a separate conductor inside the same jacket.

Termination:
  Single 120 Ω resistor across D+/D- at each end of the trunk. For a
  point-to-point Micro820 ↔ GS10 link you usually enable the Micro820's
  internal termination dip-switch (or install 120 Ω on the PLC side)
  AND add a 120 Ω at the GS10 D+/D- terminals. Two terminators total —
  not one per device on a multi-drop bus.

Shield + ground:
  Ground the cable shield at the PLC end ONLY. Do NOT bond the shield
  at the GS10 end. Bonding both ends creates a ground loop and induces
  60 Hz hum on the RS-485 pair.

Physical separation (SAFETY):
  Run the RS-485 cable in a dedicated conduit, separated from VFD
  output (U/T1, V/T2, W/T3) and DC bus wiring by ≥ 300 mm (12") of
  air or in a separate metallic conduit. VFD PWM output is the largest
  EMI source in the panel — parallel routing with power = guaranteed
  intermittent comms.

CCW (Connected Components Workbench) serial port config:
  Project tree → Micro820 → Embedded Serial Port (or plug-in module)
  → Properties → Driver = "Modbus RTU Master"
                  Baud rate = 19200
                  Data bits = 8
                  Parity   = Even
                  Stop bits = 1
                  Media    = RS-485
                  Response timeout = 1000 ms (raise to 2000 ms on
                                              noisy plants while
                                              debugging)
                  Retries  = 3
  Download → power-cycle the Micro820.

MSG_MODBUS instance must reference this channel by its CCW-assigned
serial channel number (typically Channel 2 for the embedded port,
Channel 5+ for plug-ins — check the channel mapping table in the CCW
project under "Communication Ports").
$content$,
    'mira://seeds/gs10-vfd-integration',
    4,
    jsonb_build_object(
        'manufacturer', 'AutomationDirect',
        'model', 'GS10',
        'document_type', 'integration_guide',
        'topic', 'rs485_wiring_and_ccw_config',
        'protocol', 'modbus_rtu',
        'transport', 'rs485',
        'plc', 'micro820',
        'seed_version', '1',
        'seed_date', '2026-05-15'
    ),
    false, true, 'integration_guide', now()
WHERE NOT EXISTS (
    SELECT 1 FROM knowledge_entries
     WHERE tenant_id = :tenant_id
       AND source_url = 'mira://seeds/gs10-vfd-integration'
       AND source_page = 4
);

COMMIT;

-- ---------------------------------------------------------------------------
-- Post-seed verification (run manually after \i'ing this file):
--
--   SELECT chunk_type, manufacturer, model_number,
--          metadata->>'topic' AS topic,
--          length(content) AS content_len
--     FROM knowledge_entries
--    WHERE tenant_id = :tenant_id
--      AND source_url = 'mira://seeds/gs10-vfd-integration'
--    ORDER BY source_page;
--
-- Expect 5 rows (chunks 0..4). After embedding backfill, run a recall
-- query like "GS10 P00.20 RS-485" to confirm semantic retrieval.
-- ---------------------------------------------------------------------------

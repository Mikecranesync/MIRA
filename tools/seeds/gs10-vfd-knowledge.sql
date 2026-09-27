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
-- Idempotent (v2 reconciles; see the note after BEGIN). Keyed on
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

-- v2 (2026-09-27): rows are staged in seed_rows, then reconciled into
-- knowledge_entries: a missing row is inserted; an existing row whose content
-- or metadata differs is updated in place, and its embedding is cleared when
-- the content changed (the old vector describes the old text — re-run
-- tools/backfill_knowledge_embeddings.py). v1 was insert-only, so a corrected
-- chunk could never reach an environment that already had the old one (#4031).
CREATE TEMP TABLE seed_rows (LIKE knowledge_entries INCLUDING DEFAULTS) ON COMMIT DROP;

-- ---------------------------------------------------------------------------
-- Helper: make INSERTs idempotent against the dedup index
-- ---------------------------------------------------------------------------
-- knowledge_entries_dedup_idx is (tenant_id, source_url, source_page). We
-- give every chunk a stable source_url + chunk-index so re-seeding is a
-- no-op.
-- ---------------------------------------------------------------------------

-- chunk 0: Critical Modbus parameters
INSERT INTO seed_rows (
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
AutomationDirect GS10 DURApulse VFD — Modbus RTU parameters (RS-485 slave).

Settings on the bench rig (verified on the drive; plc/GS10_Integration_Guide.md,
device-profiles/gs10.yaml, Micro820 v4.1.9 program header):

  P09.00 = 1     Modbus slave address. Must match the Micro820 MSG_MODBUS
                 Node/Slave field. Two GS10s on one RS-485 trunk need
                 distinct addresses.

  P09.01 = 96    Baud rate. The value is baud / 100: 48 = 4800,
                 96 = 9600, 192 = 19200, 384 = 38400. The keypad shows
                 "9.6" for 9600.

  P09.04 = 13    Protocol / frame = RTU, 8 data bits, No parity, 2 stop
                 bits (8N2). Other codes: 12 = 8N1, 14 = 8E1, 15 = 8O1,
                 17 = 8O2. P09.04 must match the Micro820 serial port
                 exactly (8N2 is the Micro820 default).

  P09.02 = 0     Comm-loss treatment: 0 = warn and keep running (use
                 while commissioning), 1 = fault + ramp stop, 2 = fault +
                 coast stop, 3 = ignore (factory default; not recommended).

  P09.03 = 5.0   Comm timeout in seconds. If the master goes silent for
                 longer, the drive trips CE10 (fault code 58).

  P00.21 = 2     Run command source = RS-485 Modbus (0 = keypad,
                 1 = external terminals). Leave at 0 and Modbus run/stop
                 writes are ignored.

  P00.20         Frequency command source (factory default 0 = keypad).
                 The rig sets speed by writing register 0x2001; if speed
                 writes have no effect, check P00.20.

Power-cycle the GS10 after changing P09.xx — the serial port is set up at
boot.
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
        'seed_version', '2',
        'seed_date', '2026-09-27'
    ),
    false, true, 'integration_guide', now()
WHERE NOT EXISTS (
    SELECT 1 FROM seed_rows
     WHERE tenant_id = :tenant_id
       AND source_url = 'mira://seeds/gs10-vfd-integration'
       AND source_page = 0
);

-- chunk 1: Modbus register map
INSERT INTO seed_rows (
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
AutomationDirect GS10 DURApulse VFD — Modbus RTU register map.

Write registers (function code 06, preset single register):
  0x2000 (8192)  Control command, bit field.
                   bits 0-1: 01 = STOP, 10 = RUN, 11 = JOG + RUN
                   bits 3-4: 01 = forward, 10 = reverse, 11 = change dir
                 Common words: 18 (0x0012) = RUN forward,
                               20 (0x0014) = RUN reverse, 1 = STOP.
  0x2001 (8193)  Frequency setpoint, Hz x 10: 0-4000 = 0.0-400.0 Hz
                 (write 300 for 30.0 Hz, 600 for 60.0 Hz).
  0x2002 (8194)  Control code 2. Bit 1 = fault reset: write 0x0002.

Read registers (function code 03, read holding registers):
  0x2100 (8448)  Status monitor 1: low byte = current error (fault) code,
                 high byte = warning code. 0 = no fault.
  0x2101 (8449)  Status monitor 2: operation status bits.
  0x2102 (8450)  Frequency command (what the PLC commanded), Hz x 10.
  0x2103 (8451)  Output frequency (actual), Hz x 10.
  0x2104 (8452)  Output current, A x 10.
  0x2105 (8453)  DC bus voltage, V (about 300-340 V when powered).
  0x2106 (8454)  Output voltage, V.
  0x210B (8459)  Output torque, % (needs SVC mode + auto-tune).
  0x210C (8460)  Motor speed, RPM (needs motor nameplate P05.03/P05.04).

Typical Micro820 MSG_MODBUS read for live telemetry:
  Slave          = P09.00 value (1)
  Function       = 03 (read holding registers)
  Starting addr  = 8448 (0x2100)
  Quantity       = 7   (0x2100-0x2106: fault/warning, status, freq cmd,
                        output freq, current, DC bus, output volts)

Poll 0x2100 for faults: its low byte is the fault code (for example
58 = CE10 comm timeout).
$content$,
    'mira://seeds/gs10-vfd-integration',
    1,
    jsonb_build_object(
        'manufacturer', 'AutomationDirect',
        'model', 'GS10',
        'document_type', 'integration_guide',
        'topic', 'modbus_register_map',
        'protocol', 'modbus_rtu',
        'seed_version', '2',
        'seed_date', '2026-09-27'
    ),
    false, true, 'integration_guide', now()
WHERE NOT EXISTS (
    SELECT 1 FROM seed_rows
     WHERE tenant_id = :tenant_id
       AND source_url = 'mira://seeds/gs10-vfd-integration'
       AND source_page = 1
);

-- chunk 2: Common failure modes
INSERT INTO seed_rows (
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

1. Run source not set to RS-485 (P00.21 left at 0 = keypad).
   Symptom: Modbus reads return valid data (status, output freq) but
   run/stop writes to 0x2000 appear to succeed and the drive never starts.
   Keypad still commands the drive.
   Fix:    set P00.21=2 (RS-485). If speed writes to 0x2001 are ignored,
           check P00.20 (frequency command source).

2. Baud rate / parity mismatch between Micro820 and GS10.
   Symptom: MSG_MODBUS .ErrorID in the 0x0001..0x0010 range (RTU framing
   error, parity error, CRC mismatch — protocol-level rejection).
   Fix:    confirm Micro820 serial port = 9600, 8 data, No parity, 2 stop,
           RTU AND P09.01=96 (9600) AND P09.04=13 (RTU 8N2).

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
        'seed_version', '2',
        'seed_date', '2026-09-27'
    ),
    false, true, 'integration_guide', now()
WHERE NOT EXISTS (
    SELECT 1 FROM seed_rows
     WHERE tenant_id = :tenant_id
       AND source_url = 'mira://seeds/gs10-vfd-integration'
       AND source_page = 2
);

-- chunk 3: MSG_MODBUS .ErrorID diagnostic decode
INSERT INTO seed_rows (
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
                          9600, 8 data, No parity, 2 stop bits.
                       2. GS10 P09.04 = 13 (RTU 8N2).
                       3. GS10 P09.01 = 96 (9600).

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
map (chunk 1): 0x2000 = control command, 0x2001 = frequency setpoint,
0x2002 = fault reset. Confirm P00.21 = 2 if run/stop writes are ignored.
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
        'seed_version', '2',
        'seed_date', '2026-09-27'
    ),
    false, true, 'integration_guide', now()
WHERE NOT EXISTS (
    SELECT 1 FROM seed_rows
     WHERE tenant_id = :tenant_id
       AND source_url = 'mira://seeds/gs10-vfd-integration'
       AND source_page = 3
);

-- chunk 4: RS-485 wiring + CCW serial port config
INSERT INTO seed_rows (
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
                  Baud rate = 9600
                  Data bits = 8
                  Parity   = None
                  Stop bits = 2
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
        'seed_version', '2',
        'seed_date', '2026-09-27'
    ),
    false, true, 'integration_guide', now()
WHERE NOT EXISTS (
    SELECT 1 FROM seed_rows
     WHERE tenant_id = :tenant_id
       AND source_url = 'mira://seeds/gs10-vfd-integration'
       AND source_page = 4
);

-- chunk 5: msg_modbus_write_sequence (was hand-inserted 2026-05-15 with pre-guide values; owned here since v2)
INSERT INTO seed_rows (
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
Micro820 → GS10 run command: MSG_MODBUS write sequence (garage bench rig).

CCW's MSG_MODBUS instruction takes DECIMAL register addresses in the
ElementNumber field, not hex:

  8192  Control command (0x2000)
          1  = STOP
          18 = RUN forward
          20 = RUN reverse
        The conveyor uses 18 to start and 1 to stop.

  8193  Frequency setpoint (0x2001), Hz x 10.
          300 = 30.0 Hz
          600 = 60.0 Hz (motor nameplate frequency)

  8194  Control code 2 (0x2002). Write 2 (bit 1) to reset a fault before
        re-issuing RUN.

Rung sequence (one-shot interlocked so the writes don't fire every scan):

  Step 10  Write frequency  Function 06, ElementNumber 8193,
                            LocalAddr = setpoint (Hz x 10, INT), Slave 1
  Step 20  Write command    Function 06, ElementNumber 8192,
                            LocalAddr = 18 or 1 (INT), Slave 1

Write the frequency first, so the drive has a setpoint when RUN arrives.

Micro820 embedded serial port (must match the drive):
  Driver = Modbus RTU, Role = Master, Media = RS-485
  Baud = 9600, Data bits = 8, Parity = None, Stop bits = 2

Matching GS10 parameters (keypad; power-cycle after):
  P09.00 = 1   slave address
  P09.01 = 96  9600 baud
  P09.04 = 13  RTU 8N2
  P00.21 = 2   run command source = RS-485

If the MSG block never completes (ErrorID 255), the serial-port settings
were never downloaded to the PLC: re-download the CCW project. It is a
download problem, not wiring.

SAFETY: a Modbus STOP (writing 1 to 8192) is not safety-rated. A hung
master, a stuck bit, a cable break or a drive fault can leave the motor
running. Never rely on it for E-stop, lockout/tagout or guard-open
response. Keep a hard-wired E-stop that removes drive power independent
of Modbus.
$content$,
    'mira://seeds/gs10-vfd-integration',
    5,
    jsonb_build_object(
        'manufacturer', 'AutomationDirect',
        'model', 'GS10',
        'document_type', 'integration_guide',
        'topic', 'msg_modbus_write_sequence',
        'protocol', 'modbus_rtu',
        'plc', 'micro820',
        'seed_version', '2',
        'seed_date', '2026-09-27'
    ),
    false, true, 'integration_guide', now()
WHERE NOT EXISTS (
    SELECT 1 FROM seed_rows
     WHERE tenant_id = :tenant_id
       AND source_url = 'mira://seeds/gs10-vfd-integration'
       AND source_page = 5
);

-- chunk 6: register_decimal_hex_cheat_sheet (was hand-inserted 2026-05-15 with pre-guide values; owned here since v2)
INSERT INTO seed_rows (
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
GS10 Modbus register cheat sheet — decimal ↔ hex (Micro820 MSG_MODBUS uses decimal).

  decimal  hex      meaning                              access
  -------  ------   -----------------------------------  ----------
  8192     0x2000   Control command (bit field)          write (06)
  8193     0x2001   Frequency setpoint, Hz x 10          write (06)
  8194     0x2002   Control code 2 (bit 1 = fault reset) write (06)
  8448     0x2100   Status monitor 1 (low byte = fault)  read  (03)
  8449     0x2101   Status monitor 2 (run status bits)   read  (03)
  8450     0x2102   Frequency command, Hz x 10           read  (03)
  8451     0x2103   Output frequency, Hz x 10            read  (03)
  8452     0x2104   Output current, A x 10               read  (03)
  8453     0x2105   DC bus voltage, V                    read  (03)
  8454     0x2106   Output voltage, V                    read  (03)

Control command values for register 8192:
  1   STOP
  18  RUN forward  (0x0012: run bit 1 + forward bit 3)
  20  RUN reverse  (0x0014: run bit 1 + reverse bit 4)

Frequency setpoint at register 8193 is Hz x 10:
  30 Hz → 300
  60 Hz → 600

Fault reset: write 2 (0x0002) to register 8194.

Function codes used by the Micro820 MSG_MODBUS block on this rig:
  03  Read holding registers (status, fault, output telemetry)
  06  Preset single register (command, frequency, fault reset)
$content$,
    'mira://seeds/gs10-vfd-integration',
    6,
    jsonb_build_object(
        'manufacturer', 'AutomationDirect',
        'model', 'GS10',
        'document_type', 'integration_guide',
        'topic', 'register_decimal_hex_cheat_sheet',
        'protocol', 'modbus_rtu',
        'plc', 'micro820',
        'seed_version', '2',
        'seed_date', '2026-09-27'
    ),
    false, true, 'integration_guide', now()
WHERE NOT EXISTS (
    SELECT 1 FROM seed_rows
     WHERE tenant_id = :tenant_id
       AND source_url = 'mira://seeds/gs10-vfd-integration'
       AND source_page = 6
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

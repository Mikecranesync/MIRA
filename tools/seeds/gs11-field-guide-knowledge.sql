-- Seed: GS11 VFD + Micro820 Field Guide (Mike's garage demo conveyor)
-- Source: User-provided field guide pasted 2026-05-15, MIRA chat
-- Idempotent: re-runs are no-ops via WHERE NOT EXISTS on (tenant_id, source_url, source_page)
--
-- Schema: docs/migrations/001_knowledge_entries.sql
-- Tenant: passed via psql -v tenant_id="'<slug>'". Default UUID for Mike's
--         garage demo (see \set below) if no CLI override is provided.
-- chunk_type values: wiring | parameters | serial-config | registers | plc-program |
--                    bench-test | troubleshooting | mistakes | component-profile | config-variance
--
-- IMPORTANT: This guide documents 9600 baud / None parity / 2 stop bits
-- (P09.01=9.6, P09.04=13). The earlier GS10 seed used 19200 / Even / 1 stop.
-- BOTH are valid — PLC serial port and VFD parameters MUST MATCH. See chunk 10.

\set ON_ERROR_STOP on
\set tenant_id_default '''78917b56-f85f-43bb-9a08-1bb98a6cd6c3'''
\if :{?tenant_id}
\else
\set tenant_id :tenant_id_default
\endif

BEGIN;

-- =====================================================================
-- Chunk 1 — WIRING: Micro820 to GS11 RS-485 physical connections
-- =====================================================================
INSERT INTO knowledge_entries (
    id, tenant_id, source_type, manufacturer, model_number, equipment_type,
    content, source_url, source_page, chunk_type, verified, metadata
)
SELECT
    gen_random_uuid(), :tenant_id, 'field-guide', 'Automation Direct', 'GS11', 'vfd',
$$Micro820 to GS11 RS-485 Wiring (Modbus RTU)

Physical connection — 3 wires, shielded twisted pair preferred:

  Micro820 Embedded Serial Port    GS11 RS-485 Terminal
  -----------------------------    --------------------
  D+   (positive / non-inverting)  SG+   (Modbus A, positive)
  D-   (negative / inverting)      SG-   (Modbus B, negative)
  G    (signal ground / common)    SGND  (RS-485 ground reference)

Critical: the GS11 RJ45 jack on the front of the drive is NOT Ethernet —
it is a multi-pin serial port. Do NOT plug a CAT5 patch cable into a PC
or switch. Use the screw-terminal RS-485 connector instead, or a documented
RJ45-to-RS-485 breakout that matches Automation Direct's pinout. Wrong
plug into wrong port = no comms (best case) or damaged transceiver (worst).

Clean wiring checklist (in order of how often each one bites):
  1. D+ goes to SG+, D- goes to SG-. Swap = silent failure, no fault on drive.
  2. G (Micro820) MUST land on SGND. Floating ground = intermittent corruption
     on long runs or when the VFD is running and generating noise.
  3. Use shielded twisted pair. Terminate shield at ONE end only (drive end
     preferred). Both ends grounded = ground loop hum into the bus.
  4. Keep RS-485 run separated from VFD output (motor leads / DC bus). Cross
     at 90 deg if you must cross. Parallel runs in the same conduit = EMI
     coupling = comm timeouts under load.
  5. 120-ohm termination resistor across D+/D- at the far end of the bus
     for runs >10 ft or when more than 2 nodes. Optional for a 1-master,
     1-slave bench setup with short cable.
  6. Daisy-chain only — no stubs longer than ~12 in branching off the trunk.$$,
    'mira://seeds/gs11-micro820-field-guide', 1, 'wiring', true,
    '{"manufacturer":"Automation Direct","drive":"GS11","plc":"Micro820","protocol":"Modbus RTU","topic":"physical-wiring"}'::jsonb
WHERE NOT EXISTS (
    SELECT 1 FROM knowledge_entries
    WHERE tenant_id = :tenant_id
      AND source_url = 'mira://seeds/gs11-micro820-field-guide'
      AND source_page = 1
);

-- =====================================================================
-- Chunk 2 — VFD PARAMETERS: GS11 drive-side Modbus + source config
-- =====================================================================
INSERT INTO knowledge_entries (
    id, tenant_id, source_type, manufacturer, model_number, equipment_type,
    content, source_url, source_page, chunk_type, verified, metadata
)
SELECT
    gen_random_uuid(), :tenant_id, 'field-guide', 'Automation Direct', 'GS11', 'vfd',
$$GS11 VFD Parameters for RS-485 Modbus Control (this guide's config)

Communication parameters (P09 group):
  P09.00 = 1     Slave address (Modbus node ID). Must match what the PLC
                 master targets. 1 is the default and what the Micro820
                 sample program below assumes.
  P09.01 = 9.6   Baud rate, 9600 bps. (Drive displays "9.6" for 9600.)
  P09.04 = 13   Frame format. Code 13 = RTU 8 data bits, None parity, 2 stop.
                 Other common codes on the GS11:
                   11 = RTU 8N1     12 = RTU 8E1     13 = RTU 8N2 (this guide)
                   14 = RTU 8O1     15 = RTU 8E2     16 = RTU 8O2

Source-of-command parameters (P00 group):
  P00.20 = 1     Source of frequency reference = RS-485.
                 0 = keypad, 1 = RS-485, 2 = analog 0-10V, 3 = analog 4-20mA,
                 4 = pulse input, 5 = digital up/down, etc.
  P00.21 = 2     Source of run command = RS-485.
                 0 = keypad, 1 = external terminals, 2 = RS-485.

Why both P00.20 and P00.21: the GS11 lets you split the source of FREQUENCY
(how fast to spin) and the source of RUN (start/stop direction). For pure
Modbus control, BOTH must be set to RS-485 (1 and 2 respectively). Setting
only P00.21=2 and leaving P00.20=0 produces a drive that accepts a run
command over Modbus but ignores the speed register — runs at keypad default.

After changing any P09 parameter, cycle drive power. The serial port re-
initializes at the new baud/parity/stop on power-up, not on parameter save.$$,
    'mira://seeds/gs11-micro820-field-guide', 2, 'parameters', true,
    '{"manufacturer":"Automation Direct","drive":"GS11","parameters":["P09.00","P09.01","P09.04","P00.20","P00.21"],"baud":9600,"parity":"None","stop_bits":2,"slave_id":1}'::jsonb
WHERE NOT EXISTS (
    SELECT 1 FROM knowledge_entries
    WHERE tenant_id = :tenant_id
      AND source_url = 'mira://seeds/gs11-micro820-field-guide'
      AND source_page = 2
);

-- =====================================================================
-- Chunk 3 — CCW SERIAL CONFIG: Micro820 master-side settings
-- =====================================================================
INSERT INTO knowledge_entries (
    id, tenant_id, source_type, manufacturer, model_number, equipment_type,
    content, source_url, source_page, chunk_type, verified, metadata
)
SELECT
    gen_random_uuid(), :tenant_id, 'field-guide', 'Allen-Bradley', 'Micro820', 'plc',
$$Connected Components Workbench (CCW) Serial Port Configuration

In CCW project tree: Controller > Serial Port (Embedded or Plug-in)

  Driver        : Modbus RTU Master
  Baud Rate     : 9600
  Parity        : None
  Data Bits     : 8
  Stop Bits     : 2
  Media         : RS-485 (half-duplex, 2-wire + ground)
  Modbus Role   : Master

These four must EXACTLY match the GS11's P09 group:
  CCW Baud     <-> P09.01 (9.6 = 9600)
  CCW Parity   <-> P09.04 frame code (13 = None)
  CCW Stop     <-> P09.04 frame code (13 = 2 stop bits)
  CCW Data     <-> always 8 for Modbus RTU

Single-character mismatch on any of these = no comms, no useful error.
The Micro820 will log a timeout, not a "wrong parity" error, because
RS-485 parity errors look identical to garbled-frame timeouts at the
master end.

After downloading the program, the serial port re-initializes — but only
on a CCW download or power cycle. Online parameter edits do not re-init
the port. Cycle power on doubt.$$,
    'mira://seeds/gs11-micro820-field-guide', 3, 'serial-config', true,
    '{"manufacturer":"Allen-Bradley","plc":"Micro820","software":"Connected Components Workbench","baud":9600,"parity":"None","data_bits":8,"stop_bits":2,"role":"master"}'::jsonb
WHERE NOT EXISTS (
    SELECT 1 FROM knowledge_entries
    WHERE tenant_id = :tenant_id
      AND source_url = 'mira://seeds/gs11-micro820-field-guide'
      AND source_page = 3
);

-- =====================================================================
-- Chunk 4 — MODBUS REGISTERS: GS11 holding-register map
-- =====================================================================
INSERT INTO knowledge_entries (
    id, tenant_id, source_type, manufacturer, model_number, equipment_type,
    content, source_url, source_page, chunk_type, verified, metadata
)
SELECT
    gen_random_uuid(), :tenant_id, 'field-guide', 'Automation Direct', 'GS11', 'vfd',
$$GS11 Modbus Holding Register Map (the three registers you actually use)

Register  Hex     Purpose                  Values
--------  -----   -----------------------  ---------------------------------
8192      0x2000  Run / Stop / Direction   1  = stop
                                           18 = run forward  (decimal)
                                           20 = run reverse  (decimal)
                                           In hex: 0x12 = fwd, 0x14 = rev,
                                           0x01 = stop.
                                           Bit-decoded: bit1 set = run,
                                           bit2 = direction (0=fwd, 1=rev),
                                           bit0 alone = stop command.
8193      0x2001  Frequency Reference      Hz x 100, unsigned 16-bit.
                                           30.00 Hz -> write 3000
                                           60.00 Hz -> write 6000
                                           10.00 Hz -> write 1000
                                           Max = P01.00 (default 6000 = 60 Hz).
8194      0x2002  Fault Reset              Write any non-zero value to clear
                                           latched fault. Read 0 = no fault.

Function codes:
  03 (Read Holding) and 06 (Write Single) cover 95% of GS11 control.
  16 (Write Multiple) works for writing 8192 + 8193 in one transaction —
  preferred if your master library supports it, because it avoids the
  race where the drive sees RUN before the new frequency lands.

Idempotency notes:
  - Writing 18 to 8192 when the drive is already running fwd is a no-op.
    No fault, no bump. Same for stop.
  - Writing the same Hz to 8193 every scan is harmless but wastes bus
    bandwidth — fire the write only on change.$$,
    'mira://seeds/gs11-micro820-field-guide', 4, 'registers', true,
    '{"manufacturer":"Automation Direct","drive":"GS11","registers":{"8192":{"hex":"0x2000","name":"command","stop":1,"fwd":18,"rev":20},"8193":{"hex":"0x2001","name":"freq_ref","scale":"Hz*100"},"8194":{"hex":"0x2002","name":"fault_reset"}}}'::jsonb
WHERE NOT EXISTS (
    SELECT 1 FROM knowledge_entries
    WHERE tenant_id = :tenant_id
      AND source_url = 'mira://seeds/gs11-micro820-field-guide'
      AND source_page = 4
);

-- =====================================================================
-- Chunk 5 — PLC PROGRAM: Tag structure, sequence, ST example
-- =====================================================================
INSERT INTO knowledge_entries (
    id, tenant_id, source_type, manufacturer, model_number, equipment_type,
    content, source_url, source_page, chunk_type, verified, metadata
)
SELECT
    gen_random_uuid(), :tenant_id, 'field-guide', 'Allen-Bradley', 'Micro820', 'plc',
$$Micro820 Program — Modbus Master to GS11 (sequence + ST template)

Tag structure (Global, in CCW Variables view):

  vfd_target_hz        REAL or INT     desired speed in Hz (user input)
  vfd_run_request      BOOL            HMI / pushbutton: true = run fwd
  vfd_dir_reverse      BOOL            true = reverse, false = forward
  vfd_reset_request    BOOL            rising edge clears fault
  vfd_step             INT             state-machine step (0/10/20/90)
  vfd_busy             BOOL            MSG instruction in flight
  vfd_freq_word        INT             scaled = vfd_target_hz * 100
  vfd_cmd_word         INT             1 / 18 / 20 (stop/fwd/rev)
  vfd_msg_ctrl         MSG_MODBUS2     control block for MSG instruction

State machine (vfd_step):

   0  IDLE
        - If vfd_reset_request rising edge -> step = 90.
        - Else if vfd_run_request changed OR vfd_target_hz changed:
              vfd_freq_word := vfd_target_hz * 100;
              step := 10;

  10  WRITE SPEED (MSG: FC06 to register 8193, value = vfd_freq_word)
        - Fire MSG, set vfd_busy.
        - On MSG done: clear vfd_busy, step := 20.
        - On MSG error: step := 90.

  20  WRITE COMMAND (MSG: FC06 to register 8192, value = vfd_cmd_word)
        - vfd_cmd_word := IF vfd_run_request THEN (IF vfd_dir_reverse THEN 20 ELSE 18) ELSE 1.
        - Fire MSG. On done: step := 0.  On error: step := 90.

  90  FAULT (MSG: FC06 to register 8194, value = 1)
        - On MSG done: step := 0.

Structured Text snippet (CCW ST POU body):

  CASE vfd_step OF
    0:  IF vfd_reset_request AND NOT vfd_reset_last THEN
          vfd_step := 90;
        ELSIF (vfd_run_request <> vfd_run_last)
          OR (vfd_target_hz <> vfd_target_last) THEN
          vfd_freq_word := REAL_TO_INT(vfd_target_hz * 100.0);
          vfd_step := 10;
        END_IF;
    10: (* MSG block writes 8193 = vfd_freq_word, advances step on .DN *)
        IF vfd_msg_ctrl.DN THEN vfd_step := 20; END_IF;
        IF vfd_msg_ctrl.ER THEN vfd_step := 90; END_IF;
    20: vfd_cmd_word :=
            IF vfd_run_request THEN
                (IF vfd_dir_reverse THEN 20 ELSE 18)
            ELSE 1 END_IF;
        (* MSG block writes 8192 = vfd_cmd_word, advances step on .DN *)
        IF vfd_msg_ctrl.DN THEN vfd_step := 0; END_IF;
        IF vfd_msg_ctrl.ER THEN vfd_step := 90; END_IF;
    90: (* MSG writes 8194 = 1 to clear fault *)
        IF vfd_msg_ctrl.DN THEN vfd_step := 0; END_IF;
  END_CASE;
  vfd_run_last    := vfd_run_request;
  vfd_target_last := vfd_target_hz;
  vfd_reset_last  := vfd_reset_request;

Ladder concept (if you prefer LD over ST):
  - Rung A: edge-detect changes -> MOV to vfd_freq_word, OTL step10.
  - Rung B: step10 + MSG.DN -> MOV cmd, OTL step20, OTU step10.
  - Rung C: step20 + MSG.DN -> OTU step20 -> back to step 0.
  - Rung D: step90 + MSG.DN -> OTU step90.

Critical: fire MSG only on a step transition, NEVER on every scan.
Continuous MSG enable will saturate the RS-485 bus, time out, and look
exactly like a wiring fault.$$,
    'mira://seeds/gs11-micro820-field-guide', 5, 'plc-program', true,
    '{"manufacturer":"Allen-Bradley","plc":"Micro820","language":"ST","tags":["vfd_target_hz","vfd_run_request","vfd_step","vfd_busy"],"steps":{"0":"idle","10":"write_speed","20":"write_cmd","90":"fault"}}'::jsonb
WHERE NOT EXISTS (
    SELECT 1 FROM knowledge_entries
    WHERE tenant_id = :tenant_id
      AND source_url = 'mira://seeds/gs11-micro820-field-guide'
      AND source_page = 5
);

-- =====================================================================
-- Chunk 6 — BENCH TEST SEQUENCE
-- =====================================================================
INSERT INTO knowledge_entries (
    id, tenant_id, source_type, manufacturer, model_number, equipment_type,
    content, source_url, source_page, chunk_type, verified, metadata
)
SELECT
    gen_random_uuid(), :tenant_id, 'field-guide', 'Automation Direct', 'GS11', 'vfd',
$$Bench Test Sequence — Verify GS11 Modbus control before connecting load

Use a Modbus master test tool (Modscan, QModMaster, Modbus Poll, or the
Micro820 with a simple test POU) at the same baud / parity / stop /
slave-ID you configured.

Step 1 — write 1000 to register 8193 (FC06)
  Effect: stage 10.00 Hz as the frequency reference. Drive does NOT
  start yet because P00.21=2 means only register 8192 starts it.
  Verify: read back 8193 (FC03). Should return 1000. If it returns 0
  or echoes wrong, your scaling math is off — see chunk 4.

Step 2 — write 18 to register 8192 (FC06)
  Effect: drive starts forward at 10.00 Hz. Motor should turn.
  Verify: drive display shows running indicator and 10.0 Hz.
  Listen for clean acceleration — no humming, no stall, no fault.

Step 3 — write 1 to register 8192 (FC06)
  Effect: drive ramps to stop per P01.10 decel time.
  Verify: motor coasts/ramps down to zero. Drive display shows STOP.

Step 4 (optional) — fault test
  Write 0 to register 8193 then 18 to 8192 -> drive runs at 0 Hz.
  Should not fault. If it does, P00.20 is not actually 1 — it is reading
  from somewhere else (likely keypad with 0 Hz set).

If all three steps pass, the comms path is good and the PLC-side state
machine is the only thing left to debug. If step 1 fails (no read-back),
go to chunk 7 (no-comms checklist) FIRST — do not touch PLC code.$$,
    'mira://seeds/gs11-micro820-field-guide', 6, 'bench-test', true,
    '{"manufacturer":"Automation Direct","drive":"GS11","sequence":[{"step":1,"fc":6,"reg":8193,"val":1000,"meaning":"10Hz"},{"step":2,"fc":6,"reg":8192,"val":18,"meaning":"run fwd"},{"step":3,"fc":6,"reg":8192,"val":1,"meaning":"stop"}]}'::jsonb
WHERE NOT EXISTS (
    SELECT 1 FROM knowledge_entries
    WHERE tenant_id = :tenant_id
      AND source_url = 'mira://seeds/gs11-micro820-field-guide'
      AND source_page = 6
);

-- =====================================================================
-- Chunk 7 — TROUBLESHOOTING: No comms / runs but won't move / wrong speed
-- =====================================================================
INSERT INTO knowledge_entries (
    id, tenant_id, source_type, manufacturer, model_number, equipment_type,
    content, source_url, source_page, chunk_type, verified, metadata
)
SELECT
    gen_random_uuid(), :tenant_id, 'field-guide', 'Automation Direct', 'GS11', 'vfd',
$$Troubleshooting — Three symptom patterns and what to check

SYMPTOM A: No comms at all (MSG times out, drive never responds)
  1. Swap D+ and D- at one end. By far the most common fault — RS-485
     polarity is silent when wrong, just no answer.
  2. Verify P09.01 (drive baud) matches CCW serial baud. 9.6 = 9600.
  3. Verify P09.04 frame code matches CCW parity AND stop bits.
     13 = 8N2. Wrong code = drive sees framing errors on every byte.
  4. Verify P09.00 slave ID matches the slave ID in the MSG instruction.
     Default is 1; if you have multiple drives you may have changed it.
  5. Verify G (Micro820) is bonded to SGND (drive). Floating common
     works at 6 in on a bench and fails at 6 ft in a panel.
  6. Power-cycle the drive. P09 changes do not take effect until reboot.
  7. Long bus? Add 120-ohm termination across D+/D- at the drive end.

SYMPTOM B: Runs but won't move (no rotation, no fault)
  1. P00.21 must equal 2 (run command from RS-485). If 0 or 1, the drive
     is taking start from keypad or terminals and ignoring 8192 writes.
  2. P00.20 must equal 1 (freq from RS-485). If still 0, drive starts
     from your command but speed reference is 0 Hz -> stalled / locked.
  3. Frequency register 8193 actually written? Read it back via FC03.
     If 0, your master never sent it (or sent it before step 10 fired).
  4. Drive in lockout / interlock? Check digital inputs (X1-X5) for any
     enable / E-stop input that may still be required even with P00.21=2.

SYMPTOM C: Wrong speed (drive runs, but Hz is wrong)
  1. Scaling — register 8193 is Hz x 100. To run 30 Hz you write 3000,
     NOT 30 and NOT 300. Bug #1 in 12 hours of debugging.
  2. P01.00 (max output frequency) clamps the value. If P01.00 = 6000
     (60 Hz) and you write 9000, drive runs at 60 Hz, no fault.
  3. P01.07 / P01.08 (accel / decel) are ramp times, not setpoints —
     long ramps + short test = drive never reaches target before stop.
  4. Acceleration/jerk limits inside drive may override aggressive
     setpoint changes from master.$$,
    'mira://seeds/gs11-micro820-field-guide', 7, 'troubleshooting', true,
    '{"manufacturer":"Automation Direct","drive":"GS11","symptoms":["no-comms","runs-but-no-motion","wrong-speed"],"common_cause_no_comms":"D+/D- swapped","common_cause_no_motion":"P00.21 not set to 2","common_cause_wrong_speed":"forgot Hz*100 scaling"}'::jsonb
WHERE NOT EXISTS (
    SELECT 1 FROM knowledge_entries
    WHERE tenant_id = :tenant_id
      AND source_url = 'mira://seeds/gs11-micro820-field-guide'
      AND source_page = 7
);

-- =====================================================================
-- Chunk 8 — COMMON MISTAKES (memorable list of things people actually do)
-- =====================================================================
INSERT INTO knowledge_entries (
    id, tenant_id, source_type, manufacturer, model_number, equipment_type,
    content, source_url, source_page, chunk_type, verified, metadata
)
SELECT
    gen_random_uuid(), :tenant_id, 'field-guide', 'Automation Direct', 'GS11', 'vfd',
$$GS11 + Micro820 — Common Mistakes (the things that bite real installers)

1. Using Rx / Tx instead of D+ / D-
   RS-485 is a differential pair, not a 232-style Rx/Tx. There is no
   "transmit line" — both ends drive D+ and D- in half-duplex. If the
   PLC port doc says Rx/Tx and the drive says SG+/SG-, you have a
   232-vs-485 problem. Confirm the Micro820 embedded port is 485 mode,
   not 232 mode (some plug-in modules default to 232).

2. Plugging the RJ45 into an Ethernet port
   The GS11 RJ45 jack is a serial multi-pin connector. Plugging a CAT5
   cable from it into a PC NIC, network switch, or Micro820 Ethernet port
   will not damage anything immediately, but it will not work and may
   confuse you for an hour. Use screw terminals.

3. Forgetting P00.20 / P00.21
   Setting only one (e.g. P00.21=2 for run-from-RS485) but leaving P00.20=0
   (freq still from keypad). Drive starts but at whatever Hz the keypad
   shows — typically 0 — so motor sits still, no fault.

4. Sending 30 instead of 3000 for 30 Hz
   Register 8193 is Hz x 100. Writing 30 = 0.30 Hz, looks like the drive
   is stuck or making low-frequency growl noises. Writing 3000 = 30.00 Hz.

5. Firing the MSG instruction every scan
   Putting MSG on a continuously-true rung saturates the bus, every
   transaction times out, drive looks dead. ALWAYS edge-trigger MSG —
   on step transition, on change-of-tag, on a one-shot pulse.

6. Skipping the power cycle after changing P09 params
   P09 changes save immediately to drive memory but the serial port
   keeps running on the OLD config until the drive reboots. Change
   baud / parity / stop -> cycle 24VDC or main power.

7. Master and slave parity mismatch with no visible error
   Micro820 with parity=Even talking to drive with parity=None will
   produce 100% framing errors at the drive but the Micro820 just logs
   timeouts. Looks identical to wiring break. Always verify all four
   serial params end-to-end before pulling wires.$$,
    'mira://seeds/gs11-micro820-field-guide', 8, 'mistakes', true,
    '{"manufacturer":"Automation Direct","drive":"GS11","mistakes":["rx-tx-not-d+/d-","rj45-into-ethernet","forgot-p00.20-or-p00.21","sent-30-instead-of-3000","msg-every-scan","no-power-cycle-after-p09","silent-parity-mismatch"]}'::jsonb
WHERE NOT EXISTS (
    SELECT 1 FROM knowledge_entries
    WHERE tenant_id = :tenant_id
      AND source_url = 'mira://seeds/gs11-micro820-field-guide'
      AND source_page = 8
);

-- =====================================================================
-- Chunk 9 — MIRA COMPONENT PROFILE (machine-readable connection spec)
-- =====================================================================
INSERT INTO knowledge_entries (
    id, tenant_id, source_type, manufacturer, model_number, equipment_type,
    content, source_url, source_page, chunk_type, verified, metadata
)
SELECT
    gen_random_uuid(), :tenant_id, 'field-guide', 'Automation Direct', 'GS11', 'vfd',
$$MIRA Component Profile — GS11 over Modbus RTU from Micro820

This YAML is the machine-readable summary that mira-connect / the diagnostic
engine can consume. Mirrors chunks 1-8 in structured form.

connection:
  protocol: modbus-rtu
  physical: rs-485
  master:
    plc: Allen-Bradley Micro820
    port: embedded-serial
    role: master
    baud: 9600
    parity: none
    data_bits: 8
    stop_bits: 2
  slave:
    drive: Automation Direct GS11
    slave_id: 1
    baud: 9600
    parity: none
    data_bits: 8
    stop_bits: 2

wiring_map:
  - plc: D+
    drive: SG+
  - plc: D-
    drive: SG-
  - plc: G
    drive: SGND

drive_parameters:
  P09.00: 1         # slave address
  P09.01: 9.6       # baud (9600)
  P09.04: 13        # frame format 8N2
  P00.20: 1         # frequency reference = RS-485
  P00.21: 2         # run command = RS-485

register_map:
  command_register:
    address: 8192
    hex: "0x2000"
    values: { stop: 1, run_forward: 18, run_reverse: 20 }
  frequency_register:
    address: 8193
    hex: "0x2001"
    scale: "Hz * 100"
    example: { "30Hz": 3000, "60Hz": 6000 }
  fault_reset_register:
    address: 8194
    hex: "0x2002"
    write_to_clear_fault: 1

bench_test:
  - { fc: 6, reg: 8193, val: 1000, meaning: "set 10 Hz reference" }
  - { fc: 6, reg: 8192, val: 18,   meaning: "run forward" }
  - { fc: 6, reg: 8192, val: 1,    meaning: "stop" }$$,
    'mira://seeds/gs11-micro820-field-guide', 9, 'component-profile', true,
    '{"manufacturer":"Automation Direct","drive":"GS11","plc":"Micro820","format":"yaml-in-content","consumer":"mira-connect"}'::jsonb
WHERE NOT EXISTS (
    SELECT 1 FROM knowledge_entries
    WHERE tenant_id = :tenant_id
      AND source_url = 'mira://seeds/gs11-micro820-field-guide'
      AND source_page = 9
);

-- =====================================================================
-- Chunk 10 — CONFIG VARIANCE: GS10 seed vs GS11 seed (read this!)
-- =====================================================================
INSERT INTO knowledge_entries (
    id, tenant_id, source_type, manufacturer, model_number, equipment_type,
    content, source_url, source_page, chunk_type, verified, metadata
)
SELECT
    gen_random_uuid(), :tenant_id, 'field-guide', 'Automation Direct', 'GS10-vs-GS11', 'vfd',
$$Configuration Variance Note — GS10 Seed vs GS11 Field Guide

The MIRA knowledge base contains an earlier GS10 reference that uses a
DIFFERENT serial configuration than this GS11 field guide. Both are valid
production configs. The PLC serial port settings MUST match the VFD
parameter settings, but the choice of which combo to use is per-install.

  Setting           Earlier GS10 seed     This GS11 guide
  ----------------  --------------------  --------------------
  Baud rate         19200                 9600
  Parity            Even                  None
  Stop bits         1                     2
  P09.01 on drive   19.2                  9.6
  P09.04 framecode  12 (RTU 8E1)          13 (RTU 8N2)

What the user must do BEFORE applying either seed:
  1. Read the actual P09.01 and P09.04 values on the physical drive.
  2. Read the actual baud / parity / stop in CCW's Serial Port config.
  3. Confirm both sides match each other (whatever the values).
  4. Use the seed that documents that match — OR adjust P09 to match
     CCW, OR adjust CCW to match P09. The values themselves do not matter
     as long as they are consistent end-to-end.

Why both configs exist in the wild:
  - 19200/8E1 is Allen-Bradley's default RTU recommendation (parity gives
    one extra check bit per frame, useful on noisy industrial cabling).
  - 9600/8N2 is Automation Direct's default RTU recommendation (two stop
    bits compensate for lack of parity, simpler diagnostic with parity off).

Both achieve identical reliability on a clean bench cable. The differences
matter only on long runs through noisy environments — and at that point,
shielding and routing matter far more than 9600 vs 19200.

Bottom line: do not blindly apply parameters from either seed without
first checking the as-built drive and PLC. Symptom A in chunk 7 ("no
comms at all") is the failure mode when these mismatch.$$,
    'mira://seeds/gs11-micro820-field-guide', 10, 'config-variance', true,
    '{"manufacturer":"Automation Direct","drives":["GS10","GS11"],"variance":{"gs10_seed":{"baud":19200,"parity":"Even","stop":1,"P09.01":"19.2","P09.04":12},"gs11_guide":{"baud":9600,"parity":"None","stop":2,"P09.01":"9.6","P09.04":13}},"warning":"PLC and VFD must match each other; choice of combo is per-install"}'::jsonb
WHERE NOT EXISTS (
    SELECT 1 FROM knowledge_entries
    WHERE tenant_id = :tenant_id
      AND source_url = 'mira://seeds/gs11-micro820-field-guide'
      AND source_page = 10
);

COMMIT;

-- Verification query (run separately, not part of transaction):
-- SELECT source_page, chunk_type, LEFT(content, 60) AS preview
-- FROM knowledge_entries
-- WHERE source_url = 'mira://seeds/gs11-micro820-field-guide'
-- ORDER BY source_page;

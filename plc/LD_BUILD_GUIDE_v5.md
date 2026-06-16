# MIRA v5.1 — Prog3-Modbus Ladder Build Guide

MSG_MODBUS RS-485 communication to GS10 VFD.
Build this in CCW after creating the new MIRA_v5 project.

---

## PRE-BUILD CHECKLIST

- [ ] CCW new project created: File > New > Micro800 > 2080-LC20-20QBB
- [ ] Saved as MIRA_v5
- [ ] **Serial Port configured FIRST:** Embedded Serial Port > Properties
  - Protocol: Modbus RTU
  - Mode: Master
  - Baud Rate: 9600
  - Parity: None
  - Stop Bits: 2 (8N2)
  - Handshake: None
- [ ] EtherNet/IP configured: Static IP 169.254.32.93
- [ ] Variables imported from VARIABLES_IMPORT.csv
- [ ] Prog2.stf pasted into Prog2 (ST program)
- [ ] MbSrvConf.xml copied to Controller\Controller\ folder

---

## HOW TO ADD THE LD PROGRAM

1. In Project Organizer, right-click **Programs**
2. Select **Add > New LD: Ladder Diagram**
3. Rename it: **Prog3-Modbus**
4. Verify execution order: Prog2 must run BEFORE Prog3
   (right-click Programs > Properties > check order)
5. Double-click Prog3-Modbus to open the ladder editor

---

## RUNG 1 — READ VFD STATUS (FC03, reads 4 registers)

**Purpose:** Read output frequency, current, DC bus voltage, fault code from VFD

```
|                                                              |
|   [EQU]              [XIC]           [MSG_MODBUS]            |
|---| A = B |----------| vfd_poll_active |--[mb_read_status]---|
|   | vfd_poll_step |                                          |
|   | 1             |                                          |
|                                                              |
```

**How to build in CCW:**

1. From Toolbox, drag **EQU** (Equal) to the rung
   - Source A: `vfd_poll_step`
   - Source B: `1`

2. After EQU, drag **XIC** (Examine If Closed) contact
   - Variable: `vfd_poll_active`

3. After XIC, drag **MSG_MODBUS** from Toolbox (search "MSG")
   - Instance name: `mb_read_status`

4. Fill MSG_MODBUS parameters (right-click > Properties or click each pin):

| Pin | Value | Notes |
|-----|-------|-------|
| IN | (wired from XIC output) | Auto-connected |
| LocalCfg | `read_local_cfg` | Config struct (loaded by Prog2 ST) |
| TargetCfg | `read_target_cfg` | Target struct (loaded by Prog2 ST) |
| LocalAddr | `read_data` | INT[1..125] buffer — results go here |
| Q (Done) | (internal to mb_read_status) | Prog2 reads mb_read_status.Q |
| Error | (internal to mb_read_status) | Prog2 reads mb_read_status.Error |
| ErrorID | (internal to mb_read_status) | Prog2 reads mb_read_status.ErrorID |

**Config values (set by Prog2 ST each scan):**
- Channel = 0 (built-in RS-485)
- Cmd = 3 (FC03 Read Holding Registers)
- ElementCnt = 6
- Target Addr = 8451 (0x2103)
- Target Node = 1 (VFD slave address)

---

## RUNG 2 — WRITE VFD COMMAND (FC06, run/stop/direction)

**Purpose:** Send run FWD (18), run REV (20), or stop (1) command to VFD

```
|                                                              |
|   [EQU]              [XIC]           [MSG_MODBUS]            |
|---| A = B |----------| vfd_poll_active |--[mb_write_cmd]----|
|   | vfd_poll_step |                                          |
|   | 2             |                                          |
|                                                              |
```

**How to build in CCW:**

1. Drag **EQU** — Source A: `vfd_poll_step`, Source B: `2`
2. Drag **XIC** — Variable: `vfd_poll_active`
3. Drag **MSG_MODBUS** — Instance: `mb_write_cmd`

| Pin | Value |
|-----|-------|
| LocalCfg | `write_cmd_local_cfg` |
| TargetCfg | `write_cmd_target_cfg` |
| LocalAddr | `write_cmd_data` |

**Config values (set by Prog2 ST):**
- Channel = 0, Cmd = 6 (FC06 Write Single Register)
- ElementCnt = 1
- Target Addr = 8192 (0x2000 — command register)
- Target Node = 1

**Note:** Prog2 ST writes the command value into `vfd_cmd_word`.
You need to load `vfd_cmd_word` into `write_cmd_data(1)` — either:
- Add a MOV instruction before the MSG on this rung, OR
- Add a COP block in Prog2 ST (the v5.0.0 code had this — re-enable if needed)

**Quickest fix:** Add a MOV instruction on a branch before this MSG:
- Source: `vfd_cmd_word`
- Dest: `write_cmd_data(1)`

---

## RUNG 3 — WRITE FREQUENCY SETPOINT (FC06)

**Purpose:** Send speed setpoint to VFD (value = Hz x 10, e.g. 300 = 30.0 Hz)

```
|                                                              |
|   [EQU]              [XIC]           [MSG_MODBUS]            |
|---| A = B |----------| vfd_poll_active |--[mb_write_freq]----|
|   | vfd_poll_step |                                          |
|   | 3             |                                          |
|                                                              |
```

1. Drag **EQU** — Source A: `vfd_poll_step`, Source B: `3`
2. Drag **XIC** — Variable: `vfd_poll_active`
3. Drag **MSG_MODBUS** — Instance: `mb_write_freq`

| Pin | Value |
|-----|-------|
| LocalCfg | `write_freq_local_cfg` |
| TargetCfg | `write_freq_target_cfg` |
| LocalAddr | `write_freq_data` |

**Config values (set by Prog2 ST):**
- Channel = 0, Cmd = 6
- ElementCnt = 1
- Target Addr = 8193 (0x2001 — frequency setpoint register)
- Target Node = 1

**Same MOV note as Rung 2:** Load `vfd_freq_setpoint` → `write_freq_data(1)`

---

## RUNG 4 (OPTIONAL) — FAULT RESET (FC06)

**Purpose:** Write value 2 to VFD fault reset register to clear faults

```
|                                                              |
|   [EQU]              [XIC]           [MSG_MODBUS]            |
|---| A = B |----------| vfd_poll_active |--[mb_fault_reset]---|
|   | vfd_poll_step |                                          |
|   | 4             |                                          |
|                                                              |
```

1. Drag **EQU** — Source A: `vfd_poll_step`, Source B: `4`
2. Drag **XIC** — Variable: `vfd_poll_active`
3. Drag **MSG_MODBUS** — Instance: `mb_fault_reset`

| Pin | Value |
|-----|-------|
| LocalCfg | `fault_reset_local_cfg` |
| TargetCfg | `fault_reset_target_cfg` |
| LocalAddr | `fault_reset_data` |

**Config values (set by Prog2 ST):**
- Channel = 0, Cmd = 6
- ElementCnt = 1
- Target Addr = 8194 (0x2002 — fault reset register)
- Target Node = 1

**Data:** Prog2 ST sets `fault_reset_cmd := 2` each scan.
Load `fault_reset_cmd` → `fault_reset_data(1)` via MOV.

---

## OPTIONAL: DATA LOADING RUNGS

If you want to load write buffers in the LD program instead of re-enabling
COP blocks in Prog2 ST, add these rungs BEFORE the MSG rungs:

### Rung 0A — Load command data
```
|   [EQU]              [MOV]                    |
|---| vfd_poll_step=2 |--[vfd_cmd_word → write_cmd_data(1)]--|
```

### Rung 0B — Load frequency data
```
|   [EQU]              [MOV]                    |
|---| vfd_poll_step=3 |--[vfd_freq_setpoint → write_freq_data(1)]--|
```

### Rung 0C — Load fault reset data
```
|   [EQU]              [MOV]                    |
|---| vfd_poll_step=4 |--[fault_reset_cmd → fault_reset_data(1)]--|
```

---

## AFTER BUILDING — VERIFY BEFORE DOWNLOAD

1. **Build:** Ctrl+Shift+B — must show **0 errors**
2. If errors reference unknown variables, check that VARIABLES_IMPORT.csv was loaded
3. Verify program execution order: Prog2 first, then Prog3-Modbus

---

## AFTER DOWNLOAD — LIVE MONITORING

Go online (Connect > Go Online) and watch these in the Variable Monitor:

| Variable | Expected | Problem if... |
|----------|----------|---------------|
| `heartbeat` | Toggling TRUE/FALSE | PLC scan stopped |
| `uptime_seconds` | Incrementing | PLC not running |
| `vfd_poll_step` | Cycling 1→2→3→1 | Poll timer not running |
| `vfd_poll_active` | Toggling | Sequencer stuck |
| `mb_read_status.ErrorID` | ≠ 255 | 255 = MSG never executed |
| `mb_read_status.Error` | FALSE | TRUE = comm failure |
| `vfd_comm_ok` | TRUE | VFD not responding |
| `vfd_frequency` | > 0 (when running) | No VFD data |

### ErrorID Troubleshooting

| ErrorID | Meaning | Fix |
|---------|---------|-----|
| 255 | MSG never executed | Serial port not synced — redownload |
| 55 | Timeout (no VFD reply) | Check RS-485 wiring, swap D+/D- |
| 54 | Serial driver not active | Rebuild project, redownload |
| 2 | Wrong channel number | Must be Channel=0 |

---

## SERIAL PORT — THE CRITICAL STEP

**This is the whole reason for the fresh project.**

After creating the new MIRA_v5 project in CCW:
1. Go to **Embedded Serial Port** in Project Organizer
2. Set Protocol: **Modbus**, Mode: **Master**
3. Set 9600, No Parity, 2 Stop Bits (8N2)
4. **Download the full project** (not partial)
5. After download, go to Serial Port > **Diagnose**
6. Status must show **"in sync"**

If it says "out of sync": try USB download cable instead of Ethernet.
If TCPIPObject fails during download: try a factory reset first.

# MIRA Conveyor — Complete Programming Guide (Prog2 v5.0.2)

**Source:** `controller/Controller/Micro820/Micro820/Prog2.stf` (v5.0.2, 2026-03-18, ~430 lines)
**Generated:** 2026-05-09
**Target controller:** Allen-Bradley Micro820 2080-LC20-20QBB
**Use:** This is a complete end-to-end guide. Start at Part 0 if you are setting up from scratch (network, CCW project, new ladder program). If comms and the CCW project are already configured, skip directly to the Ladder Sections. When all rungs are entered, go to Part 9 for build, download, and go-online steps.

---

## Part 0 — Prerequisites

**Hardware required:**
- Allen-Bradley Micro820 2080-LC20-20QBB (PLC) — powered by 24 VDC
- Cat5e or Cat6 Ethernet cable — from PC to PLC (or to a switch on the same segment)

**Software required:**
- Connected Components Workbench (CCW) version 22 or later, installed on the programming PC
- No RSLinx Classic or DriverLinx required — CCW communicates with the Micro820 directly over EtherNet/IP

**Network assumption used in this guide:**
- PLC IP address: `192.168.1.100`
- Programming PC IP address: `192.168.1.50` (static, set in Part 1)

---

## Part 1 — Network & comms setup

1. Open **Control Panel → Network and Sharing Center → Change adapter settings**
2. Right-click the **Ethernet** adapter (the NIC connected to the PLC) → **Properties**
3. Select **Internet Protocol Version 4 (TCP/IPv4)** → **Properties**
4. Choose **Use the following IP address:**
   - IP address: `192.168.1.50`
   - Subnet mask: `255.255.255.0`
   - Default gateway: *(leave blank)*
5. Click OK through all dialogs.
6. Open a Command Prompt and run: `ping 192.168.1.100`
   - Expected: 3 replies with < 1 ms latency. If no reply, check cable, PLC power, and PLC IP (factory default is `192.168.1.1` — may need to set it via the USB programming port first).

> **Tailscale gotcha (if Tailscale is installed on this PC):** A remote peer advertising `192.168.1.0/24` can hijack the route and make the PLC unreachable. Run this once in an elevated terminal to protect the route: `tailscale set --accept-routes=false`. Full background in `runbooks/remote-plc-programming.md`.

---

## Part 2 — CCW project setup

**Option A — Open the existing project (fastest, use if the project is already on this PC):**

1. Launch CCW
2. **File → Open Project** → navigate to the `MIRA_PLC_IO_NEW` CCW project folder
3. The Micro820 device at `192.168.1.100` is already configured — skip to Part 3

**Option B — Create a fresh project:**

1. Launch CCW → **File → New Project** → name it `MIRA_PLC`
2. In the **Device Toolbox** panel (left side), expand **Micro800 Family → Micro820**
3. Drag **2080-LC20-20QBB** onto the project canvas
4. Right-click the device tile → **Properties** → set **IP Address** to `192.168.1.100` → OK

---

## Part 3 — Create the Prog2_LD ladder program

1. In the **Controller Organizer** tree (left panel), expand **Micro820**
2. Right-click **Programs** → **Add Program**
3. Select **Ladder Diagram** as the language
4. Name it `Prog2_LD` → click **OK**
5. The LD editor opens with one empty rung — you are ready to transcribe

> **Variable scope:** `Prog2_LD` shares the controller's Global Variable table with the existing `Prog2` ST program. All variables declared in `Prog2.stf` are already available by name — you do **not** need to redeclare anything. If a variable shows as undeclared at build time, see Part 10.

---

## Length expectation

This document mirrors all 8 sections of the production ST source. It contains roughly 50 rungs. The full Prog2.stf is not "simple" — the e-stop supervision, 5-state machine, and 4-step Modbus poll cycle each generate many rungs. If you want a smaller starting point, see `drive_test/step2_vfd_control/Prog_drive_test.stf` (~10 rungs) and ask for a separate ladder reference for that program.

## Notation legend

This is the symbol set used in every rung below. The right-hand column maps to the CCW LD toolbox name you click to insert.

| ASCII | Meaning | CCW LD element |
|---|---|---|
| `--[ A ]--` | NO contact (XIC) | Direct Contact |
| `--[/ A ]--` | NC contact (XIO) | Reverse Contact |
| `--( A )--` | output coil (OTE) | Direct Coil |
| `--(L A )--` | latch / set | Set Coil |
| `--(U A )--` | unlatch / reset | Reset Coil |
| `[ONS A]` | one-shot positive edge (rising) | One-Shot |
| `[EQU a b]` | equality compare contact | EQU instruction |
| `[GRT a b]` | greater-than compare contact | GRT instruction |
| `[MOV s d]` | move source → dest | MOV instruction |
| `[ADD a b r]` | r := a + b | ADD instruction |
| `[MUL a b r]` | r := a × b | MUL instruction |
| `[NEQ a b]` | not-equal compare contact | NEQ instruction |
| `[GEQ a b]` | greater-or-equal compare contact | GEQ instruction |
| `[LEQ a b]` | less-or-equal compare contact | LEQ instruction |
| `[LES a b]` | less-than compare contact | LES instruction |
| `[LIM lo val hi]` | limit test (lo ≤ val ≤ hi) | LIM instruction |
| `[SUB a b r]` | r := a − b | SUB instruction |
| `[DIV a b r]` | r := a ÷ b | DIV instruction |
| `[MOD a b r]` | r := a mod b | MOD instruction |
| `[COP src dst N]` | copy N elements src → dst | COP instruction |
| `[CTU C PRE=N]` | up-counter | CTU function block |
| `[RES C]` | reset timer/counter | RES instruction |
| `[OSR A B]` | rising-edge one-shot (A→B for 1 scan) | OSR instruction |
| `[OSF A B]` | falling-edge one-shot | OSF instruction |
| `[JSR routine]` | jump to subroutine | JSR instruction |
| `[JMP lbl]` / `[LBL lbl]` | skip / label | JMP / LBL |
| `[AFI]` | always-false instruction (debug disable) | AFI |
| `[TON: name PT=T#1000ms]` | on-delay timer | TON function block |
| `[FB: blockname]` | function block placeholder | drag from FB toolbox |
| `+--..--+` | parallel branch (ASCII) | branch open / close |
| `BST … NXB … BND` | explicit branch mnemonics (L5X-portable) | equivalent to `+--..--+`; emit alongside ASCII when targeting Studio 5000 export |

**On function blocks** (MSG_MODBUS, TON, COP): rather than try to draw the boxes in ASCII, each FB rung is shown as `--[ enable ]--[FB: name]--` and the parameter bindings are listed as bullets immediately underneath. When you place the block in CCW, you'll see the parameter pins on the block face — bind each pin to the variable named in the bullets.

**On TON/TOF specifically:** the contacts shown to the left of `[FB: …]` should be wired to the block's **`IN` pin**, not the rung's EN. CCW Micro800 TON has a distinct `IN` input separate from the enable line; if you connect the rung condition to EN and leave `IN` dangling (default FALSE) the timer never starts. The bullets under each TON below explicitly say `IN = (rung condition)` to remind you.

**Reading direction:** rungs flow left-to-right along the power rail. Multiple instructions on a single line are in series. Parallel branches use `+--..--+` boxes around the parallel paths.

**Always-true rungs:** for unconditional execution (e.g. `[ADD cycle_count 1 cycle_count]`), CCW lets you leave the rung condition empty; in this doc those are shown with no contacts at all, just the instruction box.

## Variable summary

All variables already exist in the Controller Global Variables table because Prog2.stf already references them. When creating a new `Prog2_LD` program, you do **not** need to redeclare anything — the LD program in the same controller scope shares the same global variable table.

Groups (for cross-reference while transcribing):

- **Physical I/O (auto-declared):** `_IO_EM_DI_00..04`, `_IO_EM_DI_05..06` (sensors), `_IO_EM_DO_00..03`. We refer to these in the rungs below as `I-00`..`I-06` and `O-00`..`O-03` for readability — replace with the full `_IO_EM_*` name when you click the contact in CCW.
- **E-stop:** `e_stop_active`, `estop_wiring_fault`, `fault_alarm`
- **Direction selector:** `dir_fwd`, `dir_rev`, `dir_off`, `dir_fault`
- **Sensors / button:** `sensor_1_active`, `sensor_2_active`, `prev_button`, `button_rising`
- **State machine:** `conv_state` (INT 0–4), `motor_running`, `conveyor_running`, `motor_speed`, `motor_stopped`, `error_code`, `item_count`, `SensorEnd_Prev`, `start_timer`, `stop_timer`
- **VFD command/freq:** `vfd_cmd_word`, `vfd_freq_setpoint`, `conveyor_speed_cmd`, `conveyor_speed`, `fault_reset_cmd`, `vfd_fault_reset_pending`, `vfd_fault_code`
- **VFD status:** `vfd_frequency`, `vfd_current`, `vfd_dc_bus`, `vfd_voltage`, `vfd_comm_ok`, `vfd_comm_err`
- **Modbus poll engine:** `vfd_poll_active`, `vfd_poll_step`, `vfd_msg_done`, `vfd_poll_timer`, `msg_step_timer`, `vfd_err_timer`, `step1_active..step4_active`, `msg_phase`
- **Modbus FBs + structs:** `mb_read_status`, `mb_write_cmd`, `mb_write_freq`, `mb_fault_reset`; configs `read_local_cfg`, `read_target_cfg`, `write_cmd_local_cfg`, `write_cmd_target_cfg`, `write_freq_local_cfg`, `write_freq_target_cfg`, `fault_reset_local_cfg`, `fault_reset_target_cfg`; data buffers `read_data`, `write_cmd_data`, `write_freq_data`, `fault_reset_data`; COP helpers `cop_cmd`, `cop_freq`, `cop_reset`
- **Diagnostics:** `heartbeat`, `cycle_count`, `uptime_timer`, `uptime_seconds`, `system_ready`, `vfd_poll_count`, `vfd_err_count`, `last_good_poll`, `diag_ready`, `read_vfd_errorid`, `write_cmd_errorid`, `write_freq_errorid`
- **HMI / overrides:** `ALL_LEDS_ON`

---

# SECTION 1 — Dual-channel e-stop supervision

ST source: lines 50–61. Highest priority. I-02 is NC (healthy = 1), I-03 is NO (healthy = 0). Only one of `(I-02 XOR I-03)` healthy state is "OK". Both same → wiring fault.

### Rung 1.1 — Wiring fault detection

Wiring fault is true when both contacts are in the same state (both closed or both open).

```
       +---[ I-02 ]----[ I-03 ]------+
       |                              |
-------+                              +-----( estop_wiring_fault )----
       |                              |
       +---[/ I-02 ]---[/ I-03 ]-----+
```

### Rung 1.2 — E-stop active

`e_stop_active := (NOT I-02 AND I-03) OR estop_wiring_fault`

```
       +---[/ I-02 ]---[ I-03 ]------------+
       |                                    |
-------+                                    +-----( e_stop_active )----
       |                                    |
       +---[ estop_wiring_fault ]----------+
```

### Rung 1.3 — Latch fault_alarm on wiring fault

ST sets `fault_alarm := TRUE` in the wiring-fault path with no clear in this section. Latch (OTL) preserves it across scans; it is unlatched only by the recovery rung in Section 4.

```
-------[ estop_wiring_fault ]-------(L fault_alarm )----
```

---

# SECTION 2 — Operator I/O mapping

ST source: lines 66–75.

### Rung 2.1 — dir_fwd

```
-------[ I-00 ]----[/ I-01 ]-------( dir_fwd )----
```

### Rung 2.2 — dir_rev

```
-------[/ I-00 ]---[ I-01 ]-------( dir_rev )----
```

### Rung 2.3 — dir_off

```
-------[/ I-00 ]---[/ I-01 ]-------( dir_off )----
```

### Rung 2.4 — dir_fault

Both contacts closed = wiring fault on the selector.

```
-------[ I-00 ]----[ I-01 ]-------( dir_fault )----
```

### Rung 2.5 — Sensor passthrough

```
-------[ I-05 ]-------( sensor_1_active )----
-------[ I-06 ]-------( sensor_2_active )----
```

### Rung 2.6 — Button rising-edge (two-rung pattern)

ST: `button_rising := _IO_EM_DI_04 AND NOT prev_button; prev_button := _IO_EM_DI_04`

```
-------[ I-04 ]----[/ prev_button ]-------( button_rising )----
-------[ I-04 ]-----------------------------( prev_button )-----
```

Equivalent single-instruction form using ONS:

```
-------[ I-04 ]----[ONS prev_button]------( button_rising )----
```

The ONS form is more compact and avoids the two-rung-order subtlety. Pick one and stick with it.

---

# SECTION 3 — Safety contactor Q1 (O-02)

ST source: line 80. The contactor energizes only when the e-stop is healthy and not in wiring fault.

### Rung 3.1

```
-------[/ e_stop_active ]----[/ estop_wiring_fault ]-------( O-02 )----
```

---

# SECTION 4 — Conveyor state machine

ST source: lines 86–180. States: 0 IDLE, 1 STARTING, 2 RUNNING, 3 STOPPING, 4 FAULT. The pattern is: each state is guarded by `[EQU conv_state n]`, transitions are `[MOV n conv_state]`, and per-state effects (motor_running, vfd_cmd_word, etc.) are derived from the state value rather than written by each transition.

### Rung 4.1 — motor_running (states 1 STARTING and 2 RUNNING)

```
       +---[EQU conv_state 1]----+
       |                          |
-------+                          +-----( motor_running )----
       |                          |
       +---[EQU conv_state 2]----+
```

### Rung 4.2 — conveyor_running (state 2 only)

```
-------[EQU conv_state 2]-------( conveyor_running )----
```

### Rung 4.3 — VFD command word: STOP (1) in idle / stopping / fault

```
       +---[EQU conv_state 0]----+
       |                          |
-------+---[EQU conv_state 3]----+----[MOV 1 vfd_cmd_word]---
       |                          |
       +---[EQU conv_state 4]----+
```

### Rung 4.4 — VFD command word: FWD+RUN (18) in states 1 or 2 with dir_fwd

```
       +---[EQU conv_state 1]----+
       |                          |
-------+                          +----[ dir_fwd ]----[MOV 18 vfd_cmd_word]---
       |                          |
       +---[EQU conv_state 2]----+
```

### Rung 4.5 — VFD command word: REV+RUN (20) in states 1 or 2 with dir_rev

```
       +---[EQU conv_state 1]----+
       |                          |
-------+                          +----[ dir_rev ]----[MOV 20 vfd_cmd_word]---
       |                          |
       +---[EQU conv_state 2]----+
```

### Rung 4.6 — Transition: any state → 4 FAULT on fault conditions

The `[/EQU conv_state 4]` guard prevents re-firing once already in fault.

```
       +---[ e_stop_active ]----+
       |                         |
-------+---[ fault_alarm ]------+----[/ EQU conv_state 4]----[MOV 4 conv_state]---
       |                         |
       +---[ dir_fault ]--------+
```

### Rung 4.7 — Transition: 0 IDLE → 1 STARTING

ST: lines 96–98. Triggered by button rising-edge with a direction selected and no faults.

```
                                         +---[ dir_fwd ]---+
                                         |                  |
-------[EQU conv_state 0]--[ button_rising ]--+              +--[/ fault_alarm ]--[/ e_stop_active ]--[/ dir_fault ]--[MOV 1 conv_state]---
                                         |                  |
                                         +---[ dir_rev ]---+
```

### Rung 4.8 — Transition: 1 STARTING → 2 RUNNING (after 3s)

ST: lines 111–113.

```
-------[EQU conv_state 1]----[ start_timer.Q ]----[/ e_stop_active ]----[/ fault_alarm ]----[/ dir_fault ]----[MOV 2 conv_state]---
```

### Rung 4.9 — Transition: 2 RUNNING → 3 STOPPING on dir_off

ST: lines 128–131.

```
-------[EQU conv_state 2]----[ dir_off ]----[/ e_stop_active ]----[/ fault_alarm ]----[/ dir_fault ]----[MOV 3 conv_state]---
```

### Rung 4.10 — Transition: 3 STOPPING → 0 IDLE on stop_timer.Q

ST: lines 146–149.

```
-------[EQU conv_state 3]----[ stop_timer.Q ]----[/ e_stop_active ]----[/ fault_alarm ]----[MOV 0 conv_state]---
```

### Rung 4.11 — Recovery from FAULT: 4 → 0 on button rising

ST: lines 167–173.

```
-------[EQU conv_state 4]----[ button_rising ]----[/ e_stop_active ]----[/ estop_wiring_fault ]----[/ dir_off ]----+--(U fault_alarm)---
                                                                                                                    |
                                                                                                                    +--[MOV 0 error_code]---
                                                                                                                    |
                                                                                                                    +--(L vfd_fault_reset_pending)---
                                                                                                                    |
                                                                                                                    +--[MOV 0 conv_state]---
```

### Rung 4.12 — error_code MOV in FAULT state (4 separate rungs)

ST: lines 156–165. One per cause. The ELSIF chain in ST means earlier conditions take priority; in ladder, ordering the rungs from highest priority (e_stop) to lowest (vfd_comm_err) preserves that — each later rung will overwrite the prior MOV only if its condition is true and the prior wasn't.

To match the ELSIF semantics exactly, gate each rung with `[/ <higher-priority condition>]` — pattern shown for the second rung:

```
-------[EQU conv_state 4]----[ e_stop_active ]----------------------------------[MOV 6 error_code]---
-------[EQU conv_state 4]----[/ e_stop_active ]----[ estop_wiring_fault ]------[MOV 7 error_code]---
-------[EQU conv_state 4]----[/ e_stop_active ]----[/ estop_wiring_fault ]----[ dir_fault ]----[MOV 8 error_code]---
-------[EQU conv_state 4]----[/ e_stop_active ]----[/ estop_wiring_fault ]----[/ dir_fault ]----[ vfd_comm_err ]----[MOV 9 error_code]---
```

### Rung 4.13 — start_timer (3s, runs while in state 1)

```
-------[EQU conv_state 1]------[FB: start_timer]---
```
- Type: `TON`
- IN  = (rung condition above)
- PT  = `T#3000ms`
- Q   → `start_timer.Q` (used in rung 4.8)

### Rung 4.14 — stop_timer (2s, runs while in state 3)

```
-------[EQU conv_state 3]------[FB: stop_timer]---
```
- Type: `TON`
- PT  = `T#2000ms`
- Q   → `stop_timer.Q` (used in rung 4.10)

### Rung 4.15 — Item count on sensor_2 rising edge in state 2

ST: lines 133–136.

```
-------[EQU conv_state 2]----[ sensor_2_active ]----[/ SensorEnd_Prev ]------[ADD item_count 1 item_count]---
-------[ sensor_2_active ]------------------------------------------------( SensorEnd_Prev )-----
```

### Rung 4.16 — motor_speed echo in state 2

```
-------[EQU conv_state 2]------[MOV conveyor_speed_cmd motor_speed]---
```

### Rung 4.17 — motor_speed zero in idle / stopping / fault

ST sets `motor_speed := 0` in states 0 (line 91), 3 (line 142), and 4 (line 155). Without this rung, `motor_speed` would retain its last state-2 value forever — a diagnostic divergence visible to anything reading it from Modbus.

```
       +---[EQU conv_state 0]----+
       |                          |
-------+---[EQU conv_state 3]----+----[MOV 0 motor_speed]---
       |                          |
       +---[EQU conv_state 4]----+
```

---

# SECTION 5 — LED indicators

ST source: lines 185–194. `ALL_LEDS_ON` is a global override (set from HMI for lamp test); each LED rung ORs the override against the normal driver.

### Rung 5.1 — Green LED O-00 (running)

```
       +---[ ALL_LEDS_ON ]----+
       |                       |
-------+                       +-----( O-00 )----
       |                       |
       +---[ motor_running ]--+
```

### Rung 5.2 — Red LED O-01 (fault)

```
       +---[ ALL_LEDS_ON ]------------+
       |                                |
       +---[ e_stop_active ]----------+
       |                                |
-------+---[ fault_alarm ]------------+-----( O-01 )----
       |                                |
       +---[ estop_wiring_fault ]----+
       |                                |
       +---[ dir_fault ]--------------+
       |                                |
       +---[GRT vfd_fault_code 0]----+
```

### Rung 5.3 — PB Run LED O-03

```
       +---[ ALL_LEDS_ON ]----+
       |                       |
-------+                       +-----( O-03 )----
       |                       |
       +---[ motor_running ]--+
```

---

# SECTION 6 — VFD Modbus RTU poll loop

ST source: lines 197–359. Channel 0 (RS-485) → AutomationDirect GS10 at slave 1, 9600/8N2. Four steps cycle: read status (0x2103) → write command (0x2000) → write frequency (0x2001) → optional fault reset (0x2002).

This is the largest block. Strategy: reuse `step1_active..step4_active` (computed in rungs 6.7–6.10) as the IN gate for each MSG_MODBUS, keeping each MSG rung clean.

## Struct field initialization — pick ONE pattern

The MSG_MODBUS function blocks need `LocalCfg` and `TargetCfg` struct fields populated. Two patterns, with tradeoffs:

### Pattern A — initial values in the Variable Properties table (try first)

In CCW, open Controller → Global Variables → Variable Properties. For each struct, set the initial value of each field:

| Variable | Field | Initial value |
|---|---|---|
| `read_local_cfg` | `Channel` | 0 |
| `read_local_cfg` | `TriggerType` | 0 |
| `read_local_cfg` | `Cmd` | 3 |
| `read_local_cfg` | `ElementCnt` | 6 |
| `read_target_cfg` | `Addr` | 8451 |
| `read_target_cfg` | `Node` | 1 |
| `write_cmd_local_cfg` | `Channel` | 0 |
| `write_cmd_local_cfg` | `TriggerType` | 0 |
| `write_cmd_local_cfg` | `Cmd` | 6 |
| `write_cmd_local_cfg` | `ElementCnt` | 1 |
| `write_cmd_target_cfg` | `Addr` | 8192 |
| `write_cmd_target_cfg` | `Node` | 1 |
| `write_freq_local_cfg` | `Channel` | 0 |
| `write_freq_local_cfg` | `TriggerType` | 0 |
| `write_freq_local_cfg` | `Cmd` | 6 |
| `write_freq_local_cfg` | `ElementCnt` | 1 |
| `write_freq_target_cfg` | `Addr` | 8193 |
| `write_freq_target_cfg` | `Node` | 1 |
| `fault_reset_local_cfg` | `Channel` | 0 |
| `fault_reset_local_cfg` | `TriggerType` | 0 |
| `fault_reset_local_cfg` | `Cmd` | 6 |
| `fault_reset_local_cfg` | `ElementCnt` | 1 |
| `fault_reset_target_cfg` | `Addr` | 8194 |
| `fault_reset_target_cfg` | `Node` | 1 |

### Pattern B — first-scan MOV rungs (fallback if struct initial values don't stick)

Reports from the field show that on Micro800, **struct member initial values via the Variable Properties table sometimes don't persist after a download**. If you see `read_local_cfg.Channel` reading 0 in the monitor but the MSG fails with ErrorID = 1 or the comm doesn't open, fall back to the first-scan MOV pattern below. Add a Bool `first_scan_done` to globals (default `FALSE`) and one rung:

```
-------[/ first_scan_done ]----+--[MOV 0 read_local_cfg.Channel]---
                                +--[MOV 0 read_local_cfg.TriggerType]---
                                +--[MOV 3 read_local_cfg.Cmd]---
                                +--[MOV 6 read_local_cfg.ElementCnt]---
                                +--[MOV 8451 read_target_cfg.Addr]---
                                +--[MOV 1 read_target_cfg.Node]---
                                +--[MOV 0 write_cmd_local_cfg.Channel]---
                                +--[MOV 0 write_cmd_local_cfg.TriggerType]---
                                +--[MOV 6 write_cmd_local_cfg.Cmd]---
                                +--[MOV 1 write_cmd_local_cfg.ElementCnt]---
                                +--[MOV 8192 write_cmd_target_cfg.Addr]---
                                +--[MOV 1 write_cmd_target_cfg.Node]---
                                +--[MOV 0 write_freq_local_cfg.Channel]---
                                +--[MOV 0 write_freq_local_cfg.TriggerType]---
                                +--[MOV 6 write_freq_local_cfg.Cmd]---
                                +--[MOV 1 write_freq_local_cfg.ElementCnt]---
                                +--[MOV 8193 write_freq_target_cfg.Addr]---
                                +--[MOV 1 write_freq_target_cfg.Node]---
                                +--[MOV 0 fault_reset_local_cfg.Channel]---
                                +--[MOV 0 fault_reset_local_cfg.TriggerType]---
                                +--[MOV 6 fault_reset_local_cfg.Cmd]---
                                +--[MOV 1 fault_reset_local_cfg.ElementCnt]---
                                +--[MOV 8194 fault_reset_target_cfg.Addr]---
                                +--[MOV 1 fault_reset_target_cfg.Node]---
                                +--( first_scan_done )---
```

## Poll engine rungs

### Rung 6.1 — VFD frequency setpoint compute

ST: lines 242–245.

```
-------[MUL conveyor_speed_cmd 10 vfd_freq_setpoint]---
-------[EQU vfd_freq_setpoint 0]----[ motor_running ]------[MOV 300 vfd_freq_setpoint]---
```

### Rung 6.2 — Poll timer (500ms)

```
-------[/ vfd_poll_active ]------[FB: vfd_poll_timer]---
```
- Type: `TON`
- PT = `T#500ms`

### Rung 6.3 — Poll tick triggers next step

```
-------[ vfd_poll_timer.Q ]----[/ vfd_poll_active ]----+--(L vfd_poll_active)---
                                                        |
                                                        +--(U vfd_msg_done)---
                                                        |
                                                        +--[ADD vfd_poll_step 1 vfd_poll_step]---
```

### Rung 6.4 — Reset poll step when > 4 (first of two reset rungs)

> **Awkward spot:** the ST source has two consecutive resets on `vfd_poll_step` — first wraps from > 4 back to 1, second skips step 4 if no fault reset is pending. In ladder, these are two separate rungs that **must run in this order** after rung 6.3.

```
-------[GRT vfd_poll_step 4]------[MOV 1 vfd_poll_step]---
```

### Rung 6.5 — Skip step 4 if no fault reset pending (second of two reset rungs)

```
-------[EQU vfd_poll_step 4]----[/ vfd_fault_reset_pending ]------[MOV 1 vfd_poll_step]---
```

### Rung 6.6 — Per-step timeout watchdog (2s)

ST: lines 273–279. Catches silent hangs when the serial driver isn't loaded.

```
-------[ vfd_poll_active ]----[/ vfd_msg_done ]------[FB: msg_step_timer]---
```
- Type: `TON`
- PT = `T#2000ms`

```
-------[ msg_step_timer.Q ]------+--(L vfd_comm_err)---
                                  |
                                  +--(U vfd_comm_ok)---
                                  |
                                  +--(L vfd_msg_done)---
                                  |
                                  +--(U vfd_poll_active)---
```

### Rungs 6.7–6.10 — Step-active flags (computed first so they can gate the MSG rungs)

ST: lines 383–386.

```
-------[ vfd_poll_active ]----[EQU vfd_poll_step 1]------( step1_active )----
-------[ vfd_poll_active ]----[EQU vfd_poll_step 2]------( step2_active )----
-------[ vfd_poll_active ]----[EQU vfd_poll_step 3]------( step3_active )----
-------[ vfd_poll_active ]----[EQU vfd_poll_step 4]------( step4_active )----
```

### Rung 6.11 — COP write buffers (load command/freq/reset values into data arrays)

ST: lines 247–254. These COP blocks copy single INTs into 1-element arrays for the MSG_MODBUS write data.

```
-------[FB: cop_cmd]---
```
- Type: `COP`
- Enable    = always TRUE (or just leave rung condition empty)
- Src       = `vfd_cmd_word`
- SrcOffset = 0
- Dest      = `write_cmd_data`
- DestOffset = 0
- Length    = 1
- Swap      = FALSE

```
-------[FB: cop_freq]---
```
- Src = `vfd_freq_setpoint`, Dest = `write_freq_data`, Length = 1

```
-------[MOV 2 fault_reset_cmd]---
-------[FB: cop_reset]---
```
- Src = `fault_reset_cmd`, Dest = `fault_reset_data`, Length = 1

### Rung 6.12 — MSG_MODBUS read VFD status (step 1)

```
-------[ step1_active ]------[FB: mb_read_status]---
```
- Type: `MSG_MODBUS`
- IN          = (rung condition)
- LocalCfg    = `read_local_cfg`
- TargetCfg   = `read_target_cfg`
- LocalAddr   = `read_data`
- Q           → `mb_read_status.Q` (used in 6.16)
- Error       → `mb_read_status.Error` (used in 6.16)

### Rung 6.13 — MSG_MODBUS write VFD command (step 2)

```
-------[ step2_active ]------[FB: mb_write_cmd]---
```
- Type: `MSG_MODBUS`
- LocalCfg  = `write_cmd_local_cfg`
- TargetCfg = `write_cmd_target_cfg`
- LocalAddr = `write_cmd_data`

### Rung 6.14 — MSG_MODBUS write VFD frequency (step 3)

```
-------[ step3_active ]------[FB: mb_write_freq]---
```
- Type: `MSG_MODBUS`
- LocalCfg  = `write_freq_local_cfg`
- TargetCfg = `write_freq_target_cfg`
- LocalAddr = `write_freq_data`

### Rung 6.15 — MSG_MODBUS write VFD fault reset (step 4)

```
-------[ step4_active ]------[FB: mb_fault_reset]---
```
- Type: `MSG_MODBUS`
- LocalCfg  = `fault_reset_local_cfg`
- TargetCfg = `fault_reset_target_cfg`
- LocalAddr = `fault_reset_data`

### Rung 6.16 — Step 1 result handler (success)

ST: lines 305–315.

```
-------[ step1_active ]----[ mb_read_status.Q ]------+--[MOV read_data[1] vfd_frequency]---
                                                      |
                                                      +--[MOV read_data[2] vfd_current]---
                                                      |
                                                      +--[MOV read_data[3] vfd_dc_bus]---
                                                      |
                                                      +--[MOV read_data[4] vfd_voltage]---
                                                      |
                                                      +--(L vfd_comm_ok)---
                                                      |
                                                      +--(U vfd_comm_err)---
                                                      |
                                                      +--(L vfd_msg_done)---
                                                      |
                                                      +--(U vfd_poll_active)---
```

### Rung 6.17 — Step 1 result handler (error)

ST: lines 316–321.

```
-------[ step1_active ]----[ mb_read_status.Error ]------+--(U vfd_comm_ok)---
                                                          |
                                                          +--(L vfd_comm_err)---
                                                          |
                                                          +--(L vfd_msg_done)---
                                                          |
                                                          +--(U vfd_poll_active)---
```

### Rung 6.18 — Step 2 result handler (Q or Error)

ST: lines 323–330.

```
                                  +---[ mb_write_cmd.Q ]------+
                                  |                            |
-------[ step2_active ]----+      +                            +----+--(L vfd_msg_done)---
                            |      |                            |    |
                            +------+---[ mb_write_cmd.Error ]--+    +--(U vfd_poll_active)---
                                                                |
                                                                +--(L vfd_comm_err)---  (only on Error branch)
```

Practical authoring tip: this is easier in CCW as **two separate rungs** — one with `[ step2_active ]--[ mb_write_cmd.Q ]` driving the latches, and one with `[ step2_active ]--[ mb_write_cmd.Error ]` driving the latches plus `(L vfd_comm_err)`.

### Rung 6.19 — Step 3 result handler (same shape as rung 6.18)

```
-------[ step3_active ]----[ mb_write_freq.Q ]------+--(L vfd_msg_done)---
                                                     |
                                                     +--(U vfd_poll_active)---

-------[ step3_active ]----[ mb_write_freq.Error ]--+--(L vfd_msg_done)---
                                                     |
                                                     +--(U vfd_poll_active)---
                                                     |
                                                     +--(L vfd_comm_err)---
```

### Rung 6.20 — Step 4 result handler

ST: lines 341–346. Both Q and Error clear `vfd_fault_reset_pending`.

```
-------[ step4_active ]----+---[ mb_fault_reset.Q ]------+--(U vfd_fault_reset_pending)---
                            |                              |
                            |                              +--(L vfd_msg_done)---
                            |                              |
                            |                              +--(U vfd_poll_active)---
                            |
                            +---[ mb_fault_reset.Error ]--+--(U vfd_fault_reset_pending)---
                                                          |
                                                          +--(L vfd_msg_done)---
                                                          |
                                                          +--(U vfd_poll_active)---
```

### Rung 6.21 — VFD comm watchdog (5s of errors latches fault)

ST: lines 355–359.

```
-------[ vfd_comm_err ]------[FB: vfd_err_timer]---
```
- Type: `TON`
- PT = `T#5000ms`

```
-------[ vfd_err_timer.Q ]------+--(L fault_alarm)---
                                 |
                                 +--[MOV 9 error_code]---
```

---

# SECTION 7 — Diagnostics

ST source: lines 364–372.

### Rung 7.1 — Heartbeat toggle

ST: `heartbeat := NOT heartbeat`. In ladder this is a 2-scan oscillator.

```
-------[/ heartbeat ]------( heartbeat )----
```

Trace:
- Scan N:   `heartbeat = FALSE` → contact closed → coil energized → `heartbeat = TRUE`
- Scan N+1: `heartbeat = TRUE` → contact open → coil de-energized → `heartbeat = FALSE`

### Rung 7.2 — Cycle count

ST: line 365. Always-true rung.

```
-------[ADD cycle_count 1 cycle_count]---
```

### Rung 7.3 — Uptime self-restart timer + seconds counter

ST: lines 366–369.

```
-------[/ uptime_timer.Q ]------[FB: uptime_timer]---
```
- Type: `TON`
- PT = `T#1000ms`

```
-------[ uptime_timer.Q ]------[ADD uptime_seconds 1 uptime_seconds]---
```

### Rung 7.4 — system_ready

ST: line 370.

```
-------[/ fault_alarm ]----[/ e_stop_active ]----[EQU conv_state 2]------( system_ready )----
```

### Rung 7.5 — motor_stopped

```
-------[/ motor_running ]------( motor_stopped )----
```

### Rung 7.6 — conveyor_speed echo

```
-------[MOV conveyor_speed_cmd conveyor_speed]---
```

---

# SECTION 8 — Diagnostic instrumentation

ST source: lines 374–427. These rungs publish MSG-block internals as plain coils/integers for `vfd_diag.py` and the Ignition HMI to read.

> Note: rungs 6.7–6.10 (the `step1_active..step4_active` flags) live in this section in the ST source (lines 383–386) but are **placed in Section 6** in this ladder doc because Section 6 uses them as gating contacts. Don't duplicate them here.

### Rung 8.1 — msg_phase mirror

ST: lines 389–393.

```
-------[ vfd_poll_active ]------[MOV vfd_poll_step msg_phase]---
-------[/ vfd_poll_active ]----[MOV 0 msg_phase]---
```

### Rung 8.2 — read_vfd_errorid mirror

ST: lines 397–401.

```
-------[ mb_read_status.Q ]----[MOV 0 read_vfd_errorid]---
-------[ mb_read_status.Error ]----[MOV 1 read_vfd_errorid]---
```

### Rung 8.3 — write_cmd_errorid mirror

```
-------[ mb_write_cmd.Q ]----[MOV 0 write_cmd_errorid]---
-------[ mb_write_cmd.Error ]----[MOV 1 write_cmd_errorid]---
```

### Rung 8.4 — write_freq_errorid mirror

```
-------[ mb_write_freq.Q ]----[MOV 0 write_freq_errorid]---
-------[ mb_write_freq.Error ]----[MOV 1 write_freq_errorid]---
```

### Rung 8.5 — vfd_poll_count increment on poll tick

ST: lines 414–416.

```
-------[ vfd_poll_timer.Q ]----[/ vfd_poll_active ]------[ADD vfd_poll_count 1 vfd_poll_count]---
```

### Rung 8.6 — vfd_err_count increment on any MSG error

ST: lines 419–421.

```
       +---[ mb_read_status.Error ]----+
       |                                |
-------+---[ mb_write_cmd.Error ]------+----[ADD vfd_err_count 1 vfd_err_count]---
       |                                |
       +---[ mb_write_freq.Error ]----+
```

### Rung 8.7 — last_good_poll tracker

ST: lines 424–427.

```
-------[ mb_read_status.Q ]----[/ mb_read_status.Error ]------+--[MOV vfd_poll_count last_good_poll]---
                                                              |
                                                              +--(L diag_ready)---
```

---

# Verification

After transcribing all rungs into a new CCW LD program (e.g. `Prog2_LD`):

1. **Build in CCW.** Resolve any "undeclared identifier" errors against `Prog2.stf` as the authoritative variable list. The `scripts/ccw_last_error.py` script is the fastest way to find the actual error in the CCW logs.
2. **Download to the Micro820 simulator** (or live PLC during a maintenance window — coordinate with whoever's running the line).
3. **Run beside the production ST `Prog2`.** Compare Modbus coil snapshots from `scripts/` Modbus tools — `motor_running`, `conveyor_running`, `e_stop_active`, `vfd_comm_ok`, `vfd_poll_count` should track within one scan cycle for matching inputs.
4. **Spot-check the four state transitions interactively:**
   - idle → starting (button + dir selected)
   - starting → running (3s timer)
   - running → stopping (dir back to off)
   - stopping → idle (2s timer)
5. **Spot-check fault recovery:** trigger a wiring fault (open both e-stop channels), verify `fault_alarm` latches, and verify it only clears via the recovery button-rising path in rung 4.11.

This is **not** a formal equivalence proof — Micro820 ladder and ST scan order can differ, especially around the four MSG_MODBUS blocks, and one of the two reset rungs (6.4 / 6.5) being out of order will give silently wrong behavior. Behavioral parity on coil states is the bar.

---

# Part 9 — Build, download, and go online

After you have entered all rungs (Sections 1–8 above):

1. **Save:** Ctrl+S

2. **Build the project:**
   - `Build` menu → **Build Project** (or press Ctrl+B)
   - The Output window at the bottom shows errors and warnings
   - Resolve all errors before proceeding. For cryptic CCW error messages, run `python scripts\ccw_last_error.py` in the project root — it extracts the plain-English error from CCW's internal logs and lists likely causes
   - If you see "Undeclared identifier" errors, see Part 10

3. **Go Online (connect to the PLC):**
   - Click the green **"Go Online"** lightning-bolt button in the main toolbar
     OR: `Controller` menu → **Connect**
   - CCW scans the `192.168.1.x` subnet for EtherNet/IP devices
   - The Micro820 at `192.168.1.100` will appear in the device list — click **Connect**
   - The status bar at the bottom of CCW turns green and shows **"Online"**
   - If CCW does not find the device: re-run `ping 192.168.1.100` to confirm the route is intact (see Tailscale note in Part 1)

4. **Download to the controller:**
   - `Controller` menu → **Download to Controller**
   - A dialog warns that the controller will switch to Program mode during download — accept
   - Wait for **"Download complete"** in the Output window

5. **Switch to Run mode:**
   - Click the mode dropdown in the toolbar → select **Run**
   - Rungs begin evaluating on every scan; energized contacts and coils highlight green
   - Confirm `heartbeat` (rung 7.1) is toggling — it will blink in the monitor view once per scan pair

---

# Part 10 — Variable declarations (undeclared-identifier fallback)

If the build produces "Undeclared identifier" errors and `Prog2.stf` is not already in the same project (i.e., this is a clean controller with no ST program), declare missing variables manually:

1. In the Controller Organizer, expand **Micro820** → double-click **Global Variables**
2. For each undeclared variable, click **Add** and set **Name** and **Data Type**:

| Data type | Examples |
|---|---|
| `BOOL` | `e_stop_active`, `dir_fwd`, `dir_rev`, `dir_off`, `dir_fault`, `motor_running`, `conveyor_running`, `motor_stopped`, `fault_alarm`, `estop_wiring_fault`, `button_rising`, `prev_button`, `sensor_1_active`, `sensor_2_active`, `SensorEnd_Prev`, `vfd_comm_ok`, `vfd_comm_err`, `vfd_poll_active`, `vfd_msg_done`, `vfd_fault_reset_pending`, `system_ready`, `heartbeat`, `diag_ready`, `step1_active`, `step2_active`, `step3_active`, `step4_active`, `ALL_LEDS_ON` |
| `INT` | `conv_state`, `error_code`, `motor_speed`, `conveyor_speed`, `vfd_cmd_word`, `vfd_freq_setpoint`, `conveyor_speed_cmd`, `vfd_poll_step`, `msg_phase`, `read_vfd_errorid`, `write_cmd_errorid`, `write_freq_errorid`, `vfd_fault_code`, `vfd_frequency`, `vfd_current`, `vfd_dc_bus`, `vfd_voltage`, `fault_reset_cmd` |
| `DINT` | `item_count`, `cycle_count`, `uptime_seconds`, `vfd_poll_count`, `vfd_err_count`, `last_good_poll` |
| `TON` | `start_timer`, `stop_timer`, `vfd_poll_timer`, `msg_step_timer`, `vfd_err_timer`, `uptime_timer` |
| `MSG_MODBUS` | `mb_read_status`, `mb_write_cmd`, `mb_write_freq`, `mb_fault_reset` |
| `MBSRVCFG` | `read_local_cfg`, `read_target_cfg`, `write_cmd_local_cfg`, `write_cmd_target_cfg`, `write_freq_local_cfg`, `write_freq_target_cfg`, `fault_reset_local_cfg`, `fault_reset_target_cfg` |
| `INT[6]` (array) | `read_data` |
| `INT[1]` (array) | `write_cmd_data`, `write_freq_data`, `fault_reset_data` |
| COP helpers | `cop_cmd`, `cop_freq`, `cop_reset` — type `COP` |

3. After adding all variables, rebuild (Part 9 step 2) — undeclared errors should clear
4. The Variable Summary section of this document (above the ladder sections) lists all variable groups for cross-reference

---

# References

The conventions used in this document were cross-checked against:

- [cdilga/ladder-logic-editor](https://github.com/cdilga/ladder-logic-editor) — bidirectional ST↔LD examples; confirmed `IF A AND B THEN Y := 1` ↔ `─┤A├─┤B├─(Y)`
- [LDmicro manual + sample .ld files (thiagoralves/OpenPLC-Ladder-Editor)](https://github.com/thiagoralves/OpenPLC-Ladder-Editor) — RUNG / CONTACTS / COIL / EQU / TON conventions and instruction naming
- [basemaladimi/PLC-Simulation-Projects](https://github.com/basemaladimi/PLC-Simulation-Projects) — CCW + Factory I/O ladder examples for state-machine sequences
- [Industrial Monitor Direct: Sequential State Machine in CCW](https://industrialmonitordirect.com/blogs/knowledgebase/sequential-state-machine-ladder-logic-with-timer-in-connected-components-workbench) — state-bit vs integer-step patterns, TON + ONS usage
- [Rockwell 2080-RM001 Micro800 Programming Reference](https://www.engr.siu.edu/staff/spezia/NewWeb438B/labs/2080-rm001_-en-e.pdf) — authoritative MSG_MODBUS / TON / COP function block parameter pin names
- [Mike's GS10 + Micro820 Integration Guide gist](https://gist.github.com/Mikecranesync/4eaffdac3e27f9ab9f0d17a96fc84207) — VFD register map (0x2000 / 0x2001 / 0x2002 / 0x2103) and command words (1 STOP, 18 FWD+RUN, 20 REV+RUN)

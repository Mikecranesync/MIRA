# Conv_Simple Anomaly Catalog — what we can detect on the real bench *today*

Every item below is grounded in a **real signal** on the live Micro820 slave map
(`plc/MbSrvConf_v4.xml` → `plc/live-plc-bridge`). Nothing here is invented. This is the
working list for "run it through its paces": pick a row, inject the fault physically,
capture it with the logger, then make the rule fire and Ask MIRA explain it.

## The bench loop (how to use this with the logger)

```bash
# 1. In CCW: DISCONNECT from the controller, put PLC in RUN (so Modbus TCP answers).
# 2. Start a labeled capture for the fault you're about to inject:
python plc/conv_simple_anomaly/live_logger.py --label flaky_photoeye
#    (type a note + Enter mid-run to stamp "broke beam now"; Ctrl-C to stop)
# 3. Inject the fault at the bench (see "Reproduce" column).
# 4. Stop the logger. You now have logs/<stamp>_flaky_photoeye.{jsonl,csv} as ground truth.
# 5. Confirm the rule fires:   python plc/conv_simple_anomaly/live_check.py --secs 6
# 6. Ask MIRA the question in the row → it answers grounded in the same live tags.
```

Always capture a **`baseline_run`** (healthy fwd run) and **`baseline_idle`** first — every
threshold (FLA, DC-bus band, freq tolerance) is set relative to those golden runs.

## Legend

- **Status** — 🟢 LIVE (detectable now, current firmware) · 🟡 REFLASH (needs slave-map-v2:
  DI_05 photo-eye coil 000023 and/or GS10 fault reg 0x2100) · 🔵 NEW (signal is live; rule
  not yet written) · ✅ existing rule in `rules.py` (A0–A12).
- **Sev** — CRIT / HIGH / MED / LOW / INFO.
- **Alerts** — TG (Telegram `/fault`), MCP (`/api/faults/active`), ntfy push (HIGH/CRIT),
  ASK (surfaced when an operator asks Ask MIRA).

---

## A. PLC & RS-485 / VFD comms health

| # | ID | Anomaly | Signal(s) | Reproduce at bench | Sev | Status |
|---|----|---------|-----------|--------------------|-----|--------|
| 1 | A0 ✅ | PLC/bridge offline | no fresh sample ≥ `offline_s` | Unplug PLC Ethernet / stop bridge | CRIT | 🟢 |
| 2 | A1 ✅ | GS10 RS-485 link down | `vfd_comm_ok=0` | Unplug RS-485 / power off GS10 | HIGH | 🟢 |
| 3 | B1 | RS-485 **flaky/intermittent** | `vfd_comm_ok` toggles ≥N in window | Partially seat / wiggle RS-485 plug | HIGH | 🔵 |
| 4 | B2 | PLC **heartbeat stalled** (scan dead) | `heartbeat` not toggling ≥X s | Put PLC in PROG / stop scan | CRIT | 🔵 |
| 5 | B3 | VFD poll state-machine stuck | `vfd_poll_step` frozen / `vfd_poll_active` stuck=1 | Half-fail comms mid-poll | MED | 🔵 |
| 6 | B4 | PLC **unexpected restart** | `uptime_seconds` resets toward 0 | Power-cycle the PLC | HIGH | 🔵 |
| 7 | B5 | Stale VFD values not trust-gated | `vfd_comm_ok=0` yet HR values "fresh" | Pull RS-485, watch HRs | MED | 🟢 (gate check) |

## B. Safety & E-stop (dual-channel)

| # | ID | Anomaly | Signal(s) | Reproduce at bench | Sev | Status |
|---|----|---------|-----------|--------------------|-----|--------|
| 8 | A3 ✅ | E-stop dual-channel **wiring fault** | `estop_wiring_fault=1` OR `di02_estop_nc==di03_estop_no` | Pull ONE e-stop channel wire | HIGH | 🟢 |
| 9 | S1 | E-stop pressed (normal stop) | `e_stop_active=1` | Press the E-stop | INFO | 🟢 |
| 10 | S2 | E-stop **NC channel stuck/jumpered** | press but `di02_estop_nc` stays 1 | Jumper the NC channel | HIGH | 🟢 |
| 11 | S3 | E-stop **NO channel stuck** | `di03_estop_no` disagrees with NC | Jumper the NO channel | HIGH | 🟢 |
| 12 | S4 | E-stop **chatter/flaky contact** | `e_stop_active` toggles rapidly | Loosen e-stop wire, tap button | HIGH | 🔵 |
| 13 | A5 ✅ | Belt running while not permitted | `motor_running ∧ (estop ∨ wiring ∨ ¬contactor_q1)` | Force run with safety open | HIGH | 🟢 |
| 14 | S5 | Contactor Q1 dropped under run cmd | `do02_contactor_q1=0 ∧` run commanded | Open contactor coil while running | HIGH | 🔵 |

## C. Direction & control logic

| # | ID | Anomaly | Signal(s) | Reproduce at bench | Sev | Status |
|---|----|---------|-----------|--------------------|-----|--------|
| 15 | A4 ✅ | Direction **conflict** (both selected) | `di00_fwd_sw ∧ di01_rev_sw` (`dir_fault`) | Throw BOTH direction switches | MED | 🟢 |
| 16 | C1 ⚠️ | **Reverse-run blind spot** (the bug) | `vfd_cmd_word=34` not in `run_cmd_values [18,20]` | Run conveyor in REVERSE | — | fix config → `[18,34]` |
| 17 | A6 ✅ | Drive not responding to RUN | `cmd_word∈{18,34} ∧ ¬motor_running ≥ grace` | Command run, GS10 disabled | MED | 🟢 (after C1 fix) |
| 18 | C2 | Run command with **no direction** | run word ∧ ¬`dir_fwd` ∧ ¬`dir_rev` | Command run, no dir switch | MED | 🔵 |
| 19 | C3 | **Direction reversed under load** | `dir_fwd→dir_rev` while `motor_running` | Flip dir switch while running | MED | 🔵 |
| 20 | C4 | Run pushbutton **stuck/held** | `di04_pb_run` held > X s | Tape the run button down | LOW | 🔵 |

## D. Drive electrical (GS10 — `vfd_current_a / voltage_v / dc_bus_v / frequency_hz`)

| # | ID | Anomaly | Signal(s) | Reproduce at bench | Sev | Status |
|---|----|---------|-----------|--------------------|-----|--------|
| 21 | A8 ✅ | Output **overcurrent** > FLA | `vfd_current_a > motor_fla_a` | Brake/load the belt | HIGH | 🟢 |
| 22 | D1 | **Locked-rotor / stall** | high `vfd_current_a` ∧ `frequency_hz>0` ∧ `motor_speed≈0` | Hold the belt still | HIGH | 🔵 |
| 23 | A9 ✅ | DC bus **undervoltage** | `vfd_dc_bus_v < dc_bus_lo_v` | Input sag (hard to force) | MED | 🟢 |
| 24 | A9 ✅ | DC bus **overvoltage** (regen) | `vfd_dc_bus_v > dc_bus_hi_v` | Rapid decel of loaded belt | MED | 🟢 |
| 25 | A10 ✅ | Output frequency **frozen** under RUN | `frequency_hz` unchanged ≥ `freq_frozen_s` | Drive stops ramping | MED | 🟢 |
| 26 | A7 ✅ | Output Hz **not tracking** setpoint | `|frequency_hz − vfd_freq_setpoint| > tol` | Change setpoint, drive lags | MED | 🟢 (400116 live) |
| 27 | A2 ✅ | GS10 **drive fault active** (decoded) | `fault_raw` (0x2100) → `GS10_FAULT_CODES` | Trip GS10 (oC/oL/oH/E.LV) | HIGH | 🟡 REFLASH |
| 28 | D2 | Output **current zero under run** | `vfd_current_a≈0 ∧ motor_running ∧ Hz>0` | Open a motor lead / blow output fuse | HIGH | 🔵 |
| 29 | D3 | Output **voltage zero** with run cmd | `vfd_voltage_v≈0 ∧` run | Output-stage fault | HIGH | 🔵 |
| 30 | D4 | **Undercurrent / load lost** | `vfd_current_a ≪ baseline` while running | Decouple belt from motor | MED | 🔵 |
| 31 | D5 | **Current spike** transient | `Δvfd_current_a` > jump in one interval | Brief jam pulse | MED | 🔵 |

## E. Photo-eye & material flow

| # | ID | Anomaly | Signal(s) | Reproduce at bench | Sev | Status |
|---|----|---------|-----------|--------------------|-----|--------|
| 32 | A12 ✅ | Photo-eye **jam** (continuous block) | `di05_photoeye` blocked ≥ X s | Hold the beam broken | HIGH | 🟡 REFLASH |
| 33 | E1 | Photo-eye **flaky / rapid toggle** (#1668) | `di05` ≥7 falling edges in ~5.6 s | Wiggle sensor / wave hand fast | HIGH | 🟡 REFLASH |
| 34 | E2 | Photo-eye **dead / dark** (never makes) | `di05` never trips over a run | Disconnect the sensor | MED | 🟡 REFLASH |
| 35 | E3 | Photo-eye **stuck-made** (never breaks) | `di05` never clears | Block / misalign permanently | MED | 🟡 REFLASH |
| 36 | E4 | Photo-eye **loose wire** (intermittent open) | `di05` brief random drops | Loosen the terminal | MED | 🟡 REFLASH |
| 37 | E5 | Unexpected trip **while stopped** | `di05` changes ∧ `conveyor_running=0` | Wave hand at eye while off | LOW | 🟡 REFLASH |
| 38 | E6 | **No item flow** while running | `item_count` flat ∧ running ∧ motion | Run an empty belt | MED | 🔵 (400111 live) |
| 39 | E7 | **Item jam** (flow + beam) | `di05` blocked ∧ `item_count` frozen | Jam an item at the eye | HIGH | 🟡 REFLASH |

## F. Motion & speed (`motor_speed / conveyor_speed / conveyor_speed_cmd`)

| # | ID | Anomaly | Signal(s) | Reproduce at bench | Sev | Status |
|---|----|---------|-----------|--------------------|-----|--------|
| 40 | F1 | Commanded run, **no motion** | run cmd ∧ `conveyor_speed≈0` past grace | Belt slips / drive disabled | HIGH | 🔵 |
| 41 | F2 | **Motion while commanded stop** | `conveyor_speed>0 ∧` stop cmd | Excess coast after stop | MED | 🔵 |
| 42 | F3 | Speed **not reaching command** | `|conveyor_speed − speed_cmd| > tol` steady | Overload the belt | MED | 🔵 |
| 43 | F4 | Belt **overspeed** | `conveyor_speed > speed_cmd + tol` | (drive misconfig) | MED | 🔵 |
| 44 | F5 | Speed **hunting / oscillation** | high variance in `conveyor_speed` | PID instability | LOW | 🔵 |

## G. State machine, process & HMI consistency

| # | ID | Anomaly | Signal(s) | Reproduce at bench | Sev | Status |
|---|----|---------|-----------|--------------------|-----|--------|
| 45 | G1 | **Fault alarm latched** | `fault_alarm=1` | Trigger any ladder fault | HIGH | 🔵 |
| 46 | G2 | **Error code** nonzero (decode) | `error_code ≠ 0` | Trip a fault path | varies | 🔵 |
| 47 | G3 | `conv_state` **wedged** in FAULT | `conv_state` stuck non-running ≥ X | Trip, then don't reset | MED | 🔵 |
| 48 | G4 | **System not ready** w/o cause | `system_ready=0` ∧ no estop/fault | Remove a start precondition | MED | 🔵 |
| 49 | G5 | **Inconsistent state** | `conveyor_running ∧ ¬system_ready` (or `motor ∧ ¬conveyor`) | Force contradictory states | MED | 🔵 |
| 50 | G6 | **Stack-light logic mismatch** | `do00_green ∧ do01_red` both on / neither | Diagnostic check | LOW | 🔵 |
| 51 | G7 | Motor **over-temperature** | `temperature > limit` | Heat sensor / sustained load | HIGH | 🔵 |
| 52 | G8 | Temperature **rising trend** (predictive) | `temperature` slope > X over window | Gradual loading | MED | 🔵 |

---

## What Ask MIRA says (per category, grounded answer shape)

Each answer leads with **equipment + fault state**, then **likely cause**, then **next check** —
never a raw-tag wall (per the industrial-HMI rule). Examples:

- **A1/B1 (comms):** "GS10 isn't answering on RS-485 — its values are stale, treat them with
  suspicion. Likely a loose/again-seated RS-485 conductor or termination. Check the A/B pair at
  both ends and confirm GS10 is 9600 8N2, slave 1."
- **A3/S2 (e-stop):** "E-stop channels disagree (NC vs NO) — one contact or wire has failed.
  This can defeat the stop. Verify both channels switch together; check the suspect leg."
- **A8/D1 (current):** "Output current is above motor FLA with little/no motion — mechanical jam,
  seized bearing, or overloaded belt. Stop and clear the obstruction before restarting."
- **A12/E1 (photo-eye):** "PE-101 is chattering (7 fast breaks in ~6 s) while the line is clear —
  a flaky sensor: loose connector, marginal alignment, or a wiring fault. Reseat and realign."
- **G1/G2 (fault latch):** decodes `error_code` / GS10 fault → plain-language cause + reset steps.

## Two fixes this catalog surfaces

1. **`config.yaml` reverse bug (C1):** `run_cmd_values: [18, 20]` must become `[18, 34]` —
   REV+RUN on the GS10 is 34 (0x20 REV + 0x02 RUN), which you verified at the bench. Until
   fixed, A6/A10 are blind whenever the belt runs in reverse. (One-line change + a rule test.)
2. **Slave-map-v2 reflash** unblocks every 🟡 row (the whole photo-eye family E1–E7 + A2 drive-
   fault decode). The committed map adds DI_05 (coil 000023); the live PLC hasn't been reflashed
   yet (coil 23 returns ILLEGAL DATA ADDRESS). See `plc/RESUME_1668_PLC_FEED.md` §3.

## Coverage

- **🟢 LIVE today (no reflash):** ~30 conditions — all of A/B/C/D-electrical/F/G groups.
- **🟡 needs the DI_05/fault-reg reflash:** the 8 photo-eye + drive-fault-decode rows (E1–E7, A2).
- **✅ already coded** in `rules.py`: A0–A12 (12 rules). **🔵 NEW** candidates here: ~30 more.

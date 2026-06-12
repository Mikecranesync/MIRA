# Conv_Simple anomaly engine (machine-card invariants)

**What this is:** an *additive* anomaly detector for the **real Conv_Simple bench** (Micro820 +
GS10), separate from the `mira-fault-detective` **cv101 demo** (vision + PE-101/102 + fuses). It
applies the invariants from `MIRA_PLC/specs/CONVEYOR_MACHINE_CARD.md` to the live tag stream that
`plc/live-plc-bridge` already publishes, and routes anomalies through the **existing** surfaces.

It does **not** modify the demo. It reuses: the Mosquitto broker, the `live-plc-bridge` UNS stream,
the shared `conveyor_events` SQLite table (so Telegram `/fault` + MCP `/api/faults/active` show
these for free), and ntfy push.

## Pipeline
```
live-plc-bridge ──(UNS JSON)──▶ Mosquitto ──▶ conv_simple_anomaly.engine
   {prefix}/_streams/bridge/#                     ├─ rules.evaluate(snapshot, derived, cfg)
                                                   ├─ conveyor_events row (per new anomaly)
                                                   ├─ {prefix}/diagnostics/conv_simple_anomaly
                                                   └─ ntfy (HIGH/CRITICAL)
```

## Rules implemented (computable from today's bridge stream)
| ID | Anomaly | Signals |
|---|---|---|
| A0 | PLC/bridge offline | no fresh data ≥ `offline_s` |
| A1 | GS10 RS-485 link down (trust gate) | `vfd/vfd101/comm_ok` = False |
| A3 | E-stop dual-channel wiring fault | `safety/wiring` or `di02_estop_nc == di03_estop_no` |
| A4 | Direction fault | `di00_fwd` and `di01_rev` |
| A5 | Belt running while not permitted | `motor running` ∧ (estop ∨ wiring ∨ ¬contactor) |
| A6 | Drive not responding to RUN | `cmd_word∈{18,20}` ∧ ¬running ≥ `cmd_run_grace_s` |
| A8 | Output over motor FLA | `current_a` > `motor_fla_a` |
| A9 | DC bus out of range | `dc_bus_v` ∉ [`dc_bus_lo_v`,`dc_bus_hi_v`] |
| A10 | Output frequency frozen | RUN ∧ `freq` unchanged ≥ `freq_frozen_s` |

VFD-value rules (A2/A6/A7/A8/A9/A10) are gated by the §7 trust gate — suppressed when `comm_ok` is
False (values are stale; A1 fires instead).

## Rules implemented but awaiting slave-map v2 (degrade silently until reflash)
The rule logic for these is **written and unit-tested** (`rules.py` + `test_rules.py`); they fire
the moment the bridge publishes their topics. Until the PLC slave map is extended + reflashed, the
deployed 502 slave (13 coils + 5 HRs) does not publish them, so `snap.get(...) -> None` and they
stay silent (verified live 2026-06-01 — no false fires).

| ID | Anomaly | New topic needed | Source register |
|---|---|---|---|
| A2 | GS10 drive fault active (decoded) | `vfd/vfd101/fault_code` (+`warn_code`) | `0x2100` low byte / high byte |
| A7 | Output Hz not tracking setpoint | `vfd/vfd101/freq_setpoint` | `0x2101` (freq command) |
| A12 | Photo-eye soft-stop (jam/blockage) | `safety/pe_latched` (+`plc/di/di05_photoeye`) | `DI_05` latch (ladder global) |

To activate: **(1)** add the registers to the CCW `MbSrvConf.xml` (`modbus-slave` skill) + reflash
(`ccw-build`); **(2)** uncomment the matching entries in `live-plc-bridge/bridge.py` (`COIL_TOPICS` /
`HR_SPECS` + the `COIL_READS` / `HR_READS` plan) and `live_check.py`. The GS10 fault decode table
lives in `rules.GS10_FAULT_CODES` (sourced from the DURApulse GS10 UM §P06.17) and the invariants in
`MIRA_PLC/specs/CONVEYOR_MACHINE_CARD.md`.

## Run
```bash
# logic (no broker needed):
pytest plc/conv_simple_anomaly/                # 26 tests

# LIVE check against the real PLC (no broker / no Docker — reads 192.168.1.100:502 and runs the rules):
python plc/conv_simple_anomaly/live_check.py --secs 4
# (verified 2026-06-01 on the bench: correctly fired A1 when vfd_comm_ok was False)

# live (needs the broker + live-plc-bridge running):
pip install -r plc/conv_simple_anomaly/requirements.txt
MQTT_HOST=100.68.120.99 UNS_PREFIX=demo/cell1/conveyor/cv101 \
MIRA_DB=/mira-db/mira.db NTFY_URL=https://ntfy.sh NTFY_TOPIC=mira-factorylm-alerts \
python plc/conv_simple_anomaly/engine.py
```
Confirm the starred thresholds in `config.yaml` (motor FLA, DC-bus window) against the nameplate / a golden run.
A Docker service can be added to `docker-compose.fault-detective.yml` later (mirrors `fault-detective`).

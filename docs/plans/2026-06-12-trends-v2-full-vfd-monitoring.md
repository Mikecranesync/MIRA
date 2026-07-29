# Trends V2 — Full GS10 VFD Parameter Monitoring (PROPOSAL)

**Status:** PROPOSED (V1 tagged `trends-v1` in MIRA, `trends-hmi-v1` in MIRA_PLC, 2026-06-12)
**Depends on:** Micro820 ladder reflash (the dormant slave-map-v2 frontier — see
`project_conv_simple_anomaly` memory) + `plc/GS10_Integration_Guide.md` register table.

## What V1 monitors today (and why it's thin)

The ladder mirrors only **4 GS10 analogs** into the Modbus slave map the historian polls
(`plc/conv_simple_anomaly/live_logger.py` `HR_SPECS`): HR106 freq (Hz×100), HR107 current
(A×100), HR108 voltage (V×10), HR109 DC bus (V×10), plus `vfd_cmd_word` (HR114) and
`vfd_freq_setpoint` (HR115). No torque, no RPM, no power, no heatsink temp, no fault/warning
codes, no decoded status bits — the trend viewer's new bit-decode + last-fault features
(shipped in `mira-trend-viewer` v2) have nothing real to chew on yet.

## What the GS10 actually exposes (already documented in-repo)

`plc/GS10_Integration_Guide.md` § "Status Registers (READ — FC03)", group 0x2100+:

| Reg | Name | Scale | V2 signal name | Why |
|---|---|---|---|---|
| 0x2100 | Status Monitor 1 | hi=warn, lo=error | `vfd_error_code`, `vfd_warn_code` | **fault visibility** — the missing piece for last-fault |
| 0x2101 | Status Monitor 2 | status bits | `vfd_status_word` | feeds the viewer's **bit decode** (run/at-speed/faulted…) |
| 0x2102 | Frequency Command | Hz×10 | `vfd_freq_cmd` | cmd-vs-actual slip/tracking |
| 0x2103 | Output Frequency | Hz×10 | (have: `vfd_frequency_hz`) | — |
| 0x2104 | Output Current | A×10 | (have: `vfd_current_a`) | — |
| 0x2105 | DC Bus Voltage | V | (have: `vfd_dc_bus_v`) | — |
| 0x2106 | Output Voltage | V | (have: `vfd_voltage_v`) | — |
| 0x210B | Output Torque | % | `vfd_torque_pct` | load signature / jam precursor |
| 0x210C | Motor Speed | RPM | `vfd_motor_rpm` | actual shaft speed vs commanded |
| 0x210F | Power Output | kW | `vfd_power_kw` | energy trend, load profiling |

Plus a PLC-side **`vfd_last_fault`** (latched copy of the last nonzero 0x2100 low byte,
cleared only by a deliberate operator action — NOT by the drive's fault reset). This gives
the trend viewer's `last_fault` register real data: the active code clears on reset, the
latch keeps the trip cause.

## Plan (three layers, in order)

### 1. Ladder + slave map (MIRA_PLC repo — the reflash)
- Extend the existing `vfd_poll_step` RS-485 read cycle (Micro820 is the **sole bus
  master**; FC03 reads only, per `.claude/rules/fieldbus-readonly.md`) to read 0x2100,
  0x2101, 0x2102, 0x210B, 0x210C, 0x210F each cycle.
- Mirror into new HR offsets (proposal: HR117 `vfd_status_word`, HR118 `vfd_error_code`,
  HR119 `vfd_warn_code`, HR120 `vfd_freq_cmd` ×100, HR121 `vfd_torque_pct` ×10,
  HR122 `vfd_motor_rpm`, HR123 `vfd_power_kw` ×100, HR124 `vfd_last_fault` latched).
- Update `MbSrvConf` slave map + `plc/deploy_modbus_map.py`; reflash via CCW (manual step,
  Mike). This rides the same reflash that wakes the dormant A2/A12 anomaly signals.

### 2. Historian (MIRA repo, `plc/conv_simple_anomaly/`)
- `live_logger.py` `HR_SPECS`: add the 8 new offsets with scales.
- `trend_accumulator.py` `UNITS` + `THRESHOLDS`: add `vfd_torque_pct` "%", `vfd_motor_rpm`
  "rpm", `vfd_power_kw` "kW", `vfd_freq_cmd` "Hz"; threshold pairs where rules exist
  (torque hi = jam precursor; rpm-vs-cmd divergence is an accumulator *derived* note like
  the no-load guard).
- No new pollers, no API change — `/trends/summary` and the viewer pick the new tags up
  automatically.

### 3. Viewer mapping (MIRA repo, `mira-trend-viewer/`)
- `historianAdapter.classify()`: map `vfd_status_word` → `DataType.WORD` **with a real GS10
  `bits` table** (from the GS10 manual's Status Monitor 2 bit definitions — verify against
  the manual, do NOT reuse the mock's placeholder bits; GS10 ≠ GS1 numbering, see
  `feedback_gs10_not_gs1` memory). The store then auto-derives Running/Faulted/… step lanes
  (shipped v2 feature, zero new viewer code).
- Map `vfd_error_code` / `vfd_last_fault` → `DataType.ENUM` with the GS10 fault-code table
  (manual § fault codes; same caveat — transcribe, don't guess).
- `vfd_freq_cmd` + `vfd_frequency_hz` selected together = the cmd-vs-actual pair (the
  contactor cmd-vs-feedback v3 backlog item generalized to the drive).

## Acceptance (bench, live)
1. Historian `/trends/summary` lists all new `vfd_*` tags with GOOD quality + correct units.
2. Perspective TRENDS popup: GS10 card shows torque/RPM/power rows; `vfd_status_word`
   decodes to named bit lanes; run the conveyor → Running bit steps 0→1, freq cmd vs output
   freq track, torque/current move together.
3. Trip a fault (e-stop while running) → `vfd_error_code` shows the code, reset → active
   clears, `vfd_last_fault` keeps it. Screenshot to `docs/promo-screenshots/`.
4. `node --test` stays green (33); adapter mapping covered by a new unit test only if a
   pure-function mapping table is extracted (keep adapter logic testable).

## Out of scope for V2
- Any VFD parameter **writes** (P-group access) — read-only doctrine stands.
- Ignition-native Tag Historian path (Track B) — separate plan.
- Temp sensor ATM2-I — drops in when wired (own memory note).

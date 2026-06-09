# Air System 01 — PLC Tag Description Sheet

**Asset ID:** `airsystem01`
**UNS Asset Path:** `enterprise.florida_natural_demo.plant1.juice_bottling.line01.airsystem01`
**Type:** `air_system`

**Note:** AirSystem01 is a utility asset — it does not have a PackML `run_state`.
The compressor is always either running or not (`compressor_running`).

## Process Tags
| Tag Name | Full UNS Path | Type | Unit | Normal Range | Description |
|----------|--------------|------|------|-------------|-------------|
| `header_pressure_psi` | `...airsystem01.process.header_pressure_psi` | FLOAT | PSI | 85–100 | Plant compressed-air header pressure at main distribution manifold |
| `compressor_running` | `...airsystem01.process.compressor_running` | BOOL | — | TRUE | Lead compressor run status (TRUE = running) |

## Alarms Tags
| Tag Name | Full UNS Path | Type | Description |
|----------|--------------|------|-------------|
| `dryer_fault` | `...airsystem01.alarms.dryer_fault` | BOOL | Refrigerated air dryer fault (TRUE = fault active) |
| `low_air_alarm` | `...airsystem01.alarms.low_air_alarm` | BOOL | Header pressure below low-pressure setpoint (TRUE = alarm active); threshold 75 PSI |

## Multi-Machine Impact Reference
When `low_air_alarm` = TRUE or `header_pressure_psi` < 75 PSI, the following downstream effects are expected:
- `depalletizer01.process.vacuum_pressure` degrades (vacuum generator starved)
- `filler01.process.filler_bowl_pressure` may drop (pneumatic actuator starvation)
- `capper01.process.cap_present` may go FALSE (cap-chute pneumatic feed fails)
- `casepacker01.process.case_former_ready` may go FALSE (fold/tuck cylinder actuation fails)

This is the Scenario F (low plant air) root-cause signature.

*Synthetic SimLab fixture — not a real OEM document.*

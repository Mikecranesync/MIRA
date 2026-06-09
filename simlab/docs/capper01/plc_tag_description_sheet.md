# Capper 01 — PLC Tag Description Sheet

**Asset ID:** `capper01`
**UNS Asset Path:** `enterprise.florida_natural_demo.plant1.juice_bottling.line01.capper01`
**Type:** `capper`

## Status Tags
| Tag Name | Full UNS Path | Type | Description |
|----------|--------------|------|-------------|
| `run_state` | `...capper01.status.run_state` | ENUM | PackML machine state label |

## Process Tags
| Tag Name | Full UNS Path | Type | Unit | Normal Range | Description |
|----------|--------------|------|------|-------------|-------------|
| `cap_present` | `...capper01.process.cap_present` | BOOL | — | TRUE | Photo-eye confirms cap in position at capping head |
| `cap_torque_inlb` | `...capper01.process.cap_torque_inlb` | FLOAT | in-lb | 14–18 | Applied torque on current cap cycle |
| `cap_torque_target` | `...capper01.process.cap_torque_target` | FLOAT | in-lb | 16 | Operator-set target torque (HMI writable) |
| `cap_torque_variance` | `...capper01.process.cap_torque_variance` | FLOAT | in-lb | ±2.0 | Rolling deviation from target torque, last 20 caps |
| `cap_chute_level` | `...capper01.process.cap_chute_level` | FLOAT | % | 30–100 | Cap supply chute fill level (ultrasonic sensor) |
| `jam_detected` | `...capper01.process.jam_detected` | BOOL | — | FALSE | Jam sensor at infeed or carousel; TRUE = obstruction |

## Motor Tags
| Tag Name | Full UNS Path | Type | Unit | Normal Range | Description |
|----------|--------------|------|------|-------------|-------------|
| `motor_current_amps` | `...capper01.motor.motor_current_amps` | FLOAT | A | 3.5–6.0 | Drive motor RMS current |

## Quality Tags
| Tag Name | Full UNS Path | Type | Unit | Description |
|----------|--------------|------|------|-------------|
| `reject_count` | `...capper01.quality.reject_count` | INT | count | Cumulative cap-torque rejects this batch |

## Faults Tags
| Tag Name | Full UNS Path | Type | Description |
|----------|--------------|------|-------------|
| `fault_code` | `...capper01.faults.fault_code` | STRING | Active fault code |

*Synthetic SimLab fixture — not a real OEM document.*

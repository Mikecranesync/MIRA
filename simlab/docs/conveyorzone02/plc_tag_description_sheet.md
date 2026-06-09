# Conveyor Zone 02 — PLC Tag Description Sheet

**Asset ID:** `conveyorzone02`
**UNS Asset Path:** `enterprise.florida_natural_demo.plant1.juice_bottling.line01.conveyorzone02`
**Type:** `belt_conveyor`

## Status Tags
| Tag Name | Full UNS Path | Type | Description |
|----------|--------------|------|-------------|
| `run_state` | `...conveyorzone02.status.run_state` | ENUM | PackML machine state label |

## Process Tags
| Tag Name | Full UNS Path | Type | Unit | Normal Range | Description |
|----------|--------------|------|------|-------------|-------------|
| `speed_fpm` | `...conveyorzone02.process.speed_fpm` | FLOAT | ft/min | 80–120 | Belt surface speed |
| `photoeye_blocked` | `...conveyorzone02.process.photoeye_blocked` | BOOL | — | FALSE | Mid-zone photoeye; TRUE = bottle present at sensor |
| `blocked` | `...conveyorzone02.process.blocked` | BOOL | — | FALSE | Downstream end blocked; backpressure from next station |
| `starved` | `...conveyorzone02.process.starved` | BOOL | — | FALSE | Infeed end empty; no bottles arriving from depalletizer |
| `accumulation_percent` | `...conveyorzone02.process.accumulation_percent` | FLOAT | % | 10–60 | Zone fill level; 100% = full accumulation (upstream backup propagates) |

## Motor Tags
| Tag Name | Full UNS Path | Type | Unit | Normal Range | Description |
|----------|--------------|------|------|-------------|-------------|
| `motor_current_amps` | `...conveyorzone02.motor.motor_current_amps` | FLOAT | A | 1.5–3.5 | Belt drive motor RMS current |

## Faults Tags
| Tag Name | Full UNS Path | Type | Description |
|----------|--------------|------|-------------|
| `fault_code` | `...conveyorzone02.faults.fault_code` | STRING | Active fault code (CV2001–CV2003) |

## Notes
`accumulation_percent` is the upstream-backup propagation indicator. In Scenario D, a Case Packer 01 jam causes this zone to fill; at 100%, the upstream machine (Rinser01) is forced to hold.

*Synthetic SimLab fixture — not a real OEM document.*

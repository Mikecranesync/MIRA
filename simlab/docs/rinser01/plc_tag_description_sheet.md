# Rinser 01 — PLC Tag Description Sheet

**Asset ID:** `rinser01`
**UNS Asset Path:** `enterprise.florida_natural_demo.plant1.juice_bottling.line01.rinser01`
**Type:** `bottle_rinser`

## Status Tags
| Tag Name | Full UNS Path | Type | Description |
|----------|--------------|------|-------------|
| `run_state` | `...rinser01.status.run_state` | ENUM | PackML machine state label |

## Process Tags
| Tag Name | Full UNS Path | Type | Unit | Normal Range | Description |
|----------|--------------|------|------|-------------|-------------|
| `infeed_bottle_count` | `...rinser01.process.infeed_bottle_count` | INT | bottles | — | Cumulative bottles received from ConveyorZone02 |
| `outfeed_bottle_count` | `...rinser01.process.outfeed_bottle_count` | INT | bottles | — | Cumulative bottles discharged to Filler01 |
| `water_pressure` | `...rinser01.process.water_pressure` | FLOAT | PSI | 25–45 | Rinse water supply pressure |
| `rinse_valve_open` | `...rinser01.process.rinse_valve_open` | BOOL | — | TRUE (during run) | Rinse manifold solenoid valve status |

## Quality Tags
| Tag Name | Full UNS Path | Type | Unit | Description |
|----------|--------------|------|------|-------------|
| `reject_count` | `...rinser01.quality.reject_count` | INT | count | Bottles rejected for foreign material detection this batch |

## Faults Tags
| Tag Name | Full UNS Path | Type | Description |
|----------|--------------|------|-------------|
| `fault_code` | `...rinser01.faults.fault_code` | STRING | Active fault code (RN001–RN003) |

*Synthetic SimLab fixture — not a real OEM document.*

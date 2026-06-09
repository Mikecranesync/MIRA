# Depalletizer 01 — PLC Tag Description Sheet

**Asset ID:** `depalletizer01`
**UNS Asset Path:** `enterprise.florida_natural_demo.plant1.juice_bottling.line01.depalletizer01`
**Type:** `pick_place_depalletizer`

## Status Tags
| Tag Name | Full UNS Path | Type | Description |
|----------|--------------|------|-------------|
| `run_state` | `...depalletizer01.status.run_state` | ENUM | PackML machine state label |

## Process Tags
| Tag Name | Full UNS Path | Type | Unit | Normal Range | Description |
|----------|--------------|------|------|-------------|-------------|
| `pallet_present` | `...depalletizer01.process.pallet_present` | BOOL | — | TRUE | Photoeye confirms loaded pallet at infeed position |
| `layer_count` | `...depalletizer01.process.layer_count` | INT | layers | 1–8 | Layers remaining on current input pallet |
| `vacuum_pressure` | `...depalletizer01.process.vacuum_pressure` | FLOAT | in-Hg | -20 to -25 | Vacuum cup array holding pressure (negative = suction) |
| `bottle_outfeed_rate` | `...depalletizer01.process.bottle_outfeed_rate` | FLOAT | BPM | 195–210 | Bottles discharged to ConveyorZone01 per minute |
| `jam_detected` | `...depalletizer01.process.jam_detected` | BOOL | — | FALSE | Jam sensor at outfeed starwheel |

## Faults Tags
| Tag Name | Full UNS Path | Type | Description |
|----------|--------------|------|-------------|
| `fault_code` | `...depalletizer01.faults.fault_code` | STRING | Active fault code (DP001–DP004) |

## AirSystem01 Dependency
`vacuum_pressure` requires AirSystem01 vacuum generator supply. When
`airsystem01.process.header_pressure_psi` < 75 PSI, vacuum cup holding force is reduced;
bottles may slip during pick, causing jams or drops on ConveyorZone01.

*Synthetic SimLab fixture — not a real OEM document.*

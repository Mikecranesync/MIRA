# Palletizer 01 — PLC Tag Description Sheet

**Asset ID:** `palletizer01`
**UNS Asset Path:** `enterprise.florida_natural_demo.plant1.juice_bottling.line01.palletizer01`
**Type:** `palletizer`

## Status Tags
| Tag Name | Full UNS Path | Type | Description |
|----------|--------------|------|-------------|
| `run_state` | `...palletizer01.status.run_state` | ENUM | PackML machine state label |
| `robot_ready` | `...palletizer01.status.robot_ready` | BOOL | Robot at home position, safety zone clear, ready to accept cycle command |
| `pallet_present` | `...palletizer01.status.pallet_present` | BOOL | Photoeye confirms pallet at build station |
| `slip_sheet_present` | `...palletizer01.status.slip_sheet_present` | BOOL | Slip sheet magazine loaded and ready |
| `jam_detected` | `...palletizer01.status.jam_detected` | BOOL | Infeed conveyor jam or robot-zone obstruction |

## Production Tags
| Tag Name | Full UNS Path | Type | Unit | Description |
|----------|--------------|------|------|-------------|
| `case_infeed_count` | `...palletizer01.production.case_infeed_count` | INT | cases | Cumulative cases inducted from CasePacker01 |
| `layer_count` | `...palletizer01.production.layer_count` | INT | layers | Layers completed on current pallet in build (0 = empty pallet) |

## Faults Tags
| Tag Name | Full UNS Path | Type | Description |
|----------|--------------|------|-------------|
| `fault_code` | `...palletizer01.faults.fault_code` | STRING | Active fault code (PA001–PA004); empty = no active fault |

## Notes on Upstream Impact
When `palletizer01.status.run_state` is not EXECUTE (e.g., HELD, ABORTED, IDLE),
CasePacker01 discharge backs up. Once CasePacker01 discharge queue fills, it
stops inducting bottles and its own accumulation fills. This is the Scenario E signature.
Monitor `palletizer01.status.robot_ready` and `run_state` first when diagnosing
unexplained upstream backup.

*Synthetic SimLab fixture — not a real OEM document.*

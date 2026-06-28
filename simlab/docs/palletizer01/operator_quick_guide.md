# Palletizer 01 — Operator Quick Guide

## Machine Overview
Palletizer 01 is an end-of-line robotic palletizer that stacks cases arriving
from Case Packer 01 onto standard 48×40 GMA pallets in a pre-programmed layer pattern.
Nominal throughput: 8 cases per minute, 6-layer pallet (48 cases per pallet).

## Machine Identification
- **Asset ID:** palletizer01
- **Type:** palletizer
- **UNS Path:** `enterprise.florida_natural_demo.plant1.juice_bottling.line01.palletizer01`
- **Location:** Line 01, Station 9 (end of line)

## Safety — READ FIRST
The robot cell is a **restricted zone**. Safety light-curtain at cell entrance.
Never enter the robot cell while `robot_ready` = TRUE or `run_state` = Running.
Always press E-STOP before entering. Lock out / tag out before maintenance.

## Panel Controls
| Control | Function |
|---------|----------|
| ROBOT START | Arms robot; requires `pallet_present` = TRUE |
| ROBOT STOP | Completes current layer, then parks robot at home |
| E-STOP (red mushroom) | Immediate de-energize; key reset required |
| PALLET EJECT | Commands completed pallet to exit conveyor |
| SLIP SHEET | Manually trigger slip sheet feed |

## Startup Sequence
1. Verify `pallet_present` = TRUE (photoeye at build station).
2. Verify `slip_sheet_present` = TRUE (slip-sheet magazine loaded).
3. Verify `robot_ready` = TRUE (robot at home position; no fault).
4. Press ROBOT START. Robot enters EXECUTE state.

## Normal Operating Parameters
| Parameter | Normal | Tag |
|-----------|--------|-----|
| Robot ready | TRUE | `robot_ready` |
| Pallet present | TRUE | `pallet_present` |
| Layer count | 0–6 | `layer_count` |
| Jam detected | FALSE | `jam_detected` |

*Synthetic SimLab fixture — not a real OEM document.*

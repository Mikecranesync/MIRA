# Palletizer 01 — Electrical & I/O Notes

## Power
- 480V 3-phase, 60A MCB at panel PA-01
- Robot: 480V 3-phase dedicated circuit, 100A
- Control: 24VDC SMPS

## Digital Inputs
| I/O | Description | Tag |
|-----|-------------|-----|
| DI0 | Pallet present photoeye | `pallet_present` |
| DI1 | Robot home position | `robot_ready` |
| DI2 | Slip sheet sensor | `slip_sheet_present` |
| DI3 | Case infeed photoeye | `case_infeed_count` trigger |
| DI4 | Infeed jam sensor | `jam_detected` |
| DI5 | Safety relay feedback | E-stop chain |

*Synthetic SimLab fixture — not a real OEM document.*

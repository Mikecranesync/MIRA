# Case Packer 01 — Electrical & I/O Notes

## Power
- 480V 3-phase, 30A MCB at panel CP-01
- Control: 24VDC SMPS from panel

## Digital Inputs
| I/O | Description | PLC Tag |
|-----|-------------|---------|
| DI0 | Bottle infeed photoeye | `bottle_infeed_count` trigger |
| DI1 | Case former home | `case_former_ready` |
| DI2 | Jam detection sensor | `jam_detected` |
| DI3 | Glue level low float | `glue_level` low |

## Digital Outputs
| I/O | Description | PLC Tag |
|-----|-------------|---------|
| DO0 | Infeed stop gate | jam interlock |
| DO1 | Glue pump enable | `glue_temperature` control |

*Synthetic SimLab fixture — not a real OEM document.*

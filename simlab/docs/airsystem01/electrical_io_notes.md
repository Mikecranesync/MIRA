# Air System 01 — Electrical & I/O Notes

## Power
- 480V 3-phase, 60A MCB at panel AS-01
- Control: 24VDC SMPS from panel
- Dryer: 208V single-phase, 20A dedicated circuit

## Analog Inputs
| I/O | Description | Tag |
|-----|-------------|-----|
| AI0 | Header pressure transducer (0–150 PSI) | `header_pressure_psi` |

## Digital Inputs
| I/O | Description | Tag |
|-----|-------------|-----|
| DI0 | Compressor run contact | `compressor_running` |
| DI1 | Dryer fault relay | `dryer_fault` |
| DI2 | Low-pressure switch (75 PSI) | `low_air_alarm` |

*Synthetic SimLab fixture — not a real OEM document.*

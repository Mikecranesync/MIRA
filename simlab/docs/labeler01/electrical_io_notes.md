# Labeler 01 — Electrical & I/O Notes

## Power Summary
| Circuit | Voltage | Breaker |
|---------|---------|---------|
| Servo drive | 230 VAC, 1Ø | 20 A (CB-LBL-01) |
| Glue pot heater | 120 VAC | 15 A (CB-LBL-02) |
| Control / solenoids | 24 VDC | 10 A fused DIN |

## Key I/O
| Address | Tag | Description |
|---------|-----|-------------|
| AI-LBL-01 | `label_web_tension` | Load cell (0–5 lb, 4–20 mA) |
| AI-LBL-02 | `glue_temperature` | Type K thermocouple transmitter (0–500 °F, 4–20 mA) |
| AI-LBL-03 | `registration_error_mm` | Registration sensor analog output (±5 mm, 4–20 mA) |
| DI-LBL-01 | `label_sensor_blocked` | Photo-eye at web path (0 = clear, 1 = blocked) |
| DI-LBL-02 | E-Stop OK | |
| DI-LBL-03 | Guard Door Closed | |
| DO-LBL-01 | Glue Pot Heater Enable | 24 VDC SSR control |
| DO-LBL-02 | Reject Gate Solenoid | 24 VDC |

## Servo Drive Connections
- Servo amplifier communicates via EtherCAT to the PLC motion controller.
- Following error alarm output → DI-LBL-04 (energized = no error).
- Parameter set stored on SD card in servo drive — back up quarterly.

*Synthetic SimLab fixture — not a real OEM document.*

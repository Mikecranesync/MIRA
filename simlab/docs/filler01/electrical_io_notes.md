# Filler 01 — Electrical & I/O Notes

## Power Summary
| Circuit | Voltage | Breaker | Location |
|---------|---------|---------|---------|
| Carousel drive VFD | 460 VAC, 3Ø | 30 A (CB-FLR-01) | MCC Panel, Bay 4 |
| Control power | 120 VAC | 15 A (CB-FLR-02) | Control cabinet, terminal strip |
| Solenoid bank (fill valves) | 24 VDC | 20 A fused DIN | I/O chassis, rack 2 |
| HMI panel | 24 VDC | Internal | Operator panel |

## VFD (Variable Frequency Drive)
- **Drive:** Generic 15 HP, 460 VAC, 3-phase drive
- **PLC Control Word:** Speed setpoint via 4–20 mA analog output AO-FLR-01
- **Feedback:** Actual frequency feedback to AI-FLR-01 (0–60 Hz scaled 4–20 mA)
- **Fault Relay:** VFD fault dry-contact → DI-FLR-08 (energized = no fault)
- **Overload:** Electronic overload inside VFD; trip at 110% FLA for 60 s

## Digital Inputs (DI)
| DI Address | Tag Name | Description |
|-----------|----------|-------------|
| DI-FLR-01 | E-Stop OK | E-stop string intact (1 = safe) |
| DI-FLR-02 | Bowl Level High | Float switch — bowl full |
| DI-FLR-03 | Bowl Level Low | Float switch — bowl needs refill |
| DI-FLR-04 | Infeed Bottle Present | Photoeye at infeed starwheel |
| DI-FLR-05 | Guard Door Closed | Safety interlock |
| DI-FLR-06 | CIP Mode Active (from CIP Skid) | Interlocks out production start |
| DI-FLR-07 | Overload Reset PB | Manual reset pushbutton |
| DI-FLR-08 | VFD Fault OK | VFD no-fault dry contact |

## Digital Outputs (DO)
| DO Address | Tag Name | Description |
|-----------|----------|-------------|
| DO-FLR-01 | Fill Valve 1 Solenoid | 24 VDC — valve 1 open command |
| DO-FLR-02 to 20 | Fill Valve 2–20 Solenoids | Same as above for valves 2–20 |
| DO-FLR-21 | Bowl Refill Valve | Opens supply from balance tank to bowl |
| DO-FLR-22 | Alarm Stack Light Red | Fault present |
| DO-FLR-23 | Alarm Stack Light Amber | Warning present |
| DO-FLR-24 | Alarm Stack Light Green | Machine running |

## Analog Inputs (AI)
| AI Address | Tag Name | Range | Description |
|-----------|----------|-------|-------------|
| AI-FLR-01 | `vfd_speed_hz` feedback | 4–20 mA → 0–60 Hz | VFD actual output frequency |
| AI-FLR-02 | `motor_current_amps` | 4–20 mA → 0–15 A | VFD internal current feedback |
| AI-FLR-03 | `filler_bowl_pressure` | 4–20 mA → 0–30 PSI | Bowl headspace pressure transmitter |
| AI-FLR-04 | `product_temperature` | 4–20 mA → -10–60 °C | Bowl thermocouple transmitter |
| AI-FLR-05 | `tank_level_percent` | 4–20 mA → 0–100% | Balance tank level transmitter |

## Analog Outputs (AO)
| AO Address | Description |
|-----------|-------------|
| AO-FLR-01 | VFD speed setpoint (4–20 mA → 0–60 Hz) |
| AO-FLR-02 | Bowl pressure regulator remote setpoint (4–20 mA → 0–30 PSI) |

## Common Wiring Faults
- **Nozzle solenoid fault:** Check 24 VDC fuse block on I/O rack 2, row corresponding to valve number. Blown fuse = permanent open on that valve. Measure solenoid coil resistance (nominal 60 Ω ± 10%).
- **Bowl pressure reads 0:** Check AI-FLR-03 transmitter loop — confirm 24 VDC excitation and 4–20 mA signal at PLC analog input card. Transmitter loss-of-power reads 0 PSI (same symptom as low actual pressure — check loop before calling mechanical).
- **VFD speed not following setpoint:** Check AO-FLR-01 signal continuity; verify AO card channel calibration (output 12 mA should command ~30 Hz).

*Synthetic SimLab fixture — not a real OEM document.*

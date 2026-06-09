# Capper 01 — Electrical & I/O Notes

## Power Summary
| Circuit | Voltage | Breaker |
|---------|---------|---------|
| Capping drive motor | 460 VAC, 3Ø | 20 A (CB-CAP-01) |
| Control / solenoids | 24 VDC | 10 A fused DIN |

## Key I/O
| Address | Tag | Description |
|---------|-----|-------------|
| DI-CAP-01 | E-Stop OK | Interlocked with Filler 01 E-stop string |
| DI-CAP-02 | `cap_present` | Photo-eye at capping head entrance |
| DI-CAP-03 | `jam_detected` | Proximity sensor at carousel exit |
| DI-CAP-04 | Guard Door Closed | Safety interlock |
| AI-CAP-01 | `cap_torque_inlb` | Torque transducer (0–30 in-lb, 4–20 mA) |
| AI-CAP-02 | `motor_current_amps` | Drive current feedback |
| AI-CAP-03 | `cap_chute_level` | Ultrasonic level transmitter (0–100%) |
| DO-CAP-01 | Reject Gate Solenoid | 24 VDC — energize to extend reject cylinder |
| DO-CAP-02 | Alarm Stack Light | Red = fault |

*Synthetic SimLab fixture — not a real OEM document.*

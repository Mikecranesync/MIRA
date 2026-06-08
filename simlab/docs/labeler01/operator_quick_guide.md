# Labeler 01 — Operator Quick Guide

## Machine Overview
Labeler 01 applies pressure-sensitive labels to capped bottles using a servo-driven
label-web system with hot-melt glue assist at the label edge. An optical registration
sensor ensures each label is placed within ±1.0 mm of the target position. A vision-based
reject gate removes mis-labeled bottles.
Nominal throughput: 200 bottles per minute.

## Machine Identification
- **Asset ID:** labeler01
- **Type:** labeler
- **UNS Path:** `enterprise.florida_natural_demo.plant1.juice_bottling.line01.labeler01`
- **Location:** Line 01, Station 6 (downstream of Capper 01)

## Panel Controls
| Control | Function |
|---------|----------|
| AUTO / MANUAL | Production vs. manual splice/thread mode |
| START | Arms PackML EXECUTE |
| STOP | Completes current label cycle, halts |
| E-STOP | Immediate de-energize |
| Glue Temp Setpoint | HMI — target glue temp in °F (nominal 280 °F) |

## Normal Operating Parameters
| Parameter | Normal Range | Tag |
|-----------|-------------|-----|
| Label roll remaining | > 20% | `label_roll_percent` |
| Label web tension | 0.8–1.4 lb | `label_web_tension` |
| Glue temperature | 270–295 °F | `glue_temperature` |
| Registration error | < ±1.0 mm | `registration_error_mm` |
| Reject count | 0–2 per 1000 bottles | `reject_count` |

## Common Operator Actions
- **Roll low:** Splice new roll per label splice SOP before `label_roll_percent` reaches 5%.
- **Registration alarm:** Check web tension and glue temp first; if persistent, inspect registration sensor.
- **Glue temp alarm:** Allow 5 min warm-up after startup; if temp fails to reach setpoint, see troubleshooting guide.

*Synthetic SimLab fixture — not a real OEM document.*

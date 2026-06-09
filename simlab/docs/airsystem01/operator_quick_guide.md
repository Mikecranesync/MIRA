# Air System 01 — Operator Quick Guide

## System Overview
Air System 01 is the plant compressed-air utility for Line 01.
It supplies the entire juice bottling line: pneumatic actuators, filler bowl
pressure, depalletizer vacuum generator, and capper/labeler pneumatics.
Nominal header pressure: 90 PSI. Low-pressure alarm: 75 PSI.

## Asset Identification
- **Asset ID:** airsystem01
- **Type:** air_system
- **UNS Path:** `enterprise.florida_natural_demo.plant1.juice_bottling.line01.airsystem01`

## Key Tags
| Tag | Normal | Alarm Threshold |
|-----|--------|----------------|
| `header_pressure_psi` | 85–100 PSI | < 75 PSI → low_air_alarm |
| `compressor_running` | TRUE | FALSE = compressor offline |
| `dryer_fault` | FALSE | TRUE = moisture risk |
| `low_air_alarm` | FALSE | TRUE = immediate action |

## Startup Sequence
1. Confirm compressor power is on and control power energized.
2. Confirm dryer is running (green run light on dryer panel).
3. Start compressor via panel START button.
4. Allow header pressure to build to > 80 PSI before starting Line 01.

## Shutdown
1. Press compressor STOP.
2. Drain condensate from receiver tank drain valve.
3. Do NOT drain system if Line 01 pneumatics are still active.

*Synthetic SimLab fixture — not a real OEM document.*

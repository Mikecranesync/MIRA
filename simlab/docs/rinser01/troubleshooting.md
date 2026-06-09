# Rinser 01 — Troubleshooting Guide

**Asset ID:** `rinser01`
**UNS Path:** `enterprise.florida_natural_demo.plant1.juice_bottling.line01.rinser01`

## Low Water Pressure

**Condition:** `water_pressure` < 20 PSI; machine alarm.

1. Check building water supply pressure upstream of the rinser.
2. Confirm supply isolation valve is fully open.
3. Inspect inline strainer — if clogged, clean or replace the strainer basket.
4. Check pressure regulator — if set-point is drifting, adjust or replace.
5. **Fault Code:** RN001

## Rinse Valve Not Opening

**Condition:** `rinse_valve_open` = FALSE during production; bottles not being rinsed.

1. Check 24 VDC DO output to solenoid with a meter.
2. Measure solenoid coil resistance (nominal 40–60 Ω); if open, replace solenoid.
3. If DO output is high but valve doesn't open, valve body may be seized — replace valve.
4. **Fault Code:** RN002

## Reject Count Elevated

**Condition:** `reject_count` rising faster than baseline.

1. Remove and inspect rejected bottles — note contamination type.
2. Check detection sensor calibration — verify sensitivity setting is unchanged.
3. If contamination is from the bottle supplier, quarantine the lot and notify QA.
4. **Fault Code:** RN003

*Synthetic SimLab fixture — not a real OEM document.*

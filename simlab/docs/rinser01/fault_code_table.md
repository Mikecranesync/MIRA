# Rinser 01 — Fault Code Table

**Asset ID:** `rinser01`
**UNS Path:** `enterprise.florida_natural_demo.plant1.juice_bottling.line01.rinser01`

| Code | Label | Severity | Description | Likely Cause | Recommended Action |
|------|-------|----------|-------------|-------------|-------------------|
| RN001 | Low Water Pressure | FAULT | `water_pressure` < 20 PSI; rinse effectiveness compromised. | Water supply valve partially closed, pressure regulator failure, upstream supply issue. | Check supply isolation valve; inspect pressure regulator; confirm building water pressure. |
| RN002 | Rinse Valve Fault | FAULT | `rinse_valve_open` stuck FALSE during production run. | Solenoid coil burned out, valve actuator seized, 24 VDC DO failure. | Check DO output to solenoid; megger coil; replace solenoid or valve assembly. |
| RN003 | Reject Count High | WARN | `reject_count` rising; foreign material detected in bottles. | Bottle contamination from supplier, detection sensor calibration drift. | Inspect rejected bottles; check detection sensor calibration; notify QA. |

*Synthetic SimLab fixture — not a real OEM document.*

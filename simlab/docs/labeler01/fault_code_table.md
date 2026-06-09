# Labeler 01 — Fault Code Table

| Code | Label | Severity | Description | Likely Cause | Recommended Action |
|------|-------|----------|-------------|-------------|-------------------|
| L001 | Label Roll Low/Empty | FAULT | `label_roll_percent` < 5% or 0%. Machine stops at 0%. | Roll consumed; no splice performed in time. | Splice new roll before 5% threshold; confirm web threaded correctly after splice. |
| L002 | Web Tension Fault | FAULT | `label_web_tension` outside 0.5–2.0 lb. | Broken dancer spring, web brake failure, roll binding, web path obstruction. | Inspect dancer roller and brake pad; inspect web path for obstruction. |
| L003 | Registration Error | WARN | `registration_error_mm` > ±1.0 mm sustained; `reject_count` rising. | Web tension off, sensor contaminated, roll core run-out, glue temp low, servo error. | Check web tension; clean registration sensor; inspect roll seating; verify glue temp. |
| L004 | Glue Temp Out of Range | WARN | `glue_temperature` outside 270–295 °F. | Heater element failure, thermocouple drift, cold start delay, setpoint error. | Check heater circuit; allow warm-up; inspect thermocouple. |
| L005 | High Reject Count | WARN | `reject_count` rising above baseline without specific fault active. | Vision camera contamination, label print defect, stuck reject gate. | Clean camera lens; inspect label stock quality; test reject gate. |
| L006 | Interlock / E-Stop | FAULT | Startup prevented by interlock. | Glue temp not at warm-up threshold, roll empty, guard door open, E-stop, upstream fault. | Clear interlock condition; confirm upstream ready; reset PackML. |
| L007 | Label Sensor Blocked | FAULT | `label_sensor_blocked` = TRUE; web not advancing. | Web break, label jam in web path, threading error after splice. | Inspect web path; re-thread web; check splice quality. |

*Synthetic SimLab fixture — not a real OEM document.*

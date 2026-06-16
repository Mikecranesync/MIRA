# Case Packer 01 — Fault Code Table

| Code | Label | Severity | Description | Likely Cause | Recommended Action |
|------|-------|----------|-------------|-------------|-------------------|
| CP001 | E-Stop / Interlock | FAULT | Machine halted by E-Stop or interlock. | E-stop pressed, guard door open, Labeler 01 faulted. | Clear E-stop/interlock; confirm upstream ready; reset PackML. |
| CP002 | Case Former Not Ready | FAULT | `case_former_ready` = FALSE; cannot start case cycle. | Glue temp below threshold, blank magazine empty, mandrel sensor mis-aligned. | Wait for glue warm-up; reload blank magazine; check mandrel sensors. |
| CP003 | Glue Level Low | WARN | `glue_level` < 25%. Machine halts at 10%. | Glue hopper consumed. | Add approved food-grade hot-melt pellets to hopper; wait 3–5 min. |
| CP004 | Jam Detected | FAULT | `jam_detected` = TRUE; carousel or discharge blocked. Upstream accumulation will build. | Tipped bottle, deformed case blank, palletizer discharge backed up. | Safe-to-enter; clear jam per SOP; reset; confirm upstream ready. |
| CP005 | Glue Temp Fault | WARN | `glue_temperature` outside 300–325 °F. | Heater fault, thermocouple drift, setpoint error, cold start. | Inspect heater element; verify setpoint; allow full warm-up cycle. |
| CP006 | High Reject Count | WARN | `reject_count` rising — case seal quality issue. | Inadequate glue bead, low air pressure (fold cylinder), temp too low. | Check glue bead; verify AirSystem01 pressure; check fold cylinder timing. |
| CP007 | Low Air Pressure | WARN | AirSystem01 `header_pressure_psi` < 80 PSI — fold/seal cylinders affected. | AirSystem01 fault. | Address AirSystem01 first; do not run case former with low air. |

*Synthetic SimLab fixture — not a real OEM document.*

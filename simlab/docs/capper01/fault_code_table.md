# Capper 01 — Fault Code Table

| Code | Label | Severity | Description | Likely Cause | Recommended Action |
|------|-------|----------|-------------|-------------|-------------------|
| C001 | No Cap Present | FAULT | `cap_present` = FALSE; chute empty or sensor failure. | Cap hopper exhausted, cap orienter jam, photo-eye dirty. | Refill cap hopper; inspect chute and orienter; clean sensor. |
| C002 | Over-torque Reject | WARN | `cap_torque_inlb` > 20 in-lb; `reject_count` increasing. | Worn clutch pads, wrong cap format, setpoint too high. | Inspect clutch pads; verify cap spec; check torque setpoint. |
| C003 | Under-torque Reject | FAULT | `cap_torque_inlb` < 12 in-lb; sealing integrity compromised. | Glazed clutch pads, worn chuck, weak torque-head spring. | Scuff or replace clutch pads; check chuck fit; verify spring. |
| C004 | Jam Detected | FAULT | `jam_detected` = TRUE; carousel obstructed. | Doubled bottle, dropped cap, bottle neck fragment. | Clear jam per SOP; inspect carousel; reset. |
| C005 | Interlock / E-Stop | FAULT | Startup prevented by interlock or E-stop. | E-stop latched, guard open, Filler 01 faulted, chute empty. | Clear interlock; confirm upstream ready; reset PackML. |
| C006 | Torque Variance High | WARN | `cap_torque_variance` > ±3 in-lb; erratic caps. | Mixed cap orientation, worn spindle bearings, non-uniform clutch pads. | Inspect cap orientation; check spindle bearings; inspect all clutch pads. |
| C007 | Low Air Pressure | WARN | AirSystem01 `header_pressure_psi` < 80 PSI — reject cylinders may fail to extend. | AirSystem01 compressor fault or distribution loss. | Address AirSystem01 fault first; do not run capper with low air. |

*Synthetic SimLab fixture — not a real OEM document.*

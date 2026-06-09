# Filler 01 — Fault Code Table

| Code | Label | Severity | Description | Likely Cause | Recommended Action |
|------|-------|----------|-------------|-------------|-------------------|
| F001 | E-Stop / Interlock | FAULT | Machine halted by E-Stop or interlock chain. `run_state` = ABORTED. | E-stop pressed, guard door open, downstream interlock (Capper 01 not ready), or CIP active. | Clear E-stop or interlock condition; confirm downstream ready; reset PackML. |
| F002 | Motor Overload | FAULT | Motor overload relay tripped. `motor_current_amps` exceeded 8.5 A. | Mechanical jam in rotary carousel, worn rotary seal, jammed infeed starwheel, lubrication failure. | Clear jam, allow motor to cool 10 min, inspect rotary seals and lubrication; reset overload relay before restarting. |
| F003 | Nozzle Fault | FAULT | One or more fill nozzles failed self-test or flow check. `nozzle_fault_count` > 0. | Blocked nozzle orifice (pulp, residue), worn nozzle tip seal, failed fill valve solenoid. | Identify faulted nozzle(s) via HMI valve diagnostic; clean or replace nozzle tip; confirm solenoid response. |
| F004 | Overfill | WARN | Overfill detections exceed threshold. `overfill_reject_count` rising. | Bowl pressure too high (> 20 PSI), VFD speed too low (extended dwell), fill valve timing drift. | Reduce bowl pressure regulator set-point; verify VFD speed setpoint; run valve timing diagnostic. |
| F005 | Fill Variance High | WARN | `fill_level_variance` > ±0.5 oz — erratic fill. | Bowl level swings (float valve stuck), air entrainment in supply line, intermittent valve actuation. | Inspect bowl float valve; bleed air from supply line; verify product supply tank pressure stability. |
| F006 | Product Temp High | WARN | `product_temperature` > 42 °F. Product quality risk. | Refrigeration supply failure, product stagnant in bowl > 45 min, ambient heat during extended pause. | Drain and replace bowl product; check refrigeration; reduce pause duration between runs. |
| F007 | Low Bowl Pressure | FAULT | `filler_bowl_pressure` < 8 PSI — systematic underfill risk. `underfill_reject_count` rising. | Low supply tank level, failed/blocked pressure regulator, restricted supply line, low air pressure on pneumatic actuators, clogged fill nozzles. | Check `tank_level_percent`; inspect pressure regulator; verify AirSystem01 header pressure; inspect nozzles. See Troubleshooting § Underfill. |
| F008 | Tank Level Low | WARN | `tank_level_percent` < 15%. | Product supply batch exhausted; refill pump failure; supply valve closed. | Notify product supply; do not run production below 15%; replenish batch. |

## Fault Code Tag
All active fault codes are written to the `fault_code` tag at UNS path:
`enterprise.florida_natural_demo.plant1.juice_bottling.line01.filler01.faults.fault_code`

When multiple faults are active, the highest-severity code is reported. Fault history is
maintained in the alarm log accessible via the HMI Fault History screen.

## Reset Procedure
1. Resolve the underlying condition (see troubleshooting guide for each code).
2. On HMI: Alarms → Active Alarms → Acknowledge.
3. Issue PackML RESET command.
4. Confirm `fault_code` tag returns to empty/NONE.
5. Log the fault and corrective action in the shift maintenance log.

*Synthetic SimLab fixture — not a real OEM document.*

# CIP Skid 01 — Fault Code Table

**Asset ID:** `cipskid01`
**UNS Path:** `enterprise.florida_natural_demo.plant1.juice_bottling.line01.cipskid01`

| Code | Label | Severity | Description | Likely Cause | Recommended Action |
|------|-------|----------|-------------|-------------|-------------------|
| CIP001 | Valve Fault | FAULT | `valve_fault` = TRUE; a CIP valve is not responding to command. | Solenoid coil burned out, actuator seized, position switch failure. | Identify faulted valve via HMI valve status screen; check solenoid coil; replace actuator if seized. |
| CIP002 | Supply Temp Low | WARN | `supply_temp` < 130 °F during a step requiring heat. | Heater element failure, thermostat drift, inadequate hot-water supply. | Check heater element circuit; verify thermostat setpoint; confirm hot-water supply pressure. |
| CIP003 | Conductivity Out of Range | WARN | `conductivity` outside expected band for current step. | Incorrect chemical concentration, premature dilution, dosing pump failure. | Check chemical dosing pump operation; verify solution concentration manually; re-dose if needed. |

*Synthetic SimLab fixture — not a real OEM document.*

# Conveyor Zone 01 — Fault Code Table

**Asset ID:** `conveyorzone01`
**UNS Path:** `enterprise.florida_natural_demo.plant1.juice_bottling.line01.conveyorzone01`

| Code | Label | Severity | Description | Likely Cause | Recommended Action |
|------|-------|----------|-------------|-------------|-------------------|
| CV1001 | Zone Full / Blocked | WARN | `accumulation_percent` = 100%; downstream station not accepting bottles. | Downstream machine faulted or stopped (Rinser01, Filler01, or beyond). | Identify and resolve downstream root cause first. Zone will clear automatically when downstream resumes. |
| CV1002 | Zone Starved | WARN | `starved` = TRUE; no bottles arriving from Depalletizer01. | Depalletizer01 faulted, no pallet staged, or vacuum loss. | Check Depalletizer01 status; stage pallet if needed. |
| CV1003 | Motor Overload | FAULT | `motor_current_amps` > 5.0 A; drive trips. | Belt jam, foreign object on belt, worn belt tensioner. | Clear obstruction; check belt tension; reset overload relay. |

*Synthetic SimLab fixture — not a real OEM document.*

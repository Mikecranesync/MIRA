# Conveyor Zone 02 — Fault Code Table

**Asset ID:** `conveyorzone02`
**UNS Path:** `enterprise.florida_natural_demo.plant1.juice_bottling.line01.conveyorzone02`

| Code | Label | Severity | Description | Likely Cause | Recommended Action |
|------|-------|----------|-------------|-------------|-------------------|
| CV2001 | Zone Full / Blocked | WARN | `accumulation_percent` = 100%; downstream station not accepting bottles. | Downstream machine faulted or stopped (Rinser01, Filler01, or beyond). | Identify and resolve downstream root cause first. Zone will clear automatically when downstream resumes. |
| CV2002 | Zone Starved | WARN | `starved` = TRUE; no bottles arriving from Depalletizer01. | Depalletizer01 faulted, no pallet staged, or vacuum loss. | Check Depalletizer01 status; stage pallet if needed. |
| CV2003 | Motor Overload | FAULT | `motor_current_amps` > 5.0 A; drive trips. | Belt jam, foreign object on belt, worn belt tensioner. | Clear obstruction; check belt tension; reset overload relay. |

*Synthetic SimLab fixture — not a real OEM document.*

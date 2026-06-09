# Conveyor Zone 01 — Troubleshooting Guide

**Asset ID:** `conveyorzone01`
**UNS Path:** `enterprise.florida_natural_demo.plant1.juice_bottling.line01.conveyorzone01`

## Zone Full / Accumulation at 100%

**Condition:** `accumulation_percent` = 100%; `blocked` = TRUE.

This zone never blocks independently — it fills because a downstream station has stopped.
Check in order: Rinser01 → Filler01 → Capper01 → Labeler01 → CasePacker01.
Do NOT attempt to override or purge the zone until the downstream root cause is resolved.
**Fault Code:** CV1001

## Zone Starved

**Condition:** `starved` = TRUE; `photoeye_blocked` = FALSE for > 30 s.

Check Depalletizer01 `run_state` and `pallet_present`.
If depalletizer is running, check `bottle_outfeed_rate` — a low rate indicates vacuum or jam issue.
**Fault Code:** CV1002

## Motor Overload / Belt Jam

**Condition:** `motor_current_amps` > 5.0 A; belt slows or stops.

Clear belt obstruction (fallen cap, label debris, bottle fragment).
Check belt tension — a loose belt can slip and stall under load.
**Fault Code:** CV1003

*Synthetic SimLab fixture — not a real OEM document.*

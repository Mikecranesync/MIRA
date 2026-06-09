# Air System 01 — Troubleshooting Guide

## Low Header Pressure (AS001) — Multi-Machine Impact

**Symptom:** `header_pressure_psi` dropping; `low_air_alarm` = TRUE.
Secondary symptoms across the line:
- `depalletizer01.vacuum_pressure` drops (vacuum generator starved)
- `filler01.filler_bowl_pressure` drops → underfill
- `capper01.cap_present` may go FALSE (cap chute pneumatic feed fails)
- `casepacker01.case_former_ready` may go FALSE (case former pneumatic fault)

**When you see multiple machines faulting simultaneously, check AirSystem01 FIRST.**

**Procedure:**
1. Read `header_pressure_psi`. If < 75 PSI, this is the root cause of multi-machine symptoms.
2. Check `compressor_running`:
   - FALSE: compressor has stopped. Go to Compressor Offline section.
   - TRUE but pressure low: there is a major air leak or excess demand.
3. Walk the compressed-air distribution headers (north and south mains) listening for hiss.
4. Check all isolation valves on headers — verify all are fully open (handle parallel to pipe).
5. Check each machine's local FRL (filter-regulator-lubricator) — none should be closed.
6. Check demand: if CIP Skid 01 is active simultaneously, this may explain pressure sag.

## Compressor Offline (AS003)

**Symptom:** `compressor_running` = FALSE.

1. Check compressor control panel fault display.
2. Common causes: motor thermal overload tripped, unloader valve stuck, high-temperature shutdown.
3. Verify compressor room ambient < 100 °F.
4. Reset thermal overload relay if tripped.
5. If fault recurs in < 10 min, call refrigeration/compressor technician.

## Air Dryer Fault (AS002)

**Symptom:** `dryer_fault` = TRUE.

1. Observe dryer panel for specific fault code.
2. Common causes: refrigerant low, high ambient, bypass valve open.
3. Check dryer condensate drain — verify purging automatically.
4. Dryer faults do not immediately stop production, but moisture enters the supply.
   Notify maintenance within 1 shift.

*Synthetic SimLab fixture — not a real OEM document.*

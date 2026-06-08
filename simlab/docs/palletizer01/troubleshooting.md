# Palletizer 01 — Troubleshooting Guide

## Robot E-Stop (PA001)

**Symptom:** `fault_code` = PA001; `robot_ready` = FALSE; `run_state` = Faulted.
Cases accumulate on infeed; `casepacker01.jam_detected` may activate downstream.

**Procedure:**
1. Check robot teach pendant display for specific fault sub-code.
2. Verify no person is inside the robot cell.
3. Clear the physical cause (dropped case, safety gate open, teach pendant in T1 mode).
4. Twist-unlock e-stop mushroom. Reset safety relay via keyswitch.
5. Acknowledge fault on teach pendant. Return robot to home position.
6. Issue PackML CLEARING → STOPPED → (resume via START).

## No Pallet at Build Station (PA002)

**Symptom:** `pallet_present` = FALSE; palletizer pauses at layer-complete.

1. Fork truck operator must stage an empty pallet at the build station.
2. If photoeye reads FALSE with pallet present: check sensor alignment; clean lens.

## Infeed Jam (PA003)

**Symptom:** `jam_detected` = TRUE; case infeed stopped.

1. Press STOP; wait for robot to park at home.
2. Clear jam from infeed conveyor.
3. Press START to resume.

## Slip Sheet Empty

**Symptom:** `slip_sheet_present` = FALSE.

1. Load slip sheet magazine (100 sheets).
2. Manually trigger SLIP SHEET button to verify feed.

*Synthetic SimLab fixture — not a real OEM document.*

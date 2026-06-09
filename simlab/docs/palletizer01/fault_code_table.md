# Palletizer 01 — Fault Code Table

**Asset ID:** `palletizer01`
**UNS Path:** `enterprise.florida_natural_demo.plant1.juice_bottling.line01.palletizer01`

| Code | Label | Severity | Description | Likely Cause | Recommended Action |
|------|-------|----------|-------------|-------------|-------------------|
| PA001 | Robot E-Stop | CRITICAL | `robot_ready` = FALSE; safety zone E-stop tripped. `run_state` = ABORTED. Upstream cases accumulate; CasePacker01 jam risk. | Safety zone intrusion, teach pendant in T1 mode, hardware E-stop pressed, robot servo fault. | Verify no person in robot cell; clear physical cause; twist-unlock E-stop mushroom; reset safety relay; acknowledge on teach pendant; return robot to home. |
| PA002 | No Pallet at Station | FAULT | `pallet_present` = FALSE; palletizer paused at layer-complete waiting for next pallet. | Fork truck has not staged empty pallet; pallet photoeye dirty or misaligned. | Stage empty pallet; clean/realign pallet-present sensor. |
| PA003 | Infeed Jam | FAULT | `jam_detected` = TRUE; case infeed conveyor blocked. | Misaligned case, deformed case, foreign object on infeed conveyor. | Press STOP; wait for robot to park at home; clear infeed jam; press START to resume. |
| PA004 | Slip Sheet Empty | WARN | `slip_sheet_present` = FALSE; slip sheet magazine exhausted. | Magazine consumed; no operator restocked. | Load slip sheet magazine (100 sheets per load); manually trigger SLIP SHEET cycle to verify feed. |

*Synthetic SimLab fixture — not a real OEM document.*

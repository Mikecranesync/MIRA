# Depalletizer 01 — Fault Code Table

**Asset ID:** `depalletizer01`
**UNS Path:** `enterprise.florida_natural_demo.plant1.juice_bottling.line01.depalletizer01`

| Code | Label | Severity | Description | Likely Cause | Recommended Action |
|------|-------|----------|-------------|-------------|-------------------|
| DP001 | No Pallet at Infeed | FAULT | `pallet_present` = FALSE; no pallet at pick station. | Fork truck has not staged a pallet; pallet photoeye dirty or misaligned. | Stage full pallet; clean/realign pallet-present sensor. |
| DP002 | Vacuum Loss | FAULT | `vacuum_pressure` > -15 in-Hg (insufficient suction). | Low AirSystem01 header pressure; vacuum cup seal wear; cracked cup. | Check AirSystem01 header_pressure_psi; inspect vacuum cups; replace worn cups. |
| DP003 | Jam Detected | FAULT | `jam_detected` = TRUE; bottle obstruction at outfeed. | Tipped bottle, double-bottle presentation, guide rail misalignment. | Safe-to-enter; clear obstruction; reset PackML. |
| DP004 | Layer Count Error | WARN | `layer_count` does not decrement as expected; layer sensor fault. | Layer detection photoeye dirty or misaligned; pallet loaded off-center. | Clean and realign layer sensor; re-home pick head; reload pallet. |

*Synthetic SimLab fixture — not a real OEM document.*

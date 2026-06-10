# Case Packer 01 — Troubleshooting Guide

## Symptom Index
- [Jam Detected — Line Backs Up Upstream](#jam-detected--line-backs-up-upstream)
- [Case Former Not Ready](#case-former-not-ready)
- [Glue Level Low / Empty](#glue-level-low--empty)
- [Glue Temperature Fault](#glue-temperature-fault)
- [High Reject Count](#high-reject-count)
- [Upstream Accumulation Building (Scenario D)](#upstream-accumulation-building-scenario-d)

---

## Jam Detected — Line Backs Up Upstream

**Condition:** `jam_detected` = TRUE; `run_state` = HELD or ABORTED; upstream conveyor `accumulation_percent` rising.
**Scenario D trigger.**

- **Step 1 — Confirm E-stop and safe-to-enter.** All power must be verified de-energized before entering the machine envelope.
- **Step 2 — Identify jam location.** Check three zones: (a) bottle collation belt, (b) case forming station, (c) case discharge conveyor.
- **Step 3 — Clear bottle collation jam.** If collated bottles are tipped or a fallen cap is blocking, remove bottle(s) and cap fragment. Reset the collation count on HMI.
- **Step 4 — Clear case forming jam.** A folded case blank can jam the forming mandrel. Remove the deformed blank and reload a fresh blank from the magazine.
- **Step 5 — Clear case discharge jam.** Cases discharged into a backed-up Palletizer 01 queue can stack. Clear discharge lane and confirm Palletizer 01 is READY before restarting.
- **Step 6 — Reset PackML.** Issue PackML RESET, confirm `jam_detected` = FALSE, then restart.
- **Impact:** A sustained jam at Case Packer 01 blocks all upstream stations. `conveyorzone02.process.accumulation_percent` and `conveyorzone01.process.accumulation_percent` will both rise. If accumulation reaches 100%, Labeler 01 and Capper 01 will be forced to hold.
- **Fault Code:** CP004

---

## Case Former Not Ready

**Condition:** `case_former_ready` = FALSE; machine will not start a new case cycle.

- **Check glue temperature:** If `glue_temperature` < 295 °F, the hot-melt glue has not reached forming viscosity. Allow warm-up; do not override.
- **Check case blank magazine:** If the magazine is empty, load a new pallet of flat-pack case blanks (Part No. SP-CP-BLANKPLT).
- **Check forming mandrel sensors:** Confirm mandrel home-position sensor is triggering correctly; if not, check sensor alignment.
- **Fault Code:** CP002

---

## Glue Level Low / Empty

**Condition:** `glue_level` < 25%; machine halts at 10%.

- Add glue pellets to hopper — use only approved food-grade hot-melt adhesive (Part No. SP-CP-GLUE).
- Do not mix glue types — incompatible viscosities cause case seal failures.
- Allow 3–5 min after adding pellets for glue pot to re-stabilize at target temperature.
- **Fault Code:** CP003

---

## Glue Temperature Fault

**Condition:** `glue_temperature` outside 300–325 °F.

- Low (< 295 °F): Heater element or thermocouple failure; allow cold-start warm-up (8 min max before fault).
- High (> 335 °F): Thermocouple drift or setpoint entered incorrectly; char risk — glue will clog nozzles.
- **Fault Code:** CP005

---

## High Reject Count

**Condition:** `reject_count` rising; cases failing close inspection.

- Inspect glue bead pattern on closed case flaps — inadequate glue causes open flaps.
- Confirm glue temperature is within range.
- Check tuck-fold cylinder timing — if pneumatic pressure is low (AirSystem01), fold timing is inconsistent.
- **Fault Code:** CP006

---

## Upstream Accumulation Building (Scenario D)

When Case Packer 01 is stopped or running slowly, the backup propagates upstream through the conveyor accumulation zones. MIRA should identify Case Packer 01 as the root cause even when the upstream conveyor `blocked` and `accumulation_percent` tags are the first symptoms observed. Check `casepacker01.status.run_state` and `casepacker01.process.jam_detected` to confirm the blockage source.

*Synthetic SimLab fixture — not a real OEM document.*

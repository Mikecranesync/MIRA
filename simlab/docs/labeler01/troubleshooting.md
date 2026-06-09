# Labeler 01 — Troubleshooting Guide

## Symptom Index
- [Label Registration Error (Mis-placed Labels)](#label-registration-error-mis-placed-labels)
- [Label Web Tension Fault](#label-web-tension-fault)
- [Glue Temperature Low / High](#glue-temperature-low--high)
- [Label Roll Empty / Low](#label-roll-empty--low)
- [High Reject Count](#high-reject-count)
- [Labeler Not Starting](#labeler-not-starting)

---

## Label Registration Error (Mis-placed Labels)

**Condition:** `registration_error_mm` > ±1.0 mm sustained; `reject_count` rising.
**Scenario C trigger.**

- **Step 1 — Check web tension.** If `label_web_tension` is outside 0.8–1.4 lb, erratic web movement causes registration error. Inspect dancer roller and web brake pad (Part No. SP-LBL-WEBBRK). Adjust dancer tension spring to return tension to nominal.
- **Step 2 — Check label roll core run-out.** A label roll installed off-center causes periodic registration oscillation. Re-seat roll and confirm it spins true.
- **Step 3 — Check registration sensor alignment.** The optical registration eye tracks the label gap on the backing paper. If the sensor has drifted or the lense is contaminated, it loses timing. Clean with lint-free cloth; re-align per setup card.
- **Step 4 — Check glue temperature.** If `glue_temperature` < 260 °F, the label does not adhere flat and the tamp-blow die drags the label off position. Heat must be within range before running production.
- **Step 5 — Inspect drive servo.** If servo following error alarm is active on the servo drive keypad, the servo is losing position on the web. Check belt and pulley condition on the web drive.
- **Fault Code:** L003

---

## Label Web Tension Fault

**Condition:** `label_web_tension` < 0.5 lb or > 2.0 lb.

- Low tension (< 0.5 lb): Web brake not engaging — inspect dancer roller spring and brake pad wear.
- High tension (> 2.0 lb): Obstruction in web path or label roll not unwinding freely — inspect roll flanges and guide rollers.
- **Fault Code:** L002

---

## Glue Temperature Low / High

**Condition:** `glue_temperature` outside 270–295 °F.

- Low temperature: Check glue pot heater — thermocouple or heater element failure. Allow full 5-minute warm-up after power-on. If target is not reached in 8 minutes, inspect heater circuit (see electrical I/O notes).
- High temperature: Check thermocouple for drift or short; confirm setpoint on HMI is not elevated by operator error. High temperature can char glue and cause feed line clogging.
- **Fault Code:** L004

---

## Label Roll Empty / Low

**Condition:** `label_roll_percent` < 5%; machine will auto-stop at 0%.

- Splice new roll before roll percent reaches 5% to avoid a machine stop.
- Use label splice tape (Part No. SP-LBL-SPLTAPE); overlap min 10 mm.
- After splice, confirm `label_sensor_blocked` = FALSE (web threaded correctly) before resuming.
- **Fault Code:** L001

---

## High Reject Count

**Condition:** `reject_count` rising without a specific fault code.

- Inspect vision reject camera — lens may be contaminated, causing false accepts or rejects.
- Check label stock for print defects (mis-printed barcodes trigger reject).
- Confirm reject gate solenoid is operating correctly — a stuck gate allows bad labels through.
- **Fault Code:** L005

---

## Labeler Not Starting

**Condition:** START command issued, machine stays in IDLE.

- Confirm `glue_temperature` has reached minimum warm-up threshold (265 °F).
- Confirm `label_roll_percent` > 5%.
- Confirm Capper 01 is READY (interlocked).
- Check E-stop OK and guard door closed.
- **Fault Code:** L006

*Synthetic SimLab fixture — not a real OEM document.*

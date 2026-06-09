# Capper 01 — Troubleshooting Guide

## Symptom Index
- [High Torque / Over-torque Rejects](#high-torque--over-torque-rejects)
- [Low Torque / Under-torque Rejects](#low-torque--under-torque-rejects)
- [Cap Chute Empty / No Cap Present](#cap-chute-empty--no-cap-present)
- [Jam Detected](#jam-detected)
- [Capper Not Starting](#capper-not-starting)
- [High Torque Variance (Erratic)](#high-torque-variance-erratic)

---

## High Torque / Over-torque Rejects

**Condition:** `cap_torque_inlb` > 20 in-lb sustained; `reject_count` rising; `cap_torque_variance` positive bias.

- Check clutch pad wear — worn pads increase slip resistance. Inspect and replace if worn beyond 50% of original thickness (Part No. SP-CAP-CLUTCHPAD).
- Check cap thread specification — confirm cap supplier matches torque spec. A tighter-thread cap raises applied torque.
- Verify torque setpoint on HMI is correct for current cap format (14–18 in-lb for 38 mm closure).
- **Fault Code:** C002

---

## Low Torque / Under-torque Rejects

**Condition:** `cap_torque_inlb` < 12 in-lb; reject count rising; bottle sealing compromised.

- Inspect clutch pads — glazed pads reduce transmitted torque. Scuff surface with emery cloth or replace.
- Check torque head chuck fit — if chuck is worn, it slips on the cap, reducing torque delivery.
- Verify spring pressure on torque heads — check against specification in PM checklist.
- Confirm product supply pressure is not backing up bottles irregularly into the capping zone.
- **Fault Code:** C003

---

## Cap Chute Empty / No Cap Present

**Condition:** `cap_chute_level` < 20%; `cap_present` = FALSE on multiple cycles; reject count rising (uncapped bottles).

- Refill cap hopper from bulk supply. Standard cap bin holds 2,000 caps — should last ~10 min at 200 BPM.
- Check chute sensor — confirm photo-eye at chute exit is clean and calibrated.
- Check cap orienter for jams at the hopper exit. Mis-oriented caps can bridge and block flow.
- **Fault Code:** C001

---

## Jam Detected

**Condition:** `jam_detected` = TRUE; `run_state` transitions to HELD or ABORTED.

- Confirm E-stop circuit is safe before clearing jam.
- Inspect infeed guide rails and capping carousel for a doubled bottle, fallen cap, or fragment.
- Remove bottle and cap debris, reset jam sensor.
- Issue PackML RESET before restarting.
- **Fault Code:** C004

---

## Capper Not Starting

**Condition:** START command issued, machine stays in IDLE.

- Confirm Filler 01 is READY (interlocked — capper will not start if filler is faulted).
- Confirm `cap_chute_level` > 10% (startup interlock).
- Confirm E-stop OK and guard door closed.
- **Fault Code:** C005

---

## High Torque Variance (Erratic)

**Condition:** `cap_torque_variance` > ±3.0 in-lb; some over- and under-torque events mixed.

- Inspect cap feed orientation — mixed or inverted caps cause unpredictable torque.
- Check for worn bearings in the capping head spindle.
- Verify clutch pad condition uniformly across all heads (not just one head).
- **Fault Code:** C006

---

## Air Supply Link
Capper 01 pneumatic reject cylinders require AirSystem01 `header_pressure_psi` > 80 PSI.
If air pressure is low, reject gates will fail to extend, passing faulty bottles to Labeler 01.
Always confirm air system status if reject count is unexpectedly low during a torque-deviation event.

*Synthetic SimLab fixture — not a real OEM document.*

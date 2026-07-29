# CV-101 — V6 correction from Mike's field report (2026-07-11)

Technician (Mike) correction on the V5 print, reconciled with the photos. This REVERSES part of the
V4 change: MLC1 (Q1) belongs back in the power path — but NOT as a 3-phase motor contactor; as the
**single-phase supply switch** to the drive, using two of its NO contacts.

## What Mike stated (field authority)
1. **MLC1 sits between the main service breaker and the VFD supply.** When its coil energizes, it
   **supplies the incoming voltage to the VFD** (i.e., it powers the drive on).
2. **Incoming supply is 230 V SINGLE-PHASE — 2 wires**, not 3-phase. "Only two wires, high voltage on
   the MLC contactor."
3. The MLC also has the **24 VDC control coil on A1/A2** (driven by O-02).
4. "On the print it shows three-phase voltage coming in, and that's not correct."
5. (Flagged, see below) "the drive is converting it to 480 V output."

## Reconciliation with the photos (why this fits)
- The full-res MLC photo showed **13-14 and 43-44 (the two NO contacts) wired** with heavier
  conductors; **21-22 / 31-32 (NC) unused**; **coil A1/A2 wired**. That is exactly a **2-pole supply
  switch**: each NO contact carries one leg of the single-phase 230 V supply into the drive.
- The device is genuinely a Schneider **CA3KN22BD control relay** (catalog), but the drive's input
  current is small (P00.01 rated current = **1.60 A**), so a control relay's NO contacts can switch the
  single-phase supply for this small load. **Device ID = control relay; duty = drive-supply contactor.**
- GS10 single-phase input terminals = **R/L1 and S/L2** (T/L3 unused on single-phase). Motor output
  stays 3-phase (U/T1, V/T2, W/T3 → M1) — a 1φ-input VFD still outputs 3φ to the motor. Only the
  **input** changes from 3-phase to single-phase.

## Corrected E-003 topology (V6)
```
230 V 1φ SUPPLY (2-wire L1/L2)
   → CB1 (2-pole breaker)
   → Q1/MLC NO contacts: 13→14 (leg 1), 43→44 (leg 2)   [coil A1/A2 on E-006, driven by O-02]
   → VFD1  R/L1 , S/L2   (single-phase input; T/L3 unused)
   → VFD1  U/T1, V/T2, W/T3  → M1 (3-phase motor output)
   + PE bus
```
- OI-21 (was "separate motor contactor — none observed") is **RESOLVED**: there is no separate motor
  contactor; the **MLC control relay itself is the supply switch** (single-phase, low current).
- Q1 now appears on **both** sheets: E-003 (its two NO power contacts switch the supply) and E-006
  (its coil, driven by O-02).

## FLAGGED for confirmation — output voltage (do not letter as fact yet)
Mike reported **230 V in / 480 V out**. A standard PWM VFD (incl. the GS10) **cannot boost output above
its input** — a 230 V single-phase GS10 outputs **230 V 3-phase**; 480 V output would require a 460 V
input drive (different model) or a step-up transformer. Drawn on V6: **input = 230 V 1φ** (per
technician), **output voltage = CONFIRM** (new open item OI-27) pending the **motor nameplate voltage**
and the **exact GS10 model**. Not encoding "480 V out" as verified until confirmed — a wrong voltage on
a power print misleads a troubleshooter.

## V6 changes
1. E-003: input 3φ → **single-phase 230 V (2-wire)**; **add Q1/MLC's 2 NO contacts** in the supply
   between CB1 and the GS10 R/L1 & S/L2; 2-pole CB1; T/L3 unused.
2. Q1 role: "control relay used as the VFD **supply switch** — NO contacts 13-14 & 43-44 switch the
   230 V 1φ supply; coil A1/A2 (24 VDC) from O-02. Energizing O-02 powers the drive." On E-003 + E-006.
3. VFD1: single-phase 230 V input (R/L1, S/L2); output voltage = OI-27 (confirm; reported 480 V).
4. OI-21 resolved; OI-27 added (output voltage / drive model / motor nameplate voltage).
5. E-006 note: MLC NO contacts switch the VFD supply (shown on E-003), not "control-circuit interlock".

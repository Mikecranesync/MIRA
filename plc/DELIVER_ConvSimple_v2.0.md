# DELIVER — Prog_init **V2.0** into `Conv_Simple_1.9` (reads torque / rpm / power)

**The whole fix is one action: Build → Download.** Nothing else is missing.

## What was actually wrong (so we stop chasing ghosts)
The GS10 keypad shows real **torque 73.7 %** and **880 rpm** → the drive computes them.
They read **0** in the historian for one reason only: the program **compiled and
running on the PLC is still V1.8**, which reads only the `0x2100..0x2106` monitor
block and **never requests** `0x210B` / `0x210C` / `0x210F`. The newer read code was
edited into the `.stf` on disk but was **never Built into the project**, so the
running firmware never changed. Not wiring. Not the drive. Not a round-robin bug.

## What is ALREADY done in `Conv_Simple_1.9` (do NOT redo it)
- ✅ The **9 variables** are declared (`vfd_torque/motor_rpm/power/warn_code/freq_cmd/
  last_fault` = WORD, `lp_toggle/last_fault_clear` = BOOL). Historian confirmed
  CCW **400118–400125** read `quality: good` end-to-end on 2026-06-13.
- ✅ The **Modbus slave map** is applied (that is why those registers are exposed).
- ⛔ Do **not** re-run `build_conv_simple_1_9.py`, do **not** re-import the `.ccwmod`,
  do **not** re-declare variables. That dance is the day you already paid for — it
  succeeded. V2.0 changes **only the `Prog_init` logic** and adds **zero** variables.

## Deliver (≈2 minutes, CCW)
1. Open `C:\Users\hharp\Documents\CCW\MIRA_PLC\Conv_Simple_1.9\Conv_Simple_1.9.ccwsln`.
2. Open **`Prog_init`**. The first comment line MUST read:
   `Conv_Simple Prog_VFD -- V2.0: reads torque / rpm / power (GS10)`.
   - If it still says **V1.8** (CCW loaded a cached/binary copy), select-all in the
     `Prog_init` editor and **paste** the contents of
     `plc/Prog_init_ConvSimple_v2.0.st`. This is the single trap that has masked
     every prior flash: the editor showed old code, so Build compiled old code.
3. **Build.** Expect **0 errors**. (If "AnyArray" → a register var has a Dimension
   set; clear it. If "SHR/AND" → not used in V2.0. Neither should occur.)
4. **Download → Run.**

> The on-disk `Prog_init.stf` has already been set to V2.0 in the repo's name; the
> previous V1.8 copy is saved alongside as `Prog_init.stf.v1.8-flashed.bak` if you
> need to compare.

## Acceptance (tell Claude when it's running)
With the motor running at 30 Hz and the keypad showing torque/rpm:
1. **torque / rpm / power read NON-ZERO** in the historian (`:8766/viewer/`),
   `quality: good`, tracking the keypad.
2. **freq command vs output frequency track 1:1** — `vfd_freq_cmd` (400121) =
   `vfd_frequency` (the output, 400107) within rounding. If they are 10× apart it is
   a historian divisor, not the PLC (drive decode P09.30).

## If torque/rpm/power are STILL 0 after Download — exactly two possibilities
1. **The old V1.8 is still flashed** → the Build compiled a cached copy. Confirm the
   `Prog_init` editor shows the **V2.0** header (step 2), Build shows 0 errors, and
   the Download actually completed. Re-paste + Build + Download.
2. **The drive monitor params are unset** (only if the keypad ALSO shows 0):
   - `0x210C` rpm needs **P05.03** (rated rpm) + **P05.04** (poles)
   - `0x210B` torque needs **P00.11 = 2** (IM/PM SVC) + an **auto-tune** (P05.00)
   - `0x210F` power computes from V×I once the motor is loaded
   Mike's keypad already shows torque/rpm, so #2 is not expected — start with #1.

## After a clean flash
Export `Prog_init` → copy the `.stf` over `plc/Prog_init_ConvSimple_v2.0.st` and the
CCW project dir → commit → update `wiki/hot.md`.

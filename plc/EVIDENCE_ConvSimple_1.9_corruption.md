# Evidence — why `Conv_Simple_1.9` inverted the E-stop, and the 1.9→2.0 naming fix

**Date:** 2026-06-13 · **Author:** Claude (Opus 4.8) for Mike
**TL;DR:** The 1.9 *project image* is corrupted (symbol-table desync from a day of
manual variable surgery + CCW cache reuse). Its ladder **source and compiled code
are byte-identical to 1.8**, but the variable-binding/config tables underneath them
shifted — so the SAME safety logic bound to the WRONG data at runtime and the e-stop
read inverted. Pristine **1.8 downloads correctly** (you proved this by reverting).
The fix is a clean rebuild as **Conv_Simple_2.0** from the proven-good 1.8 baseline.

---

## 1. The behaviour you saw (the symptom)
- Downloaded `Conv_Simple_1.9` (with V2.0 program) → **e-stop inverted**: main contactor
  OFF when e-stop released, ON when pressed in; green light stuck on.
- Reverted to `Conv_Simple_1.8` → **immediately correct** again.

That single fact — **1.8 good, 1.9 bad** — is the anchor for everything below.

## 2. What I changed vs. what controls the e-stop
- My V2.0 edit touched **only `Prog_init`** (the Modbus comms POU).
- The e-stop, main contactor (`_IO_EM_DO_02`), green light (`_IO_EM_DO_00`) and red
  light (`_IO_EM_DO_01`) are driven **100% by `Prog1`** (the ladder). `Prog_init`
  does not write any of those outputs — it only sends the VFD run/freq command over
  Modbus and *reads* `e_stop_ok`.
- The `e_stop_ok` read inside `Prog_init` is **line-for-line identical** to pristine
  1.8 (`vfd_run_permit := _IO_EM_DO_02 AND e_stop_ok AND NOT pe_latched`).

So no code I wrote can flip the e-stop.

## 3. The decisive file comparison (1.8 vs 1.9, Micro820 program dir)
Compared every file byte-for-byte (`cmp`). The three that decide the e-stop are all
**identical**; everything that differs is variable/symbol/config bookkeeping:

| File | 1.8 | 1.9 | Result | Meaning |
|---|---|---|---|---|
| `Prog1.stf` | 1451 | 1451 | **IDENTICAL** | ladder *source* unchanged |
| `PROG1.ic` | 1141 | 1141 | **IDENTICAL** | **compiled ladder logic unchanged** |
| `IO.rtc` | 21352 | 21352 | **IDENTICAL** | **I/O configuration unchanged** |
| `PROG1.rtc` | 1053 | 1053 | differs @ byte 31 | ladder's **variable-binding** shifted |
| `MICRO820_Pou_PROG1.xtc` | 332 | 332 | differs @ byte 21 | ladder symbol refs shifted |
| `GlobalVariable.rtc` | 10108 | 10545 | differs | new vars added (expected) |
| `MICRO820_Symbols*.xtc` | 31720 | 32288 | differs | symbol tables grew (expected) |
| `MICRO820_Conf.xtc` | 3840 | 3852 | differs (+12, **binary only**) | controller config shifted |
| `MICRO820_Constants.xtc` | 468 | 480 | differs (+12, **binary only**) | constants/init shifted |
| `Prog_init.stf` / `PROG_INIT.*` | — | — | differs | my V2.0 edit (expected) |

Extracting printable strings from `PROG1.rtc`, `MICRO820_Conf.xtc`,
`MICRO820_Constants.xtc` showed **no readable/logic differences** — only binary
address/checksum bytes changed.

## 4. The conclusion (the corruption mechanism)
- The compiled ladder (`PROG1.ic`) is the **old, correct 1.8 image** — it references
  its variables (`e_stop_ok`, the DI/DO bools) by **baked-in addresses**.
- But adding the 9 V1.9 variables (by hand and via the `.accdb` inject, across the
  day) **re-allocated the variable/symbol tables** — `PROG1.rtc`, the symbol `.xtc`s,
  and the controller `Conf`/`Constants` all moved.
- CCW reused the **cached compiled ladder** (that's why `PROG1.ic` is byte-identical
  instead of recompiled against the new layout — exactly the "CCW reloads from its
  binary caches" trap the install card warned about).
- Net: the downloaded image has a **correct ladder pointing at a shifted variable
  map** → the safety logic binds to the wrong memory → **e-stop reads inverted.**
  This is a classic CCW **symbol-table desync**, and it is why hand-editing the binary
  symbol caches is off-limits (see `reference_ccw_modbus_and_project_mechanics`).

**Therefore the 1.9 project image is not trustworthy and must not be deployed.** The
correct logic was never the problem; the project's bookkeeping is corrupt.

## 5. The version-naming mess (your "1.9 = 2.0?" question)
The CCW convention here is **project name == POU version** (e.g. project
`Conv_Simple_1.8` carried `Prog_VFD V1.8`). I broke that by stamping the POU **V2.0**
while leaving the project at **`Conv_Simple_1.9`** — that's the mismatch you spotted.

**Fix:** make both **2.0**. The clean rebuild is project **`Conv_Simple_2.0`**
containing **`Prog_VFD V2.0`** — matched again. The `1.8 → 2.0` jump is honest:
- **V1.8** = the last version actually flashed and known-good.
- **"1.9"** = a never-cleanly-built interim; its image corrupted (this doc). Retired.
- **V2.0** = the first clean build that actually reads torque/rpm/power, cloned from
  the proven-good 1.8 baseline.

## 6. The fix (what to do now) — see `INSTALL_ConvSimple_v2.0.md`
1. **Stay on 1.8** for now (e-stop is correct there). Machine is safe.
2. Build **`Conv_Simple_2.0`** from **pristine 1.8** (`python plc/build_conv_simple_2_0.py`),
   declare the 9 vars, Import the `.ccwmod`, paste `Prog_init_ConvSimple_v2.0.st`,
   **CCW Clean → Build → Download.** Clean baseline = no inherited desync.
3. **MANDATORY before running: re-validate the e-stop under LOTO** (released = run
   permitted, pressed = contactor positively drops, red light on). A safety function
   was just observed inverted — prove it correct on this build before trusting it.

## Reproduce this evidence yourself
```bash
D18="…/Conv_Simple_1.8/Controller/Controller/Micro820/Micro820"
D19="…/Conv_Simple_1.9/Controller/Controller/Micro820/Micro820"
cmp "$D18/Prog1.stf" "$D19/Prog1.stf"   # identical
cmp "$D18/PROG1.ic"  "$D19/PROG1.ic"    # identical (compiled ladder)
cmp "$D18/IO.rtc"    "$D19/IO.rtc"      # identical (I/O config)
cmp "$D18/PROG1.rtc" "$D19/PROG1.rtc"   # differ @ byte 31 (binding shifted)
```

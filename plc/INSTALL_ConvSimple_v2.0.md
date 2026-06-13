# INSTALL — Conv_Simple_2.0 / Prog_VFD V2.0 (reads torque / rpm / power)

**Why this exists:** the `Conv_Simple_1.9` image corrupted (symbol-table desync —
its ladder source + compiled code are identical to 1.8 but the variable bindings
shifted, which **inverted the e-stop** on download). Pristine 1.8 is good. V2.0 is a
**clean rebuild from 1.8** that adds torque/rpm/power and fixes the version naming
(project `Conv_Simple_2.0` == POU `Prog_VFD V2.0`). Evidence:
`EVIDENCE_ConvSimple_1.9_corruption.md`.

> 🔴 **SAFETY GATE (non-negotiable, both paths below):** a safety function (the
> e-stop) was just observed inverted. Before ANY run after a download, **lock out /
> de-energize**, then physically verify the e-stop: **released → contactor can run;
> pressed → contactor positively DROPS; red light on.** Do not return the machine to
> service until this passes on the image you actually downloaded. Leave the GS10
> control disabled (`vfd_ctrl_enable = FALSE`) until then.

You are safe right now on 1.8. Take the clean path without time pressure.

---

## PATH A — clean rebuild as Conv_Simple_2.0 (recommended)

Builds on the proven-good 1.8 baseline, so the e-stop/I-O config is the trustworthy
one. Costs re-declaring the 9 vars + importing the map once — but it is the only path
that does NOT inherit the 1.9 corruption.

1. **Close CCW.** Run the builder (clones pristine 1.8 → Conv_Simple_2.0, stages the
   apply kit):
   ```
   python plc/build_conv_simple_2_0.py --dry-run     # review
   python plc/build_conv_simple_2_0.py               # build
   ```
2. Open `Conv_Simple_2.0\Conv_Simple_2.0.ccwsln`.
3. **Declare the 8 variables** in Global Variables (the apply kit's
   `CCW_VARIABLES_ConvSimple_v2.0_DELTA.md` is the checklist — the register map is
   unchanged for 2.0). **8, not 9:** V2.0 dropped `read_sel` (the v1.9 delta lists 9
   incl. `read_sel` — ignore that file for 2.0). Fastest + safest: **clone an existing
   row** so the type is guaranteed:
   - clone `vfd_status_word` (WORD) → rename to each of:
     `vfd_warn_code`, `vfd_freq_cmd`, `vfd_torque`, `vfd_motor_rpm`, `vfd_power`,
     `vfd_last_fault`
   - clone `poll_phase` (BOOL) → rename to: `lp_toggle`, `last_fault_clear`
   - **Every register var's Dimension MUST be blank** (a dimension → `AnyArray` build
     error). Do **not** add `read_sel` (V2.0 doesn't use it).
4. **Import the Modbus map** — Device Config → **Modbus Mapping** → **Import** →
   `_V2.0_APPLY\Modbus_ConvSimple_v1.9.ccwmod`. (Vars must exist first, or the
   ISaGRAF post-build throws "undeclared variable".)
5. **Paste the program** — open `Prog_init`, select-all, paste
   `_V2.0_APPLY\Prog_init_ConvSimple_v2.0.st`. Confirm the header reads
   **`Conv_Simple_2.0  Prog_VFD V2.0`**.
6. **Build → Clean** then **Build** (Clean first so no stale compiled ladder is
   reused — stale-cache reuse is exactly what corrupted 1.9). Expect **0 errors**.
7. **Download → Run.**
8. 🔴 **Re-validate the e-stop under LOTO (safety gate above) BEFORE trusting it.**

## PATH B — in-place repair of the existing 1.9 (faster, keeps your vars)

Only if you want to avoid re-declaring vars. The 1.9 corruption looks like a stale
compiled ladder over a shifted variable map, which a full Clean+Rebuild can resolve —
**but you must prove the e-stop afterward**, because this reuses the suspect project.

1. Open `Conv_Simple_1.9`. Confirm `Prog_init` shows the V2.0 program (paste
   `Prog_init_ConvSimple_v2.0.st` if it shows old code).
2. **Build → Clean Project** (delete all compiled artifacts), then **Build** (full).
   This forces the ladder to recompile against the *current* variable layout —
   resolving the desync if that's all it was.
3. **Download → Run.**
4. 🔴 **Re-validate the e-stop under LOTO.**
   - **PASS** → the desync is cleared; you kept your vars. (Optionally rename the
     project to 2.0 later for naming sanity.)
   - **FAIL** → do not chase it further. Use **Path A** (clean from 1.8).

## Acceptance (after the safety gate passes — tell Claude)
With the motor running at 30 Hz and the keypad showing torque/rpm:
1. **torque / rpm / power read NON-ZERO** in the historian (`:8766/viewer/`),
   `quality: good`, tracking the keypad.
2. **freq command vs output frequency track 1:1** (`vfd_freq_cmd` 400121 vs
   `vfd_frequency`). 10× off → historian divisor, not the PLC.

## If torque/rpm/power are still 0 (after a clean flash + good e-stop)
Only two causes:
1. The new program didn't actually compile/download (confirm V2.0 header, Clean done,
   0 errors, download completed).
2. Drive monitor params unset (only if the keypad also shows 0): `0x210C` rpm needs
   P05.03+P05.04; `0x210B` torque needs P00.11=2 (SVC) + auto-tune (P05.00); `0x210F`
   power needs the motor loaded. Your keypad shows them, so this isn't expected.

## After a clean, e-stop-validated flash
Export `Prog_init` → copy the `.stf` over `plc/Prog_init_ConvSimple_v2.0.st` and the
CCW dir → commit → update `wiki/hot.md`.

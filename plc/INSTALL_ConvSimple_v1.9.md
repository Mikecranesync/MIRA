# INSTALL — Conv_Simple_1.9 (Trends V2, full GS10 monitoring)

The `BUILD_CONV_SIMPLE_1.9.cmd` builder produced this `Conv_Simple_1.9` clone and
**pre-applied as much as is safely possible**:

- ✅ Clean clone of `1.8` (1.8 untouched — your fallback).
- ✅ V1.9 **Modbus slave map baked** into `MbSrvConf.xml` (CCW reads it on open).
- ✅ **Pre-injected** into the project database (`PrjLibrary.accdb`): the 9 new
  V1.9 variables, and the V1.9 program written to `Prog_init.stf`.

## Best case — open → Build → Download

1. (one-time, if not already set) GS10 `P09.09 = 10.0 ms`.
2. Open `Conv_Simple_1.9\Conv_Simple_1.9.ccwsln` in CCW.
3. Check `Prog_init` shows the V1.9 code and the Global Variables list includes
   `vfd_torque`, `vfd_motor_rpm`, `vfd_power`, `vfd_warn_code`, `vfd_freq_cmd`,
   `vfd_last_fault`, `read_sel`, `lp_toggle`, `last_fault_clear`.
4. **Build → Download → Run.** Done.

Build + Download can't be skipped — no PLC runs new logic without compiling and
transferring it. That's the floor; everything above it is pre-done.

## If CCW shows MISSING VARIABLES or the OLD program

Then your CCW build reloads from its binary caches instead of the project DB, so
the pre-inject didn't take. No harm — fall back to the manual path:

1. Restore the clean clone: `python build_conv_simple_1_9.py --force`
   (rebuilds 1.9 from pristine 1.8 with only the slave map baked).
2. **Variables** — Right-click the Micro820 → **Variable Export/Import → Export**
   (this reveals your CCW's exact CSV columns). In the CSV, add 9 rows using
   `_V1.9_APPLY/vars_ConvSimple_v1.9.csv` as the checklist — the
   `CLONE_FROM_EXISTING_ROW` column says which existing row to duplicate-and-rename
   (the 7 UINTs clone `vfd_status_word`; the 2 BOOLs clone `poll_phase`). Then
   **Variable Export/Import → Import**.
   (`vfd_status_word` and `vfd_fault_code` already exist — don't re-add.)
3. **Program** — open `Prog_init`, select all, paste
   `_V1.9_APPLY/Prog_init_ConvSimple_v1.9.st`.
4. **Build → Download → Run.**

Build notes: if CCW flags `SHR(...)` → `SHR(IN := read_data[1], N := 8)`. If it
flags UDINT→UINT narrowing on a `vfd_*` var, declare it `UDINT` — no `ANY_TO_*`
cast (that caused err 0124 before).

## Verify (tell Claude when it's running)
Claude restarts the historian and confirms the 8 new tags read `quality: good`,
then the acceptance check: **freq command vs output frequency must track 1:1** on
the trend (if 10× off → drive decoding method P09.30, a historian-divisor fix).

## How V1.9 polls
One Modbus message per 500 ms tick on the shared RS-485 port. The motor **write is
unchanged (~1 Hz)**. A single read FB is reconfigured per tick (Option C tiered
polling): the monitor block (faults + freq/current/DC-bus) gets 2 of every 3 read
ticks (~1.5 s); torque/rpm and power each refresh ~6 s. `Addr = wire + 1`
(bench-proven AB off-by-one).

After a clean flash: export `Prog_init`, copy its `.stf` to both `plc/` and the
CCW project dir, then tell Claude to commit + update the wiki.

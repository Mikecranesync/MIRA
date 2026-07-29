# INSTALL — Conv_Simple_2.1 / Prog_VFD V2.1 (program baked in)

**What V2.1 is:** the exact V2.0 read logic (torque / rpm / power via two alternating
half-blocks), but the program is **already written into the project** by
`build_conv_simple_2_1.py`. You do **not** paste it. V2.1 exists because the 2.0
manual-paste step got skipped — the bare 1.8 clone got downloaded and the new
registers stayed `no_data`. Baking the program removes that whole failure mode.

> 🔴 **SAFETY GATE (non-negotiable):** a safety function (the e-stop) was observed
> inverted on the corrupted 1.9 image. This 2.1 clone is built from PROVEN-GOOD 1.8
> (correct e-stop, confirmed live 2026-06-13). Still — after ANY download, **lock
> out / de-energize**, then physically verify: **e-stop released → contactor can
> run; pressed → contactor positively DROPS, red light on.** Keep
> `vfd_ctrl_enable = FALSE` until it passes.

## Build it (CCW closed)
```
python plc/build_conv_simple_2_1.py --dry-run     # review
python plc/build_conv_simple_2_1.py               # clone + bake + stage
```
This prints the 8-variable list and leaves the program already in `Prog_init`.

## Your steps in CCW (only 3 — no paste)
1. **Open** `Conv_Simple_2.1\Conv_Simple_2.1.ccwsln`. `Prog_init` already reads
   **`Conv_Simple_2.1  Prog_VFD V2.1`** (it's baked in — confirm the header, but you
   don't paste anything).
2. **Declare the 8 variables** — clone a row (see
   `_V2.1_APPLY\CCW_VARIABLES_ConvSimple_v2.1_DELTA.md`):
   - clone `vfd_status_word` (WORD) → `vfd_warn_code`, `vfd_freq_cmd`, `vfd_torque`,
     `vfd_motor_rpm`, `vfd_power`, `vfd_last_fault`
   - clone `poll_phase` (BOOL) → `lp_toggle`, `last_fault_clear`
   - **no `read_sel`**, every **Dimension blank**.
3. **Import the Modbus map** — Device Config → Modbus Mapping → **Import** →
   `_V2.1_APPLY\Modbus_ConvSimple_v1.9.ccwmod`. (Vars must exist first.)
4. **Build → Clean**, then **Build** (0 errors) → **Download**.

> If `Prog_init` somehow shows the old V1.8 body when you open it (CCW cached an old
> copy), select-all and paste `_V2.1_APPLY\Prog_init_ConvSimple_v2.1.st` — but on a
> fresh clone it should already be V2.1.

## Then
- 🔴 Re-validate the e-stop under LOTO (gate above).
- Run the motor at 30 Hz.
- `python plc/conv_simple_anomaly/live_capture.py --seconds 60` — the 400118–125
  block (incl. `vfd_torque_pct` / `vfd_motor_rpm` / `vfd_power_kw`) should go LIVE.

## Acceptance
1. torque / rpm / power read **NON-ZERO** at `quality: good` in the historian.
2. `vfd_freq_cmd` (400121) vs `vfd_frequency` (0x2103) track **1:1**. (10× off → a
   historian divisor, not the PLC.)
`python plc/conv_simple_anomaly/verify_v2_telemetry.py` checks both.

## After a clean, e-stop-validated flash
Export `Prog_init` → copy the `.stf` over `plc/Prog_init_ConvSimple_v2.1.st` and the
CCW dir → commit → update `wiki/hot.md`.

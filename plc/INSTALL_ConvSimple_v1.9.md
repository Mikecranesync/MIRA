# INSTALL — Conv_Simple_1.9 (Trends V2, full GS10 monitoring)

The `build_conv_simple_1_9.py` builder already did everything that's safe to
automate. This card is the **remaining work inside CCW** — kept to the minimum
because CCW stores the program and variables in binary files that can't be
hand-authored from outside.

## Already done for you (by the builder)
- ✅ `Conv_Simple_1.9` is a clean clone of `1.8` (1.8 untouched — your fallback).
- ✅ The **V1.9 Modbus slave map is baked in** (`MbSrvConf.xml`). CCW reads it on
  open — no action needed. Original saved as `MbSrvConf.xml.pre_v1_9.bak`.
- ✅ This kit (`_V1.9_APPLY/`) holds the program + variable templates.

## What's left — 3 actions in CCW (CCW must be CLOSED elsewhere first)

### 0. Drive params (one-time, if not already set)
GS10 over RS-485 needs `P09.09 = 10.0 ms` (default 2.0 ms causes ErrorID-55
cycling). The other comm params (P09.00=1, P09.01=96, P09.04=12 / 8N1) are
already set on this bench.

### 1. Open the project
Open `Conv_Simple_1.9\Conv_Simple_1.9.ccwsln` in CCW.

### 2. Add the 17 new variables  (the reliable, format-proof way)
The new variables are the **same types** as ones you already have, so we clone
your own rows instead of guessing CCW's CSV columns:

1. Right-click the **Micro820 controller** → **Variable Export/Import** →
   **Export** → save as e.g. `vars_export.csv`.
2. Open that CSV in Excel. It now shows CCW's exact column layout for *your*
   version, including how it writes `MSG_MODBUS`, `MODBUSLOCPARA`,
   `MODBUSTARPARA`, and `ARRAY[1..10] OF UDINT`.
3. Add 17 rows, using `_V1.9_APPLY/vars_ConvSimple_v1.9.csv` as the checklist.
   The `CLONE_FROM_EXISTING_ROW` column tells you which of your existing rows to
   duplicate-and-rename for each:
   - `vfd_warn_code, vfd_freq_cmd, vfd_torque, vfd_motor_rpm, vfd_power,
     vfd_last_fault` → copy the **`vfd_status_word`** row, rename (all UINT).
   - `last_fault_clear`, `lp_toggle` → copy any **BOOL** row. `read_sel` → any **INT** row.
   - `mb_read_load, mb_read_power` → copy the **`mb_read_status`** row (MSG_MODBUS).
   - `read_load_cfg, read_power_cfg` → copy **`read_local_cfg`** (MODBUSLOCPARA).
   - `read_load_tgt, read_power_tgt` → copy **`read_target_cfg`** (MODBUSTARPARA).
   - `read_load_data, read_power_data` → copy **`read_data`** (ARRAY[1..10] OF UDINT).
4. Save, then **Variable Export/Import → Import** → pick your edited CSV.

> `vfd_status_word` and `vfd_fault_code` already exist — do not re-add them.
> (You can try importing `vars_ConvSimple_v1.9.csv` directly first; if CCW
>  rejects the columns, use the export-clone method above — it always matches.)

### 3. Replace the Prog_init program
Open the **`Prog_init`** program (NOT Prog1 — that's the ladder, leave it),
select all, and paste the contents of `_V1.9_APPLY/Prog_init_ConvSimple_v1.9.st`.

Then **Build**. Expect 0 errors. If CCW flags:
- `SHR(...)` signature → use `SHR(IN := read_data[1], N := 8)`.
- UDINT→UINT narrowing on a `vfd_*` var → declare that var `UDINT` (match
  `read_data`); do **not** add an `ANY_TO_*` cast (that caused err 0124 before).

### 4. Download & run
**Connect → Download → set to Run.**

## Verify (tell Claude when it's running)
Claude restarts the historian and confirms the 8 new tags read `quality: good`,
then the acceptance check: **freq command vs output frequency must track 1:1**
on the trend (if 10× off, it's drive decoding method P09.30 — a historian
divisor fix, not the ladder).

## How V1.9 behaves on the bus
One Modbus message per 500 ms tick on the shared RS-485 port. The **motor write
is unchanged (~1 Hz)**. Reads rotate (Option C tiered polling): the monitor
block (faults + freq/current/DC-bus) gets 2 of every 3 read-ticks (~1.5 s);
torque/rpm and power each refresh ~6 s. Addressing keeps the bench-proven
`Addr = wire + 1` rule.

After a clean flash: export `Prog_init`, copy its `.stf` to both `plc/` and the
CCW project dir (standing rule), and tell Claude to commit + update the wiki.

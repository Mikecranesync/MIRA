# CCW Variables Delta — Conv_Simple_2.0 `Prog_VFD V2.0` (8 NEW scalars)

> **Use THIS file for the 2.0 clean rebuild — not the v1.9 delta.** The v1.9 delta
> (`CCW_VARIABLES_ConvSimple_v1.9_DELTA.md`) lists **9** vars including `read_sel`
> (UINT). **V2.0 dropped `read_sel`** (it alternates two fixed half-blocks via
> `lp_toggle`, no 0..2 selector). V2.0 needs **8** vars. Declaring `read_sel` in 2.0
> is harmless but pointless — leave it out.

## Two version numbers (don't conflate)
- **`Conv_Simple_2.0`** = the CCW **project** (clean clone of the proven-good 1.8).
- **`Prog_VFD V2.0`** = the comms **POU's** own version. In 2.0 the project name and
  the POU version finally match. Apply `Prog_init_ConvSimple_v2.0.st`.

## V2.0 design — one read FB, reconfigured (so only 8 NEW scalars)
V2.0 **reuses** the existing `mb_read_status` FB + `read_local_cfg` /
`read_target_cfg` / `read_data` buffer, just changing `.Addr` / `.ElementCnt` per
read tick (the same reconfigure-every-scan style the write path already uses). No new
function-block instances, structs, or arrays — only 8 simple scalars:

| Name | Type | Dimension | clone of | HR (Modbus) |
|---|---|---|---|---|
| `vfd_warn_code` | `WORD` | *(blank)* | `vfd_status_word` | 400120 (reserved) |
| `vfd_freq_cmd` | `WORD` | *(blank)* | `vfd_status_word` | 400121 |
| `vfd_torque` | `WORD` | *(blank)* | `vfd_status_word` | 400122 |
| `vfd_motor_rpm` | `WORD` | *(blank)* | `vfd_status_word` | 400123 |
| `vfd_power` | `WORD` | *(blank)* | `vfd_status_word` | 400124 |
| `vfd_last_fault` | `WORD` | *(blank)* | `vfd_status_word` | 400125 |
| `lp_toggle` | `BOOL` | *(blank)* | `poll_phase` | — (internal) |
| `last_fault_clear` | `BOOL` | *(blank)* | `poll_phase` | coil 000024 |

`vfd_fault_code` and `vfd_status_word` already exist (V1.x baseline) — **reused.**

> ⚠️ **The 6 `vfd_*` register vars are `WORD`, not `UINT`.** The live `vfd_status_word`
> / `vfd_fault_code` rows are CCW type WORD and `read_data[n]` assigns straight into
> them. Cloning the `vfd_status_word` row guarantees the type.
>
> ⚠️ **Dimension MUST be blank — these are SCALARS, not arrays.** Each binds to a
> single holding register in `Modbus_ConvSimple_v1.9.ccwmod` (`DataTypeSize="2"`). A
> non-empty Dimension makes CCW declare `ARRAY[..] OF WORD`, report the type as
> **`AnyArray`**, and Build fails: *"Data type of variable X:AnyArray does not match
> with current mapping item: Word"*. Leave Dimension empty.

## How to declare them (Path A — by hand in CCW; this is the clean/safe path)
**V2.0 does NOT pre-inject vars.** Unlike the 1.9 path (`inject_vars_accdb.py` wrote
rows straight into `PrjLibrary.accdb`), the 2.0 rebuild declares the 8 vars **in the
CCW GUI by cloning an existing row.** Direct-to-`.accdb` symbol injection is what
desynced the 1.9 symbol table and **inverted the e-stop** — so for 2.0 we keep CCW as
the single writer of the symbol table.

In **Global Variables** (clone the row — copy/paste the row, or add a new row and set
the same Type — whichever your CCW build offers; the point is type + blank Dimension
come from the template, not hand-typed):
1. Clone `vfd_status_word` (WORD) → 6 copies, renamed:
   `vfd_warn_code`, `vfd_freq_cmd`, `vfd_torque`, `vfd_motor_rpm`, `vfd_power`,
   `vfd_last_fault`. (Cloning guarantees `WORD` + blank Dimension.)
2. Clone `poll_phase` (BOOL) → 2 copies, renamed: `lp_toggle`, `last_fault_clear`.
3. Confirm all 8 rows show the right **Type** and a **blank Dimension**. Do **not**
   add `read_sel`.

## Compiler notes (V2.0)
- The reads are plain assigns from `read_data[n]` (UDINT) into the WORD register vars —
  no casts. V2.0 does **not** byte-split the fault word (Micro800 ST `AND`/`SHR` need
  bit-string operands; `read_data` is UDINT), so `vfd_warn_code` stays reserved (0).
- `vfd_freq_cmd := vfd_freq_sp;` — same scale (x100; 3000 = 30.00 Hz). If Build flags a
  type mismatch here, `vfd_freq_sp` isn't WORD — match the type; never add `ANY_TO_*`
  (err 0124).

## Acceptance (after the e-stop gate passes)
Motor at 30 Hz, keypad showing torque/rpm:
1. `vfd_torque` / `vfd_motor_rpm` / `vfd_power` read **NON-ZERO** in the historian
   (`:8766/viewer/`), `quality: good`, tracking the keypad.
2. `vfd_freq_cmd` (400121) vs `vfd_frequency` (0x2103) track **1:1**. 10× off → a
   historian divisor, not the PLC.

After a clean, e-stop-validated flash: export `Prog_init` → copy `.stf` over
`plc/Prog_init_ConvSimple_v2.0.st` and the CCW dir → commit → update `wiki/hot.md`.

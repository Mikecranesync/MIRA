# CCW Variables Delta — Conv_Simple_1.8 `Prog_init` V1.8 → V1.9 (Trends V2)

## Two version numbers (don't conflate)
- **`Conv_Simple_1.8`** = the CCW **project** loaded on the PLC.
- **`Prog_init` V1.8 → V1.9** = the comms **POU's** own version (this delta).

The repo files `plc/Prog2.stf` / `plc/Micro820_v4.1.9_Program.st` are a dead pre-1.8
"Prog2" lineage on **Channel 0** — never used here. The live machine is **Prog1**
(ladder) + **Prog_init** (ST comms, **Channel 2**). Apply
`plc/Prog_init_ConvSimple_v1.9.st`.

## V1.9 design — one read FB, reconfigured (so only 9 NEW scalars)
V1.9 **reuses** the existing `mb_read_status` FB + `read_local_cfg` /
`read_target_cfg` / `read_data` buffer, just changing `.Addr` / `.ElementCnt` per
poll (the same reconfigure-every-scan style the write path already uses). That means
**no new function-block instances, structs, or arrays** — the only new globals are 9
simple scalars:

| Name | Type | Dimension | clone of |
|---|---|---|---|
| `read_sel` | `UINT` | *(blank)* | `vfd_status_word` |
| `vfd_warn_code` | `WORD` | *(blank)* | `vfd_status_word` |
| `vfd_freq_cmd` | `WORD` | *(blank)* | `vfd_status_word` |
| `vfd_torque` | `WORD` | *(blank)* | `vfd_status_word` |
| `vfd_motor_rpm` | `WORD` | *(blank)* | `vfd_status_word` |
| `vfd_power` | `WORD` | *(blank)* | `vfd_status_word` |
| `vfd_last_fault` | `WORD` | *(blank)* | `vfd_status_word` |
| `lp_toggle` | `BOOL` | *(blank)* | `poll_phase` |
| `last_fault_clear` | `BOOL` | *(blank)* | `poll_phase` |

`vfd_fault_code` and `vfd_status_word` already exist (V1.x) — **reused.**

> ⚠️ **The 6 `vfd_*` register vars are `WORD`, not `UINT`** (corrected in commit
> `9141f195` — the live `vfd_status_word` / `vfd_fault_code` rows are CCW type WORD, and
> `read_data[n]` assigns straight into them). `read_sel` is `UINT` (a 0..2 counter).
>
> ⚠️ **Dimension MUST be blank — these are SCALARS, not arrays.** Each is bound to a single
> holding register in `Modbus_ConvSimple_v1.9.ccwmod` (`DataTypeSize="2"`). If you put a
> dimension (e.g. `1..125`) in the CCW variable table, CCW declares an `ARRAY[..] OF WORD`,
> reports its type as **`AnyArray`**, and Build fails with *"Data type of variable
> X:AnyArray does not match with current mapping item: Word"*. Leave Dimension empty.

## You normally don't declare these by hand
`BUILD_CONV_SIMPLE_1.9.cmd` runs `inject_vars_accdb.py`, which clones the
`vfd_status_word` / `poll_phase` rows in the project DB (`PrjLibrary.accdb`) to
create all 9, and writes the V1.9 program into `Prog_init.stf`. So the intended flow
is **open → Build → Download**. This table is the **manual fallback** for if CCW
doesn't honor the pre-inject (see `INSTALL_ConvSimple_v1.9.md`): export your vars,
clone these rows, import.

## Compiler notes
- `vfd_fault_code := read_data[1] AND 16#00FF;`,
  `vfd_warn_code := SHR(read_data[1], 8) AND 16#00FF;` — plain assigns, no casts.
- `SHR` signature complaint → `SHR(IN := read_data[1], N := 8)`.
- UDINT→UINT narrowing complaint on a `vfd_*` var → declare it `UDINT` (match
  `read_data`); never add `ANY_TO_*` (err 0124).

## V1.9 behavior
One Modbus msg per 500 ms tick; motor write unchanged (~1 Hz). Monitor block on 2 of
3 read ticks (~1.5 s); torque/rpm + power each ~6 s (Option C tiered polling).
`Addr = wire + 1` off-by-one (bench-proven). New reads: load `0x210B`×2 (torque/rpm),
power `0x210F`×1. This is the same flash that wakes dormant A2/A12 anomaly signals.

After a clean flash: export `Prog_init` → copy `.stf` to `plc/` and the CCW dir →
commit → update `wiki/hot.md`.

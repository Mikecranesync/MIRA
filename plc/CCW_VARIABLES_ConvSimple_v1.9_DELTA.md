# CCW Variables Delta — Conv_Simple_1.8 `Prog_init` V1.8 → V1.9 (Trends V2)

## Naming, so nobody gets confused again

There are two unrelated version numbers in this project. Keep them straight:

- **`Conv_Simple_1.8`** — the **CCW project** (the thing loaded on the PLC). Iterated
  1.4 → … → 1.8.
- **`Prog_init` V1.8 → V1.9** — the **comms POU's** own version, stamped in its header.
  V1.9 is what this delta produces.

The repo files `plc/Prog2.stf` and `plc/Micro820_v4.1.9_Program.st` are a **dead
pre-1.8 lineage** — a single monolithic "Prog2" ST program on **Channel 0**. They were
**never** what runs here and must not be used as a base. The live machine is
**Prog1** (ladder I/O, 61 lines) + **Prog_init** (ST comms, Channel 2). This delta
extends the live `Prog_init` in place. Apply `plc/Prog_init_ConvSimple_v1.9.st`.

## New globals to declare (CCW → Controller → Global Variables)

Match the TYPES of the existing read block exactly — `Prog_init` already declares
`read_local_cfg : MODBUSLOCPARA`, `read_target_cfg : MODBUSTARPARA`,
`read_data : ARRAY[1..10] OF UDINT`, `mb_read_status : MSG_MODBUS`. Clone those types.

| Name | Type |
|---|---|
| `read_sel` | `INT` |
| `lp_toggle` | `BOOL` |
| `mb_read_load` | `MSG_MODBUS` |
| `read_load_cfg` | `MODBUSLOCPARA` |
| `read_load_tgt` | `MODBUSTARPARA` |
| `read_load_data` | `ARRAY[1..10] OF UDINT` |
| `mb_read_power` | `MSG_MODBUS` |
| `read_power_cfg` | `MODBUSLOCPARA` |
| `read_power_tgt` | `MODBUSTARPARA` |
| `read_power_data` | `ARRAY[1..10] OF UDINT` |
| `vfd_warn_code` | `UINT` |
| `vfd_freq_cmd` | `UINT` |
| `vfd_torque` | `UINT` |
| `vfd_motor_rpm` | `UINT` |
| `vfd_power` | `UINT` |
| `vfd_last_fault` | `UINT` |
| `last_fault_clear` | `BOOL` |

`vfd_fault_code` and `vfd_status_word` already exist (V1.x) — **reused, not re-added.**

## Compiler note — match the no-cast style

V1.8 assigns `read_data[n]` (UDINT) into the `vfd_*` globals **plainly** (no
`ANY_TO_*`); a 32-bit cast caused err 0124 before. The byte-split keeps that style:
`vfd_fault_code := read_data[1] AND 16#00FF;` and
`vfd_warn_code := SHR(read_data[1], 8) AND 16#00FF;`.
If CCW flags `SHR`'s signature, use named args `SHR(IN := read_data[1], N := 8)`, or
the divide form `(read_data[1] / 256) AND 16#00FF`. If CCW flags UDINT→UINT narrowing
on any of the new vars, declare that var as **UDINT** to match `read_data` — do **not**
add an `ANY_TO_*` cast.

## What V1.9 changes (intent)

1. Split `0x2100` into `vfd_fault_code` (low byte) + `vfd_warn_code` (high byte).
2. Capture the `0x2102` freq-command echo → `vfd_freq_cmd`.
3. Latch `vfd_last_fault` (cleared only by `last_fault_clear`, Modbus coil 000024).
4. Two new interleaved reads — load `0x210B..0x210C` (torque, rpm) and power `0x210F`
   — on the **Option C** rotation: monitor block keeps 2 of every 3 read-ticks
   (~1.5 s), torque & power each ~6 s. Writes (motor command) are **unchanged** (~1 Hz).
   Addressing keeps the bench-proven **Addr = wire + 1** rule (load `Addr 16#210C` →
   wire `0x210B`; power `Addr 16#2110` → wire `0x210F`).

## Deploy sequence (Mike, on the PLC laptop)

1. **Stop the historian** (`trend_historian.py`) — sole-poller rule, frees the COM port.
   (Claude can do this; restart it in step 5.)
2. **Close CCW completely.** Then run, from the repo root:
   `python plc/deploy_modbus_map.py --project "C:/Users/hharp/Documents/CCW/MIRA_PLC/Conv_Simple_1.8" --dry-run`
   then again without `--dry-run`. It backs up the existing `MbSrvConf.xml` first.
3. **Open CCW → Conv_Simple_1.8 → Global Variables.** Declare the 17 new vars above.
4. **Open `Prog_init`**, select all, paste `plc/Prog_init_ConvSimple_v1.9.st`.
   **Build → expect 0 errors.** (Prog1 ladder is untouched.)
5. **Connect → Download → Run.** Then Claude restarts the historian and checks
   `curl "http://127.0.0.1:8766/trends/summary?window=30"` lists `vfd_status_word`,
   `vfd_error_code`, `vfd_warn_code`, `vfd_freq_cmd`, `vfd_torque_pct`, `vfd_motor_rpm`,
   `vfd_power_kw`, `vfd_last_fault` with `quality: good`.
6. **Scale check (plan acceptance):** on the trend, **freq command vs output frequency
   must track 1:1**. If freq reads are 10× off, the drive is on decoding method 2
   (P09.30) — fix is the historian divisor, not the ladder.
7. **Lock it in:** export `Prog_init`, copy its `.stf` to both `plc/` and the CCW
   project dir (standing rule), commit, update `wiki/hot.md`.

This same flash wakes the dormant A2/A12 anomaly signals
(see `project_conv_simple_anomaly` + `plc/conv_simple_anomaly/README.md`).

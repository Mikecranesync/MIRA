# CCW Variables to Map — Conv_Simple_2.1 `Prog_VFD V2.1` (8 scalars)

> **The program is already baked into this clone.** You do NOT paste it. The ONLY
> authoring step left is declaring these 8 variables, then Importing the `.ccwmod`
> map. (The 8 globals live in the symbol table, which CCW must write — so they are
> declared by hand, not injected.)

## The 8 variables (clone a row so type + blank Dimension are guaranteed)

| Variable | Type | clone of | Modbus HR |
|---|---|---|---|
| `vfd_warn_code` | `WORD` | `vfd_status_word` | 400120 (reserved) |
| `vfd_freq_cmd` | `WORD` | `vfd_status_word` | 400121 |
| `vfd_torque` | `WORD` | `vfd_status_word` | 400122 |
| `vfd_motor_rpm` | `WORD` | `vfd_status_word` | 400123 |
| `vfd_power` | `WORD` | `vfd_status_word` | 400124 |
| `vfd_last_fault` | `WORD` | `vfd_status_word` | 400125 |
| `lp_toggle` | `BOOL` | `poll_phase` | — (internal, not mapped) |
| `last_fault_clear` | `BOOL` | `poll_phase` | coil 000024 |

`vfd_status_word` and `vfd_fault_code` already exist in the 1.8 baseline (mapped at
400118/400119) — **reused, do not re-declare.** `read_sel` is **v1.9-only** — do NOT
add it; V2.1 alternates two fixed half-blocks via `lp_toggle`.

## How to declare them (Global Variables)
1. Clone `vfd_status_word` (WORD) → 6 copies, rename to the 6 WORD vars above.
2. Clone `poll_phase` (BOOL) → 2 copies, rename to `lp_toggle`, `last_fault_clear`.
3. Confirm all 8 show the right **Type** and a **blank Dimension**.

> ⚠️ **Dimension MUST be blank.** A non-empty Dimension makes CCW declare
> `ARRAY[..] OF WORD`, report the type as **`AnyArray`**, and Build fails:
> *"Data type of variable X:AnyArray does not match with current mapping item: Word"*.

## Then
- Device Config → **Modbus Mapping** → **Import** → `Modbus_ConvSimple_v1.9.ccwmod`
  (the vars must exist first, or the import reports "variable does not exist").
- **Build → Clean, then Build** (0 errors) → **Download**.
- 🔴 Validate the e-stop under LOTO before running. Then 30 Hz + `live_capture.py`.

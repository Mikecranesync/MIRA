# CCW Variables Delta — v5.0.0 → v5.1.0 (Trends V2)

New globals to declare in the CCW Controller Variables table (PrjLibrary.accdb) before
pasting `Micro820_v5.1.0_Program.st` into Prog2. Base project: **Conv_Simple_1.8**
(the deployed v5.0.0). Do NOT add a VAR block in the ST — CCW wants them in the table.

## Already declared (verify, don't re-add)

These exist in Conv_Simple_1.8 (confirmed via the project symbol table) and v5.1.0
starts writing them:

| Name | Type | Note |
|---|---|---|
| `vfd_status_word` | Word | declared by an earlier build; never written until now |
| `vfd_fault_code` | Word | the red-light term `vfd_fault_code > 0` finally gets data |

## New variables

| Name | Type | Init | Purpose |
|---|---|---|---|
| `vfd_warn_code` | Word | (none) | GS10 0x2100 high byte (active warning ID) |
| `vfd_freq_cmd` | Word | (none) | GS10 0x2102 commanded frequency |
| `vfd_torque` | Word | (none) | GS10 0x210B output torque (% ×10) |
| `vfd_motor_rpm` | Word | (none) | GS10 0x210C actual shaft speed (rpm) |
| `vfd_power` | Word | (none) | GS10 0x210F output power (kW ×1000) |
| `vfd_last_fault` | Word | (none) | PLC-latched last nonzero fault code |
| `last_fault_clear` | Bool | (none) | operator clear for the latch (Modbus coil C24) |
| `read_load_local_cfg` | *same type as `read_local_cfg`* | (none) | step-5 MSG config |
| `read_load_target_cfg` | *same type as `read_target_cfg`* | (none) | step-5 MSG target |
| `read_load_data` | *same type as `read_data`* (MODBUSLOCADDR) | (none) | step-5 buffer |
| `mb_read_load` | *same type as `mb_read_status`* (MSG_MODBUS) | (none) | step-5 MSG block |
| `read_power_local_cfg` | *same type as `read_local_cfg`* | (none) | step-6 MSG config |
| `read_power_target_cfg` | *same type as `read_target_cfg`* | (none) | step-6 MSG target |
| `read_power_data` | *same type as `read_data`* (MODBUSLOCADDR) | (none) | step-6 buffer |
| `mb_read_power` | *same type as `mb_read_status`* (MSG_MODBUS) | (none) | step-6 MSG block |

> MODBUSLOCADDR is the fixed [1..125] WORD array CCW uses for MSG_MODBUS LocalAddr —
> no sizing needed. `read_data` already holds ≥7 elements for the widened step-1 read.

## Compiler notes

- `vfd_fault_code := read_data(1) AND 16#00FF;` and `vfd_warn_code := SHR(read_data(1), 8);`
  assume WORD targets (they are — see table above). If CCW complains about the SHR
  signature, the named form is `SHR(IN := read_data(1), NbR := 8)`.
- If any new var accidentally gets declared INT instead of Word, the WORD expressions
  above will throw type errors at build — declare as Word, don't cast.

## Deploy sequence (Mike, on the PLC laptop)

1. **Stop the historian** (`trend_historian.py`) — sole-poller rule, and CCW needs the
   COM port story clean anyway.
2. Close CCW if open. Run `python plc/deploy_modbus_map.py --auto --dry-run`, then
   without `--dry-run` (drops `MbSrvConf_v5.1.xml` into Conv_Simple_1.8).
3. Open CCW → Conv_Simple_1.8. Declare the variables above.
4. Replace Prog2 body with `Micro820_v5.1.0_Program.st`. Build (0 errors).
5. Download → Run. Verify: `python plc/vfd_diag.py` or restart the historian and check
   `curl "http://127.0.0.1:8766/trends/summary?window=30"` lists `vfd_status_word`,
   `vfd_error_code`, `vfd_warn_code`, `vfd_freq_cmd`, `vfd_torque_pct`, `vfd_motor_rpm`,
   `vfd_power_kw`, `vfd_last_fault` with `quality: "good"`.
6. **Scale check at first run** (plan acceptance): freq cmd vs output freq must track
   1:1 on the trend; if freq reads are 10× off, the drive is on decoding method 1
   (P09.30) — adjust `HR_SPECS` divisors for 106/115/120, not the ladder.
7. After a clean flash, export Prog2 → copy `Prog2.stf` to BOTH `plc/` and the CCW
   project dir (standing rule), and update `wiki/hot.md`.

This is the same reflash that wakes the dormant A2/A12 anomaly signals
(see `project_conv_simple_anomaly` memory + `plc/conv_simple_anomaly/README.md`).

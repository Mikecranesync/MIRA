# Controller Variables — drive_test

Add these in CCW → **Global Variables** table (exact names, types). Retained = `FALSE` unless stated.

## Remote command (Modbus TCP writable)

| Name | Type | Init | Notes |
|---|---|---|---|
| `remote_run_cmd` | BOOL | FALSE | Ignition writes. TRUE = forward-run, FALSE = stop. |

## Safety inputs (already wired on the PLC)

| Name | Type | Init | Notes |
|---|---|---|---|
| `_IO_EM_DI_02` | BOOL | — | E-stop NC contact (built-in mapping). |
| `_IO_EM_DI_03` | BOOL | — | E-stop NO contact (built-in mapping). |
| `e_stop_active` | BOOL | FALSE | Computed. |
| `estop_wiring_fault` | BOOL | FALSE | Computed. |

## VFD control/feedback

| Name | Type | Init | Notes |
|---|---|---|---|
| `vfd_cmd_word` | UINT | 1 | 1 = STOP, 18 = FWD+RUN. |
| `vfd_frequency` | INT | 0 | Hz × 10, from VFD status read. |
| `vfd_current` | INT | 0 | A × 10, from VFD status read. |
| `vfd_dc_bus` | INT | 0 | V, from VFD status read. |
| `vfd_voltage` | INT | 0 | V × 10, from VFD status read. |
| `vfd_comm_ok` | BOOL | FALSE | Last VFD read succeeded. |
| `vfd_poll_count` | UDINT | 0 | Poll cycles since boot. |
| `vfd_err_count` | UDINT | 0 | Failed MSG_MODBUS calls since boot. |
| `motor_running` | BOOL | FALSE | TRUE iff commanded AND VFD reports >0 Hz. |

## MSG_MODBUS wiring (3 instances)

| Name | Type | Notes |
|---|---|---|
| `MB_READ_STATUS` | `MSG_MODBUS` | Step 0 — read 0x2103. |
| `MB_WRITE_CMD` | `MSG_MODBUS` | Step 1 — write 0x2000. |
| `read_local_cfg` | `MODBUSLOCPARA` | Local config for read. |
| `read_target_cfg` | `MODBUSTARPARA` | Target config for read. |
| `read_local_addr` | `MODBUSLOCADDR` | Read buffer anchor. |
| `read_data` | `ARRAY[1..6] OF INT` | Read buffer. |
| `write_local_cfg` | `MODBUSLOCPARA` | Local config for write. |
| `write_target_cfg` | `MODBUSTARPARA` | Target config for write. |
| `write_local_addr` | `MODBUSLOCADDR` | Write buffer anchor. |
| `write_buffer` | `ARRAY[1..1] OF INT` | Holds vfd_cmd_word for COP. |
| `COP_CMD` | `COP` | Copy into write buffer. |

**Address bindings (in Variable Properties → Modbus Addr):** leave the driver to auto-address MODBUSLOCADDR entries via the Modbus Mapping editor, as in the production project.

## Timers and scan helpers

| Name | Type | Notes |
|---|---|---|
| `poll_timer` | TON | 500 ms cadence. |
| `poll_tick` | BOOL | Rising edge each 500 ms. |
| `poll_step` | UINT | Round-robin (0=read, 1=write). |
| `step_read_active` | BOOL | Derived. |
| `step_write_active` | BOOL | Derived. |
| `uptime_timer` | TON | 1 s cadence. |
| `uptime_seconds` | UDINT | Since PLC boot. |
| `last_good_poll` | UDINT | uptime_seconds at last successful read. |
| `heartbeat` | BOOL | Toggles every scan. |
| `cycle_count` | UDINT | Scans since boot. |
| `system_ready` | BOOL | Derived (comm OK and safe). |

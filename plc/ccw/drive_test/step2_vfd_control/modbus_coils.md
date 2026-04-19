# Modbus TCP Mapping — drive_test

Add these in CCW → **Device Toolbox → Modbus Mapping** on the new project.

## Coils (1-bit, `read_coils` / `write_single_coil`)

| Coil # | Variable | Read/Write | Purpose |
|---|---|---|---|
| `000001` | `motor_running` | R | Feedback — TRUE when drive is actually running. |
| `000002` | `vfd_comm_ok` | R | TRUE if last VFD poll succeeded. |
| `000003` | `system_ready` | R | TRUE iff comm OK and e-stop healthy. |
| `000004` | `e_stop_active` | R | TRUE when e-stop is pressed. |
| `000005` | `estop_wiring_fault` | R | TRUE when e-stop channels disagree. |
| `000009` | `heartbeat` | R | Toggles every scan; Ignition uses this as a liveness probe. |
| **`000100`** | **`remote_run_cmd`** | **R/W** | **Ignition writes here to start/stop.** |

## Holding registers (16-bit, `read_holding_registers`)

| Register # | Variable | Units | Purpose |
|---|---|---|---|
| `400001` | `vfd_frequency` | Hz × 10 | Actual output freq from VFD. |
| `400002` | `vfd_current` | A × 10 | Output current. |
| `400003` | `vfd_dc_bus` | V | DC bus voltage. |
| `400004` | `vfd_voltage` | V × 10 | Output voltage. |
| `400005` | `vfd_cmd_word` | — | What the PLC is commanding (1 or 18). |
| `400010` | `vfd_poll_count` (LSW) | count | Low word of poll counter. |
| `400011` | `vfd_poll_count` (MSW) | count | High word. |
| `400012` | `vfd_err_count` (LSW) | count | Low word of error counter. |
| `400013` | `vfd_err_count` (MSW) | count | High word. |
| `400014` | `uptime_seconds` (LSW) | s | Low word of PLC uptime. |
| `400015` | `uptime_seconds` (MSW) | s | High word. |

## Zero-based vs one-based gotcha

Micro 820 / CCW uses **one-based** coil numbering (`000100` is the 100th coil). Most libraries — pymodbus, OPC UA bridges, Ignition's older Modbus-TCP driver in strict mode — are **zero-based** (`99` addresses the same coil). Ignition's "Modbus TCP" driver in its default configuration already applies the +1 offset internally; set Address Prefix `0` and it matches the table above.

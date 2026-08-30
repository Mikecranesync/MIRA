# CCW Variables to Map - Conv_Simple v4.2.2 Discharge Acceptance

Bench/demo logic only. This is not production-certified machinery control.

`plc/Micro820_v4.2.2_Program.st` is the next ST program version derived from
`Micro820_v4.1.9_Program.st`. It adds SimLab discharge request handling with a
required local human acceptance step.

v4.2.2 fixes the v4.2.0 CCW build error by removing the undeclared `e_stop_ok`
global dependency. Do not add `e_stop_ok`; the program uses existing
`e_stop_active` and `estop_wiring_fault` directly.

## New BOOL Variables

Clone an existing scalar `BOOL` row such as `commissioning_mode` or `poll_phase`.
Confirm the Dimension field is blank.

| Variable | Init | Suggested Modbus coil | Direction |
|---|---:|---:|---|
| `simlab_discharge_request` | `FALSE` | `000028` / C27 | bench write, request only |
| `simlab_discharge_heartbeat` | `FALSE` | `000029` / C28 | bench write, heartbeat |
| `discharge_pending_acceptance` | `FALSE` | `000030` / C29 | read |
| `discharge_accepted` | `FALSE` | `000031` / C30 | read |
| `discharge_running` | `FALSE` | `000032` / C31 | read |
| `discharge_complete` | `FALSE` | `000033` / C32 | read |
| `discharge_rejected_or_faulted` | `FALSE` | `000034` / C33 | read |
| `discharge_accept_timeout` | `FALSE` | `000035` / C34 | read |
| `amber_led_flash` | `FALSE` | `000036` / C35 | read, drives O-04 amber |
| `green_start_pb` | `FALSE` | `000037` / C36 | read |
| `photoeye_blocked` | `FALSE` | `000038` / C37 | read |
| `photoeye_clear_30s` | `FALSE` | `000039` / C38 | read |
| `bench_permissive_ok` | `FALSE` | `000040` / C39 | read |
| `local_stop_active` | `FALSE` | internal | internal |
| `remote_start_allowed` | `FALSE` | internal | internal |
| `manual_start_allowed` | `FALSE` | internal | internal |
| `green_start_rising` | `FALSE` | internal | internal |
| `prev_green_start_pb` | `FALSE` | internal | internal |
| `discharge_pending_was_active` | `FALSE` | internal | internal |
| `amber_blink_phase` | `FALSE` | internal | internal |

## New TON Variables

Clone an existing scalar `TON` row such as `start_timer` or `stop_timer`.

| Variable | Purpose |
|---|---|
| `discharge_accept_timer` | 30-second human acceptance timeout |
| `photoeye_clear_timer` | 30-second clear dwell before another discharge |
| `amber_blink_timer` | 0.5-second logical amber flash tick |

## Physical I/O Confirmed

| Signal | Current mapping |
|---|---|
| Green/start push button | `_IO_EM_DI_04` / `PBRun` |
| Photoeye | `_IO_EM_DI_05`; confirm blocked polarity on the bench |
| DO0 | `_IO_EM_DO_00` / `LightGreen`, do not reuse |
| DO1 | `_IO_EM_DO_01` / `LightRed`, do not reuse |
| DO2 | `_IO_EM_DO_02` / `ContactorQ1`, do not reuse |
| DO3 | `_IO_EM_DO_03` / `PBRunLED`, do not reuse |
| DO4 | `_IO_EM_DO_04` / `AmberLight`, pending human acceptance lamp |

The user has assigned the amber lamp to embedded output O-04 / `_IO_EM_DO_04`.
Before download, confirm there is exactly one writer for `_IO_EM_DO_04`. If the
live CCW project still has the old `Prog1` direction-indicator rung writing DO4,
remove or disable that rung before testing this package.

## Modbus Safety Notes

- Keep write access bench-only and disabled by default in any adapter.
- The only SimLab write should be `simlab_discharge_request`; optionally write
  `simlab_discharge_heartbeat` if the bridge owns a heartbeat.
- Do not expose writes for motor, VFD run, contactor, LEDs, accepted/running
  state, or any safety tag.
- The Micro820 map is sparse. Do not create a client read span across unmapped
  gaps.


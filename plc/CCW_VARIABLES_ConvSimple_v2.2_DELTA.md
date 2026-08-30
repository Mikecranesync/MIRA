# CCW Variables to Map - Conv_Simple v2.2 Discharge Acceptance

Bench/demo logic only. This is not production-certified machinery control.

`Conv_Simple_2.2` keeps the confirmed-good 2.0 project shape:

- `PROG1` ladder owns physical I/O, E-stop, contactor, and panel outputs.
- `PROG_INIT` Structured Text owns the VFD Modbus read/write path.
- `DwlOrder.txt` remains `PROG1` then `PROG_INIT`.

The program is already baked into the clone. Do not paste a `Prog2` program.

## Existing Variables From 2.0 / 2.1

Keep the existing 2.0/2.1 variables and Modbus map. If this clone already has
the 2.1 load-block variables, do not redeclare them.

## New BOOL Variables

Clone an existing scalar `BOOL` row such as `poll_phase`. Confirm the Dimension
field is blank.

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
| `amber_led_flash` | `FALSE` | `000036` / C35 | read, drives O-04 amber through PROG1 |
| `green_start_pb` | `FALSE` | `000037` / C36 | read |
| `photoeye_blocked` | `FALSE` | `000038` / C37 | read |
| `photoeye_clear_30s` | `FALSE` | `000039` / C38 | read |
| `bench_permissive_ok` | `FALSE` | `000040` / C39 | read |
| `remote_start_allowed` | `FALSE` | internal | internal |
| `green_start_rising` | `FALSE` | internal | internal |
| `prev_green_start_pb` | `FALSE` | internal | internal |
| `discharge_pending_was_active` | `FALSE` | internal | internal |
| `amber_blink_phase` | `FALSE` | internal | internal |

## New TON Variables

Clone an existing scalar `TON` row such as `poll_timer`.

| Variable | Purpose |
|---|---|
| `discharge_accept_timer` | 30-second human acceptance timeout |
| `photoeye_clear_timer` | 30-second clear dwell before another discharge |
| `amber_blink_timer` | 0.5-second logical amber flash tick |

## Physical I/O

| Signal | Current mapping |
|---|---|
| Green/start push button | `_IO_EM_DI_04` / `PBRun` |
| Photoeye | `_IO_EM_DI_05`; confirm blocked polarity on the bench |
| DO0 | `_IO_EM_DO_00` / green/running light, unchanged |
| DO1 | `_IO_EM_DO_01` / red/E-stop light, unchanged |
| DO2 | `_IO_EM_DO_02` / contactor Q1, unchanged |
| DO4 | `_IO_EM_DO_04` / amber pending-acceptance light |

`PROG1` v2.2 changes the old DO4 forward-direction rung into
`amber_led_flash -> _IO_EM_DO_04`. That preserves the 2.0 rule that physical
outputs are written by ladder, not by the VFD ST program.

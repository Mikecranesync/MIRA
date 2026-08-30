# Conv_Simple_2.4 CCW Variable + Modbus Map

This package fixes the 2.3 build error by using the variable name that exists in the current CCW controller variable list: `discharge_rejected`.

Do not create `discharge_rejected_or_faulted` for this version. That name caused the reported compiler error.

## Required Controller Variables

All variables are Micro820 controller-scope globals.

| Name | Data Type | Dimension | Initial Value | Retained | Modbus |
|---|---|---|---|---|---|
| `simlab_discharge_request` | BOOL | blank | FALSE | unchecked | Coil `000028` / C27, bridge write |
| `discharge_pending_acceptance` | BOOL | blank | FALSE | unchecked | Coil `000030` / C29, read |
| `discharge_accepted` | BOOL | blank | FALSE | unchecked | Coil `000031` / C30, read |
| `discharge_running` | BOOL | blank | FALSE | unchecked | Coil `000032` / C31, read |
| `discharge_complete` | BOOL | blank | FALSE | unchecked | Coil `000033` / C32, read |
| `discharge_rejected` | BOOL | blank | FALSE | unchecked | Coil `000034` / C33, read; means rejected/faulted |
| `discharge_accept_timeout` | BOOL | blank | FALSE | unchecked | Coil `000035` / C34, read |
| `amber_led_flash` | BOOL | blank | FALSE | unchecked | Coil `000036` / C35, read; drives `_IO_EM_DO_04` |
| `green_start_pb` | BOOL | blank | FALSE | unchecked | Coil `000037` / C36, read |
| `photoeye_blocked` | BOOL | blank | FALSE | unchecked | Coil `000038` / C37, read |
| `photoeye_clear_30s` | BOOL | blank | FALSE | unchecked | Coil `000039` / C38, read |
| `bench_permissive_ok` | BOOL | blank | FALSE | unchecked | Coil `000040` / C39, read |
| `remote_start_allowed` | BOOL | blank | FALSE | unchecked | internal, no Modbus required |
| `green_start_rising` | BOOL | blank | FALSE | unchecked | internal, no Modbus required |
| `prev_green_start_pb` | BOOL | blank | FALSE | unchecked | internal, no Modbus required |
| `discharge_pending_was_active` | BOOL | blank | FALSE | unchecked | internal, no Modbus required |
| `amber_blink_phase` | BOOL | blank | FALSE | unchecked | internal, no Modbus required |

## Required Timer Variables

| Name | Data Type | Dimension | Initial Value | Retained | Modbus |
|---|---|---|---|---|---|
| `discharge_accept_timer` | TON | blank | blank | unchecked | none |
| `photoeye_clear_timer` | TON | blank | blank | unchecked | none |
| `amber_blink_timer` | TON | blank | blank | unchecked | none |

## Optional Heartbeat

Heartbeat is not used by the v2.4 motor permissive logic because the current project appears to contain the typo `simlab_disharge_heartbeat` in the CCW variable list. Leave heartbeat unmapped for this test unless you correct the controller variable name and Modbus map together.

## Physical I/O

| Signal | Physical point |
|---|---|
| Green/start push button | `_IO_EM_DI_04` |
| Photoeye blocked | `_IO_EM_DI_05` |
| Contactor/run permissive output | `_IO_EM_DO_02`, unchanged |
| Green/running lamp | `_IO_EM_DO_00`, unchanged |
| Red/E-stop lamp | `_IO_EM_DO_01`, unchanged |
| Amber pending acceptance lamp | `_IO_EM_DO_04` |

## Test Sequence

1. Build `Conv_Simple_2.4`.
2. If CCW reports an undeclared identifier, add that exact name as a controller-scope global with the type above.
3. Turn `simlab_discharge_request` on from Modbus/variable watch.
4. Confirm `_IO_EM_DO_04` flashes and motor does not start.
5. Press green/start PB.
6. Conveyor may run only if permissives are true.
7. Block photoeye; conveyor stops and `discharge_complete` turns true.

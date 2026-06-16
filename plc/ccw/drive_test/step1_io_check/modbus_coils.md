# Modbus Mapping — Step 1 I/O Check

CCW → **Device Toolbox → Modbus Mapping → Add Row**. The `_IO_EM_*` variables appear in the dropdown automatically because embedded I/O is built into the controller type.

## Inputs (read-only coils) — addresses 1..12

| Coil | Variable | Physical terminal |
|---|---|---|
| 000001 | `_IO_EM_DI_00` | I-00 |
| 000002 | `_IO_EM_DI_01` | I-01 |
| 000003 | `_IO_EM_DI_02` | I-02 |
| 000004 | `_IO_EM_DI_03` | I-03 |
| 000005 | `_IO_EM_DI_04` | I-04 |
| 000006 | `_IO_EM_DI_05` | I-05 |
| 000007 | `_IO_EM_DI_06` | I-06 |
| 000008 | `_IO_EM_DI_07` | I-07 |
| 000009 | `_IO_EM_DI_08` | I-08 |
| 000010 | `_IO_EM_DI_09` | I-09 |
| 000011 | `_IO_EM_DI_10` | I-10 |
| 000012 | `_IO_EM_DI_11` | I-11 |

## Outputs (read/write coils) — addresses 13..20

| Coil | Variable | Physical terminal |
|---|---|---|
| 000013 | `_IO_EM_DO_00` | O-00 |
| 000014 | `_IO_EM_DO_01` | O-01 |
| 000015 | `_IO_EM_DO_02` | O-02 |
| 000016 | `_IO_EM_DO_03` | O-03 |
| 000017 | `_IO_EM_DO_04` | O-04 |
| 000018 | `_IO_EM_DO_05` | O-05 |
| 000019 | `_IO_EM_DO_06` | O-06 |
| 000020 | `_IO_EM_DO_07` | O-07 |

## Liveness — coil 100

| Coil | Variable | Notes |
|---|---|---|
| 000100 | `heartbeat` | Toggles every scan. Ignition uses this as a "is the PLC alive" probe. |

That's the entire Modbus map for Step 1. Twelve read-only inputs, eight read/write outputs, one heartbeat. Nothing else.

## Safety note for outputs

Because no logic is driving the DOs, **whatever Ignition writes stays put** until something else writes a different value. That's exactly what we want for this test, but it means:

- Don't leave a contactor or motor starter on O-02 energized and walk away during Step 1 testing.
- If you have the safety contactor wired to O-02, keep the main disconnect OPEN during Step 1 so the contactor clicks but nothing downstream energizes.
- Step 2 will add the real safety interlock (e-stop forces DOs off regardless of remote write).

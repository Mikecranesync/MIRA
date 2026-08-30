# Discharge Conveyor Human Acceptance Patch

Bench/demo plan only. This is not production-certified machinery control.

## Verified I/O

From `plc/Micro820_v4.1.9_Program.st`, `plc/vfd_diag.py`, and `plc/MbSrvConf_ConvSimple_v1.9.xml`:

| Signal | Verified mapping | Use |
|---|---|---|
| Green/start push button | `_IO_EM_DI_04`, `PBRun`, Modbus coil address `000016` | Human discharge acceptance rising edge |
| Photoeye | `_IO_EM_DI_05`, bridge coil offset `22` | Stop accepted discharge when blocked |
| DO0 | `_IO_EM_DO_00`, `LightGreen` | Existing running light, do not reuse |
| DO1 | `_IO_EM_DO_01`, `LightRed` | Existing fault/e-stop light, do not reuse |
| DO2 | `_IO_EM_DO_02`, `ContactorQ1` | Existing safety contactor, do not reuse |
| DO3 | `_IO_EM_DO_03`, `PBRunLED` | Existing pushbutton light, do not reuse |
| DO4 | `_IO_EM_DO_04`, `AmberLight` | Flash while waiting for human acceptance |

The bench amber lamp is assigned to embedded output O-04 / `_IO_EM_DO_04`.
Before download, confirm the live CCW project has exactly one writer for DO4.
If the old `Prog1` direction-indicator rung is still present, remove or disable
that rung before testing this package.

## Concrete Program Artifact

The corrected next version package is written in the 2.0 series shape as:

- `plc/Prog1_ConvSimple_v2.2.st`
- `plc/Prog_init_ConvSimple_v2.2.st`
- `plc/CCW_VARIABLES_ConvSimple_v2.2_DELTA.md`
- `plc/INSTALL_ConvSimple_v2.2.md`
- `plc/build_conv_simple_2_2.py`

`Conv_Simple_2.2` supersedes the failed `Conv_Simple_4.2.x` bench attempts.
The 4.2.x packages used a one-POU `PROG2` shape, while the confirmed-good
`Conv_Simple_2.0` project uses `PROG1` plus `PROG_INIT` with
`DwlOrder.txt = PROG1, PROG_INIT`. Version 2.2 preserves that known-good shape
and only patches the two existing source files.

Keep this document as the safety/design note. Use the files above for the next
CCW implementation pass.

## Variables To Add

Use existing CCW naming conventions if the live project already has equivalents:

```iecst
simlab_discharge_request       BOOL := FALSE;  (* high-level request only *)
simlab_discharge_heartbeat     BOOL := FALSE;  (* optional, if bridge writes it *)
discharge_pending_acceptance   BOOL := FALSE;
discharge_accepted             BOOL := FALSE;
discharge_running              BOOL := FALSE;
discharge_complete             BOOL := FALSE;
discharge_rejected_or_faulted  BOOL := FALSE;
discharge_accept_timeout       BOOL := FALSE;
amber_led_flash                BOOL := FALSE;  (* flashes _IO_EM_DO_04 while pending *)
green_start_pb                 BOOL := FALSE;  (* alias of _IO_EM_DI_04 / PBRun *)
photoeye_blocked               BOOL := FALSE;  (* alias of _IO_EM_DI_05, confirm blocked polarity *)
photoeye_clear_30s             BOOL := FALSE;
bench_permissive_ok            BOOL := FALSE;
discharge_accept_timer         TON;
photoeye_clear_timer           TON;
amber_blink_timer              TON;
prev_green_start_pb            BOOL := FALSE;
green_start_rising             BOOL := FALSE;
remote_start_allowed           BOOL := FALSE;
discharge_pending_was_active   BOOL := FALSE;
amber_blink_phase              BOOL := FALSE;
```

The v2.2 ST expects `simlab_discharge_heartbeat` to be TRUE during live request
testing. If the bridge is not writing a heartbeat yet, force it TRUE only during
the controlled bench test or remove that permissive and document the bridge gap.

## Required State Machine

The existing conveyor state machine already uses `PBRun` rising edge and keeps
the Micro820/GS10 in control. The discharge patch should be integrated ahead of
motor start permissives so `simlab_discharge_request` never drives the motor.

```iecst
green_start_pb := _IO_EM_DI_04;
green_start_rising := green_start_pb AND NOT prev_green_start_pb;
prev_green_start_pb := green_start_pb;

photoeye_blocked := _IO_EM_DI_05;  (* confirm polarity on bench *)
photoeye_clear_timer(IN := NOT photoeye_blocked, PT := T#30s);
photoeye_clear_30s := photoeye_clear_timer.Q;

bench_permissive_ok :=
  NOT e_stop_active
  AND NOT estop_wiring_fault
  AND NOT dir_off
  AND NOT fault_alarm
  AND vfd_comm_ok
  AND photoeye_clear_30s
  AND NOT photoeye_blocked;

IF NOT simlab_discharge_request THEN
  discharge_pending_acceptance := FALSE;
  discharge_accepted := FALSE;
  discharge_accept_timeout := FALSE;
END_IF;

IF simlab_discharge_request
   AND NOT discharge_pending_acceptance
   AND NOT discharge_accepted
   AND NOT discharge_complete
   AND NOT discharge_rejected_or_faulted THEN
  discharge_pending_acceptance := TRUE;
END_IF;

discharge_accept_timer(
  IN := discharge_pending_acceptance,
  PT := T#30s
);

IF discharge_pending_acceptance THEN
  amber_led_flash := discharge_pending_acceptance AND amber_blink_phase;
  IF discharge_accept_timer.Q THEN
    discharge_pending_acceptance := FALSE;
    discharge_accept_timeout := TRUE;
    discharge_rejected_or_faulted := TRUE;
  ELSIF green_start_rising AND bench_permissive_ok THEN
    discharge_pending_acceptance := FALSE;
    discharge_accepted := TRUE;
  END_IF;
ELSE
  amber_led_flash := FALSE;
END_IF;

IF discharge_accepted AND bench_permissive_ok THEN
  discharge_running := TRUE;
END_IF;

IF discharge_running AND photoeye_blocked THEN
  discharge_running := FALSE;
  discharge_complete := TRUE;
  discharge_accepted := FALSE;
END_IF;

IF discharge_running AND (NOT bench_permissive_ok OR NOT simlab_discharge_request) THEN
  discharge_running := FALSE;
  discharge_accepted := FALSE;
  discharge_rejected_or_faulted := TRUE;
END_IF;
```

Do not auto-restart after E-stop, stop, fault, power cycle, timeout, heartbeat
loss, adapter shutdown, or request drop. SimLab must issue a fresh request and
the human must press the green/start push button again.

## Manual Bench Steps Required

1. Confirm the green/start input changes on `_IO_EM_DI_04` / `PBRun`.
2. Confirm photoeye blocked/clear polarity on `_IO_EM_DI_05`.
3. Verify amber LED wiring on `_IO_EM_DO_04` / O-04 and confirm no other
   routine writes DO4.
4. Add CCW variables and Modbus map entries for the discharge state tags.
5. Build/download the Micro820 program in CCW.
6. Verify E-stop, local stop/selector off, VFD comm/drive ready, fault reset,
   photoeye stop, and 30-second clear dwell before enabling live request writes.

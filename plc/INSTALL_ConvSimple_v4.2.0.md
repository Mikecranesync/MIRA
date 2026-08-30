# INSTALL - Conv_Simple v4.2.0 Discharge Acceptance

Bench/demo only. Do not treat this as production-certified machinery control.

## What Changed

`plc/Micro820_v4.2.0_Program.st` adds supervised SimLab discharge request logic:

1. `simlab_discharge_request` only creates a pending request.
2. The conveyor stays stopped while pending.
3. `amber_led_flash` flashes the amber bench lamp on `_IO_EM_DO_04` / O-04 while pending.
4. A human must press the green/start push button (`_IO_EM_DI_04` / `PBRun`).
5. Acceptance uses a clean rising edge and only succeeds if all bench permissives are true.
6. The conveyor stops when `_IO_EM_DI_05` photoeye blocks.
7. The photoeye must be clear for 30 seconds before the next accepted discharge.
8. Timeout, request drop, heartbeat loss, E-stop, selector-off, drive comm fault, or any active fault clears accepted/running state and requires a fresh request plus fresh human acceptance.

## Build The CCW Project Package

With CCW closed, build the openable project folder:

```powershell
python plc/build_conv_simple_4_2_0.py --dry-run
python plc/build_conv_simple_4_2_0.py
```

Or run the wrapper from the repo root:

```cmd
plc\BUILD_CONV_SIMPLE_4.2.0.cmd
```

That creates:

```text
C:\Users\hharp\Documents\CCW\MIRA_PLC\Conv_Simple_4.2.0\Conv_Simple_4.2.0.ccwsln
```

The generated project is cloned from the v4-style `MIRA_PLC.ccwsln` controller
project and has `Micro820_v4.2.0_Program.st` already baked into `Prog2.stf`.
It does not edit CCW's binary symbol table or generated compile artifacts.

## Before Download

1. Read `plc/CCW_VARIABLES_ConvSimple_v4.2.0_DELTA.md`.
2. Declare the new BOOL and TON variables in CCW with blank Dimension fields.
3. Open `Conv_Simple_4.2.0\Conv_Simple_4.2.0.ccwsln`.
4. Confirm `DwlOrder.txt` / project organizer shows `Prog2` as the program POU.
5. Confirm no other routine writes `_IO_EM_DO_04`. The generated v4.2.0 package
   should not contain `Prog1`; if you instead apply this patch to an older
   `Conv_Simple_2.1` project, remove or disable the old `Prog1` DO4
   direction-indicator rung before download.
6. Add Modbus mappings only after the variables exist.
7. Keep live write adapters disabled.

## Required Bench Verification

1. Lock out/de-energize as appropriate before safety checks.
2. Verify E-stop released allows the contactor path and E-stop pressed drops it.
3. Verify selector-off or local stop behavior prevents running.
4. Verify `_IO_EM_DI_04` changes only when the green/start push button is pressed.
5. Verify `_IO_EM_DI_05` photoeye polarity. If blocked polarity is inverted, fix `photoeye_blocked := sensor_1_active;` before running.
6. Verify the amber lamp is wired to `_IO_EM_DO_04` / O-04 and no other program writes that output.
7. With `simlab_discharge_request=TRUE`, confirm the motor remains off and `discharge_pending_acceptance=TRUE`.
8. Confirm the amber lamp flashes while `discharge_pending_acceptance=TRUE`.
9. Press green/start and confirm the conveyor runs only with permissives true.
10. Block the photoeye and confirm the conveyor stops and `discharge_complete=TRUE`.
11. Clear the photoeye and wait more than 30 seconds before the next discharge.

## Not Included

- No Factory I/O integration.
- No live SimLab write adapter.
- No automatic PLC download.

The next live bridge step is still to create an opt-in bench-only adapter that
writes only `simlab_discharge_request` and optional heartbeat, then clears the
request on shutdown, timeout, scenario stop, or connection loss.

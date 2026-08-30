# INSTALL - Conv_Simple v2.2 Discharge Acceptance

Bench/demo only. Do not treat this as production-certified machinery control.

## What v2.2 Fixes

v4.2.x used the wrong CCW shape: one `PROG2` POU. The confirmed-good 2.0 series
uses two POUs:

```text
PROG1
PROG_INIT
```

`Conv_Simple_2.2` is built from confirmed-good `Conv_Simple_2.0` and keeps that
shape. `PROG1` remains the physical I/O owner; `PROG_INIT` remains the VFD
Modbus/ST owner.

## What Changed

1. `simlab_discharge_request` only creates a pending request.
2. The conveyor stays stopped while pending.
3. `amber_led_flash` flashes the amber bench lamp on `_IO_EM_DO_04` / O-04 while pending.
4. A human must press the green/start push button (`_IO_EM_DI_04` / `PBRun`).
5. Acceptance uses a clean rising edge and only succeeds if bench permissives are true.
6. The conveyor stops when `_IO_EM_DI_05` photoeye blocks.
7. The photoeye must be clear for 30 seconds before the next accepted discharge.

## Build The CCW Project Package

With CCW closed, build the openable project folder:

```powershell
python plc/build_conv_simple_2_2.py --dry-run
python plc/build_conv_simple_2_2.py
```

Or run the wrapper from the repo root:

```cmd
plc\BUILD_CONV_SIMPLE_2.2.cmd
```

That creates:

```text
C:\Users\hharp\Documents\CCW\MIRA_PLC\Conv_Simple_2.2\Conv_Simple_2.2.ccwsln
```

## Before Download

1. Read `plc/CCW_VARIABLES_ConvSimple_v2.2_DELTA.md`.
2. Declare the new BOOL and TON variables in CCW with blank Dimension fields.
3. Open `Conv_Simple_2.2\Conv_Simple_2.2.ccwsln`.
4. Confirm `DwlOrder.txt` / project organizer shows `PROG1` then `PROG_INIT`.
5. Confirm `PROG1` writes `_IO_EM_DO_04` from `amber_led_flash`.
6. Confirm `PROG_INIT` header is `Conv_Simple_2.2 Prog_VFD V2.2`.
7. Add Modbus mappings only after variables exist.
8. Keep live write adapters disabled except the bench-only request/heartbeat bits.

## Required Bench Verification

1. Lock out/de-energize as appropriate before safety checks.
2. Verify E-stop released allows the contactor path and E-stop pressed drops it.
3. Verify `_IO_EM_DI_04` changes only when the green/start push button is pressed.
4. Verify `_IO_EM_DI_05` photoeye polarity.
5. Verify the amber lamp is wired to `_IO_EM_DO_04` / O-04.
6. With `simlab_discharge_request=TRUE`, confirm the motor remains off and `discharge_pending_acceptance=TRUE`.
7. Confirm the amber lamp flashes while `discharge_pending_acceptance=TRUE`.
8. Press green/start and confirm the conveyor runs only with permissives true.
9. Block the photoeye and confirm the conveyor stops and `discharge_complete=TRUE`.
10. Clear the photoeye and wait more than 30 seconds before the next discharge.

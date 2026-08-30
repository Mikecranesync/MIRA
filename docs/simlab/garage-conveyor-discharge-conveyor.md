# Garage Conveyor as Bottling-Line Discharge Conveyor

`discharge_conveyor01` is the SimLab name for the existing garage conveyor concept when it is used as the discharge conveyor between `casepacker01` and `palletizer01`.

## Mapping

| Garage conveyor concept | SimLab asset/tag |
|---|---|
| Micro820 + GS10 bench conveyor | `discharge_conveyor01` |
| Case packer package ready / transfer request | `discharge_conveyor01.status.discharge_request` |
| SimLab request bit for future PLC bridge | `discharge_conveyor01.status.simlab_discharge_request` |
| Pending human acceptance | `discharge_conveyor01.status.discharge_pending_acceptance` |
| Local green/start accepted | `discharge_conveyor01.status.discharge_accepted` |
| Amber pending flash, wired to Micro820 O-04 / `_IO_EM_DO_04` | `discharge_conveyor01.status.amber_led_flash` |
| Palletizer ready to accept discharge | `discharge_conveyor01.status.pallet_unload_ready` |
| Garage conveyor photoeye | `discharge_conveyor01.status.photoeye_blocked` |
| Required clear dwell | `discharge_conveyor01.process.clear_seconds` |
| Photoeye clear dwell satisfied | `discharge_conveyor01.status.photoeye_clear_30s` |
| Next discharge permissive | `discharge_conveyor01.status.ready_for_next_discharge` |

## Control Boundary

The default implementation is headless SimLab only. It does not write to a PLC, Factory I/O, MQTT broker, or relay unless existing opt-in SimLab publisher environment variables are explicitly configured.

The real Micro820/garage conveyor remains the safety and motion-control authority. Any future bridge must stay opt-in, bench-only until proven, and preserve local E-stop, local stop, and photoeye behavior.

Existing reusable bench pieces:

- `plc/live-plc-bridge/bridge.py` reads bench Micro820 signals read-only and labels itself bench-only.
- `plc/Micro820_v4.1.9_Program.st` is a conveyor controller program, not a discharge-specific production program.
- `mira-relay/tag_ingest.py` and SimLab relay publishers can land simulated readings when explicitly enabled.

No Factory I/O or live hardware integration is enabled by adding `discharge_conveyor01`.

## Human Acceptance Requirement

When SimLab or the bottling-line discharge scenario requests the real discharge
conveyor, the PLC must not immediately start the conveyor. The request is only a
high-level request bit. The PLC must enter `discharge_pending_acceptance`, flash
an amber panel LED if a verified spare output exists, and wait for a clean rising
edge of the local green/start push button.

Evidence wording for the pending state:

> Discharge conveyor request is pending local human acceptance. Amber panel LED should be flashing. Press the green/start push button to authorize the bench conveyor run.

Verified from the current repo:

| Question | Current answer |
|---|---|
| Green/start input | `_IO_EM_DI_04` / `PBRun` |
| Photoeye telemetry | `_IO_EM_DI_05`, bridge coil offset `22` |
| Existing start logic | `button_rising := _IO_EM_DI_04 AND NOT prev_button` |
| Existing output use | DO0 green running, DO1 red fault/e-stop, DO2 safety contactor, DO3 PB run LED |
| Amber output | `_IO_EM_DO_04` / O-04, assigned by bench wiring |
| PLC 30-second clear timer | Not present in `Micro820_v4.1.9_Program.st` |
| Existing blink bit | Not found |

The amber feature is now assigned to O-04 / `_IO_EM_DO_04`. Before download,
confirm the live CCW project has exactly one writer for DO4. If an older `Prog1`
direction-indicator rung still drives `_IO_EM_DO_04`, remove or disable it before
testing this package. Do not reuse the motor output, safety contactor, VFD run
path, red fault lamp, green running lamp, or pushbutton LED as amber.

## Bench Operator Sequence

1. Start in headless/read-only mode first.
2. Verify E-stop.
3. Verify stop button or selector-off behavior.
4. Verify the green/start input changes in telemetry as `_IO_EM_DI_04` / `PBRun`.
5. Verify the amber LED is wired to Micro820 O-04 / `_IO_EM_DO_04`, and verify no other routine writes DO4.
6. Verify the photoeye changes in telemetry and confirm blocked/clear polarity.
7. Enable live request mode only after the PLC patch is built, downloaded, and verified.
8. Start the discharge scenario.
9. Confirm `discharge_pending_acceptance=true`; amber on O-04 should flash.
10. Press the green/start push button to accept.
11. Confirm the conveyor runs only if E-stop OK, local stop clear, drive ready, no fault, photoeye clear, and the 30-second clear timer is satisfied.
12. Confirm the conveyor stops when the photoeye blocks.
13. Clear the photoeye and wait more than 30 seconds before the next discharge.

## Live Bridge Guardrail

The existing bench bridge is read-only. If a live write bridge is added later,
the only write from SimLab may be `simlab_discharge_request`; SimLab must never
write motor, VFD run, safety, amber-output, or accepted/running state tags.

Live request writes must remain disabled by default. A later bench-only adapter
should require an explicit flag such as:

```powershell
$env:SIMLAB_LIVE_DISCHARGE_WRITES = "1"
```

On adapter shutdown, scenario stop, timeout, or lost connection, the adapter must
clear `simlab_discharge_request`.

## Preferred Live Path

For customer-like operation, live garage conveyor telemetry should come through
Ignition or an edge gateway, not Jarvis and not direct MIRA Modbus polling.

Preferred path:

```text
Micro820 -> OT switch -> Ignition/edge gateway -> outbound HMAC tag stream -> mira-relay -> MIRA
```

The laptop direct-Modbus path remains bench-only. The laptop may still be used
as an engineering workstation for CCW/RDP, but normal telemetry should continue
when the laptop is disconnected from the OT switch.

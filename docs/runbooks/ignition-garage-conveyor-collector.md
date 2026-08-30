# Ignition Garage Conveyor Collector

## Goal

Use Ignition as the normal collector for the garage conveyor/Micro820, not Jarvis and not direct MIRA Modbus polling.

## Device

Create or verify an Ignition device:

- Driver: Micro800 if stable; otherwise Modbus TCP.
- Host: `192.168.1.100`.
- Port: `502` for Modbus TCP.
- Poll rate: start at `1000 ms`; reduce only after stable.
- Network: Ignition/edge gateway OT NIC on the same isolated switch as the Micro820.

## Approved Telemetry Tags

Expose only approved telemetry tags first:

- `green_start_pb`
- `photoeye_blocked`
- `photoeye_clear_30s`
- `bench_permissive_ok`
- `discharge_pending_acceptance`
- `discharge_accepted`
- `discharge_running`
- `discharge_complete`
- `discharge_rejected_or_faulted`
- `discharge_accept_timeout`
- `amber_led_flash`
- VFD health/readback tags
- E-stop and contactor state

## Relay

Use outbound Ignition tag stream to `mira-relay` with HMAC auth. Do not expose inbound PLC or Ignition ports to MIRA cloud.

Preferred data path:

```text
Micro820 -> OT switch -> Ignition/edge gateway -> outbound HMAC tag stream -> mira-relay -> MIRA
```

## Writes

Default: no writes.

Bench-only optional write after PLC v4.2.0 is downloaded and tested:

- `simlab_discharge_request`
- optional `simlab_discharge_heartbeat`

No other write tags are allowed. Do not write motor, VFD run, safety, contactor, accepted/running, or output tags from MIRA.

## Verification

1. Confirm Ignition can browse/read the Micro820.
2. Confirm the PLC laptop direct bridge and Jarvis are stopped.
3. Confirm MIRA still receives tag updates through outbound relay.
4. Unplug the engineering laptop from the OT switch.
5. Confirm telemetry continues.

If telemetry stops when the laptop is unplugged, the runtime architecture still depends on the laptop and the cutover is not complete.

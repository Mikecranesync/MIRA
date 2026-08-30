# PLC Laptop Jarvis Inventory

Date: 2026-06-27

## Host

- Hostname: `LAPTOP-0KA3C70H`
- Tailscale IP: `100.72.2.99`
- PLC bench IP: `192.168.1.100`
- PLC laptop Ethernet IP: `192.168.1.50/24`

## Current Observations

- `Test-NetConnection 100.72.2.99 -Port 8765`: ping succeeds, TCP fails.
- `Get-NetTCPConnection -State Listen`: Ignition listens on `8088`; Jarvis `8765` is not listening.
- `plc/live-plc-bridge/bridge.py`: bench-only direct Modbus polling; never customer-shipped.
- `docs/architecture/real-vs-simulated.md`: garage rig is real reads through developer bench tools; shipped path is Ignition read-only.
- `plc/live-plc-bridge/bridge.py` defaults to `PLC_HOST=192.168.1.100`, `PLC_PORT=502`, and publishes MQTT from a laptop/container-side direct Modbus poll.

## What Jarvis Is

Jarvis is a remote-control convenience for the demo laptop. It lets a remote operator or Codex session inspect files, run commands, and drive local bench scripts when the PLC is reachable only from the PLC laptop.

## What Jarvis Is Not

Jarvis is not required in a customer plant and should not be part of the product architecture. A customer site should use an approved edge collector, SCADA gateway, historian, OPC UA server, MQTT/Sparkplug broker, or Ignition-style outbound relay path.

## Conclusion

The PLC laptop and Jarvis bridge are useful bench scaffolding. The product-like path is:

```text
Micro820 -> OT switch -> Ignition/edge gateway -> outbound HMAC tag stream -> mira-relay -> MIRA
```

Keep Jarvis out of customer diagrams except as an internal demo/support tool.

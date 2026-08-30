# Customer PLC Connectivity Patterns

## Decision

MIRA does not require Jarvis in a customer plant.

Customer PLC connectivity should use an approved plant edge path: existing SCADA, Ignition, an edge gateway, OPC UA, MQTT/Sparkplug, historian export, or another customer-approved integration point.

## Supported Patterns

### Pattern A - Existing Ignition

Use the customer's existing Ignition gateway. Add read-only tags, WebDev tag export, or tag-change scripts. Push outbound HMAC telemetry to MIRA relay.

Use when:

- Customer already runs Ignition.
- Tags are already modeled or can be added safely.
- IT/OT allows outbound HTTPS from the gateway or gateway-adjacent edge host.

### Pattern B - Edge Gateway

Install a small industrial PC or edge gateway on the OT network. It reads PLC/SCADA data locally and pushes outbound telemetry. This gateway can run Ignition Edge, Kepware, Node-RED, or a hardened MIRA collector depending on the site.

Use when:

- Customer does not have a suitable SCADA export path.
- The PLC network must remain isolated.
- MIRA needs a controlled, supportable collector that is not a user laptop.

### Pattern C - MQTT/Sparkplug

If the plant already publishes Sparkplug B or MQTT telemetry, subscribe to the broker or bridge a filtered namespace into MIRA relay.

Use when:

- Customer already has MQTT infrastructure.
- Topic naming and tag normalization can be mapped to approved MIRA tags.
- The broker can enforce read-only credentials or publish-only bridge rules.

### Pattern D - File Or Historian Export

If online connectivity is limited, ingest approved CSV, JSON, historian export, or report files as a lower-frequency telemetry source.

Use when:

- The site will not permit live PLC or SCADA integration.
- Batch diagnostics are acceptable.
- The customer can export approved data from an existing historian.

## Not Supported As Product

- Jarvis remote shell bridge.
- Direct cloud-to-PLC Modbus.
- Customer PLC behind a random Windows laptop.
- MIRA container reaching into a plant LAN without the customer's edge architecture.
- Unapproved write access to motor, VFD, contactor, safety, or output tags.

## Writes

Default is read-only.

Any write/control feature requires:

1. Explicit site approval.
2. Explicit tag allowlist.
3. PLC-side permissives.
4. Human confirmation where motion is possible.
5. Audit log.
6. Tested recovery behavior for timeout, adapter shutdown, lost heartbeat, E-stop, stop, and power cycle.

For the garage conveyor discharge demo, the only planned bench write is `simlab_discharge_request`, with optional `simlab_discharge_heartbeat`. The PLC must still require local green/start push-button acceptance before motion.

## Demo Translation

When explaining the current garage conveyor:

- Say: "The bench currently uses a laptop-local Modbus path because the PLC is cabled directly to the demo laptop."
- Say: "The customer architecture is Ignition or an edge gateway pushing outbound telemetry."
- Do not say: "Customers install Jarvis."
- Do not say: "MIRA reaches directly into your PLC network from the cloud."

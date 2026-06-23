# Phase 4 — MQTT nervous-system round trip

MQTT is only the transport. The answer card below was produced AFTER the event crossed MQTT;
it must match the offline card byte-for-byte.

## The event
- type: `photoeye_blocked`  ·  asset: `synthetic_beverage_co.demo_site.bottling.bottlingline1.conveyor01`
- UNS topic: `synthetic_beverage_co/demo_site/bottling/bottlingline1/conveyor01/events`

## Transport
- published payload == received payload: **True**
- answer card (via MQTT) == answer card (offline): **True**

```json
{
  "abnormal_signals": [
    "synthetic_beverage_co.demo_site.bottling.bottlingline1.conveyor01.production.counts_outfeed_value_value",
    "synthetic_beverage_co.demo_site.bottling.bottlingline1.conveyor01.status.blocked_value_value",
    "synthetic_beverage_co.demo_site.bottling.bottlingline1.conveyor01.status.photoeye_blocked_value_value",
    "synthetic_beverage_co.demo_site.bottling.bottlingline1.conveyor01.status.state_name"
  ],
  "asset_uns": "synthetic_beverage_co.demo_site.bottling.bottlingline1.conveyor01",
  "conflicting": false,
  "event_type": "photoeye_blocked",
  "healthy_signals": [],
  "line_uns": "synthetic_beverage_co.demo_site.bottling.bottlingline1",
  "schema_version": "1",
  "symptom": "line_blocked"
}
```

## Answer card (produced through MQTT)
```
============================================================
  ASK MIRA — ANSWER CARD
============================================================
Question: Why is the line line blocked?

Most likely cause:  Photoeye blocked / fouled — on Conveyor01
Confidence:         HIGH

Why MIRA thinks that:
  - Photoeye is blocked or fouled (sees a permanent target)
  - Conveyor logic believes product is present and stops feeding
  - Product backs up / accumulation fills upstream
  - Machine asserts Blocked state
  - Outfeed counts flatline; OEE availability drops

Evidence FOR:
  - Conveyor01 — Outfeed count: rate dropped to 0/min
  - Conveyor01 — Blocked state: TRUE
  - Conveyor01 — Photoeye blocked: TRUE
  - Conveyor01 — Machine state: Down / Fault
  - Conveyor01 hosts the photoeye (inferred component)
  - Conveyor01 feeds CapLoader01

Evidence AGAINST:
  - None found — no current reading argues against this.

Manuals & procedures:
  - Conveyor O&M Manual (synthetic), p.42 — 7.3 Photoeye Sensors
  - Sensor Maintenance Guide (synthetic), p.11 — Cleaning diffuse-reflective sensors
  - Procedure: Clean & verify a photoeye sensor

Similar history:
  - Seen 3 time(s) before; typically ~11 min; last fixed by: Cleaned sensor lens.

Technician checks:
  - Visually inspect the photoeye lens for product debris, condensation, or label adhesive.
  - Clear the target and confirm the sensor output toggles (LED off).
  - Verify alignment to the reflector / confirm sensing distance.
  - Check the photoeye wiring/connector for damage.

What needs human review:
  - Confirm the cause on the floor — this is MIRA's most likely hypothesis (high confidence), not a confirmed fact.
  - The 'photoeye' on Conveyor01 is an inferred component (not in the tag export) — confirm it exists.
  - Other possibilities were considered (e.g. Conveyor mechanical jam) — rule them out with the checks above.

------------------------------------------------------------
MIRA's best hypothesis from the factory's own tags + documentation. Confirm before acting.
```

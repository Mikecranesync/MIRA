# ProveIt Bottling demo — overview

- mode: **live-cell**
- assets (sim + live cell): **12**
- scenarios run: **4**  (skipped: 0)
- live cell: **supervised bench OFFLINE — degraded to evidence snapshot**
- MQTT round trip: **off (--no-mqtt)**
- Hub export: **not exported**
- telemetry: **86 events, normal x10 -> demo\proveit_bottling\reports\telemetry_events.jsonl (off (JSONL only))**
- ignition export: **off**

The plant is simulated; the Conv_Simple packaging cell is a REAL supervised bench (requires_supervision=true, runs_24_7=false). MIRA explains each fault with evidence-backed cards.

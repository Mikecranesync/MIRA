# Platform Alignment — MQTT Transport (Audit Area 5)

**Phase 4.5 audit, read-only. 2026-06-23.**
**Question:** can Phase 4 MQTT events enter existing MIRA pathways, or is there a separate event-processing architecture?

**Verdict:** **one adapter away.** The `direct_connection` contract the spine's events must satisfy is **real and implemented — but HTTP-only** (`mira-pipeline/ignition_chat.py`). No existing MQTT subscriber reaches the Supervisor; the bench subscribers are a **separate rules-engine architecture**. The merge is a single new subscriber that calls the existing `engine.process(uns_source="direct_connection")`.

## Key correction to the audit's own hypothesis

- **`mira-relay` has ZERO MQTT.** No `mqtt_ingest`, no `paho`/`aiomqtt`. Ingest is HTTP `POST /api/v1/tags/ingest` + WebSocket only (`relay_server.py`). `live_signal_cache` is a **Neon table written over HTTP** (`tag_ingest.py`), not an MQTT-fed cache. The `mira-relay/mqtt_ingest` seam named in planning docs **is not built**.
- **Sparkplug B is documentation-only** — `grep spBv1|sparkplug` over `*.py` is empty. The `direct-connection-uns-certified.md` rule lists it as a qualifying surface, but no code exists.

## Existing MQTT pathways (all bench, none reach the Supervisor)

| Pathway | MQTT | Reaches Supervisor? | File |
|---|---|---|---|
| `mira-fault-detective` | subscriber | No — own `rules.evaluate()` → SQLite → HTTP `/current_fault` | `mira-fault-detective/engine.py` |
| `plc/conv_simple_anomaly` | subscriber | No — own anomaly rules → SQLite | `plc/conv_simple_anomaly/engine.py` |
| `simlab` MqttPublisher | publisher | No | `simlab/publishers.py` |
| `plc/*` bench publishers | publisher | No (BENCH-ONLY) | `plc/mqtt_publisher.py` |
| `mira-bridge/mosquitto` | broker host | No (Node-RED routing) | `mira-bridge/mosquitto/` |

The Supervisor consumes fault-detective only as **flag-gated HTTP prompt enrichment** (`engine.py` L3462 `_fetch_live_status`, `_LIVE_DATA_ENABLED`, additive) — never as a `direct_connection` turn.

## The implemented `direct_connection` seam (HTTP)

`mira-pipeline/ignition_chat.py`: sets `uns_source="direct_connection"` when `asset_id`/`asset_context` present (L511), calls `engine.process(..., uns_source=uns_source)` (L608), **rejects** asset-specific turns with no UNS identifier (`422 uns_required`, L521). This is exactly the contract a `MaintenanceEvent` must satisfy — and the event's `asset_uns` **is** the required UNS identifier.

## Topic comparison

Spine topics `enterprise/site/area/line/asset/events` are **DIVERGENT in literal form, COMPATIBLE in hierarchy**. The canonical UNS is the dot-delimited `ltree`; slash is a display/MQTT projection (`simlab/uns.py` makes this explicit and already has `from_mqtt_topic()` for `/`→`.`). No existing publisher emits exactly the spine topic; existing ones use `FactoryLM/...` (simlab) or `demo/cell1/...` (fault-detective), per-tag leaves.

## Mapping verdict

**PARTIAL — one adapter hop.** ✅ `asset_uns` = the required identifier · ✅ engine accepts `uns_source="direct_connection"` · ✅ the `.`↔`/` mapping exists (`simlab/uns.py`) · ❌ **no MQTT subscriber calls `engine.process`**, and the named `mira-relay/mqtt_ingest` does not exist.

**The merge seam, precisely:** `mqtt_uns event → [NEW MQTT subscriber adapter] → from_mqtt_topic()/normalize → engine.process(uns_source="direct_connection")`. The adapter belongs **beside `ignition_chat.py`** (a new direct-connection surface per `.claude/rules/direct-connection-uns-certified.md`) — **not** inside `mira-relay` (HTTP-only) and **not** as another standalone-rules subscriber like fault-detective (that re-forks the engine).

## Conclusion

Phase 4 is **architecturally the same shape as `mira-fault-detective`** (subscriber + its own deterministic engine). That is the existing *bench* pattern — useful, but it dead-ends in SQLite, not the grounded Supervisor. To reach the cited-answer brain, swap the spine's in-process broker for a real client behind its `Transport` seam and route the received event into the **existing HTTP `direct_connection` path** (or a thin MQTT-subscriber twin of it). Not blocked by a competing architecture; blocked only by a missing ~1-file adapter.

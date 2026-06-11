# Real-Time Datapoint and Clock Source

**Status:** Spec — implemented (`feat/realtime-datapoint-clock` + SimLab on `feat/simlab-juice-bottling`)
**Date:** 2026-06-11
**Author:** Claude (CHARLIE) for Mike Harper

---

> MIRA does not redefine the UNS as history. MIRA keeps live datapoints
> separate and uses the maintenance KG for durable maintenance context.

---

## 1. The two UNS branches

MIRA's UNS tree has two distinct branches under every equipment instance, and they must not be conflated:

| Branch | Path shape | What lives there | Storage |
|---|---|---|---|
| **Live-state** | `…equipment.{eq}.datapoint.{tag}` | Current tag value + clock provenance | `tag_events` (append) + `live_signal_cache` (upsert) JSONB |
| **Maintenance KG** | `…equipment.{eq}.maintenance.*` / `.documentation.*` | Fault history, work orders, PM schedules, manuals, component profiles | `kg_entities` / `kg_relationships` (NeonDB) |

The live-state branch is the **Walker-style "current state" subtree** — it holds one value per tag at any instant. The maintenance KG is durable, append-only, human-reviewed knowledge. Telemetry values are explicitly **not** stored on `kg_entities` (see `docs/specs/uns-kg-unification-spec.md` §3.4).

**Builder:** `mira-crawler/ingest/uns.py:datapoint_path(equipment_path_value, tag_name)` constructs the live-state address by appending `.datapoint.{tag}` to an equipment-instance path. Example:

```
enterprise.lakewales.site.plant1.area.packaging.line.line2.equipment.conveyor_a.datapoint.motor_current
```

Do not hand-format this path. Use `datapoint_path()` — it delegates to `equipment_subnode_path()` so slug normalization and reserved-label checks apply automatically. (SimLab uses a flatter `…line01.{asset}.{category}.{tag}` projection of the same tree; both share the lowercase dot-ltree contract.)

---

## 2. Why the PLC clock matters

A plant controller runs its own real-time clock. When MIRA receives a tag batch from an Ignition gateway or PLC bridge, the values may have been sampled seconds or minutes before the HTTP request arrived (network latency, batch accumulation, retries). If MIRA records the server-receive time as the event timestamp:

- **Event ordering** is wrong across batches — a fast-arriving batch from a slow network looks newer than a slow-arriving batch from a fast one.
- **Drift audits** are impossible — you cannot tell whether a sensor value is 30 seconds old or 30 milliseconds old.
- **Historical replays** produce incorrect timelines.

By reading the controller's own clock tag from the batch, MIRA can record when the PLC **observed** the value, not when MIRA received it. The difference is also recorded as `sample_age_seconds` so downstream consumers know how stale the reading is.

---

## 3. `timestamp_source` resolution rules

Implemented in `mira-relay/clock_resolver.py`. Applied once per batch in `mira-relay/tag_ingest.py:ingest_batch()`.

### 3.1 Precedence (highest to lowest)

| Priority | Condition | `timestamp_source` value | `degraded` |
|---|---|---|---|
| 1 | A clock tag in the batch is valid and fresh (skew < 300 s) | `plc_clock` / `scada_clock` / `gateway_clock` | `false` |
| 2 | No usable clock tag; reading's own `ts` field is parseable | `gateway_clock` | `false` (or `true` if a stale clock was seen) |
| 3 | No usable `ts`; no clock tag | `server_clock` | `false` |
| 4 | A clock tag was present but every candidate was unparseable or stale | `unknown` | `true` |

When multiple valid clock tags appear in one batch, the most authoritative wins: PLC clock (`plc_clock`) beats SCADA clock (`scada_clock`), which beats gateway clock (`gateway_clock`). The rank is defined in `clock_resolver._SOURCE_RANK`.

### 3.2 Known clock-tag basenames

`clock_resolver.CLOCK_TAG_SOURCES` maps tag basenames (matched on the last path segment, lowercased) to their source value:

| Tag basename | `timestamp_source` |
|---|---|
| `plc_time`, `plc_datetime`, `controller_time` | `plc_clock` |
| `scada_time` | `scada_clock` |
| `system_time`, `gateway_time` | `gateway_clock` |

### 3.3 Staleness rejection

A clock tag that parses successfully but differs from server time by more than `DEFAULT_MAX_CLOCK_SKEW_SECONDS` (300 s) is rejected as implausible. The batch falls back to the next tier, and if no other clock tag succeeds, `degraded=true` is set in metadata.

### 3.4 UTC normalization

All stored timestamps are UTC ISO-8601. `parse_clock_value()` accepts:
- ISO-8601 strings (with or without offset; naive strings are assumed UTC)
- Epoch seconds (float/int)
- Epoch milliseconds (values above `1e11` are divided by 1000)

The original value as received from the controller is preserved in `source_timestamp_local` so the local offset is not silently discarded.

---

## 4. Where it is stored today

No schema migration was required. Provenance fields ride in existing JSONB columns:

| Table | Column | Fields written |
|---|---|---|
| `tag_events` (migration 033) | `metadata` JSONB | `timestamp_source`, `sample_age_seconds`, `source_timestamp_local`, `clock_degraded` |
| `live_signal_cache` (migration 020 + 036) | `properties` JSONB | same four fields |

`TagEventRow` (in `tag_ingest.py`) also carries `timestamp_source`, `sample_age_seconds`, and `source_timestamp_local` as typed first-class fields for in-process use. The JSONB mirror ensures the data survives the store boundary without any DDL change.

**Forward path (not done — noted for future work):** if query patterns warrant it, `timestamp_source` and `sample_age_seconds` could be promoted to dedicated columns on `tag_events` with a straightforward `ALTER TABLE`. That is a separate migration, not part of this feature.

---

## 5. Future Ignition / MQTT / Sparkplug B / historian integration

The relay already accepts `source_system` values of `ignition` and `plc_bridge` in `VALID_SOURCE_SYSTEMS`. The clock-resolver runs identically for all source systems — a batch from Ignition carrying a `controller_time` tag gets the same `plc_clock` treatment as one from the simulator.

**Sparkplug B:** SimLab's `simlab/uns.py:to_mqtt_topic()` converts canonical ltree UNS paths to MQTT topic strings (`spBv1.0/<group>/<edge>/<device>`). The inverse `from_mqtt_topic()` converts incoming Sparkplug topics back to UNS paths. A future Sparkplug subscriber in `mira-relay` or `mira-bridge` can resolve the UNS path from the topic namespace and pass the birth/data payload through the existing `ingest_batch` pipeline unchanged.

**Historian integration:** a historian that emits timestamped tag batches (OSIsoft PI, Aveva, InfluxDB export) would write into the `.datapoint.*` live-state branch via the same `/api/v1/tags/ingest` endpoint. The clock resolver would use whatever timestamp source the historian provides in `ts`, falling back to `server_clock`. The maintenance KG branch is unaffected.

---

## 6. SimLab namespace types and clock tags

### 6.1 Walker namespace classification

`simlab/models.py` adds a `NamespaceType` enum layered over the existing `TagCategory` axis. Every `TagDef` derives a Walker namespace type via `resolved_namespace_type` (explicit override wins; otherwise the category default applies):

| TagCategory | Default NamespaceType | Rationale |
|---|---|---|
| STATUS, PROCESS, MOTOR, PRODUCTION | FUNCTIONAL | Real-time operational data |
| QUALITY | INFORMATIVE | Derived / aggregated consumer data |
| FAULTS, ALARMS, MAINTENANCE, DOCS, TRAINING | MAINTENANCE | MIRA's durable knowledge wedge |
| (clock tags, explicit override) | REALTIME | Live datapoints + heartbeat; not implied by any category |

`CATEGORY_NAMESPACE_TYPE` in `simlab/models.py` is the authoritative mapping. The REALTIME type is not a default for any category — clock tags set it explicitly via `TagDef.namespace_type=NamespaceType.REALTIME`.

### 6.2 SimLab clock tags

`simlab/baselines/__init__.py:controller_clock_tags()` returns the standard clock tag set for a process asset:

| Tag name | Category | namespace_type | Purpose |
|---|---|---|---|
| `controller_time` | STATUS | REALTIME | Controller wall-clock (ISO-8601 UTC); matched by `clock_resolver.CLOCK_TAG_SOURCES` as `plc_clock` |

These tags are merged into at least `filler01` on the juice bottling line so the end-to-end timestamp path (`controller_time` → `find_batch_clock` → `plc_clock` on every reading in the batch) is exercisable in SimLab evals without a live PLC.

When rendered as an ingest payload, `Reading.namespace_type` is set to `"realtime"` and rides in the tag's `metadata` dict so the relay and Command Center can classify the tag without re-deriving it.

---

## 7. Cross-references

| Resource | Notes |
|---|---|
| `mira-relay/clock_resolver.py` | Pure, dependency-free timestamp resolver. All constants, parsers, `find_batch_clock`, `resolve_event_timestamp`. |
| `mira-relay/tag_ingest.py` | Calls `find_batch_clock` + `resolve_event_timestamp` once per batch; writes provenance into JSONB. |
| `mira-crawler/ingest/uns.py:datapoint_path` | Builds the `.datapoint.*` live-state UNS address. |
| `simlab/models.py` | `NamespaceType`, `CATEGORY_NAMESPACE_TYPE`, `TagDef.namespace_type`, `TagDef.resolved_namespace_type`. |
| `simlab/baselines/__init__.py:controller_clock_tags` | Clock tags wired onto `filler01` for eval coverage. |
| `docs/research/2026-06-10-walker-uns-alignment.md` | This feature closes part of **Gap 1** (live-state UNS branch) and **Gap 3** (clock provenance). |
| `docs/specs/uns-kg-unification-spec.md` §3.4 | Canonical statement that telemetry values do not belong in `kg_entities`. |

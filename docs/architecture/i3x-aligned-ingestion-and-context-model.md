# i3X-Aligned Ingestion & Context Model

**Status:** Architecture (research-derived, no code yet)
**Date:** 2026-06-14
**Companion to:** `docs/research/i3x-strategy-for-factorylm-mira.md` (the *why*)
and `docs/implementation/i3x-mvp-plan.md` (the *when*).

> This document describes the **layered pipeline** that turns messy plant signals
> into i3X-conformant, human-approved, hallucination-resistant context — and maps
> every layer to what **already exists** in MIRA vs. what is a **gap**. It is the
> reference model the MVP plan builds against.

---

## 0. Design invariants (carried from MIRA doctrine + i3X)

These are non-negotiable and constrain every layer below.

1. **Read-only by default.** No customer-shipped path opens a write socket to the
   plant; the i3X server declares `update.current=false`, `update.history=false`.
   (`fieldbus-readonly.md`, SaaS scope guard, i3X writes are MAY.)
2. **Raw is separated from approved.** The append-only capture stream is distinct
   from the approved context surface. MIRA already enforces this:
   `tag_events` (raw) vs `live_signal_cache` (current) vs KG (approved objects).
3. **MIRA exposes approved context, not raw guesses.** Everything reachable via
   i3X has passed `approved_tags` (FAIL-CLOSED) and/or KG `approval_state =
   verified`. `proposed` never reaches a consumer.
4. **No historian required.** Current value + a bounded `tag_events` window
   satisfy i3X history-read; a full historian is optional enrichment.
5. **No Ignition 8.3 / Web Dev module required.** Ignition is one adapter among
   many (tag export / browse / existing WebDev endpoint all work). OPC UA, MQTT,
   PLC bridge, and file export are peers.
6. **OPC UA is an adapter, not the master model.** Same posture as CESMII's
   `OPCUA-i3X` wrapper. The UNS/KG is the master.
7. **Modbus cannot auto-discover semantics.** A Modbus register is a number at an
   address; meaning comes from a **device profile + technician approval**, never
   from the wire. (`fieldbus-discovery-spec.md`, `device-profiles/`.)

---

## 1. The layer stack (end to end)

```
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ 9. MIRA INTELLIGENCE LAYER      engine · RAG · diagnosis · MCP · groundedness│
 ├──────────────────────────────────────────────────────────────────────────┤
 │ 8. i3X-COMPATIBLE API LAYER     /info /namespaces /objecttypes ...          │  ← the standard skin
 │                                 /objects/value /objects/history /subscriptions│
 ├──────────────────────────────────────────────────────────────────────────┤
 │ 7. APPROVAL LAYER               approved_tags · ai_suggestions · approval_state│  ← human gate
 ├──────────────────────────────────────────────────────────────────────────┤
 │ 6. RELATIONSHIP LAYER           HasComponent · ControlledBy · Drives ·       │
 │                                 Monitors · AlarmFor · InstanceOf · HasParent  │
 ├──────────────────────────────────────────────────────────────────────────┤
 │ 5. ASSET-ATTACHMENT LAYER       signal → UNS equipment node → kg_entity       │
 ├──────────────────────────────────────────────────────────────────────────┤
 │ 4. CLASSIFICATION LAYER         command/feedback/status/fault/alarm/analog…   │
 ├──────────────────────────────────────────────────────────────────────────┤
 │ 3. NORMALIZATION LAYER          slug paths · types · quality · clock/VQT       │
 ├──────────────────────────────────────────────────────────────────────────┤
 │ 2. RAW CAPTURE LAYER            tag_events (append-only, full truth stream)    │
 ├──────────────────────────────────────────────────────────────────────────┤
 │ 1. INGESTION ADAPTERS LAYER     Ignition · relay · PLC bridge · OPC UA · MQTT  │  ← per-source, read-only
 └──────────────────────────────────────────────────────────────────────────┘
        ▲ PLANT: PLC · SCADA · Ignition · Modbus · OPC UA · MQTT/Sparkplug B
```

Data flows **up** (plant → intelligence/API). Approval (layer 7) is the gate that
divides "raw/proposed" (layers 1–6 working data) from "exposed/verified" (layers
8–9 consumable surface).

---

## 2. Layer 1 — Ingestion adapters

**Job:** speak each source's protocol, read-only, and emit a uniform *raw reading*
envelope. One adapter per source; adapters never share the master model — they
only produce raw readings.

**Uniform raw reading (already the `POST /api/v1/tags/ingest` batch shape):**
```
{ source_system, source_connection_id?, tags: [
    { tag_path, value, value_type, quality?, ts?, equipment_entity_id?, metadata? }
] }
```
`source_system ∈ {ignition, plc_bridge, relay, simulator}` today
(`tag_ingest.py:VALID_SOURCE_SYSTEMS`).

| Adapter | Status in MIRA | Notes |
|---|---|---|
| **Ignition** (WebDev push / tag export / browse) | **EXISTS** | Primary. `source_system="ignition"`. Does **not** require 8.3 or a specific module — push or export both work. |
| **Relay** (cloud endpoint) | **EXISTS** | `mira-relay` ingest endpoint; SaaS path for Ignition factory→cloud. |
| **PLC bridge** (Modbus TCP poll) | **EXISTS (bench-only)** | `plc/live-plc-bridge` — BENCH-ONLY, never customer-shipped (`fieldbus-readonly.md`). Produces readings, but needs a device profile for semantics. |
| **Simulator** | **EXISTS** | `source_system="simulator"` → `simulated=true`, cache-protected. |
| **OPC UA** | **GAP (greenfield)** | No `asyncua` in tree; `mira-connect` deferred. Two options: (a) build a read-only OPC UA→raw-reading adapter; (b) run CESMII `OPCUA-i3X` in front of the OPC UA server and ingest via the i3X **client** (`python-i3x-client`). Prefer (b) where a site already exposes OPC UA. |
| **MQTT / Sparkplug B** | **PARTIAL** | `mira-bridge`/`mira-relay` handle Sparkplug turns for chat; a telemetry→`tag_events` MQTT subscriber is a smaller gap (topic → tag_path normalization). |
| **Fieldbus discovery** | **EXISTS (read-only)** | `plc/discover.py` finds devices + identifies them against `device-profiles/*.yaml`. Feeds *which signals exist*, not their semantics. |

**Constraint applied:** every adapter is read-only; Modbus/OPC-UA discovery yields
*candidate* signals that must pass classification + approval before exposure.

---

## 3. Layer 2 — Raw capture (append-only)

**Job:** record every accepted reading immutably, before any interpretation. This
is the "full truth stream" and the source for i3X **history**.

- **MIRA today:** `tag_events` (mig 033) — append-only, one row per reading, with
  `tenant_id, tag_path, value, value_type, quality, source_system, simulated,
  event_timestamp, uns_path?, equipment_entity_id?, metadata`. Written
  transactionally with the current-value cache (`tag_ingest.persist_batch`).
- **i3X role:** `tag_events` (bounded window or full) backs
  `POST /objects/history` → `HistoricalValueResult { values: VQT[] }`.
- **Gap:** none structurally. A retention/window policy + a `tag_events → VQT[]`
  projection are needed (Phase 2). A historian is **not** required (invariant #4).

---

## 4. Layer 3 — Normalization

**Job:** make raw readings comparable and standards-shaped.

| Concern | MIRA today | i3X target | Gap |
|---|---|---|---|
| Tag-path slug | `normalize_tag_path` (relay) / `uns.slug()` | n/a (internal) | none |
| UNS path | `uns.py` ltree builders | Namespace + element address | none for instances |
| Value typing | `value_type ∈ {bool,int,float,string,enum}` | ObjectType JSON Schema field type | **gap: no per-type schema** (§11) |
| Quality | `{good, bad, stale, uncertain}` + `freshness_status` (036) | VQT `{Good, GoodNoData, Bad, Uncertain}` | **mapping needed** (§4.1) |
| Timestamp + clock | `clock_resolver` (server/source/PLC clock provenance) | VQT `timestamp` RFC 3339 UTC | none (already UTC; emit RFC 3339) |

### 4.1 Quality mapping (MIRA → i3X VQT)

| MIRA `latest_quality` / freshness | i3X VQT `quality` | Rule |
|---|---|---|
| `good` (fresh) | `Good` | direct |
| `bad` | `Bad` | direct |
| `uncertain` | `Uncertain` | direct |
| `stale` (or `freshness_status` stale) | `Uncertain` | downgrade; surface staleness in metadata |
| value absent but object known | `GoodNoData` | **new** — i3X has it, MIRA doesn't model it explicitly |

This mapping is pure projection logic at the API layer — no migration. It is a
named gap (#28 in the strategy checklist) only because the enums differ; the data
to drive it already exists.

---

## 5. Layer 4 — Classification

**Job:** decide *what kind of signal* each tag is. This is a core "compiler pass"
and a key anti-hallucination lever — a typed signal is far harder to misread than
a raw register.

**Target signal classes** (the vocabulary the MVP should standardize):

| Class | Meaning | Example | Direction |
|---|---|---|---|
| `command` | a write target / setpoint the controller acts on | `motor_run`, speed setpoint | (write — exposed read-only as state) |
| `feedback` | controller's echo of a command's effect | `motor_running` | read |
| `status` | discrete state | `conv_state`, `mode` | read |
| `fault` | latched fault flag / code | `fault_alarm`, `error_code` | read |
| `alarm` | active alarm condition | `over_temp_alarm` | read |
| `analog` | continuous measured value | `dc_bus_voltage`, `temperature` | read |
| `speed` | rotational/linear rate | `motor_speed_hz` | read (analog subtype) |
| `current` | electrical current | `motor_current_a` | read (analog subtype) |
| `count` / `totalizer` | accumulating counter | `parts_count` | read |

**MIRA today:** classification is **implicit/ad hoc** — Modbus maps
(`MbSrvConf_v4.xml`), device profiles (`device-profiles/`), and `value_type` carry
fragments, but there is **no first-class signal-class field** on `tag_events` /
`live_signal_cache` / `kg_entities`.

**Gap + approach:** add a `signal_class` (enum) determined by (a) device-profile
declaration, (b) heuristic on tag name/units, (c) technician confirmation. **Never
from the wire alone** (invariant #7). The class becomes part of the i3X ObjectType
(`AnalogSignal`, `FaultSignal`, `CommandSignal`, …) so consumers read typed
objects, not strings.

---

## 6. Layer 5 — Asset attachment

**Job:** bind each classified signal to the physical thing it describes — the UNS
equipment node and its `kg_entity`.

- **MIRA today:** `approved_tags.uns_path` resolves a tag → a UNS equipment/
  datapoint node; `equipment_entity_id` FK links to the asset; `uns.datapoint_path`
  addresses `…equipment.{eq}.datapoint.{tag}`. The UNS hierarchy
  (site→area→line→work_cell→equipment→{component,datapoint,…}) gives every signal
  a home.
- **i3X role:** attachment produces the `parentId` chain. A `datapoint` object's
  `parentId` is its equipment object; equipment's `parentId` is its line/cell;
  etc. i3X requires `parentId` to match the `HasParent` relationship and the
  parent to be `isComposition: true`.
- **Gap:** the UNS *path* expresses containment, but MIRA does not currently emit
  i3X `HasParent`/`isComposition` relationships from it. This is a projection
  (walk the ltree → emit parent edges), not a schema change.

---

## 7. Layer 6 — Relationships

**Job:** express how objects relate beyond containment — the graph the LLM
traverses instead of guessing.

**Target relationship vocabulary (with i3X-required reverse pairs):**

| Relationship | Reverse (`reverseOf`) | Meaning |
|---|---|---|
| `HasComponent` | `ComponentOf` | asset → its component |
| `HasParent` | `HasChild` | containment (drives `parentId`) |
| `ControlledBy` | `Controls` | equipment → its controller/PLC |
| `Drives` | `DrivenBy` | motor/VFD → driven load |
| `Monitors` | `MonitoredBy` | sensor → monitored equipment |
| `AlarmFor` | `HasAlarm` | alarm signal → equipment/condition |
| `InstanceOf` | `HasInstance` | site asset → kb model template |
| `CausesFault` / `caused_by` | (reverse) | fault chain |
| `Feeds` | `FedBy` | material/flow downstream |

**MIRA today:**
- `kg_relationships.relationship_type` (mig 001) is a **single-direction TEXT**
  field — no `reverseOf`, not stored bidirectionally.
- Some predicates already exist in code/MCP (`feeds`, `caused_by`, sequence-walk;
  `INSTANCE_OF` in `uns.py`; `has_component` referenced).
- `relationship_proposals` (mig 018) + `ai_suggestions` (mig 027) propose edges;
  `approval_state` (mig 029) gates them.

**Gaps (#29 in strategy checklist):**
1. **No reverse-pair vocabulary.** i3X requires every RelationshipType to declare
   `reverseOf`. Need a canonical relationship-type registry with reverse names.
2. **Not stored bidirectionally.** i3X requires both directions queryable. Either
   store both edges or synthesize the reverse at the API layer (preferred:
   synthesize, to avoid doubling writes — but `/objects/related` must honor it).
3. **Free-text predicates.** `relationship_type` is unconstrained TEXT; the i3X
   projection needs a closed, namespaced vocabulary.

**Reuse:** `/objects/related` maps directly onto the existing MCP traversal logic
(`feeds`/`caused_by`/sequence-walk in `mira-mcp/server.py`) — the graph walk is
already implemented; it needs an i3X-shaped wrapper, not a reimplementation.

---

## 8. Layer 7 — Approval (the human gate)

**Job:** ensure only confirmed context is exposed. This is MIRA's differentiator
and the boundary between working data and the i3X surface.

- **MIRA today — three complementary gates already exist:**
  1. **`approved_tags`** (mig 035) — FAIL-CLOSED allowlist. A tag not on it is
     *rejected, never stored*. This is the signal-exposure gate.
  2. **KG `approval_state`** (mig 029, on `kg_entities` + `kg_relationships`) —
     `proposed` (default) → `verified` (admin/tech action). Objects/edges are
     `proposed` until a human confirms.
  3. **`ai_suggestions`** (mig 027) + **`relationship_proposals`** (mig 018) —
     the proposal inbox the `/proposals` surface renders;
     proposed → approved transitions per ADR-0017.
- **i3X role:** the i3X server exposes **only** `approved_tags`-allowlisted signals
  and **only** `approval_state = verified` entities/relationships. `proposed`
  content is invisible to consumers. This is what guarantees invariant #3.
- **Gap:** none structurally — the gates exist. The work is wiring the i3X
  projection to filter on them (an `approval_state = 'verified'` predicate +
  allowlist join), and confirming the **VQT/quality** of a value never bypasses
  the gate.

> Correction vs. the original task brief: `approval_state` is **not** in migration
> 001; it was added in **mig 029**. `ai_suggestions` = mig 027,
> `relationship_proposals` = mig 018. Cite those, not 001.

---

## 9. Layer 8 — i3X-compatible API

**Job:** project layers 2–7 into the standard i3X read surface.

| i3X endpoint | Backed by | Status |
|---|---|---|
| `GET /info` | static capabilities (`update.*=false`) | new, trivial |
| `GET /namespaces` | UNS roots + a MIRA type-namespace URI | new (needs namespace URI — gap) |
| `GET /objecttypes`, `POST /objecttypes/query` | signal-class + entity-type → ObjectType + JSON Schema | new (needs per-type schemas — gap) |
| `GET /relationshiptypes`, `POST .../query` | relationship-type registry w/ `reverseOf` | new (needs reverse vocabulary — gap) |
| `GET /objects`, `POST /objects/list` | `kg_entities` (verified) + UNS nodes | new (projection) |
| `POST /objects/related` | `kg_relationships` (verified) — **reuse MCP traversal** | new wrapper over existing logic |
| `POST /objects/value` | `live_signal_cache` → VQT | new (projection + quality map) |
| `POST /objects/history` | `tag_events` window → VQT[] | new (projection; no historian needed) |
| `POST /subscriptions` + `register`/`sync`/`list`/`delete` | poll `live_signal_cache` deltas (`tag_event_diffs` mig 037) | new — **MUST for conformance** |
| `POST /subscriptions/stream` (SSE) | optional | declare `subscribe.stream=false` initially |
| `PUT /objects/value`, `PUT /objects/history` | — | **declare unsupported** (`update.*=false`) |

**Capabilities MIRA declares in `/info` (MVP):**
```
capabilities.query.history   = true   // tag_events window
capabilities.update.current  = false  // read-only doctrine
capabilities.update.history  = false  // read-only doctrine
capabilities.subscribe.stream= false  // sync-only first; SSE later
```
This is **fully conformant** — writes and SSE are MAY.

**Hosting:** keep it decoupled from the internal `mira-mcp`. The public-ingest
spec recommends a separate surface (Next.js route in `mira-hub`, or a small
FastAPI). `mira-hub/src/lib/i3x.ts` (the planned, not-yet-built `toI3xEnvelope`)
is the natural home for the projection helpers.

---

## 10. Layer 9 — MIRA intelligence

**Job:** consume the approved context (internally and via the i3X MCP server).

- **Internal:** the engine/RAG/diagnosis already read UNS/KG/live_signal_cache
  directly — no change. The i3X layer is *additive*, for external consumers and
  for a standardized LLM surface.
- **Via i3X MCP:** once MIRA serves i3X, `cesmii/i3X-MCP-Server` gives MIRA's LLM
  (and customers') a grounded, typed, plant-aware tool surface (`search_objects`,
  `read_current_value`, `get_history`, `find_related`, `describe_type`,
  `watch_values`) with writes disabled — see strategy §6/§7.
- **Anti-hallucination:** typed objects + VQT quality + traversable relationships
  + verified-only exposure (see strategy §6).

---

## 11. Current gaps analysis (consolidated)

Ordered by how much they block i3X conformance. "Additive" = no rewrite of the
master model; a projection or a new column/table.

| # | Gap | Layer | Blocks | Effort | Additive? |
|---|---|---|---|---|---|
| G1 | **No per-type JSON Schema** for object types | 3/8 | `/objecttypes` (MUST) | M | additive (derive from signal-class + entity-type + component templates) |
| G2 | **No Namespace URI** for the type vocabulary | 8 | `/namespaces`, ObjectType (MUST: each type in exactly one namespace) | S | additive (define `https://factorylm.com/uns/v1` etc.) |
| G3 | **No `reverseOf` relationship vocabulary**, not bidirectional | 6/8 | `/relationshiptypes`, `/objects/related` (MUST) | M | additive (registry + synthesize reverse at API) |
| G4 | **Quality enum mismatch** (no `GoodNoData`; `stale`→`Uncertain`) | 3/8 | VQT correctness | S | additive (projection map, §4.1) |
| G5 | **No first-class `signal_class`** (command/feedback/fault/analog…) | 4 | typed objects, classification pass | M | additive (enum column + profile/heuristic/confirm) |
| G6 | **No i3X subscription/sync layer** (poll deltas) | 8 | `/subscriptions/*` (MUST for conformance) | M | additive (reuse `tag_event_diffs` mig 037) |
| G7 | **No `HasParent`/`isComposition` emission** from UNS containment | 5/8 | parentId rule (MUST) | S | additive (walk ltree → emit edges) |
| G8 | **No OPC UA adapter** | 1 | OPC UA ingestion | M–L | new adapter, or reuse `OPCUA-i3X` + i3X client |
| G9 | **`toI3xEnvelope` / i3x.ts not built** | 8 | the whole API layer | — | the implementation work itself |
| G10 | **`tag_events` history window/retention policy** undefined | 2/8 | `/objects/history` quality | S | additive (config) |

**What is NOT a gap (already in place):** raw capture (`tag_events`), current
value (`live_signal_cache`), the approval gate (`approved_tags` + `approval_state`
+ `ai_suggestions`/`relationship_proposals`), the relationship-traversal logic
(MCP), the UNS address space (`uns.py`), quality + freshness + clock provenance,
tenancy/RLS. The master model is sound; the work is the *typed projection skin*.

---

## 12. The one-paragraph summary

MIRA already has eight of the nine layers a contextualized industrial platform
needs: read-only adapters, append-only raw capture, normalization, asset
attachment, a relationship store, a human approval gate, and an intelligence
layer. What it lacks is the **typed projection** i3X standardizes — per-type JSON
Schemas, namespace URIs, reverse-paired relationship vocabulary, a VQT quality
map, a first-class signal classification, and a polled subscription layer. None of
these require rewriting the UNS/KG master model; they are additive projections and
small columns. Build them as a **read-only i3X skin downstream of the approval
gate**, reuse CESMII's MCP server and Python client, and treat OPC UA as just
another adapter — and FactoryLM becomes a conformant "industrial context compiler"
that any i3X consumer (or LLM) can ground on without hallucinating.

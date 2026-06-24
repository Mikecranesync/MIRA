# Lane 3 — MQTT/Sparkplug subscriber: design review (DESIGN ONLY, no implementation)

**Status:** design review for the roadmap's **Lane 3** (`docs/plans/2026-06-22-simlab-uns-ingest-roadmap.md`).
**Decision sought:** lock the architecture so the MQTT/Sparkplug subscriber becomes a **second
ingestion SOURCE feeding the one canonical pipeline**, not a parallel re-implementation.
**Non-goal of this doc:** writing the subscriber. No production code here.

**Companion proofs:** L1/L2 (PR #2280) made the HTTP relay path turnkey; this lane adds the
*foreign-feed* path (how a real factory's Ignition/Sparkplug UNS arrives). The same convergence
discipline that let SimLab reuse `ingest_batch` applies here — more so, because the temptation to
fork is higher.

---

## 0. The thesis in one diagram

```
HTTP source  (SimLab RelayIngestPublisher / Ignition tag-stream timer)
   │  POST /api/v1/tags/ingest  + HMAC                       relay_server.tags_ingest
   ▼
MQTT source  (this lane: mira-relay/mqtt_ingest subscriber)
   │  broker subscribe → DECODE topic+payload → canonical batch dict + tenant
   ▼
        ┌─────────────────────────────────────────────────────────────┐
        │  tag_ingest.ingest_batch(payload, tenant_id, store)          │  ← THE ONLY pipeline
        │  • allowlist (fail-closed)  • normalize_tag_path  • provenance │
        │  • UNS resolve from allowlist • cache-protection • persist     │
        └─────────────────────────────────────────────────────────────┘
                                   │ store.persist_batch (ONE txn)
                                   ▼
                      tag_events (raw)  +  live_signal_cache (UNS latest)
```

**Rule:** the subscriber's entire job is **transport + decode**. Everything from the canonical
batch dict onward is `ingest_batch`. If the subscriber ever calls `persist_batch` directly,
re-normalizes, or re-checks the allowlist, that is the failure this doc exists to prevent.

---

## 1. Subscriber architecture

A read-only, config-bound, per-tenant process. Owns `mira-relay/mqtt_ingest/` (new; the dir does
not exist yet — greenfield, so no "merge into existing" hazard).

```
mqtt_ingest/
  subscriber.py     # aiomqtt connect/subscribe loop, reconnect/backoff, graceful shutdown
  decode.py         # topic+payload -> canonical "tag entry" dict(s); NO persistence
  codecs/
    plain_json.py   # SimLab/simple brokers: {"value","ts","source"} + from_mqtt_topic
    sparkplug_b.py  # spBv1.0 protobuf: BIRTH alias table, DDATA deltas (Phase 3b)
  config.py         # tenant_id, broker, topic filters, source_system, codec choice
```

Key properties:
- **One subscriber instance ↔ one (tenant, broker).** Tenant comes from **config**, never from
  the topic. This mirrors `.claude/rules/direct-connection-uns-certified.md`: a direct connection
  carries its UNS identity by construction; a foreign feed that cannot resolve a tenant/UNS is
  **rejected, not downgraded**. (MQTT has no per-message HMAC — broker TLS + per-topic ACL is the
  transport auth; the tenant binding is the subscriber's config, exactly like the PLC bridge.)
- **Read-only.** Subscribe only. **Never** publish a CMD/NCMD/DCMD or any control topic
  (`.claude/rules/fieldbus-readonly.md`, train-before-deploy read-only-in-beta). The codec must not
  even construct a publish path.
- **Batches per flush, not per message.** Buffer messages for a short window (e.g. 250 ms) or N
  messages, then emit ONE `ingest_batch` call. This matches the HTTP path's batch semantics and
  the `persist_batch` single-transaction guarantee, and amortizes the allowlist load.
- **Best-effort, isolated, observable.** A decode error on one message drops that message (logged),
  never the batch; a DB error fails the batch and relies on broker redelivery/QoS — same posture as
  the relay route. Emit the same `accepted/rejected/cache_skipped/simulated` counters the HTTP path
  logs.

---

## 2. Sparkplug B ingestion strategy (phased)

Sparkplug B is **not** plain JSON — it is protobuf with a stateful session model. A correct
subscriber must:
- Track **NBIRTH/DBIRTH** per `edge/device` to build the **alias → metric-name** table and the
  metric **datatype**. DDATA/NDATA carry aliases + values only; without the BIRTH table they are
  meaningless.
- Honor **bdSeq / seq** ordering and **NDEATH/DDEATH** (LWT) → mark the device stale; on rebirth,
  rebuild the alias table.
- Decode **protobuf** (eclipse-tahu schema). This is the materially harder part and the reason to
  phase:

| Phase | Codec | Feeds | Scope |
|---|---|---|---|
| **3a** | `plain_json` | SimLab self-MQTT (`MqttPublisher`) + simple JSON brokers | reuse `from_mqtt_topic`; the SimLab path is already provable end-to-end the moment the subscriber exists |
| **3b** | `sparkplug_b` | real Ignition/edge gateways (Flexware EMQX) | tahu protobuf + BIRTH/alias state machine; lowers each DDATA metric into the SAME canonical tag entry |

Both codecs terminate identically: a list of canonical tag entries → `ingest_batch`. Sparkplug is a
**decoder**, not a second pipeline.

---

## 3. Mapping: MQTT/Sparkplug payload → existing ingest models

The canonical batch dict (consumed by `ingest_batch`, validated against `VALID_SOURCE_SYSTEMS`,
`VALID_VALUE_TYPES = {bool,int,float,string,enum}`, `VALID_QUALITY`):

```json
{ "source_system": "...", "source_connection_id": "<broker/edge id>",
  "tags": [ { "tag_path": "...", "value": ..., "value_type": "...",
              "quality": "good", "ts": "<iso>", "equipment_entity_id": null, "metadata": {} } ] }
```

| Canonical field | plain-JSON (SimLab) source | Sparkplug B source | Risk / note |
|---|---|---|---|
| `tag_path` | `from_mqtt_topic(topic)` → dot-ltree | `group/edge/device` + metric name → ltree | **MUST** normalize to the seeded `approved_tags.normalized_tag_path` (see §5) |
| `value` | payload `value` | metric value (post-alias) | Sparkplug typed; JSON loosely typed |
| `value_type` | **MISSING** in payload (`{value,ts,source}` only) | metric `datatype` → map to enum | **Gap:** plain-JSON drops value_type. Recover from `tag_entities.data_type` (mig 025) or infer from the Python type. Decide once. |
| `quality` | **MISSING** (defaults to `good`) | metric `is_null`/quality flags | default `good`; map Sparkplug quality where present |
| `ts` | payload `ts` (epoch) → iso | metric/payload timestamp | both already epoch-ish |
| `source_system` | config (`"simulator"`) | config (e.g. `"ignition"`) | **`mqtt`/`sparkplug` are NOT in `VALID_SOURCE_SYSTEMS`** — see §6 decision |
| `tenant_id` (batch-level) | subscriber config | subscriber config | never topic-derived |
| `equipment_entity_id` / `metadata` | optional | optional (edge/device id in metadata) | passthrough |

Two payload-shape facts that drive design:
1. **The SimLab MQTT envelope omits `value_type` and `quality`** (`simlab/publishers.py::_mqtt_stamp`
   = `{value, ts, source}`). The HTTP path keeps them (`Reading.to_ingest_tag()`). So the plain-JSON
   codec needs a `value_type` recovery rule. **Cleanest:** the codec looks up `value_type` from the
   allowlist/catalog row (the subscriber already must consult the allowlist's UNS mapping), avoiding
   a guess. Worst case (no catalog), infer from `type(value)`.
2. **Sparkplug datatype → `VALID_VALUE_TYPES`** is a fixed map (`Int8..Int64/UInt* → int`,
   `Float/Double → float`, `Boolean → bool`, `String/Text → string`, template/enum → `enum`). Define
   it once in `codecs/sparkplug_b.py`.

---

## 4. Reuse opportunities from the SimLab relay path (L1/L2)

| Reuse | What | Why it's safe to reuse |
|---|---|---|
| **`ingest_batch`** | the whole allowlist→normalize→provenance→persist pipeline | store-agnostic by design (`tag_ingest.py`); SimLab already proved a non-HTTP caller can drive it |
| **`NeonTagStore`** | `load_allowlist`, `current_state_simulated`, `persist_batch` | same atomic events+cache txn + sim-never-overwrites-real guarantee |
| **`normalize_tag_path`** | the authoritative normalizer | the fail-closed match key — MUST be the same function (see §5) |
| **`from_mqtt_topic`** | topic → ltree inversion for the plain-JSON codec | already the inverse of the SimLab projection; reuse verbatim |
| **seed-generator pattern** | `gen_approved_tags_simulator.py` | a Sparkplug-aware analog (`gen_approved_tags_<edge>.py`) emits the allowlist from the BIRTH metric set, normalized identically |
| **validation runbook shape** | the 8-step land/verify checklist | the subscriber's staging proof is steps 2/4/5/6/7/8 with MQTT in place of HTTP |

**Do NOT reuse:** the HMAC layer (`auth.py`, the `X-MIRA-*` signing) — that is HTTP-request auth;
MQTT auth is broker TLS/ACL + config tenant binding. Forcing HMAC onto MQTT would be the wrong shape.

---

## 5. Risk: diverging normalization behavior (the #1 hazard)

The relay is **fail-closed**: a tag whose `normalize_tag_path(tag_path)` is not in `approved_tags`
is silently rejected. So normalization is a *contract between three artifacts that must agree*:
the **seed** (what's allowlisted), the **live traffic** (what the subscriber emits), and the
**relay** (what it computes to match). The HTTP path proved how easily these drift — there are
**already three copies** of the normalizer (`tag_ingest.normalize_tag_path`,
`gen_approved_tags_simulator.py::normalize_tag_path`, and the SimLab slug), held together only by
`tests/simlab/test_approved_tags_seed.py`'s pin.

Adding a fourth caller (the MQTT codec) without consolidating multiplies the drift surface:
- If the Sparkplug codec builds `tag_path` one way and the seed generator another, **every metric is
  rejected** (the step-2/step-4 failure mode) — and fail-closed makes it **silent**: zero rows, no
  error, just an empty `live_signal_cache`.
- Display-case inversion is a live trap: `to_mqtt_topic` PascalCases (`FloridaNaturalDemo`); a naive
  codec that lowercases the raw topic without `from_mqtt_topic` produces a *different* slug than the
  seed and bounces everything.

**Mitigation (must precede 3b):** one importable normalizer, and a single seed-generator pattern
that the subscriber and the seed both derive from the same metric source (BIRTH set). Pin every
caller to it with the same test shape already in `test_approved_tags_seed.py`.

---

## 6. Risk: duplicate logic (the #2 hazard) + the schema decision it forces

Tempting forks, and why each is wrong:
- **Subscriber writes `tag_events`/`live_signal_cache` directly** → bypasses the atomic events+cache
  transaction and the *sim-never-overwrites-real* cache protection (`ingest_batch` lines that read
  `current_state_simulated` first). A foreign feed clobbering a real cache row is exactly the
  provenance bug the relay was built to prevent. **Always** go through `ingest_batch`.
- **Subscriber re-implements the allowlist** → two allowlist semantics to keep in sync; fail-closed
  drift. Reuse `store.load_allowlist`.
- **A second provenance rule** → `simulated` is derived ONCE from `source_system` in `ingest_batch`;
  a subscriber-side `simulated` flag would let a batch mix sim/real. Don't set it; let the pipeline.

**Concrete schema decision forced now:** `VALID_SOURCE_SYSTEMS = {ignition, plc_bridge, relay,
simulator}`. A foreign MQTT/Sparkplug feed is conceptually `ignition` (Ignition edge) but may want
its own value for provenance/freshness analytics. **Recommendation:** map real edge feeds to the
existing `ignition` (no schema change, matches "this is the Ignition UNS arriving"); only add a new
`source_system` if a feed is genuinely neither. If added, it is a **coordinated change**:
`VALID_SOURCE_SYSTEMS` (relay), any CHECK constraint on `tag_events.source_system`/
`live_signal_cache.source_system`, and the freshness/provenance queries — one migration, dev→staging→prod.

---

## 7. Shared components to EXTRACT before implementation (the pre-work)

> **STATUS 2026-06-23 — items 1 & 2 DONE (PR: Lane 3 §7 pre-work).** Items 3 & 4 are
> subscriber-phase work and remain **unstarted** (no MQTT/broker/Sparkplug code exists yet).

**Migration note — why consolidate BEFORE writing the subscriber.** The fail-closed allowlist
makes normalization a silent contract: a 4th caller (the MQTT codec) that normalizes even slightly
differently would get *every* metric rejected with **zero errors** (empty `live_signal_cache`, no
log). Extracting the one normalizer + one batch shape first means the subscriber is written against
a contract that already has exactly one implementation and a regression net — there is no window in
which a second inlet can fork the core. Doing it after would mean retro-fitting a divergence that is
invisible until it drops data on the floor. This PR adds **no** transport code; it only converges
existing callers onto a single contract.

Ordered; each is small and is the price of "one pipeline, many sources":

1. ✅ **Canonical normalizer — single source of truth.** **Done:** `normalize_tag_path` now lives in
   **`mira-relay/ingest_contract.py`** (dependency-free, in the relay container — the relay Dockerfile
   gains a `COPY ingest_contract.py`). `mira-relay/tag_ingest.py` **re-exports** it (so
   `from tag_ingest import normalize_tag_path` is unchanged, identity-tested). The seed generator
   (`tools/seeds/gen_approved_tags_simulator.py`) loads it **by file path** (no `sys.path` pollution)
   instead of its old mirror. The two mirrored copies are gone; the slug *path-builder*
   `simlab.uns.slug` is a different role (per-label, not full-path matching) and is intentionally left
   in place. Pinned by `tests/simlab/test_ingest_contract.py` (relay re-export identity + no surviving
   local copies + seed-uses-canonical for all 89 tags) and the existing
   `tests/simlab/test_approved_tags_seed.py`. Closes §5 at the root.
2. ✅ **Canonical tag-entry + batch builder.** **Done:** `build_tag_entry(...)` + `build_ingest_batch(...)`
   in `mira-relay/ingest_contract.py`. SimLab's `RelayIngestPublisher` now assembles its payload via
   `build_ingest_batch` (byte-identical output → HMAC body + bearer-tenant behavior unchanged); the
   future MQTT/Sparkplug codecs and the engine bridge call `build_tag_entry` per decoded message.
   Pinned by `test_ingest_contract.py` (builder output accepted by `ingest_batch`; a future-MQTT-shape
   fixture maps a decoded message to the same canonical batch — **no subscriber**).
3. ⏳ **A `value_type`/quality recovery rule** for sources whose payload omits them (plain-JSON MQTT),
   resolved from `tag_entities.data_type` (mig 025) — extract a small resolver the codec calls.
   **(Subscriber-phase — unstarted.)**
4. ⏳ **Topic→tag_path resolver interface** with the two codec impls behind it, both terminating in the
   shared normalizer. Keeps Sparkplug's complexity quarantined in one file without a parallel pipeline.
   **(Subscriber-phase — unstarted.)**

None of these require touching `ingest_batch`'s logic — they converge *more* code onto it.

### Extracted API (the contract the subscriber will be written against)

```python
# mira-relay/ingest_contract.py  — dependency-free; THE single ingest contract
normalize_tag_path(raw: str) -> str
build_tag_entry(tag_path, value, *, value_type="string", quality="good",
                ts=None, equipment_entity_id=None, metadata=None) -> dict
build_ingest_batch(source_system, tags, *, tenant_id=None,
                   source_connection_id=None) -> dict
VALID_VALUE_TYPES, VALID_QUALITY            # the vocabularies ingest_batch enforces
```

---

## 8. Recommendation for sequencing Lane 3

1. **Pre-work first:** §7.1 (single normalizer) + §7.2 (canonical batch builder). Small, no behavior
   change, removes the divergence root before a fourth caller lands. Ships with the same pin-tests.
2. **Phase 3a (plain-JSON codec):** reuse `from_mqtt_topic`; prove SimLab self-MQTT lands via the
   subscriber using the L1/L2 staging runbook with MQTT swapped for HTTP. Lowest risk, immediate value.
3. **Phase 3b (Sparkplug B):** tahu protobuf + BIRTH/alias state machine + a Sparkplug-aware seed
   generator; the foreign-feed path. Gate on 3a green.

**Architectural acceptance criterion for the whole lane:** a `grep` for `persist_batch`,
`load_allowlist`, and any `normalize`-style function shows the MQTT subscriber calls them **only via
`ingest_batch`/the shared normalizer** — zero parallel implementations. If the subscriber grows its
own allowlist, normalizer, or DB write, the lane has failed its thesis.

---

## Cross-references
- `docs/plans/2026-06-22-simlab-uns-ingest-roadmap.md` — Lane 3 row, §2 UNS mapping rules.
- `mira-relay/tag_ingest.py` — `ingest_batch`, `NeonTagStore`, `normalize_tag_path` (convergence).
- `simlab/uns.py` — `to_mqtt_topic` / `from_mqtt_topic`; `simlab/publishers.py` — `MqttPublisher` envelope.
- `mira-hub/db/migrations/025_tag_entities.sql` — `data_type` (value_type recovery source).
- `.claude/rules/fieldbus-readonly.md`, `.claude/rules/direct-connection-uns-certified.md`,
  `.claude/rules/train-before-deploy.md` — read-only + tenant-binding constraints.
- `docs/runbooks/2026-06-23-simlab-relay-ingest-staging-validation.md` — the proof shape Lane 3 reuses.

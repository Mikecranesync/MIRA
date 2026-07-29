# Lane 3 Phase 3a — plain-JSON MQTT subscriber codec: implementation plan

> ## 🚦 IMPLEMENTATION GATE — DO NOT WRITE CODE YET
> This plan may be executed **only after BOTH**:
> 1. **PR #2280** (L1/L2 relay ingest) — its 8-step **staging validation is GREEN**
>    (`docs/runbooks/2026-06-23-simlab-relay-ingest-staging-validation.md`).
> 2. **PR #2281** (Lane 3 §7 pre-work — `mira-relay/ingest_contract.py`) — **merged**.
>
> Until then this is a design artifact. The first inlet (HTTP) must be staged before the
> second inlet (MQTT) is cut. This document is the ready-to-run plan, not a license to start.

**Lane:** Lane 3 / Phase **3a** only (`docs/plans/2026-06-22-simlab-uns-ingest-roadmap.md`).
**Design basis:** `docs/design/2026-06-23-lane3-mqtt-subscriber-design.md` (§1 architecture, §3 mapping,
§7 extracted contract). **Pre-work it stands on:** `mira-relay/ingest_contract.py` (#2281).

---

## 1. Goal & non-goals

**Goal:** a read-only MQTT subscriber that lands **plain-JSON** tag messages (SimLab's own
`MqttPublisher` envelope, and simple JSON brokers) into `tag_events` + `live_signal_cache` through the
**existing `ingest_batch` pipeline** — a second *transport*, zero new pipeline logic.

**In scope (3a):**
- A read-only aiomqtt subscriber loop (connect, subscribe, buffer, flush).
- A `plain_json` codec: MQTT topic + `{"value","ts","source"}` → canonical tag entry via the #2281
  contract (`build_tag_entry` / `build_ingest_batch`).
- Landing via `ingest_batch(payload, tenant_id, NeonTagStore(...))` — the same call the HTTP route makes.
- Tests with a **fake aiomqtt** (no broker) + an in-memory-store e2e (no NeonDB).

**Explicitly NOT in 3a (deferred):**
- ❌ Sparkplug B / protobuf / eclipse-tahu (that is **Phase 3b**).
- ❌ Any publish / CMD path (`.claude/rules/fieldbus-readonly.md`; read-only-in-beta).
- ❌ Broker stand-up (infra — `roadmap §6`, Mike).
- ❌ A `value_type` catalog lookup against `tag_entities.data_type` (3a infers from the JSON value's
  Python type; the catalog resolver is §7 item 3, pulled in only when a feed needs it).
- ❌ A new allowlist seed for the SimLab self-feed (the **L2 `simulator` seed is reused as-is** — see §6).

---

## 2. Preconditions — what is already built (do not rebuild)

| Reusable | Where | Role in 3a |
|---|---|---|
| `ingest_batch(payload, tenant_id, store)` | `mira-relay/tag_ingest.py` | THE pipeline — allowlist, normalize, provenance, persist. The codec calls it. |
| `NeonTagStore` | `mira-relay/tag_ingest.py` | prod store (`load_allowlist`, `persist_batch`) — reuse verbatim. |
| `normalize_tag_path` / `build_tag_entry` / `build_ingest_batch` | `mira-relay/ingest_contract.py` (#2281) | the canonical contract the codec produces against. |
| `from_mqtt_topic(topic) -> uns_path` | `simlab/uns.py` | topic → canonical ltree path. **Verified non-lossy** for all 89 SimLab tags (round-trips, and its `normalize_tag_path` equals the L2 seed key). |
| L2 `simulator` allowlist seed | `tools/seeds/approved_tags_simulator.sql` | the 89 rows a SimLab self-MQTT message matches — **no new seed needed**. |
| fake-aiomqtt test pattern | `tests/simlab/test_publishers.py::_FakeClient` | mirror it for the subscribe side (no broker in CI). |
| in-memory-store e2e pattern | `tests/simlab/test_relay_ingest_e2e.py` | land-without-NeonDB proof for the subscriber. |

**Verified fact (re-confirm at build time):** `from_mqtt_topic(to_mqtt_topic(p)) == p` and
`normalize_tag_path` of the inverted path == the L2 seed's `normalized_tag_path`, for **all 89** SimLab
tags. So the codec MUST resolve the path via `from_mqtt_topic` (NOT naive lowercasing — that is the
display-case trap from the design review §5, which `from_mqtt_topic` avoids).

---

## 3. Architecture & file layout (owned dir: `mira-relay/mqtt_ingest/`)

```
mira-relay/
  mqtt_ingest/
    __init__.py
    config.py        # SubscriberConfig: tenant_id, broker host/port, topic filters,
                     #   source_system, codec name, flush window/size. Tenant from CONFIG.
    decode.py        # plain_json codec: (topic, payload_bytes) -> list[tag entry] | None
    subscriber.py    # aiomqtt connect/subscribe loop; buffer -> flush -> ingest_batch
    run.py           # `python -m mqtt_ingest` entrypoint (reads env/Doppler, builds config)
  Dockerfile         # add: COPY mqtt_ingest/  (dir copy) + `pip install aiomqtt`
  tests/
    test_mqtt_decode.py       # codec unit tests (fake payloads; no broker)
    test_mqtt_subscriber.py   # loop + ingest seam via fake aiomqtt + in-memory store
```

**Dockerfile note (mandatory):** the relay image uses **per-file `COPY`**. Adding `mqtt_ingest/`
requires `COPY mqtt_ingest/ ./mqtt_ingest/` (or per-file lines) **and** `aiomqtt` in the `pip install`
line — omitting either crash-loops the import (cf. the 2026-06-02 `ModuleNotFoundError` incident the
#2281 `ingest_contract` COPY also guards). The subscriber is a **separate process/service**, not part
of `relay_server`'s ASGI app — it shares the codebase + `NeonTagStore`, not the HTTP route.

---

## 4. The decode contract (`decode.py`)

Input: an MQTT `(topic: str, payload: bytes)`. Output: a list of **canonical tag entries** (usually 1),
or `None`/`[]` to drop (logged, never raises).

```
plain_json(topic, payload, *, source_system) -> list[dict]:
  1. msg = json.loads(payload)                      # {"value":…, "ts":<epoch float>, "source":…}
  2. uns_path = from_mqtt_topic(topic)              # canonical ltree path (NON-lossy; §2)
  3. value = msg["value"]                           # drop if missing → []
  4. value_type = _infer_value_type(value)          # bool|int|float|string  (see below)
  5. quality = msg.get("quality", "good")           # plain-JSON omits it → good (ingest_batch
                                                     #   downgrades unknowns to "uncertain")
  6. ts_iso = _epoch_to_iso(msg.get("ts"))          # epoch float → ISO-8601 (HTTP path uses ISO)
  7. return [build_tag_entry(uns_path, value, value_type=value_type,
                             quality=quality, ts=ts_iso,
                             metadata={"transport":"mqtt","topic":topic})]
```

`_infer_value_type(value)` (3a rule — dependency-free, no catalog):
`bool→"bool"` (check bool **before** int — `isinstance(True,int)` is True), `int→"int"`,
`float→"float"`, else `"string"`. Maps into `VALID_VALUE_TYPES`. *(When a real feed needs exact types
beyond JSON's, §7 item 3's `tag_entities.data_type` resolver is added — out of 3a scope.)*

**Worked example (SimLab self-feed):**
```
topic   = FactoryLM/FloridaNaturalDemo/Plant1/JuiceBottling/Line01/Filler01/process/fill_level_oz
payload = {"value": 11.5, "ts": 1735689601.0, "source": "simulator"}
->  uns_path = enterprise.florida_natural_demo.plant1.juice_bottling.line01.filler01.process.fill_level_oz
->  entry    = {tag_path: <uns_path>, value: 11.5, value_type: "float", quality: "good",
                ts: "2025-01-01T00:00:01Z", metadata:{transport:"mqtt", topic:<topic>}}
->  normalize_tag_path(uns_path) == the L2 seed's normalized_tag_path  ⇒ allowlisted ⇒ lands.
```

---

## 5. Subscriber loop & landing (`subscriber.py`)

```
async run(config, store):
  async with aiomqtt.Client(config.host, config.port, tls=…) as client:
    await client.subscribe(config.topic_filter)        # e.g. "FactoryLM/#"
    buffer = []
    async for message in client.messages:
      entries = plain_json(message.topic.value, message.payload,
                           source_system=config.source_system)
      buffer.extend(entries or [])
      if len(buffer) >= config.flush_size or _flush_window_elapsed():
        _flush(buffer, config, store); buffer.clear()

_flush(entries, config, store):
  payload = build_ingest_batch(config.source_system, entries)   # tenant via store/HMAC-less in-proc
  ingest_batch(payload, config.tenant_id, store)                # SAME pipeline as the HTTP route
```

- **Batch, don't ingest-per-message** — matches the `persist_batch` single-transaction guarantee and
  amortizes `load_allowlist`. Flush on size OR a short time window (e.g. 250 ms).
- **Best-effort + isolated:** a decode error drops that one message (logged); a DB error fails the
  flush and relies on the next flush / broker redelivery (QoS≥1) — same posture as the relay route.
  The loop never dies on one bad message.
- **Reconnect/backoff:** aiomqtt raises `MqttError` on disconnect; wrap the `async with` in a
  retry-with-backoff loop. On reconnect, re-subscribe (broker may not retain subscriptions).
- **Counters:** log `accepted/rejected/cache_skipped` from the `ingest_batch` result, same as the HTTP
  route — feeds the same observability.

---

## 6. Tenant, config & seeding

- **Tenant is CONFIG, never topic-derived.** One subscriber instance ↔ one `(tenant, broker)`
  (`.claude/rules/direct-connection-uns-certified.md`: a foreign feed carries its identity by
  construction; one that can't resolve a tenant is **rejected**, not downgraded). The SimLab self-feed
  config uses `SIMLAB_TENANT_ID`.
- **Allowlist (fail-closed) is unchanged.** `ingest_batch` enforces it. For the **SimLab self-feed the
  L2 `simulator` seed is reused verbatim** — §2's verification proves a SimLab MQTT message lands on
  those exact 89 keys. **No new seed in 3a.**
- **A foreign (non-SimLab) JSON broker** needs its own `approved_tags` seed for its `source_system`,
  generated the same way `gen_approved_tags_simulator.py` does (a 3a-adjacent task **only if** a real
  foreign JSON feed is onboarded; the SimLab self-feed alone needs nothing new).

---

## 7. Safety / read-only constraints (hard)

- **Subscribe only.** No publish, no CMD/NCMD/DCMD topic, no client `.publish(...)` anywhere in
  `mqtt_ingest/` (`.claude/rules/fieldbus-readonly.md`, train-before-deploy read-only-in-beta).
- **No fieldbus client** (`pymodbus`/`pycomm3`/`opcua`/…) — MQTT only.
- **Provenance preserved by the pipeline:** `simulated` is derived once from `source_system` inside
  `ingest_batch`; the codec must NOT set it. Sim-never-overwrites-real cache protection is the
  pipeline's, not the codec's.

---

## 8. Testing strategy (no broker, no NeonDB in CI)

1. **`test_mqtt_decode.py`** — `plain_json` unit tests on synthetic `(topic, payload)`: SimLab envelope
   → correct entry; `value_type` inference (bool-before-int, int, float, string); missing value → `[]`;
   malformed JSON → `[]` (logged, no raise); epoch→ISO ts. **Assert `from_mqtt_topic`+`normalize_tag_path`
   of the decoded path equals the L2 seed key for the SimLab tag set** (the fail-closed guarantee).
2. **`test_mqtt_subscriber.py`** — fake aiomqtt (mirror `_FakeClient`, feeding a scripted `messages`
   async-iter) + the in-memory `TagStore` from `test_relay_ingest_e2e.py`. Drive N messages → assert
   rows land in `events`/`state` with resolved `uns_path`; a malformed message doesn't stop the loop;
   a store error doesn't kill the loop; tenant comes from config.
3. **Reuse the seam discipline of #2280** — the subscriber's land assertions mirror the HTTP e2e seam.
4. **(Staging, infra-gated)** — point the subscriber at a real Mosquitto fed by `SIMLAB_MQTT_HOST`
   (the MQTT emit half already exists, `cfe42179`) and confirm `live_signal_cache` fills — this is the
   roadmap §6/§7 staging proof, reusing the L1/L2 validation runbook shape with MQTT in place of HTTP.

---

## 9. Build sequence (TDD; only after the gate clears)

1. `config.py` + a failing `test_mqtt_decode.py` → implement `plain_json` + `_infer_value_type` +
   `_epoch_to_iso` until green. (Pure functions — fastest, highest-value.)
2. `subscriber.py` loop against fake aiomqtt + in-memory store → `test_mqtt_subscriber.py` green.
3. `run.py` entrypoint (env/Doppler → config). Dockerfile: `COPY mqtt_ingest/` + `aiomqtt`.
4. Compose wiring as a **separate service** (saas) — infra step, staged first; not in the code PR.
5. Staging proof (§8.4) + a short runbook addendum.

Keep it one reviewable PR for steps 1–3 (code+tests, no infra), mirroring the #2281 discipline.

---

## 10. Acceptance criteria

- A SimLab MQTT message (real `MqttPublisher` envelope) lands in `tag_events` + `live_signal_cache`
  with the resolved `uns_path`, **via `ingest_batch`** (grep proof: `mqtt_ingest/` calls
  `ingest_batch` + `build_tag_entry`/`build_ingest_batch` + `from_mqtt_topic`, and contains **no**
  `persist_batch`, `load_allowlist`, normalizer, or publish of its own — the Lane-3 thesis check).
- Decode/loop tests pass with **no broker and no NeonDB**.
- `value_type` inference correct (esp. bool-before-int); fail-closed match verified against the L2 seed.
- Read-only audit clean (no publish path); `mira-run-hallucination-audit` unaffected.

---

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Display-case normalization drift** (design §5) | Use `from_mqtt_topic` (verified non-lossy for all 89 tags); a test pins decoded-key == seed-key. Never lowercase the raw topic. |
| **`value_type` mislabel** (JSON loses exact types) | 3a infers from Python type (bool-before-int); exact typing deferred to the `tag_entities.data_type` resolver (§7.3) when a feed needs it. |
| **Retained messages replay on (re)subscribe** | Idempotent landing — `tag_events` is append-only by design; `live_signal_cache` upsert is last-writer; acceptable. Note in the runbook. |
| **QoS / at-least-once duplicates** | `tag_events` append + cache upsert tolerate dupes; provenance unaffected. |
| **A second inlet forks the core** | The acceptance grep-check forbids any allowlist/normalizer/persist/publish inside `mqtt_ingest/`. |
| **Tenant spoofing via topic** | Tenant is config-only; topic never sets it. |

---

## 12. Out of scope → later phases
- **Phase 3b:** Sparkplug B (tahu protobuf, NBIRTH/DBIRTH alias state machine, NDATA/DDATA), foreign-feed
  seed generator, `source_system` enum decision (design §6).
- **Lanes 4–5:** Command Center live-value panel; production `live_signal_cache` → Supervisor bridge.

## Cross-references
- `docs/design/2026-06-23-lane3-mqtt-subscriber-design.md` — architecture + the §7 contract this builds on.
- `docs/plans/2026-06-22-simlab-uns-ingest-roadmap.md` — Lane 3 row, §2 UNS mapping rules, §6 infra.
- `docs/runbooks/2026-06-23-simlab-relay-ingest-staging-validation.md` — the proof shape 3a reuses.
- `mira-relay/ingest_contract.py` (#2281), `mira-relay/tag_ingest.py`, `simlab/uns.py` (`from_mqtt_topic`),
  `simlab/publishers.py` (`MqttPublisher` envelope), `tools/seeds/approved_tags_simulator.sql` (L2 seed).

# Phase 3a (plain-JSON MQTT ingestion) — readiness assessment

**Date:** 2026-06-24. **Status:** assessment only — **do not implement.** Companion to the gated plan
`docs/plans/2026-06-23-lane3-phase3a-plain-json-mqtt-codec.md` and the §7 pre-work already merged
(`mira-relay/ingest_contract.py`, Contract 5 guard).

**The headline recommendation:** **build MQTT AFTER the contextualization demonstration, not before.**
Rationale below.

---

## Context: what's already true
- The ingest foundation (SimLab → relay → `ingest_batch` → `tag_events`/`live_signal_cache`) is **landed
  on main (v3.40.0) and 8/8 staging-proven** over the **HTTP relay path**.
- The §7 pre-work is done: the **canonical contract** (`normalize_tag_path` / `build_tag_entry` /
  `build_ingest_batch`) and the **one-pipeline conformance guard** are on main. So MQTT, when built,
  is a thin *transport* that calls the existing contract — not a parallel system.
- The contextualization demo (Phase 3 plan) runs **entirely on the HTTP path** and needs **no MQTT**.

---

## 1. Remaining risks (for the MQTT build itself)
| Risk | Severity | Note / mitigation |
|---|---|---|
| **Normalization divergence** (display-case trap) | Low (now) | `from_mqtt_topic` verified non-lossy for all 89 SimLab tags → same allowlist key. The Contract 5 guard + single normalizer prevent a fork. |
| **`value_type`/`quality` recovery** (SimLab MQTT envelope drops them) | Med | Phase 3a infers `value_type` from the Python type (bool-before-int); exact typing deferred to a `tag_entities.data_type` resolver only if a feed needs it. |
| **Retained-message replay / QoS dup** on (re)subscribe | Low | `tag_events` append + cache last-writer tolerate dups; note in runbook. |
| **Reconnect/backoff + broker auth** | Low–Med | aiomqtt reconnect loop; broker TLS/ACL + config-bound tenant (no per-message HMAC). Standard. |
| **Infra: a broker must exist** | Med | Needs a Mosquitto/EMQX (Mike's infra). The HTTP path needs none. |
| **Staging HMAC/relay gaps surface again** | Low | The staging relay still lacks `MIRA_IGNITION_HMAC_KEY`; irrelevant to MQTT (broker auth), but a reminder the staging relay isn't stood up. |

No **structural** risk remains — the convergence contract is built and guarded.

## 2. Expected implementation effort
**Small–Medium.** Per the Phase 3a plan: a new `mira-relay/mqtt_ingest/` package —
- `config.py` (tenant/broker/topic/codec), `decode.py` (`plain_json`: topic→`from_mqtt_topic`,
  payload→`build_tag_entry`), `subscriber.py` (aiomqtt loop → buffer → `build_ingest_batch` →
  `ingest_batch`), `run.py` entrypoint.
- `mira-relay/Dockerfile`: `COPY mqtt_ingest/` + `aiomqtt` (per-file COPY discipline).
- Compose wiring as a **separate read-only service** (infra step, not code).

Estimate: **~1 focused PR for code+tests** (steps 1–3 of the plan), plus an infra/compose step. The
"transport + decode" shape is intentionally thin because the pipeline already exists.

## 3. Expected test scope
- `test_mqtt_decode.py` — codec units on synthetic `(topic, payload)`: SimLab envelope → correct
  entry; `value_type` inference (bool-before-int); malformed JSON → drop; **decoded key == L2 seed
  key** for the SimLab tag set (fail-closed guarantee).
- `test_mqtt_subscriber.py` — **fake aiomqtt** + in-memory `TagStore` (the staging-validation
  harness): N messages → rows land with resolved `uns_path`; a bad message doesn't kill the loop; a
  store error doesn't kill the loop; tenant from config.
- Acceptance grep: `mqtt_ingest/` contains **no** allowlist/normalizer/persist/publish of its own
  (Contract 5).
- **No broker, no NeonDB in CI.** A staging proof (broker + landed rows) reuses the L1/L2 validation
  shape.

## 4. Demo value (for the contextualization demo specifically)
**Low — near zero for the ProveIt contextualization story.** What the audience cares about is
*"signals → understanding"* (steps 5–8: identify asset, explain cause, cite evidence, recommend
action). The **transport** the signals arrived over is invisible to them. SimLab already lands data
over HTTP; MQTT changes nothing the audience sees.

**Strategic value — high, but LATER.** MQTT/Sparkplug is **how a real customer's factory actually
arrives** (Ignition/edge gateways publish Sparkplug). It matters enormously for the *"connect your
real plant"* story — i.e. once the contextualization value is proven and the conversation turns to
*"now point it at my factory."* That is a post-demo, commercial-motion concern, not a demo concern.

## 5. Before or after the contextualization demo? → **AFTER**
**Recommendation: implement MQTT *after* the contextualization demonstration is built and shown.**

Why:
1. **The demo doesn't need it.** Phase 3 runs end-to-end on the landed HTTP path. Building MQTT first
   delays the value proof and adds infra (a broker) for **zero** demo benefit.
2. **The risk-reducing pre-work is already done** (contract + guard on main), so MQTT can be added
   later cheaply and safely — there's no "build it now or pay more later" pressure.
3. **Sequencing by value:** the open question is *"what useful thing happens after data gets in?"* —
   that's contextualization, not a second inlet. Prove the *after*, then widen the *front door*.
4. **It composes cleanly post-demo:** once the demo exists, MQTT becomes a one-PR transport that
   feeds the *same* pipeline the demo already showcases — and the natural lead-in to "connect a real
   Sparkplug feed" for a design partner.

**Trigger to build MQTT:** when a concrete feed needs it — a design-partner factory or the live
Flexware/Sparkplug ProveIt feed — *and* the contextualization demo is in hand. Until then it stays
gated.

---

## Summary verdict
| Dimension | Assessment |
|---|---|
| Structural readiness | ✅ High (contract + guard merged; convergence proven) |
| Remaining risk | Low (no structural risk; infra = a broker) |
| Effort | S–M (~1 code PR + infra) |
| Test scope | Codec units + fake-aiomqtt subscriber (no broker/DB) |
| Demo value (contextualization) | **Low now**, high strategic value **later** |
| **Sequencing** | **AFTER the contextualization demo** — gated until a real feed needs it |

## Cross-references
- `docs/plans/2026-06-23-lane3-phase3a-plain-json-mqtt-codec.md` (the gated build plan)
- `docs/design/2026-06-23-lane3-mqtt-subscriber-design.md` (§7 pre-work + reuse discipline)
- `docs/plans/2026-06-24-contextualization-demo-plan.md` (the work that comes first)
- `.claude/rules/one-pipeline-ingest.md` (Contract 5 — what guarantees MQTT won't fork the core)

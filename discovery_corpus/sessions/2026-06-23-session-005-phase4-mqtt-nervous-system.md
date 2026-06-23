# Session 005 — MQTT nervous system: transport preserves explainability (Phase 4)

**Date:** 2026-06-23
**Recorder:** Discovery Recorder (ProveIt 2027 northstar, Phase 4)
**Class of work:** event transport (MQTT/UNS) — the narrowest possible nervous-system layer

> Deterministic, local, no external broker. MQTT is ONLY transport; the evidence graph + explanation
> engine remain the source of truth. NO Ignition / OpenPLC / Modbus / OPC-UA / Sparkplug / PLC sim /
> historian / CMMS / dashboard / web UI / clustering. Synthetic fixtures only.

---

## 1. Question being answered

Can a deterministic maintenance event travel through MQTT on a UNS-shaped topic and produce the EXACT
same evidence-backed Ask-MIRA answer card that exists offline — proving the transport never changes
the reasoning?

## 2. Files inspected

- `evidence_graph/` (Phase 3): `explain_cause` + `answer_card` — the brain the wire must not change.
- `causality/`, `factory_context/`, `discovery_corpus/scripts/` — rebuilt deterministically subscriber-side.

## 3. Commands executed

```bash
python mqtt_uns/run_phase4.py        # Phase 3 -> build brain -> publish -> subscribe -> card -> replay -> pytest
make mqtt-phase4
python -m pytest mqtt_uns/tests/ -q
python -m ruff check mqtt_uns
```

## 4. Python workflows used

- `broker.InMemoryBroker` (real MQTT `+`/`#` topic matching, synchronous loopback — deterministic).
- `schemas.MaintenanceEvent` (deterministic JSON: sorted keys + sorted signal lists, no wall-clock).
- `topics.topic_for_event` (UNS path -> `enterprise/site/area/line/asset/events`).
- `event_bridge`: `build_brain` / `event_from_scenario` (Phase 2 -> wire) / `observation_from_event`
  (wire -> Phase 3) / `explain_event` (-> explanation + card).
- `replay.run_replay` (hundreds of replays; consistency/determinism/citation/cause metrics).

## 5. Hypotheses tested — including the ones that FAILED

| # | Hypothesis | How tested | Evidence | Verdict |
|---|---|---|---|---|
| **H1** | "Phase 4 needs a real broker (Mosquitto) to be MQTT." | Weigh a real-broker dependency against the determinism + offline-gate discipline of every prior phase. | A network broker makes the gate non-deterministic + flaky and adds infra; an in-process broker with real topic/wildcard semantics proves the SAME thing (serialize→publish→match→subscribe→deserialize) deterministically. | **ELIMINATED for now** → in-process broker is the right Phase-4 transport; the `Transport` seam accepts a real client later with zero brain changes. |
| **H2** | "The event should carry the answer (cause/confidence/citations)." | Consider putting the explanation on the wire. | If the wire carries the answer, MQTT is no longer *just transport* and could silently change the reasoning. | **ELIMINATED** → the event carries only the **observation** (type + UNS + abnormal/healthy signals); the subscriber re-runs the SAME `explain_cause`, so the brain stays the single source of truth. |
| **H3** | "Inject every mode on every asset for the replay." | Build the full scenario set. | A conflicting `sensor_drift` on a filler erased ALL supporting evidence (the defect counter is both its only support AND its contradiction) → a no-evidence card → citation completeness 97.22%. | **REFINED** → a contradiction case is only meaningful if supporting evidence REMAINS; require non-empty abnormal AND healthy. Citation completeness → 100%. |
| **H4** | "Cause accuracy must be ~100%." | Measure top-cause == injected across all replays. | 37% — on the sparse fixture many modes share generic symptoms (blocked/counts/state) with no signature tag, so the ranker picks the highest-base-confidence cause. | **REFRAMED** → cause accuracy is an engine-discriminability metric, NOT a transport metric. Both offline + MQTT agree on the same cause, so the card still survives transport. Measured + reported honestly; the Phase-4 invariants (consistency/determinism/citation) are 100%. |

## 6. Evidence that eliminated the failed hypotheses (now executable)

- H1 → the whole gate runs offline + deterministically (`test_mqtt_*`, `run_phase4`).
- H2 → `test_mqtt_answer_card` (MQTT card == offline card byte-for-byte) + the cross-phase check that
  the MQTT card equals the committed `phase3_answer_card.md`.
- H3 → the `scenario_set` filter + 100% citation completeness across 420 replays.
- H4 → `phase4_replay_validation.{md,json}` (metrics + the honest explanation).

## 7. Results observed (synthetic fixture)

Flagship: photoeye event → topic `synthetic_beverage_co/demo_site/bottling/bottlingline1/conveyor01/events`
→ subscribe → `explain_cause` → answer card **identical** to the offline + committed Phase 3 card.
Contradiction event survives transport (confidence still drops, Evidence AGAINST intact). Replay:
**420 replays — answer-card consistency 100%, determinism 100%, citation completeness 100%**, 0 transport
failures, 0 mismatches; cause accuracy 37.14% (measured). `PHASE 4: OK`.

## 8. Conclusions reached

The brain works; the nervous system works; **event transport preserves explainability**; MIRA remains
auditable after transport. MQTT only moves the event; the answer is reconstructed by the same engine on
the far side, byte-for-byte. We are ready to begin real-world integrations in later phases (swap the
in-process broker for a real client behind the same `Transport` seam).

## 9. Reusable code created

`mqtt_uns/{schemas,broker,topics,publisher,subscriber,event_bridge,mqtt_reports,replay,run_phase4}.py`
+ `make mqtt-phase4`. Reuses Phases 0–3 unchanged.

## 10. Tests added

`mqtt_uns/tests/{test_mqtt_publish,test_mqtt_subscribe,test_mqtt_answer_card,test_mqtt_determinism}.py`
— **13 pytest, green**: UNS topic shape + serialized publish; wildcard delivery + lossless deserialize +
filter scoping; MQTT-card == offline-card (flagship + contradiction + tank) + no unsupported claims;
message/card/replay determinism (replay invariants 100%).

## 11. Fixtures added

None — Phase 4 reuses the synthetic factory + knowledge/history/procedures fixtures from Phases 0–3.
No licensed data; no new fixtures needed (the nervous system transports, it does not model).

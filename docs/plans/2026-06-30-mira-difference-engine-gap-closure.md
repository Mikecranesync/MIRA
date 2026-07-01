# MIRA Difference Engine — Consolidated Gap-Closure Plan

Synthesized 2026-06-30 from four parallel repo explorations (persistence, detectors,
context/explanation, HMI/adapters). Companion to
`docs/plans/2026-06-30-mira-difference-engine-backlog.md` (phases) +
`docs/product/mira_signal_difference_engine_prd.md` (PRD). **Reuse mandate holds:
extend existing cores; no rival ingest/allowlist/resolver/supervisor.**

## Corrections to the backlog (verified during exploration)

1. **`kg_entities`/`kg_relationships` are ALREADY DEPLOYED** in the Hub —
   `mira-hub/db/migrations/001_knowledge_graph.sql` (+ 025/026/050), read by
   `mira-bots/shared/ctx_enrichment.py`. Phase 4 is **context-resolution glue**, not a
   table deploy. (The `docs/migrations/004-005` "planned" schema is superseded by the
   live Hub tables.)
2. **New tables land at `mira-hub/db/migrations/057_signal_baselines.sql` + `058_machine_events.sql`** (verified next-free; RLS + `GRANT … TO factorylm_app`, UUID tenant per `.claude/rules/mira-hub-migrations.md`). *Re-verify next-free at implementation time.*
3. **The one-pipeline contract has LANDED** (`mira-relay/ingest_contract.py`, `tag_ingest.py`, `tests/test_architecture.py` Contract 5). Adapters (Phase 7) route through `build_tag_entry → build_ingest_batch → ingest_batch`, template = `simlab/publishers.py::RelayIngestPublisher`. **Verify the #2280/#2281 HOLD is actually lifted before starting Phase 7** (memory had it gated; the exploration reports it merged/green).
4. **Event grouping mostly EXISTS** — `mira-relay/tag_diff_logger.py` (edges/thresholds/fault-windows) is mature but **dormant** (no caller) + the `difference_detectors.group_observations` seed. The gap is the **scheduled worker**, not the logic.

## Per-phase closure table

| Phase | Gap | Already exists (reuse) | Build | Key files | Effort |
|---|---|---|---|---|---|
| **1 Historian** | continuous history to baseline against | `tag_events` (raw), diagnostic-window trend capture | NeonDB **rollup** `tag_events_hourly` + hourly aggregate job (Option A; InfluxDB deferred = would fork pipeline) | `mira-hub/db/migrations/059_tag_events_hourly.sql`; a batch job in `mira-relay/` | **S–M** |
| **2 Detectors** | learned baseline + more detectors | seed (`difference_detectors.py`), threshold A0–A12 (`rules_core.py`) | `signal_baselines` table + pure `baseline_learner.py` (windowed stats, `learn_signal_baseline`/`learn_paired_lag`) + 7 detectors (drift/ramp/correlation/sequence/cycle-time/nuisance/never-seen) | `mira-hub/db/migrations/057_signal_baselines.sql`; `plc/conv_simple_anomaly/{baseline_learner,test_baseline_learner}.py`; extend `difference_detectors.py` | **M–L** |
| **3 Event grouping** | write grouped events | `tag_diff_logger.py` (dormant) + `group_observations` seed | `machine_events` table + scheduled worker (reads `tag_events`→diffs→group→writes events) | `mira-hub/db/migrations/058_machine_events.sql`; `mira-relay/workers/difference_engine_worker.py` | **S** + **L** |
| **4 Context resolver** | bind event→component→manuals | kg tables LIVE, `approved_tags.uns_path`, `component_templates`, `neon_recall` | resolver glue (event UNS → component template → cited manual chunks) | extend `mira-bots/shared/ctx_enrichment.py` | **M** |
| **5 HMI** | machine-health view | ConvSimpleLive Perspective project (MaintenancePanel/AnomalyCard/MiraAsk), `mira_diagnose.py`, factorylm tokens | MachineHealthTile + EventCard + trend sparkline views + `mira_diagnose.py` summary fns | `plc/ignition-project/ConvSimpleLive/.../views/{MachineHealthTile,EventCard}/view.json` | **M** (×3) |
| **6 Ask MIRA from event** | answer from an event | Supervisor (`engine.py`), Ask API, `citation_compliance`, RAG worker — all unchanged | `machine_event_id` on `AskRequest` + `event_context.py` builder (renders event→prompt block, like `machine_context.py`) | `mira-bots/ask_api/{app.py,event_context.py}` | **M** |
| **7 Adapters** | any source, read-only | one-pipeline contract (landed), `plc/litmus/` proof | Litmus productionize (M, **do first**), OPC UA client (L), MQTT plain-JSON (L), Sparkplug B (future); all under `mira-relay/*_ingest/` | `mira-relay/{litmus_ingest,opc_ua_ingest,mqtt_ingest}/` | **M / L / L** |

## Critical path to the Micro820 / ProveIt MVP

```
P1 historian ─▶ P2 baselines+detectors ─▶ P3 worker+machine_events ─▶ P4 context glue ─▶ P6 Ask-MIRA-from-event
                                                                          (P5 HMI ‖ P7 Litmus run in parallel)
```

**Fastest end-to-end proof (skip the heavy bits):** SimLab already emits replayable,
deterministic signals (scenarios A–F). The smallest arc that demonstrates the whole
thesis **offline, no historian, no new adapters**:

> SimLab replay → seed + 1–2 new detectors → `group_observations` → **machine event** →
> `event_context.py` into the existing Supervisor → **cited "what changed?" answer** →
> `simlab/diagnostic.py::grade()` scores it.

That path touches only P2 (partial) + P3 (grouping, no worker/table needed for the demo)
+ P6, all deterministic and unit-testable via `tests/simlab/test_difference_engine.py`.
It's the recommended **first milestone** — it proves the reposition with code before
investing in the historian, worker, HMI, and adapters.

## Rough effort

- **Fastest MVP proof (SimLab arc):** ~1 engineer-week (detectors + event_context + test harness).
- **Full MVP (with persistence + worker + context + Ask MIRA):** ~4–6 engineer-weeks.
- **Phase 5 HMI:** ~2–2.5 weeks (3 views + scripts + screenshots). **Phase 7 adapters:** Litmus ~1 week, OPC UA / MQTT ~1.5 weeks each.

## Guardrails at every phase

Read-only OT (no PLC writes) · grounding/citation/refusal unchanged · no rival core
(one-pipeline law, single UNS resolver, single Supervisor) · factorylm tokens + ISA-101
for any HMI + Screenshot Rule · migrations dev→staging→prod via `apply-migrations.yml`.

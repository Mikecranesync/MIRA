# MIRA Difference Engine — Implementation Backlog (2026-06-30)

Phased backlog for the signal-difference-engine reposition. Companion to
`docs/product/mira_difference_engine_offering.md` (positioning) and
`docs/product/mira_signal_difference_engine_prd.md` (PRD).

Status badges: ✅ shipped · ⚠️ partial · 🔲 not built · 🟦 bench-only.
Convention matches `docs/plans/2026-06-01-mira-master-architecture-plan.md`
(Goal / Gate / Deps, exact paths). **Reuse mandate applies** — extend existing
cores; no rival ingest/allowlist/resolver/supervisor.

---

## 0. What already exists (baseline — 2026-06-30)

| Layer | Capability | Status | Where |
|---|---|---|---|
| 1 Ingest | canonical pipeline + raw store | ✅ | `mira-relay/{ingest_contract,tag_ingest}.py`; `tag_events`(033), `live_signal_cache`(020), `approved_tags`(035) |
| 2 Detect | threshold rules A0–A12 | ✅ | `plc/conv_simple_anomaly/rules_core.py` |
| 2 Detect | baseline/stuck/delayed seed + tests | ✅ (seed) | `plc/conv_simple_anomaly/difference_detectors.py` + `test_difference_detectors.py` |
| 2 Detect | learned baselines / drift / correlation | 🔲 | — (this backlog) |
| 3 Group | edge/threshold/fault-window diffs | ✅ | `mira-relay/tag_diff_logger.py`; `tag_event_diffs`(037) |
| 3 Group | timing/baseline observation grouping | ✅ (seed) | `difference_detectors.py::group_observations` |
| 3 Trend | diagnostic-window capture | ⚠️ | `plc/conv_simple_anomaly/trend_*.py`; `diagnostic_trend_*`(020) |
| 3 Trend | continuous historian | 🔲 | — |
| 4 Context | UNS resolver + approved map + KB + component templates | ✅ | `mira-bots/shared/uns_resolver.py`; `knowledge_entries`(001); `component_templates`(016) |
| 4 Context | kg_entities/relationships deployed | 🔲 | migrations 004/005 authored, not deployed |
| 5 Explain | Supervisor + Ask MIRA + citation compliance | ✅ | `mira-bots/shared/engine.py`; `mira-bots/ask_api/`; `citation_compliance.py` |
| — | "MIRA on top of Litmus" bench proof | 🟦 | `plc/litmus/` |

---

## Phase 0 — Documentation & positioning *(this change; small)*
**Goal:** name the through-line; land positioning + PRD + backlog + discovery note;
seed the Layer-2 detectors with tests; update product language safely.
- Docs: `docs/product/mira_difference_engine_offering.md`, `.../mira_signal_difference_engine_prd.md`, this file, `docs/audits/2026-06-30-signal-difference-engine-discovery.md`.
- Seed + tests: `plc/conv_simple_anomaly/difference_detectors.py` (+ test).
- Safe copy: `docs/product/what-is-mira.md` lead; `CLAUDE.md`/`NORTH_STAR.md` pointers.
- **Gate:** `pytest plc/conv_simple_anomaly/test_difference_detectors.py` green; existing A0–A12 tests still green; no live UI/HTML overclaim. **Deps:** none. **Status:** ✅

## Phase 1 — Signal schema + history store
**Goal:** durable, queryable signal history to baseline against (fills the Layer-3 gap).
- Reuse `tag_events` for raw; add a retention/downsample path (continuous historian).
- Decide store: extend NeonDB (`tag_events` + rollup table) vs. the Litmus/OW InfluxDB already running. Document choice; do **not** fork the ingest core.
- **Gate:** a replay (SimLab scenario or bench window) is queryable as an ordered per-signal series with ts+quality. **Deps:** P0.

## Phase 2 — Baseline / difference detectors
**Goal:** learn or declare normal, detect deviation on live signals.
- Add `signal_baselines` table (migration; RLS + grant per `.claude/rules/mira-hub-migrations.md`).
- Baseline learner: windowed stats per operating context (e.g. startup vs steady-run).
- Promote the seed detectors to run against `signal_baselines`; add drift + ramp-change.
- **Gate:** on a replayable fault, out-of-baseline + stuck + delayed-transition fire with factual observations; silent when healthy; unit + SimLab tests green. **Deps:** P1.

## Phase 3 — Event grouping
**Goal:** compress observations into few machine events (anti-spam).
- Add `machine_events` table. Wire `tag_diff_logger` + `group_observations` into a scheduled worker that writes grouped events (reuse tag_diff_logger; don't duplicate edge/threshold logic).
- **Gate:** a multi-signal incident yields exactly one `machine_events` row with its member observations; nuisance chatter does not spam. **Deps:** P2.

## Phase 4 — Context resolver
**Goal:** bind an event to asset + component + manuals + prior evidence.
- Reuse `approved_tags.uns_path`, `component_templates`, `knowledge_entries`; deploy `kg_entities`/`kg_relationships` (migrations 004/005) dev→staging→prod.
- Resolve "signal_c" → "VFD DC bus / cv_101"; attach candidate docs.
- **Gate:** an event resolves to the correct component + ≥1 cited manual chunk on the bench conveyor. **Deps:** P3.

## Phase 5 — HMI machine-health view
**Goal:** operator sees machine health + event cards, not a tag wall.
- Perspective/HMI health tiles + event card + trend sparkline (ISA-101 / `factorylm-ui-style`). Extend the Maintenance Intelligence Module panel (`plc/ignition-project/ConvSimpleLive/`), don't start fresh.
- **Gate:** 3-second test passes; abnormal asset shows one event + its trend; Screenshot Rule artifacts saved. **Deps:** P4. Honors `train-before-deploy` (approved asset only).

## Phase 6 — Ask MIRA explanation from difference events
**Goal:** answer "what changed / why in warning" from an event + approved context, cited.
- Feed a `machine_events` row into the Supervisor as input (reuse `engine.py`, Ask MIRA, `citation_compliance`); answer the seven questions.
- **Gate:** MVP acceptance criteria 6–7 met; groundedness/citation tests not lowered. **Deps:** P4 (P5 optional).

## Phase 7 — Litmus / Ignition / MQTT / OPC UA adapters
**Goal:** the same difference engine over any source, read-only, one pipeline.
- Litmus 🟦 (`plc/litmus/` proof) → productionize read path; OPC UA client; MQTT/Sparkplug subscriber **under `mira-relay/`** per `.claude/rules/one-pipeline-ingest.md`.
- **Gate:** ≥2 sources feed `tag_events` via the canonical contract; Contract-5 CI green. **Deps:** P1. **Note:** MQTT/Sparkplug is **HELD** until #2280 staging-green + #2281 merged.

---

## Sequencing notes
- P0 is this change. P1→P4 is the critical path to the MVP demo; P5/P6 are the
  operator-facing payoff; P7 broadens sources.
- Every phase reuses an existing core. If a phase tempts you to add a second
  allowlist/resolver/ingest path, stop — that's a rule violation, not a phase.
- Keep read-only and grounding invariants at every phase.

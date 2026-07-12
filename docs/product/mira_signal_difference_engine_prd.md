# PRD — MIRA Signal Difference Engine + Contextual Supervisor (Architecture)

> **⚠️ PRODUCT FRAMING UPDATE (2026-07-11).** This PRD describes the foundational engine architecture.
> The **first sellable product is Drive Commander**, a read-only VFD troubleshooting tool (issue #2577,
> PR #2504, ADR-0025). This PRD is valid engine design; it is **not the first product**.
> See **[NORTH_STAR.md](../../NORTH_STAR.md) and [ADR-0025](../adr/0025-drive-intelligence-packs-and-drive-commander.md)**
> for the current strategy.

**Status:** DRAFT engine architecture (2026-06-30). Companion to
`docs/product/mira_difference_engine_offering.md` (engine positioning) and
`docs/plans/2026-06-30-mira-difference-engine-backlog.md` (phased work).
Reconciles with `NORTH_STAR.md`, `docs/THEORY_OF_OPERATIONS.md`, and the
`.claude/rules/` laws (one-pipeline ingest, fieldbus read-only, direct-connection
UNS certification, train-before-deploy). Drive Commander is the first product
built on this engine.

> **Reuse mandate.** This PRD extends existing cores; it does **not** propose rival
> ones. No second allowlist, no second UNS resolver, no second Supervisor, no
> second ingest pipeline. New code is confined to the two genuine gaps (learned
> baselines, continuous trending) plus glue.

---

## 1. Problem

Raw machine connectivity is now commodity — Litmus, Ignition, OPC UA, MQTT, and PLC
exports all deliver tag values cheaply (proven on the bench 2026-06-30). What
maintenance still lacks: **a system that notices what *changed*, compresses the
noise into a few real machine events, and explains them in maintenance terms with
evidence** — without a human first hand-mapping the meaning of every tag. Threshold
alarms miss slow drift and novel patterns; SCADA shows walls of tags; chatbots
answer questions but don't watch the signals.

## 2. Goals

1. Detect **differences from normal** on raw signals with no prior knowledge of a
   tag's human meaning (out-of-baseline, drift, stuck, late/broken transition,
   sequence-out-of-order, cycle-time drift, ramp change, broken correlation, rising
   nuisance rate, never-seen pattern).
2. Emit **factual observations**, not explanations, at the low level.
3. **Group** many observations into few **machine events** (anti-spam).
4. **Resolve context** for events (tag names, PLC logic, approved map, asset
   hierarchy, manuals, wiring, nameplate/photos, prior evidence).
5. **Explain** for the operator: what changed, how bad, which event, which
   component, what to check first, what evidence, what trend caused the alert — with
   citations and honest uncertainty.
6. Ingest read-only from Litmus / Ignition / OPC UA / MQTT / PLC export / historian
   / CSV via the **one** canonical pipeline.

## 3. Non-goals

- ❌ Any PLC write / control path. Read-only, always.
- ❌ Replacing Litmus / Ignition / SCADA / historian (they are sources).
- ❌ "Predicts all failures" / production predictive-maintenance certainty.
- ❌ A second ingest core, allowlist, resolver, or Supervisor.
- ❌ Weakening grounding: no uncited spec, no silent manual truncation, no
   fabricated fault meaning. Citation compliance + refusal behavior stay intact.
- ❌ Deploying to an HMI before an asset agent is validated/approved
  (`.claude/rules/train-before-deploy.md`).

## 4. Architecture (map to what exists)

```
Litmus / Ignition / OPC UA / MQTT / PLC export / historian / CSV
        │  (read-only adapters, one pipeline)
        ▼
[1] Signal ingestion   ── mira-relay: ingest_contract → ingest_batch → NeonTagStore
        │                  tables: tag_events, live_signal_cache, approved_tags   ✅ EXISTS
        ▼
[2] Difference engine   ── rules_core.py A0–A12 (threshold) ✅  +  learned baselines/drift ⚠️ NEW
        │                  emits factual Observations
        ▼
[3] Event grouping      ── tag_diff_logger.py (edges/thresholds/fault-windows) ✅
        │                  + timing/baseline grouping (difference_detectors.py seed) ⚠️ NEW
        ▼
[4] Context resolver    ── uns_resolver, approved_tags UNS map, knowledge_entries,
        │                  component_templates, (kg_entities/relationships planned) ✅ EXISTS
        ▼
[5] Supervisor / explain ─ engine.py Supervisor, Ask MIRA, citation_compliance ✅ EXISTS
        ▼
     Operator (HMI panel / chat) — read-only, cited, honest
```

## 5. Data model (reuse first; two additive tables)

**Reused as-is (do not duplicate):**
- `tag_events` (migration 033) — append-only raw stream: `tag_path, value, value_type,
  quality, source_system, event_timestamp, uns_path, equipment_entity_id, metadata`.
  This IS the "store raw signal values (source, path, type, value, ts, quality)"
  requirement. *Unit* lives in `metadata` JSONB until/unless a column is justified.
- `live_signal_cache` (migration 020) — latest value + `last_changed_at` (edge time)
  per tag; the substrate for stuck/transition detection.
- `approved_tags` (migration 035) — fail-closed allowlist + `normalized_tag_path` +
  `uns_path`. The tag→context anchor.
- `tag_event_diffs` (migration 037) — existing edge/threshold/fault-window diffs.
- `diagnostic_trend_sessions` / `diagnostic_trend_signals` (migration 020) — trend capture.

**New, additive (the two gaps):**
- `signal_baselines` — learned/declared normal per `(tenant_id, uns_path|tag_path, context_key)`:
  `lo, hi, mean, stddev, normal_lag_s` (for paired timing), `sample_count, learned_from,
  method ('declared'|'learned'), window, updated_at`. One row per signal per operating
  context (e.g. "startup", "steady-run").
- `machine_events` — grouped events: `event_id, tenant_id, asset uns_path, start_ts,
  end_ts, observation_count, signals[], severity_hint, summary_factual, context JSONB,
  status`. Observations reference back to `tag_event_diffs` / `tag_events`.

Both go dev→staging→prod via `apply-migrations.yml`, RLS + `GRANT … TO factorylm_app`,
per `.claude/rules/mira-hub-migrations.md`.

## 6. Detectors (Layer 2)

**Existing (threshold, known failure modes):** `rules_core.py` A0–A12 — offline, comm
loss, VFD fault decode, e-stop wiring, direction, illegal run, drive-not-responding,
freq-not-tracking, overcurrent, DC-bus over/under, freq-stuck, photo-eye jam.

**New (deviation from normal, no failure-mode knowledge required):** seeded in
`plc/conv_simple_anomaly/difference_detectors.py` (pure, dual-runtime, unit-tested):
- `detect_out_of_baseline(signal, value, lo, hi)` — value outside learned range.
- `detect_stuck(signal, samples, min_span_s)` — value unchanged past a span.
- `detect_delayed_transition(a, b, a_ts, b_ts, normal_lag_s, tol_s)` — B late after A.
- (backlog) drift, ramp-change, broken-correlation, sequence-order, cycle-time drift,
  nuisance-rate, never-seen-pattern.

Each returns an **`Observation`** (factual `detail`, `value`, `expected`, `ts`,
`magnitude`) — never a human explanation.

## 7. Event grouping (Layer 3)

**Existing:** `mira-relay/tag_diff_logger.py` compresses raw events into
`tag_event_diffs` (rising/falling edge, threshold cross, quality change) and windows
diffs around fault triggers (`fault_window_id`, ±5 s).

**New:** `group_observations(observations, window_s)` in `difference_detectors.py`
clusters baseline/timing observations that occur close in time into one
`MachineEvent` — the anti-spam compression for the detectors tag_diff_logger doesn't
cover. Output feeds `machine_events`.

## 8. Context resolver (Layer 4)

Reuse: `approved_tags.uns_path` (tag→UNS), `uns_resolver` (vendor/model canon),
`knowledge_entries` (cited manual chunks), `component_templates` (diagnostics,
failure modes, troubleshooting, safety), and `kg_entities/kg_relationships` when
deployed. Resolves "signal_c" → "VFD DC bus on conveyor cv_101" and binds the event
to an asset subtree, manuals, and prior evidence. Honors
`.claude/rules/knowledge-entries-tenant-scoping.md` (hybrid read filter) and
`uns-compliance.md`.

## 9. Supervisor / explanation (Layer 5)

Reuse the Supervisor (`engine.py`) + Ask MIRA + `citation_compliance`. New input:
instead of only a chat message, the supervisor is handed a **machine event** (grouped
observations + resolved context) and answers the seven questions: *what changed / how
bad / which event / which component / what to check first / what evidence / what trend
caused it*. Output is cited and honest (careful language, no overclaim). Direct-
connection surfaces are UNS-certified (`.claude/rules/direct-connection-uns-certified.md`).

## 10. HMI experience

- **Machine-health view:** muted-normal, color-for-state (ISA-101 /
  `industrial-hmi-scada-design` / `factorylm-ui-style`). One tile per asset; abnormal
  assets surface a **machine event**, not a tag wall.
- **Event card:** "what changed" one-liner + the trend sparkline that caused it +
  severity + likely component + "check first" list.
- **Ask MIRA:** one tap from a card → grounded explanation with citations. Free tier =
  detection + trends (in-gateway/offline); paid = grounded Ask MIRA (cloud RAG). Matches
  the shipping Maintenance Intelligence Module tiering.

## 11. Acceptance criteria (MVP — Micro820 / ProveIt)

1. Live tag values ingest read-only from Litmus (or bridge/SimLab) into `tag_events`.
2. A baseline is learned or declared for ≥3 conveyor signals (incl. DC bus 318–325 V).
3. Out-of-baseline, stuck, and delayed-transition detectors emit factual observations
   on a replayable fault (SimLab scenario or bench e-stop), and are silent when healthy.
4. Observations for one incident group into **one** `MachineEvent` (not N alerts).
5. The event resolves to the conveyor asset + the right component (DC bus / motor).
6. Ask MIRA answers *"What changed?"* / *"Why is this machine in warning?"* from the
   event **plus** approved context, **with a citation**, no fabricated spec.
7. Trend evidence (the sparkline that triggered) is shown/returned.
8. Zero PLC writes anywhere in the path.

## 12. Test plan

- **Unit (offline, deterministic) — DONE for the seed:**
  `plc/conv_simple_anomaly/test_difference_detectors.py` (14 tests: out-of-baseline
  low/high/boundary, stuck true/false/short-span, delayed on-time/late, grouping
  compress/split/empty). Style-A snapshot pattern, matches `test_rules.py`.
- **Unit (backlog):** drift, ramp-change, broken-correlation, sequence-order detectors.
- **Integration (SimLab):** replay scenarios A–F (`tests/simlab/`), assert the difference
  engine flags the scenario's abnormal tags and groups them into the expected event;
  grade with `simlab/diagnostic.py::grade()`.
- **Regression:** existing `tests/regime7_ignition/test_diagnose_parity.py` (A0–A12
  parity) and `plc/conv_simple_anomaly/test_rules.py` stay green — the seed is additive.
- **Grounding:** existing citation/refusal tests unchanged; supervisor-from-event path
  must not lower groundedness scores.

## 13. Future work

- Baseline **learning** service (windowed stats per operating state) → `signal_baselines`.
- Continuous **historian** (the Layer-3 gap) — retention + downsample; feeds trend cards.
- Wire `tag_diff_logger` + `difference_detectors` to a scheduled worker writing `machine_events`.
- Correlation / sequence / cycle-time / never-seen-pattern detectors.
- Deploy `kg_entities`/`kg_relationships` for richer context resolution.
- Adapters: OPC UA client, MQTT/Sparkplug subscriber (gated by the one-pipeline HOLD, #2280/#2281).

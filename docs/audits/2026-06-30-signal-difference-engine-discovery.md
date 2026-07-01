# Discovery — MIRA's revised offering after Litmus proved raw connectivity is commodity

**Date:** 2026-06-30 · **Type:** product-direction discovery (inspect-then-reposition).

## Question

What is MIRA's revised product offering after the bench proved that raw PLC
connectivity (Litmus Edge read the Micro820 by name + Modbus TCP in minutes) is a
**commodity** any vendor can do? Where is the durable value, and how do we say it
without contradicting the existing wedge or rebuilding the stack?

## Files inspected (read-only, via 3 parallel Explore passes)

**Positioning:** `NORTH_STAR.md`, `STRATEGY.md`, `docs/THEORY_OF_OPERATIONS.md`, root
`CLAUDE.md`, `docs/brand-and-positioning-2026-04-26.md`, `docs/product/what-is-mira.md`,
`docs/RESUME_2026-06-14_maintenance-intelligence-module.md`, `mira-web/public/{pricing,buy,assess,activated}.html`.

**Architecture (5-layer map):** `mira-relay/{ingest_contract,tag_ingest,relay_server,tag_diff_logger}.py`;
migrations for `tag_events`(033), `live_signal_cache`(020), `approved_tags`(035),
`tag_event_diffs`(037), `diagnostic_trend_*`(020); `plc/conv_simple_anomaly/{rules_core,live_check,engine,trend_*}.py`;
`mira-bots/shared/{engine,uns_resolver,citation_compliance}.py`, `mira-bots/shared/workers/rag_worker.py`,
`mira-bots/ask_api/{app,machine_context}.py`; `knowledge_entries`(001), `component_templates`(016),
`kg_entities`/`kg_relationships`(004/005, authored not deployed).

**Conventions:** `tests/simlab/`, `plc/conv_simple_anomaly/test_rules.py`,
`mira-fault-detective/tests/test_rules.py`, `docs/plans/*` phase format, `docs/audits/*`,
`simlab/` (ProveIt bottling sim, replayable scenarios A–F).

## Conclusion

The new framing — **"signal difference engine with a contextual supervisor"** —
**sharpens** the canonical wedge; it does not replace it. Two load-bearing findings:

1. **~70% already exists.** Ingestion (`mira-relay` + `tag_events`/`live_signal_cache`/
   `approved_tags`), event grouping (`tag_diff_logger` + `tag_event_diffs`: edges,
   threshold crosses, fault windows), context resolution (`uns_resolver`,
   `approved_tags` UNS map, `knowledge_entries`, `component_templates`), and the
   grounded Supervisor (`engine.py`, Ask MIRA, `citation_compliance`) are all built.
2. **The genuine gaps are two:** (a) **learned-baseline / drift** detection — today's
   A0–A12 are threshold-only, no learned normal; (b) a **continuous historian** —
   today's trend capture is diagnostic-window only. Everything else is glue +
   naming the through-line.

So the reposition is cheap and honest: name the engine, fill two gaps, reuse the
rest, and lead with "what changed + what it means," not "we connect to your PLC."

## Repo areas changed (this session)

- **New docs:** `docs/product/mira_difference_engine_offering.md` (positioning),
  `docs/product/mira_signal_difference_engine_prd.md` (PRD),
  `docs/plans/2026-06-30-mira-difference-engine-backlog.md` (backlog), this note.
- **New seed code + tests:** `plc/conv_simple_anomaly/difference_detectors.py`
  (pure, dual-runtime: out-of-baseline / stuck / delayed-transition / grouping) and
  `plc/conv_simple_anomaly/test_difference_detectors.py` (14 tests, green).
- **Safe copy:** lead of `docs/product/what-is-mira.md`; one-line pointers in root
  `CLAUDE.md` and `NORTH_STAR.md`.
- **Untouched (deliberately):** live `mira-web` landing HTML (visible UI change →
  needs design-ship + Screenshot Rule; avoided overclaim); all working code; grounding/
  citation/refusal behavior; no PLC write path introduced.

## Reusable workflow

1. Three parallel Explore agents: (a) positioning/copy, (b) architecture-to-code map,
   (c) test/convention/fixtures. 2. Reconcile the new framing against `NORTH_STAR.md`
   before writing (sharpen, don't fork). 3. Map every proposed layer to an existing
   component; only build the proven gaps. 4. Seed the riskiest new layer with a small,
   deterministic, unit-tested module (evidence beats slideware). 5. Docs in house
   conventions (`docs/product/`, `docs/plans/`, `docs/audits/`). 6. Defer live-UI copy
   to a screenshotted design-ship pass.

## Next tests / fixtures needed

- SimLab integration: replay scenarios A–F, assert the difference engine flags the
  scenario's abnormal tags and groups them into the expected event; grade via
  `simlab/diagnostic.py::grade()`.
- A **`signal_baselines`** fixture (learned normal for ≥3 conveyor signals incl. DC bus
  318–325 V) for Phase-2 detector tests.
- A bench replay (e-stop / VFD comm loss) captured as an ordered per-signal series to
  test stuck + delayed-transition on real timing.
- Backlog detectors' unit tests: drift, ramp-change, broken-correlation, sequence-order.

## Preserved rig facts (bench truth, read-only)

Micro820 via Litmus container; EtherNet/IP read-by-name works; Modbus TCP works; VFD
DC-bus scale = raw × 0.1 V (V×10), observed 323→321 V; 13 real global vars read by
name; two honest gaps (no photo-eye var, no frequency-command var — only output
frequency); AB Micro850/Micro800 by-name is the winning Litmus DeviceHub path;
read-only only, zero PLC writes.

# Live Machine State — Discovery Report

Prior authoritative audit: `docs/discovery/duplicate-systems-audit.md` (2026-07-03) — file:line-cited audit of nearly this whole domain; read before new dedup work.

## 1. Canonical ingest pipeline (ONE-pipeline law) — REUSE AS-IS
- `mira-relay/ingest_contract.py` — normalize_tag_path (fail-closed), build_tag_entry, build_ingest_batch; stdlib-only so every transport loads the same file. CANONICAL.
- `mira-relay/tag_ingest.py` — ingest_batch(): validates source_system, approved_tags allowlist fail-closed, normalizes, derives `simulated` once/batch, writes tag_events (append-only) + upserts live_signal_cache in one txn. NeonTagStore (NullPool + RLS SET LOCAL). Also mark_tags_stale (Sparkplug NDEATH), record_seen_tags (auto-discover disabled).
- `mira-relay/tag_diff_logger.py` + mig 037 — derived meaningful-change stream (edges, threshold cross, quality change, fault windows), rebuildable.
- `mira-relay/mqtt_ingest/` + `codecs/sparkplug_b.py` — uses contract, no fork.
- Doctrine: `.claude/rules/one-pipeline-ingest.md`. Tables: 033 tag_events, 020+036 live_signal_cache, 035 approved_tags (distinct from tag_entities).

## 2. Machine Memory (Hub→engine→HMI, #2432/#2476/#2478/#2479) — KEEP/EXTEND (best-tested slice)
- Schema: 038_machine_runs.sql (machine_run/run_step/run_baseline/run_diff, joined to tag_events by uns_path+time); 040_machine_memory_windows.sql (machine_state_window idle/running/faulted/comm_down/estopped/unknown + typed A0-A12 run_diff columns).
- Worker: `mira-crawler/run_engine/{machine_memory,snapshot,state_windows,anomaly_rules,segmentation,baseline,diff,next_check,store,pipeline}.py` via `tasks/historize_runs.py` (Celery beat, `MIRA_RUN_DIFF_ENABLED` default OFF — staging). anomaly_rules = byte-identical vendored A0-A12 copy, parity-tested. Runbook docs/runbooks/machine-memory-worker.md.
- #2432 fix: windows key on ingested_at (server time) not event_timestamp (freezes under report-by-exception).
- Hub reads: `machine-memory.ts` (fetchMachineMemory/fetchLiveSignals), `machine-current-state.ts` (PURE deriveCurrentState: open window trusted; closed only while live; else comm_down/unknown), `command-center-freshness.ts` (PURE freshness off live_signal_cache.last_seen_at vs expected_freshness_seconds; live/stale/simulated/unknown + subtree rollup) — THE freshness indicator, single canonical impl.
- Intelligence bridge (#2476): `machine-context-intelligence.ts` (PURE deriveContextIntelligence) + `machine-context-packet.ts` (buildMachineContextPacket, renderMachineEvidenceSection) → "## Live Machine Evidence (observed now)" injected into assets/[id]/chat. Single compute site.
- UI: MachineMemoryCard.tsx (State bubble + Assessment). API: api/assets/[id]/machine-memory/route.ts.
- Engine mirror (#2478): `mira-bots/shared/live_snapshot.py` (assess_snapshots, render_machine_evidence) wired via engine.py _maybe_attach_live_snapshot; embeds legacy [LIVE CONVEYOR STATUS] verbatim.
- Ignition HMI mirror (#2479): `mira-pipeline/ignition_chat.py` + assess_from_paths() — deterministic assessment from ONLY scaling-immune enum/bool signals; returns None rather than fabricate.
- In-flight branch `feat/hub-live-signal-polish` (13 files vs main): signal-history route, gs10-display.ts, MachineMemoryCard rewrite — same lineage, review/merge next.
- Deferred gap (#2478): ignition_chat pre-scaled snapshot assessment needs tag_entities-driven mapping.

## 3. Ignition collector — KEEP
- `ignition/gateway-scripts/tag-stream.py` — read-only browse+read → allowlist → HMAC POST /api/v1/tags/ingest, 2s.
- Pure logic: `ignition/webdev/FactoryLM/api/tags/{collector,allowlist}.py`.
- WebDev endpoints: alerts/chat/connect/diagnose/ingest/status/tags + mira.
- In-gateway diagnose: `api/diagnose/diagnose_core.py` = byte-identical vendored rules_core copy, parity-tested (ConvSimpleLive only). **GAP: NorthwindBottling vendored copy NOT covered by parity test — silent-drift risk, one-line fix.**
- Timer resource ground truth: `ignition/project-resources/FactoryLMCollector/ignition/timer/MiraTagStream/` (8.3 format; 8.1 layout silently never fired June→July, fixed).
- Distribution: docs/plans/2026-07-03-ignition-collector-resource-pack.md (zip + Exchange now, .modl later) — in progress, blocked on one bench step.
- Allowlist dual-write cutover (JSON file ↔ approved_tags table) NOT done — documented gap.
- `mira-ignition-exchange/` — free ChatDock/ScanWidget lead-gen, separate surface.

## 4. Litmus Edge — bench-only, compliant
`plc/litmus/mira_on_litmus.py` uses same ingest contract. dashboard_api/provision read-only (structurally asserted no-write tests). Decision docs under docs/discovery + docs/integrations + docs/product.

## 5. Live-tag latency / push — BUILD gap
**No WS/SSE push for live tags exists** (only chat streaming). Freshness is poll-based. feat/hub-live-signal-polish still poll-based. SSE/WS push = planned gap, no code.

## 6. Anomaly engine A0-A12
- Canonical: `plc/conv_simple_anomaly/rules_core.py` (dual Py2.7/3.12, GS10_FAULT_CODES 40 codes). Catalog: ANOMALY_CATALOG.md.
- Bench engine.py writes conveyor_events (SQLite). **P1 UNRESOLVED: conveyor_events vs faults tables share same SQLite file (MIRA_DB_PATH), never joined; faults read by mira-mcp /api/faults/active. Fix before conv_simple_anomaly leaves bench.**
- Vendored 4-5x (ignition webdev, ConvSimpleLive, run_engine, NorthwindBottling-unguarded) — deliberate (Jython), parity-guarded except NorthwindBottling.
- `trend_historian.py` — bench Track-A poller+SQLite+/chart,/trend endpoints; self-documented as superseded by Ignition native historian in product.

## 7. Historian / trends
- `mira-relay/historian.py` — HistorianAdapter ABC + TrendBucket/Sample/EvidenceWindow DTOs + InMemory impl (#2339). Prod: `historian_postgres.py` — thin SQL over EXISTING tables (live_signal_cache, tag_events, tag_event_diffs, decision_traces). list_runs() deferred (#2341) — trivial wiring to machine_run(038) pending. Good tests (266+313 lines).
- `mira-trend-viewer/` — standalone JS GS10-aware trend viewer w/ own tests; **no confirmed Hub wiring — verify still live; possibly superseded by signal-history route.**
- Trends V2 plan docs — check against hub-live-signal-polish.

## 8. tag_entities / expected_envelope / display_endpoints
- 025_tag_entities.sql — typed tag catalog: uns_path, sparkplug/opcua/symbolic addressing, IEC61131 data_type, units, scaling JSONB {raw_min,raw_max,eng_min,eng_max,offset}, source_kind/address, component_instance_id FK, **expected_envelope JSONB** (min/max/normal_range/fault_states).
- **CONFIRMED GAP: expected_envelope consumed by NOTHING** except verify_phase0_deploy.py — designed, never read by engine code. Real actionable debt: wire into run_engine anomaly eval or gs10-display scaling work.
- display_endpoints: 030 registry + seeds + command-center routes + commissioning.ts — "where to watch a live display", read-only doctrine. KEEP.

## Summary
1. REUSE: ingest contract/tag_ingest/diff_logger; freshness + current-state libs; historian adapters; rules_core + guarded vendors.
2. EXTEND: hub-live-signal-polish (merge); run_engine worker (flip flag when staging-proven).
3. FIX: expected_envelope unconsumed; NorthwindBottling parity; conveyor_events/faults collision (P1); allowlist dual-write cutover.
4. BUILD: live-tag SSE/WS push.
5. VERIFY: mira-trend-viewer still live?

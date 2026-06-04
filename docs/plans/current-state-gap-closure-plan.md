# MIRA — Current-State Gap-Closure Plan (Walker DT-2026 Alignment)

**Status:** Phases 0–5 + RLS tests complete (PRs #1657/#1674). apply-and-verify CI green as of 2026-06-04. Merge conflict being resolved.
**Last updated:** 2026-06-04 (gap-closure driver session)
**Authored:** 2026-06-02
**Owner:** Lead systems architect (gap-closure work stream)
**Governs:** the gap-closure work stream that closes the gaps in the
`docs/plans/2026-06-01-mira-master-architecture-plan.md` (PRIMARY FOCUS).
This doc is the **evidence-grounded "what is actually built today"** companion
to that plan. The master plan says what to build; this doc says what exists.

## 0. Method & honesty contract

Walker Reynolds' digital-transformation pipeline:
**Connect → Collect → Store → Analyze → Visualize → Pattern → Report → Solve.**

Every component below was **verified against the codebase** (CodeGraph +
file reads + `grep` for absence), not trusted from a spec. The audit ran as
8 parallel stage auditors (one per pipeline stage) on the `feat/dt2026-gap-closure`
worktree (branched off `feat/hub-command-center` @ `80d5c624`, which is 33
commits behind / 28 ahead of `origin/main` at audit time).

**Status legend:**

| Label | Meaning |
|---|---|
| **BUILT** | Real, customer-shippable code path that works |
| **PARTIAL** | Some pieces present, material gaps remain |
| **BENCH_ONLY** | Works but bench/dev only — not in any customer compose (e.g. `plc/` Modbus tools) |
| **SIMULATED** | Only mock/simulator data, no real source |
| **DESIGNED_NOT_BUILT** | Spec/ADR/plan exists, no code |
| **MISSING** | Nothing exists |

**Anti-overclaim rule:** "verified-absent: searched X, found nothing" is the
evidence standard for MISSING. A doc describing a thing is **not** proof it is
built.

---

## 1. Pipeline status at a glance

| Stage | Headline | Worst gap that blocks the wedge |
|---|---|---|
| **Connect** | 2 customer-shippable paths (Ignition WebDev → relay/pipeline, both HMAC), 4 bench-only Modbus tools correctly fenced | `tag-stream.py` (periodic factory→relay push) sends **unsigned** POSTs; `MIRA_IGNITION_HMAC_KEY` absent from `docker-compose.saas.yml` |
| **Collect** | `mira-relay POST /ingest` BUILT (HMAC + batch); Ignition tag-browse allowlist BUILT | **No allowlist enforcement on the relay `/ingest` path**; **no provenance flag** (sim vs real) at collection; `mock_tag_stream.py` not built |
| **Store** | Hub migrations 001–031 substantive & complete for existing domain | **5 gap-closure tables MISSING/PARTIAL** (`tag_events`, `approved_tags` table, `flaky_input_signals`, `decision_traces` = MISSING; `current_tag_state` = `live_signal_cache` lacking 3 cols) |
| **Analyze** | Supervisor engine, FSM, UNS gate, hybrid retrieval, cascade all BUILT | **`direct_connection` UNS bypass DESIGNED_NOT_BUILT** (zero code); citation compliance observe-only; resolver `site_path` never populated at runtime (async guard) |
| **Visualize** | Hub pages (feed/assets/docs/knowledge/WO/schedule/namespace/proposals/mobile) BUILT; HealthScoreWidget BUILT | **Command Center liveness = HTTP reachability only, NOT tag freshness** (this is the Phase 4 gap); CC page itself unmerged (feature branch) |
| **Pattern** | Health-score recompute worker BUILT; schematic vision pipeline real | **Flaky-input detector MISSING (zero code)**; `kg_writer` writes `kg_relationships` directly (bypasses proposals); no proposal-transition helpers |
| **Report** | `ignition_audit_log` BUILT; benchmark_db + eval framework BUILT (mature) | **`decision_traces` storage MISSING** — `trace_id` is Langfuse-sourced, **`None` whenever LANGFUSE_SECRET_KEY unset (the default)**; observability config dir absent |
| **Solve** | MCP CMMS tools + Atlas adapter + RESOLVED→WO dual-write BUILT & tested | Hub `/proposals` renders **only** `relationship_proposals`, **never `ai_suggestions`** → nameplate/photo proposals written but invisible; HANDOFF FSM state MISSING; non-Atlas `create_asset` stubbed |

---

## 2. Stage-by-stage component inventory

### 2.1 CONNECT — getting data off the plant

| Component | Status | Evidence |
|---|---|---|
| `mira-relay` HTTP `/ingest` + WS `/ws` (HMAC) | **BUILT** | `mira-relay/relay_server.py:217` (ingest), `:243` (ws), `auth.py:70` (verify_hmac, ±300s window, nonce replay store); in `docker-compose.saas.yml:339-360` |
| `mira-pipeline` `POST /api/v1/ignition/chat` | **BUILT** | `ignition_chat.py:163` (route, HMAC `_verify_hmac` `:65`), `:193` per-asset chat_id, `:195` tag preamble, `:226` audit write |
| Ignition WebDev module (Jython, chat/tags/connect/ingest/alerts) | **BUILT** | `ignition/webdev/FactoryLM/api/chat/doPost.py` (signs via `signing.py`), `api/tags/doGet.py` + `allowlist.py` (fail-closed 503), `api/connect/doPost.py` (activation) |
| Ignition `tag-stream.py` (periodic factory→relay push) | **PARTIAL** | `ignition/gateway-scripts/tag-stream.py:109` — `_post_to_relay()` sends **only `Content-Type`, no HMAC headers**; `signing.py` exists but not imported here |
| `plc/discover.py` (fieldbus scanner) | **BENCH_ONLY** | `discover.py:1` read-only docstring, `:20-24` SAFETY header; **verified-absent in any compose**; PR #1586 (`16c4d3b4`) |
| `plc/live-plc-bridge/bridge.py` | **BENCH_ONLY** | `:1-20` BENCH-ONLY box; only in `docker-compose.fault-detective.yml:105-108` |
| `plc/live_monitor.py` (writes GS10) | **BENCH_ONLY** | `:1-17` BENCH-ONLY box; `:66-69` write targets; the only intentional PLC-write path |
| `tools/demo_plc_poller.py` | **BENCH_ONLY** | `:1-43` read-only header; not in any compose |
| `tools/demo_plc_simulator.py` (Modbus server) | **SIMULATED** | `:41-45` `StartAsyncTcpServer`; software sim of Micro820 |
| `mira-connect` Modbus driver | **DESIGNED_NOT_BUILT** | `mira-connect/.../modbus_driver.py` skeleton; no app/compose entry; deferred "Config 4" |

**Connect gaps for this work stream:** (C1) sign `tag-stream.py` with the same
HMAC contract Phase 2 enforces; (C2) add `MIRA_IGNITION_HMAC_KEY` to
`docker-compose.saas.yml` relay env. Both fold into **Phase 3** (Ignition
collector) since that's the customer-shipped Connect surface.

### 2.2 COLLECT — tag collection, allowlist, batching, normalization

| Component | Status | Evidence |
|---|---|---|
| Tag ingestion endpoint (`POST /ingest`) | **BUILT** | `relay_server.py:217`, `:328` route, tests `test_relay.py:89`. **Note: it is `/ingest`, not `/api/v1/tags/ingest`** — the master-plan claim that a tags-ingest endpoint is missing refers to the *versioned, allowlist-enforcing, UNS-aware* contract, which is what Phase 2 adds |
| Tag allowlist enforcement (`approved_tags.json`) | **BUILT (Ignition side only)** | `ignition/.../api/tags/allowlist.py:128`, `doGet.py:100-143` fail-closed. **NOT enforced on `mira-relay /ingest`** — any tag accepted there |
| Tag normalization / alias map | **PARTIAL** | `relay_server.py:27-40` `TAG_COLUMN_MAP` = 8 aliases → 4 columns only; no UNS-slug normalization at ingest; unknown tags dropped from metric columns |
| `demo_plc_poller` event detection | **BENCH_ONLY** | `:174-204` `detect_events()` rising/falling/value_changed — the only real collector, single hard-coded equipment |
| Batch payload handling | **BUILT** | `relay_server.py:97-173` single-txn multi-equipment upsert; no size cap/rate-limit |
| Sim-vs-real provenance at collection | **MISSING** | verified-absent: no `provenance`/`simulated`/`source_type` in relay payload or `equipment_status` |
| `tools/mock_tag_stream.py` + `tools/scenarios/*.yaml` | **DESIGNED_NOT_BUILT** | verified-absent on disk; only in master plan Phase 4 |
| NeonDB sinks `live_signal_cache` + `live_signal_events` | **BUILT** | poller `SCHEMA_DDL` + Hub mig 019/020 |

**Collect gaps for this work stream:** (Co1) allowlist enforcement +
(Co2) UNS-path normalization + (Co3) provenance/`simulated` flag must all live
on the **Phase 2** `POST /api/v1/tags/ingest` endpoint. (Co4) `mock_tag_stream.py`
is a master-plan Phase 4 deliverable, useful but out of *this* work stream's 0–4 scope (it unblocks engine Phases 5/9).

### 2.3 STORE — database schema (the foundation Phase 1 lands)

All existing domain tables are **BUILT** and well-formed (kg_entities,
kg_relationships, knowledge_entries, fault_codes, component_templates,
installed_component_instances, relationship_proposals + relationship_evidence,
ai_suggestions, troubleshooting_sessions, live_signal_events/cache,
diagnostic_trend_*, tag_entities, wiring_connections, display_endpoints,
ignition_audit_log, cmms_equipment). Lineage per ADR-0013: Hub
`mira-hub/db/migrations/001–031` owns the product surface; engine
`docs/migrations/001–008` owns kg_* approval columns.

**The five gap-closure tables — verified:**

| Table | Status | Decision | Evidence |
|---|---|---|---|
| `tag_events` (raw append-only stream) | **MISSING** | **NET-NEW → mig 033** | verified-absent: no `033_tag_events.sql`, no `CREATE TABLE...tag_events`. `live_signal_events` (019) is demo/component-bound, lacks `uns_path`/`source_system`/per-event provenance — too different to column-add |
| `approved_tags` (allowlist table) | **MISSING** | **NET-NEW → mig 035** | only `ignition/project/approved_tags.json` (46 tags). `tag_entities` (025) is the *semantic catalog*, NOT the security allowlist — distinct concern |
| `current_tag_state` (latest per tag) | **PARTIAL** | **EXTEND `live_signal_cache` → mig 036** (do NOT duplicate) | `live_signal_cache` (020) IS this table: PK `(tenant_id, plc_tag)`, `last_value_*`, `last_seen_at`, `last_changed_at`, `prev_value_*`, `simulated`. Missing only `uns_path`, `freshness_status`, `source_system`, `latest_quality` |
| `flaky_input_signals` | **MISSING** | **NET-NEW → mig 034** | verified-absent: no `034_*`, no `CREATE TABLE...flaky` |
| `decision_traces` | **MISSING** | **NET-NEW → mig 032** | verified-absent: no `032_*`, no `decision_trace`. `trace_id` exists in `process_full()` return but is Langfuse-sourced = `None` by default |

**Numbering:** `origin/main` tops out at Hub mig **029**; this branch adds
030/031 (Command Center + audit) and the gap-closure work adds **032–036**.
At merge time, if `origin/main` has independently grown a 030+, the
gap-closure migrations rename with a `b` suffix (`032b_*`) per the master
plan's collision mitigation.

### 2.4 ANALYZE — the diagnostic brain

| Component | Status | Evidence |
|---|---|---|
| Supervisor engine (`process`/`process_full`) | **BUILT** | `engine.py:467` (class), `:838` (process), `:1103` (process_full pipeline) |
| Dialogue FSM | **BUILT** | `fsm.py:19` STATE_ORDER, `:40-49` side-states incl. `AWAITING_UNS_CONFIRMATION`; DST behind `MIRA_USE_DST=1` (off by default) |
| UNS confirmation gate (chat surfaces) | **BUILT** | `engine.py:4541` `_should_fire_uns_gate`, `:4573`/`:4682` request/response handlers |
| **`direct_connection` UNS bypass** | **DESIGNED_NOT_BUILT** | **verified-absent: `grep direct_connection *.py` = 0 hits**; `ignition_chat.py:203` calls `engine.process()` through the full gate, never sets `state["uns_context"]["source"]` |
| UNS resolver | **PARTIAL** | `uns_resolver.py:717` resolves vendor/model/fault; `site_path` DB-enrich `:686-687` **always skipped under a running loop** → hierarchy never populated at runtime; no `source`/`confidence=certified` band |
| Hybrid retrieval (BM25+pgvector) | **BUILT** | `neon_recall.py:606`; PR #1385 ungated BM25 (`:636-642`) |
| RAG worker | **BUILT** | `rag_worker.py:273`, sanitize on both paths `:930-933` |
| Citation compliance | **PARTIAL** | `citation_compliance.py:7,54` — **observational only, never blocks** |
| Inference cascade (Groq→Cerebras→Gemini) | **BUILT** | `router.py:133-183` order, `:257` sanitize, no Anthropic |

> Analyze gaps (`direct_connection` bypass, citation enforcement, hierarchy
> resolution) are **master-plan Phases 6/7** — out of this 0–4 work stream but
> recorded here as the verified baseline those phases start from.

### 2.5 VISUALIZE — Hub UI

| Component | Status | Evidence |
|---|---|---|
| Command Center page (UNS tree + iframe viewer) | **PARTIAL** | on `feat/hub-command-center` (`91c6180c`), **verified-absent on origin/main**; demo-verified |
| **Command Center liveness indicator** | **BUILT — HTTP reachability only** | `tree/route.ts:17-22` comment "**NOT PLC-signal freshness**", `:175-201` 2s HTTP probe + 10s cache (any response = live); `page.tsx:211-223` `DisplayDot` |
| `display_endpoints` registry + read | **BUILT** | mig 030; `tree/route.ts:104-110`, `display/[id]/route.ts:54-59` |
| `display_endpoints` CRUD API | **DESIGNED_NOT_BUILT** | only in `cc-phase2-worktree` (`feat/hub-command-center-phase2`), blocked on Colima proxy-bind |
| Health-score widget (L0–L6) | **BUILT** | `HealthScoreWidget.tsx` + `health-score.ts` + `api/readiness/route.ts` **on origin/main** — *(master plan line 125 is WRONG: it says "not built")* |
| `/feed /assets /documents /knowledge /workorders /schedule /namespace /proposals /m/[assetTag]` | **BUILT** | all on origin/main (see audit refs) |
| `/discovery` page | **PARTIAL** | on `feat/hub-discovery-scan` worktree, in-memory store, unmerged |
| `/plc` Hub page | **MISSING** | verified-absent on all branches — *(master plan §1.7 wrongly lists it)* |
| Phase 4 tag-freshness liveness | **DESIGNED_NOT_BUILT** | this is exactly the **Phase 4** deliverable of this work stream |

### 2.6 PATTERN — anomaly/flaky detection, trends, KG inference

| Component | Status | Evidence |
|---|---|---|
| Flaky-input / sensor-anomaly detector | **MISSING** | verified-absent: `codegraph_search('flaky_input_detector')`/`('flaky_rules')` = 0; `mira-bots/agents/` has only `morning_brief_runner.py` |
| KG relationship proposal pipeline | **PARTIAL** | `kg_writer.py:144` writes `kg_relationships` **directly** (bypasses `relationship_proposals`); `/proposals` reads proposals correctly; **no `proposal-transition` helper** (verified-absent both `.ts` and `.py`) |
| Diagnostic trend sessions | **PARTIAL** | mig 020 + `signal-recorder.ts` write cache; `ask/route.ts:408-444` only *proposes* a trend, never persists a `diagnostic_trend_sessions` row |
| Health-score recompute worker | **BUILT** | `scripts/health-score-worker.ts:51` (PR #1332 slice 3) |
| Schematic vision (`kg_extract_schematic`) | **PARTIAL** | real 3-pass Gemini pipeline `schematic_intelligence.py:272`; but `upsertSchematicComponents()` writes `kg_relationships` at confidence=1.0, bypassing proposals |

> Flaky detector + proposal-transition are master-plan Phases 9/3 — out of this
> work stream's 0–4 scope; the `flaky_input_signals` *table* is built now (Phase 1).

### 2.7 REPORT — audit, decision traces, eval, observability

| Component | Status | Evidence |
|---|---|---|
| `decision_traces` / `DecisionTraceWriter` | **PARTIAL (storage MISSING)** | verified-absent: no `decision_trace.py`, no writer class; `trace_id` from `telemetry.py:70` `_NoOpTrace.id = None` when `LANGFUSE_SECRET_KEY` unset (the default) → **trace_id is None in prod** |
| `ignition_audit_log` | **BUILT** | mig 031 + `ignition_audit.py:51` write / `:143` read; wired in `ignition_chat.py`; append-only; PR #1624 |
| `benchmark_db` | **BUILT** | `benchmark_db.py` evidence_utilization/packet; reddit + prejudged runs |
| `conversation_logger` | **BUILT** | `conversation_logger.py:45` → `conversation_eval`; wired in Slack+Telegram (not pipeline) |
| Eval / test framework (regimes, goldens) | **BUILT (mature)** | 7 regimes, 60+ fixtures, 52 golden cases, offline pipeline + judge |
| Observability (Prom/Grafana/Flower) | **PARTIAL** | `docker-compose.observability.yml` defined but `./observability/` config dir **verified-absent**; `mira-ops/` dir absent |
| Hub `audit_events` (user-action trail) | **BUILT** | `mira-web/src/lib/audit.ts:45-61` |

> The `decision_traces` *table* is this work stream's Phase 1; the
> `DecisionTraceWriter` + Hub `/decision-traces` page are master-plan Phase 8.

### 2.8 SOLVE — work orders, CMMS, proposal review, resolution

| Component | Status | Evidence |
|---|---|---|
| MCP CMMS tool layer (7 tools) | **BUILT** | `mira-mcp/server.py:304-389`; REST shims :8001 |
| CMMS adapter factory + Atlas | **BUILT** | `cmms/factory.py:13-56`, `cmms/atlas.py:20-255` (all methods + `for_tenant`) |
| MaintainX adapter | **PARTIAL** | WO ops built; `create_asset` stubbed (`maintainx.py:163-173`) |
| Limble / Fiix adapters | **PARTIAL** | WO CRUD coded, untested live; `create_asset` stubbed |
| Atlas CMMS container stack | **BUILT** | `mira-cmms/docker-compose.yml` 4-container |
| RESOLVED → WO offer/dual-write | **BUILT** | `engine.py:2006-2036` offer, `:2125-2165` dual-write Atlas+Hub, `:2169-2298` yes/no/edit |
| HANDOFF FSM state | **MISSING** | verified-absent: no `HANDOFF` in `mira-bots/shared/` |
| `ai_suggestions` queue (mig 027) | **BUILT** | full DDL, 6 types, RLS |
| Hub `/proposals` reviewer UI | **PARTIAL** | `proposals/route.ts:127` reads **only `relationship_proposals`, never `ai_suggestions`** → nameplate/photo proposals invisible |
| Nameplate → proposal flow | **PARTIAL** | extract+Atlas-create tested; `propose_from_nameplate` writes `ai_suggestions` but no review surface; Atlas-only |
| Hub `work_orders` dual-write | **BUILT** | `integrations/hub_neon.py:71-135` |

---

## 3. Gap → closure matrix (this work stream: Phases 0–4)

| # | Gap (verified) | Closing phase | Deliverable |
|---|---|---|---|
| G1 | No append-only raw tag stream | **P1** | `032`…`035` + `036` migrations (see §2.3) |
| G2 | `approved_tags` is a flat JSON file, not a queryable tenant table | **P1 + P2 + P3** | `035_approved_tags.sql`; enforced in P2 ingest; populated/used in P3 Ignition |
| G3 | `current_tag_state` lacks UNS path + freshness + provenance system | **P1** | `036` extends `live_signal_cache` |
| G4 | No flaky-signal storage | **P1** | `034_flaky_input_signals.sql` (detector itself = master-plan P9) |
| G5 | No durable decision-trace storage (trace_id None in prod) | **P1** | `032_decision_traces.sql` (writer = master-plan P8) |
| G6 | No versioned, allowlist-enforcing, UNS-aware, provenance-correct tag ingest | **P2** | `POST /api/v1/tags/ingest` in `mira-relay` |
| G7 | Relay `/ingest` accepts any tag (no allowlist), no sim/real separation | **P2** | allowlist check + `simulated` flag, never mix |
| G8 | `tag-stream.py` unsigned; `MIRA_IGNITION_HMAC_KEY` absent from saas compose | **P3** | sign the stream; wire the key; collector deploy doc |
| G9 | Command Center "live" = HTTP reachability, not tag freshness | **P4** | live/stale/unknown/simulated from `current_tag_state`, reachability kept separate |

**Out of this work stream (recorded for the planner):** `direct_connection`
bypass (P6), citation enforcement + session lifecycle (P7), decision-trace
*writer*/UI (P8), flaky *detector* (P9), proposal-transition helper +
`kg_writer` re-route (P3 of master plan), `ai_suggestions` review surface
(Solve), HANDOFF state (Solve), `mock_tag_stream.py` (P4 of master plan,
engine-side). These are real gaps with verified evidence above; they are not
in scope for the 0–4 build but must not be lost.

---

## 4. Schema refinement note (reconciling task spec ↔ master-plan Appendix B)

The gap-closure task's column specs **refine** the master plan's first-pass
Appendix-B SQL; they do not contradict the plan. Recorded so Agent 1 (planner)
stays unblocked:

1. **`tag_events` is the RAW ingestion stream**, not the master plan's
   *meaningful-diff* stream. The task's columns (`value`, `value_type`,
   `quality`, `source_system`, `source_connection_id`, `simulated`,
   `event_timestamp` vs `ingested_at`) carry the **provenance the plan's draft
   omits** — and Phase 2's "never silently mix simulated and real telemetry"
   requirement *needs* those columns. The plan's Phase-5 *diff-event* model
   (`event_type` rising/falling/value_changed) is a **separate downstream
   concern**: it can be derived from this raw stream by the Phase-5 diff logger,
   or land as its own `tag_event_diffs` table later. **No conflict — sequence.**

2. **`current_tag_state` = extend `live_signal_cache`, not a new table.**
   The plan used `live_signal_cache` as "latest value." The audit confirms it
   IS that table; we add `uns_path`, `source_system`, `latest_quality`,
   `freshness_status` rather than duplicate (Reuse-Before-Build).

3. **`decision_traces`** ships the task's evidence-oriented columns
   (`tag_evidence`/`manual_evidence`/`kg_evidence` JSONB, `citations_present`,
   `technician_confirmed`, `outcome`) plus the plan's `platform`/`model_used`/
   `latency_ms`. UUID PK uses `gen_random_uuid()` (house convention; the plan's
   UUIDv7 suggestion is dropped — NeonDB-portable, time-ordering via index).

4. **`approved_tags`** uses the task's allowlist shape
   (`source_system`+`source_tag_path` key, `normalized_tag_path`, `enabled`,
   `notes`) — the security-allowlist concern — distinct from the plan's
   threshold/baseline columns (those belong to the Phase-9 flaky detector and
   can be added later if needed). Migrates `ignition/project/approved_tags.json`.

---

## 5. Corrections to the master plan (file these with Agent 1)

| Master plan claim | Verified reality |
|---|---|
| §1.7 "Health-score widget 🔲 not built" | **BUILT on origin/main** (`HealthScoreWidget.tsx`, `health-score.ts`, `api/readiness`) |
| §1.7 lists `/plc` as an existing Hub page | **MISSING** — verified-absent on all branches |
| §1.3 "`approved_tags` … currently file-only" | Correct — but note `tag_entities` (025) is NOT a substitute (semantic catalog ≠ allowlist) |
| §1.6 implies Ignition `tag-stream` is shippable | The **chat** path signs HMAC; the **tag-stream** path does NOT (gap G8) |
| Appendix B `tag_events` (diff stream) | Refined to raw-ingestion stream for Phase 2 provenance (see §4.1) |

---

## 6. Change log

- **2026-06-02** — Phase 0 deliverable. 8-stage parallel repo-truth audit
  (Connect→…→Solve), every component status-labeled with file/function/table/PR
  evidence and verified-absent assertions for gaps. Established the Phase-1
  schema decisions (4 net-new tables + 1 extend), the Phase-2/3/4 gap list, the
  schema-refinement reconciliation with the master plan, and 5 corrections to
  the master plan's baseline.
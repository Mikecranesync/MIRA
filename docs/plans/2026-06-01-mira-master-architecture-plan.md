# MIRA — Master Architecture & Phased Implementation Plan

**Status:** DRAFT — planning only, no production code
**Authored:** 2026-06-01
**Owner:** Mike Harper
**Companion docs (read in this order):** `docs/THEORY_OF_OPERATIONS.md` → `docs/specs/maintenance-namespace-builder-spec.md` → `docs/mira-ignition-secure-architecture.md` → `docs/specs/mira-component-intelligence-architecture.md` → `docs/specs/uns-kg-unification-spec.md` → `docs/plans/2026-05-15-maintenance-namespace-builder.md` → `docs/plans/2026-04-19-mira-90-day-mvp.md`

## 0. How to read this document

This is the **master plan that ties the existing specs and execution plans together**. It does NOT replace them. It is:

- A consolidated phase 0–13 roadmap, with each phase grounded in what already exists in the codebase (file paths, table names, PR numbers) so we never reinvent.
- A sub-agent dispatch plan (12 agents) for parallel execution where work is independent.
- A deliverables appendix covering: folder structure, Postgres schema, agent tools, event model, decision trace model, flaky-wire rule, demo plan, open questions, mock-first list, build-first list.

**Critical operating constraints (locked, do not violate):**

1. Postgres-first. No Neo4j, no Memgraph, no TerminusDB until Phase 13 and only if proven necessary.
2. No LangChain, no TensorFlow, no n8n. PRD §4.
3. Inference cascade: Groq → Cerebras → Gemini. **Never Anthropic** (removed PR #610).
4. UNS compliance: ISA-95 ltree paths via `mira-crawler/ingest/uns.py` builders. No hand-formatted paths.
5. Ignition-first for PLC data. **No customer-shipped MIRA container opens a Modbus / OPC-UA / EtherNet-IP socket** to the plant. `plc/live_monitor.py` and `plc/live-plc-bridge/bridge.py` are bench-only. See `docs/mira-ignition-secure-architecture.md` §8 and `.claude/rules/fieldbus-readonly.md`.
6. UNS Location-Confirmation Gate is non-negotiable on chat surfaces (Slack, Telegram, email, generic web). Direct connections (Ignition cloud-chat, MQTT/Sparkplug, PLC bridge, Hub display, QR deep-link) skip the gate but MUST reject turns missing a UNS identifier. See `.claude/rules/direct-connection-uns-certified.md`.
7. Every `proposed → verified` KG transition is a human action. No auto-verify.
8. Working demo over perfect architecture. Mock tag data wherever it unblocks Phase 4–11 work.

---

## 1. What already exists (Phase 0 baseline — 2026-06-01)

Status badges: ✅ shipped · ⚠️ partial · 🔲 not built · 🟦 bench-only (not customer-shipped)

### 1.1 Engine + bots

| Capability | Status | Where it lives |
|---|---|---|
| `Supervisor` class (engine entrypoint) | ✅ | `mira-bots/shared/engine.py:467` |
| Dialogue-state FSM (IDLE → Q1 → Q2 → Q3 → DIAGNOSIS → FIX_STEP → RESOLVED) | ✅ | `mira-bots/shared/fsm.py` |
| Side state `AWAITING_UNS_CONFIRMATION` | ✅ | `engine.py:1428–1439`, `_should_fire_uns_gate()` at L4541 |
| UNS resolver (vendor/model/fault-code extraction, alias tables + NeonDB enrichment) | ✅ | `mira-bots/shared/uns_resolver.py` (~900 lines) — `UNSContext` dataclass with `source` + `confidence` band |
| UNS confirmation gate (vendor/model/fault scope) | ✅ | Merged via PRs #1220, #1280, #1295, #1314 |
| Direct-connection UNS bypass (`source="direct_connection"`) | ⚠️ | Rule documented in `.claude/rules/direct-connection-uns-certified.md`. `ignition_chat.py` sets per-asset `chat_id` but does **not** explicitly set `source="direct_connection"` on `state["uns_context"]` yet. **Gap: Phase 6 must close this.** |
| Citation compliance hook (observational) | ⚠️ | `mira-bots/shared/citation_compliance.py` logs; does not yet enforce |
| Inference cascade Gemini → Groq → Cerebras (+ legacy Claude tail) | ✅ | `mira-bots/shared/inference/router.py` — `sanitize_context()` PII strip default-on |
| KB retrieval (BM25 + pgvector) | ✅ | `mira-bots/shared/neon_recall.py` — `recall_knowledge`, `recall_fault_code`, `kb_has_coverage`. Recently fixed in PR #1385 (embedding-gate killed BM25). |
| RAG worker (chunk retrieve → prompt → LLM) | ✅ | `mira-bots/shared/workers/rag_worker.py` — `kb_status` property for KB-gap scoring |
| LLM-based conversation router (intent) | ✅ | `mira-bots/shared/conversation_router.py` |
| Safety keyword classifier (22 phrases) | ✅ | `mira-bots/shared/guardrails.py` — `SAFETY_KEYWORDS` |
| Slack adapter (Socket Mode) | ✅ | `mira-bots/slack/bot.py` — dispatcher → `Supervisor.process_full()` → Block Kit renderer |
| Telegram adapter | ✅ | `mira-bots/telegram/` |
| Eval / benchmark turn log | ✅ | `mira-bots/shared/benchmark_db.py` — `evidence_utilization`, `evidence_packet` |

### 1.2 MCP tools (registered at `mira-mcp/server.py`)

**26 tools across 7 domains.** All routable via SSE :8000 (MCP clients) or REST :8001 (PDF ingest + CMMS proxy).

- **Equipment / live signal:** `get_equipment_status`, `list_active_faults`, `get_fault_history`, `get_maintenance_notes`
- **Diagnostic case:** `diagnostic_record_case`
- **CMMS (Atlas/MaintainX/Limble/Fiix via `mira-mcp/cmms/factory.py`):** `cmms_write_work_order`, `cmms_create_work_order`, `cmms_list_work_orders`, `cmms_complete_work_order`, `cmms_list_assets`, `cmms_get_asset`, `cmms_list_pm_schedules`, `cmms_health`
- **Asset / nameplate:** `create_asset_from_nameplate`
- **Agent control:** `run_kb_builder`, `run_prompt_optimizer`, `run_infra_guardian`, `get_agent_status`
- **Knowledge graph:** `kg_maintenance_context`, `kg_impact_analysis`, `kg_root_cause_chain`, `kg_traverse_chain`, `kg_flag_pm_mismatches`
- **Namespace / UNS:** `mira_browse_namespace`, `mira_get_equipment`
- **Schematic vision:** `kg_extract_schematic` (3-pass — IEC/ANSI classify → symbol detect → connection trace)

**Gaps the master plan must fill (per phase tables below):**
- No `get_asset_context(uns_path)` returning unified asset+component+tag+document+WO bundle.
- No `read_tag_value(tag_id)` agent-facing tool (live data is in `equipment_status` SQLite via `get_equipment_status`, but per-tag is not a first-class call).
- No `record_decision_trace(...)` tool — decision traces don't have a storage layer yet.
- No `detect_flaky_input(tag_id, window)` analytic tool.

### 1.3 Schema (NeonDB)

**ADR-0013 settled lineage:**
- **Hub `mira-hub/db/migrations/001–031`** owns the product-surface schema (KG, CMMS sync, component intelligence, namespace builder, sessions/signals, HMI, audit, tenancy/auth). Applied via `apply-migrations.yml`.
- **Engine `docs/migrations/001–008`** owns `kg_entities`/`kg_relationships` approval-state columns and the bridge to `knowledge_entries`. Applied separately.

**Tables already in place (selected — full inventory in Appendix B):**
- `kg_entities` (uns_path ltree, source_chunk_id, approval_state — Hub 001/010/024/029)
- `kg_relationships` (source_id, target_id, relationship_type, source_chunk_id, approval_state — Hub 001/024/028/029)
- `knowledge_entries` (text + embedding + metadata + `equipment_entity_id` FK — engine 001 + 006_kg_bridge)
- `fault_codes` (engine 002)
- `component_templates` (Hub 016 — Layer 1, reusable per-model)
- `installed_component_instances` (Hub 017 — Layer 2, tenant-scoped, uns_path)
- `relationship_proposals` + `relationship_evidence` (Hub 018 — Layer 3, evidence-bound)
- `ai_suggestions` (Hub 027 — 6 suggestion types, broad work queue; `kg_edge` type points to `relationship_proposals`)
- `troubleshooting_sessions` + `live_signal_events` (Hub 019)
- `live_signal_cache` + diagnostic trend tables (Hub 020)
- `tag_entities` (Hub 025 — first-class PLC/Sparkplug/OPC UA tag)
- `wiring_connections` (Hub 026)
- `display_endpoints` (Hub 030 — Command Center registry)
- `ignition_audit_log` (Hub 031 — every prompt + every tag read + cited sources)
- `cmms_equipment` (Atlas-synced; `equipment_number` QR binding, `uns_path` ISA-95)
- `tenant_invites`, `tenant_cmms_config`, `equipment_guest_reports`

**What is NOT yet a table (Phase 1 must add):**
- `decision_traces` — full audit of every troubleshooting interaction with retrievals, gate outcomes, citations, model usage, latency.
- `tag_events` (or `signal_events_v2`) — append-only event stream of meaningful tag changes / fault windows / flaky-input detections. (`live_signal_events` exists in Hub 019 but its current schema is per-session-bound; the event stream needs a tenant-scoped append-only twin.)
- `flaky_input_signals` — rolling-window flicker detector output.
- (Maybe) `approved_tags` — D1 from `mira-ignition-secure-architecture.md`, currently file-only (`approved_tags.json`).

### 1.4 Ingestion

- **PDF → chunk → embed → dedup → store:** `mira-crawler/ingest/converter.py` → `chunker.chunk_blocks()` (max 2000 tok, section-aware, table-aware) → `embedder.embed_text()` (Ollama `nomic-embed-text:latest`) → `dedup.py` → `store.store_chunks()` → `kg_writer.register_equipment_and_manual()` side effect.
- **Nameplate OCR:** `nameplate_worker.py` works, but invoked only from bot chat — **not** from an ingest API yet (TOO doc ⚠️).
- **MiraDrop watcher:** `~/MiraDrop/inbox/` → Hub `/api/uploads/folder` → OW chunks. Documented in `tools/mira-drop-watcher/README.md`. ADR-0019 + `mira-ingest-v2` design lock 2026-05-26.

### 1.5 Tag collector + bench tooling

- **`tools/demo_plc_poller.py`** — read-only Modbus TCP poll of Micro820 + GS10. `ADDRESS_MAP` matches `plc/MbSrvConf_v4.xml`. Emits `rising_edge`/`falling_edge`/`value_changed` events. Pushes to mira-relay (`POST /ingest`) and `live_signal_cache`. **Already implements the diff-detection pattern Phase 5 needs.**
- **`tools/demo_plc_simulator.py`** — Modbus TCP server (port 5020) driven by tick loop; ramps motor_speed 0→100, motor_current tracks speed × 0.1. Used to smoke-test the poller without hardware.
- **`plc/discover.py`** — read-only fieldbus scanner (TCP scan + CIP List Identity + Modbus FC1–4). RS-485 sweep requires `--serial-bus-idle`. Merged via PR #1586. 🟦 Useful for onboarding but does not run on customer plants without explicit human consent.

### 1.6 Ignition integration

- **`mira-pipeline/ignition_chat.py`** — `POST /api/v1/ignition/chat` exists; HMAC-verified (`MIRA_IGNITION_HMAC_KEY`); per-asset `chat_id = f"ignition:{tenant_id}:{asset_id}"`; tag preamble injected via `_format_tag_preamble()`. **Gap:** does not yet populate `state["uns_context"]["source"]="direct_connection"`.
- **`mira-pipeline/ignition_audit.py`** — writes to `ignition_audit_log` (PR #1624 / D7).
- **`mira-relay/relay_server.py`** — cloud-side Ignition gateway endpoint. HTTP `/ingest` (HMAC) + WebSocket `/ws`. Persists to SQLite WAL (`equipment_status`, `faults`).
- **Per `docs/mira-ignition-secure-architecture.md`:** D1 (approved_tags allowlist + WebDev filter) 🔴 not built; D2 (WebDev `/chat` repoint) 🔴; D6 (Perspective ChatPanel view) 🔲; D8 (tag-import wizard) 🔲; D10 (E2E bench) 🔲. ADR-0021 ratified ✅.

### 1.7 Hub UI

- `mira-hub/` Next.js app at `app.factorylm.com`. Pages: `/feed`, `/assets`, `/documents`, `/knowledge`, `/workorders`, `/schedule`, `/plc`, `/m/[assetTag]`, `/discovery` (fieldbus inventory — PR #1589), `/command-center` (PR #1593 / #1603).
- `parent_asset_id` exists on `cmms_equipment`; **flat asset list, no tree UI** (per namespace-builder spec Phase 2).
- Health-score widget 🔲 not built.

### 1.8 Demo conveyor + Fault Detective

- `plc/Micro820_v4.1.9_Program.st` — ladder logic with 5 s `vfd_err_timer` (GS10 comm timeout → CE10 → `fault_alarm` → `error_code=9` → `conv_state=FAULT`).
- `plc/MbSrvConf_v4.xml` — ground-truth Modbus map (coils 0–6, HR 400101–400117). v4 deployed to bench PLC 2026-05-29.
- `docker-compose.fault-detective.yml` 🟦 — bench harness, NOT customer-shipped. Wired to `plc/live-plc-bridge/bridge.py`.
- Conv_Simple_1.6 (write path) — drafted via Mike on PLC laptop; promotion/tag/PR-#7 status unconfirmed from CHARLIE.

### 1.9 What's still missing (the gap list this plan closes)

| Missing capability | Phase that delivers it |
|---|---|
| `decision_traces` table + writer + retriever | **Phase 1** schema, **Phase 8** writer/UI |
| `tag_events` append-only stream + diff logger | **Phase 5** |
| `flaky_input_signals` + detector job | **Phase 9** |
| `state["uns_context"]["source"]="direct_connection"` wired on Ignition chat path | **Phase 6** |
| Citation enforcement (not just observational) | **Phase 7** |
| `get_asset_context(uns_path)` unified MCP tool | **Phase 11** |
| `read_tag_value` / `read_tag_history` MCP tools | **Phase 11** |
| `record_decision_trace` MCP tool | **Phase 11** |
| Approved-tags allowlist enforced at relay + Ignition WebDev | **Phase 4 (D1/D2)** |
| Health score L0–L6 computer | Out of scope for this plan (namespace-builder Phase 2 owns it; cross-reference only) |
| Hub `/proposals` reviewer queue UI | Out of scope (namespace-builder Phase 2 owns it) |

---

## 2. Phase Breakdown (0–13)

Each phase: **goal · why · inputs · outputs · schema · agent tools · risks · acceptance · suggested files · difficulty (S/M/L/XL).**

### Phase 0 — Discovery & alignment

**Goal.** Lock the inventory of what exists vs. what's planned, so no sub-agent reinvents.
**Why.** Local checkouts run dozens of commits behind origin/main. The namespace-builder plan has already shipped Phases 0–2 slice-by-slice; the 90-day MVP plan calls work "in-flight" that's actually merged. A wrong baseline is what produces duplicate scrapers, duplicate enum fixes, duplicate UNS gates.
**Inputs.** `git fetch origin main` · `gh pr list --state merged --search '<keyword>'` · §1 above · CLAUDE.md · MEMORY.md · `wiki/hot.md`.
**Outputs.** This document. The "baseline" section in §1 must be re-verified at the start of every sub-agent session by running:
```
git fetch origin main
git log HEAD..origin/main --oneline | head -50
gh pr list --state open --limit 30
```
**Schema changes.** None.
**Agent tools.** N/A (planning).
**Risks.** Baseline drifts before Phase 1 starts. Mitigation: every sub-agent runs the 3-command check in its briefing and reports back what it found.
**Acceptance.** This doc merged. Each phase below has the "currently in-flight" line accurate to origin/main at time of work.
**Files.** This document.
**Difficulty.** S.

---

### Phase 1 — Postgres-first data model

**Goal.** Land the missing tables (`decision_traces`, `tag_events`, `flaky_input_signals`, optional `approved_tags`) and ratify the column-add patterns for the existing schema so Phases 2–11 have a stable foundation.
**Why.** Most domain tables already exist (kg, components, sessions, signals, ai_suggestions, ignition_audit). The plan-critical *new* tables are the trace + event + flaky-signal layer. Adding them now means downstream phases never block on "where do I write this."
**Inputs.** Existing Hub migrations 001–031, engine migrations 001–008, the ADR-0013 lineage rule, the namespace-builder spec's `ai_suggestions` shape, `live_signal_cache` (Hub 020) for event-stream patterns.
**Outputs.**
- New Hub migrations:
  - `032_decision_traces.sql` — append-only audit (see §3 deliverable D5)
  - `033_tag_events.sql` — append-only meaningful-change stream (see §3 deliverable D4)
  - `034_flaky_input_signals.sql` — rolling-window flicker detector output (see §3 deliverable D6)
  - `035_approved_tags.sql` — first-class table backing the `approved_tags.json` allowlist (see Ignition D1)
- Column adds (separate small migrations to avoid mega-PRs):
  - `036_decision_trace_session_link.sql` — `troubleshooting_sessions.decision_trace_id` FK
  - `037_kg_relationships_evidence_ref.sql` — explicit `relationship_proposal_id` link if not already present
- Engine-side migrations folder stays scoped to `kg_entities`/`kg_relationships` per ADR-0013.

**Schema.** See Appendix B for full shapes.
**Agent tools.** None at this phase (Phase 11 wires them).
**Risks.**
- Migration numbering collision with concurrent peer sessions. Mitigation: every sub-agent runs `ls mira-hub/db/migrations/ | tail -5` and `git fetch origin main` before assigning a number; if collision risk, rename to `032b_*.sql`.
- `ltree` extension on NeonDB prod — UNS-KG spec Q2 still unconfirmed. Mitigation: verify on staging before any path-typed CREATE TABLE.
- Engine vs. Hub lineage drift — ADR-0013 says product-surface goes to Hub. Mitigation: re-read §1.3 and check both `ls` outputs before creating.

**Acceptance.**
- `apply-migrations.yml --dry-run` passes on staging.
- `apply-migrations.yml --apply` passes on staging.
- All four new tables exist with the indexes specified in §3.
- The 3-command pre-flight is logged in the PR description.
- No row counts in existing tables changed.

**Suggested files.**
- `mira-hub/db/migrations/032_decision_traces.sql`
- `mira-hub/db/migrations/033_tag_events.sql`
- `mira-hub/db/migrations/034_flaky_input_signals.sql`
- `mira-hub/db/migrations/035_approved_tags.sql`
- `mira-hub/db/migrations/036_decision_trace_session_link.sql`
- `mira-hub/db/migrations/037_kg_relationships_evidence_ref.sql`
- `docs/adr/0022-decision-trace-storage.md` (decision: append-only NeonDB, no separate time-series DB until proven)

**Difficulty.** M (SQL only, but each table needs careful index design — Appendix B).

---

### Phase 2 — Knowledge base ingestion

**Goal.** Promote the existing PDF ingest pipeline from "works when invoked from bot chat" to "first-class HTTP ingest API + MiraDrop watcher + chunk dedup + KG-side-effect" — and surface a structured `ingest_status` so Phase 3 can see "what was extracted from what."
**Why.** Per TOO doc: `nameplate_worker.py` works but is only invoked from bot chat. The MiraDrop ingest v2 design (ADR-0019) is locked but unbuilt. The unified-namespace spec (§3) says every chunk needs an `equipment_entity_id`; the flywheel only spins when this side-effect runs reliably.
**Inputs.** `mira-crawler/ingest/` modules · `tools/mira-drop-watcher/` · ADR-0019 · `docs/specs/uns-kg-unification-spec.md` · existing `knowledge_entries` table · `kg_writer.upsert_entity()`.
**Outputs.**
- A documented `POST /api/v1/ingest` endpoint on `mira-mcp` (REST :8001) that accepts: PDF / image / structured CSV (PLC tag export) / wiring-diagram image / photo. Returns an `ingest_id`.
- `tools/mira-drop-watcher/` updates to call this endpoint instead of the OW upload path (Track 2 per `project_miradrop_tracks.md`).
- `kg_writer` side-effect verification: every successful manual ingest creates ≥1 `kg_entity` and links chunks via `source_chunk_id`.
- `ingest_status` table (or column on `ingest_tracking`) capturing: source_file, chunk_count, entity_count, fault_codes_extracted, pm_schedules_extracted, errors[].
- A nameplate-from-API endpoint: `POST /api/v1/ingest/nameplate` — accepts photo, returns `mfr`, `model`, `serial`, `V`, `FLA`, `HP` + a draft `installed_component_instance` row in `pending` state.

**Schema.** Lightweight — column adds to `ingest_tracking`. No new tables of consequence.
**Agent tools.** Phase 11 wires `mira_ingest(file_url, kind)` and `mira_ingest_nameplate(photo_b64)` MCP tools.
**Risks.**
- Chunker is already tuned for max 2000 tok, table-aware — don't regress. Mitigation: golden test on a known manual (GS10 datasheet) before/after.
- Open WebUI ↔ NeonDB dual-write era (`project_upload_retrieval_gap.md`). Mitigation: Phase 2 writes to `knowledge_entries` only; OW path is sunsetting per `project_miradrop_tracks.md`.
- Embedding gate (PR #1385) — verify retrieval still hits BM25 + vector after this work.

**Acceptance.**
- Upload a manual via the new API → chunks appear in `knowledge_entries` → at least one `kg_entity` is created → the manual is retrievable via `mira_browse_namespace`.
- Upload a nameplate photo → `installed_component_instances` row in `pending` state with mfr/model/serial.
- MiraDrop watcher dropped a PDF in `~/MiraDrop/inbox/` → end-to-end chunked + KG-bridged in <30s.
- No regression on the 5-regime tests (`tests/regime3_kb`).

**Suggested files.**
- `mira-mcp/server.py` — add ingest endpoints (REST router, not @mcp.tool)
- `mira-crawler/ingest/api.py` (new) — shared ingest entrypoint, called from MCP REST router and MiraDrop watcher
- `tools/mira-drop-watcher/watcher.py` — re-point to new endpoint
- `docs/adr/0019-miradrop-ingest-v2.md` (already exists per MEMORY.md — extend with API contract)

**Difficulty.** M.

---

### Phase 3 — Knowledge graph relationships

**Goal.** Close the proposal → evidence → review → verify loop. Today, ingest writes `kg_relationships` directly; the namespace-builder spec calls this "rhetorical, not real." Phase 3 inserts `relationship_proposals` as the intermediate step and routes Hub `/proposals` (Phase 2 of namespace-builder, already shipped) at the resulting queue.
**Why.** TOO Invariant #4: every edge has a status. Today `proposed` is rhetorical. Closing the loop is what makes the "MIRA proposes, human confirms" wedge real.
**Inputs.** Hub migrations 016/017/018 (component_templates, installed_component_instances, relationship_proposals + evidence) · Hub 027 (ai_suggestions) · Hub 029 (approval_state on kg_*) · ADR-0017 (status transitions go through helpers) · `kg_writer.upsert_relationship()`.
**Outputs.**
- `mira-hub/lib/proposal-transition.ts` + `mira_bots/shared/proposal_transition.py` helpers (ADR-0017 — already specified as required for any status update on `ai_suggestions` / `relationship_proposals` / `kg_*.approval_state`). Implement if not present.
- Rewire `kg_writer.upsert_relationship()` to write to `relationship_proposals` (with evidence row), bridge an `ai_suggestions` of type `kg_edge`, and only insert into `kg_relationships` on human approval.
- Verify the existing recompute worker (PR #1332 / Phase 2 slice 3) picks these up and that the `/proposals` reviewer UI shows them.
- A KG-write **forbidden phrase audit**: grep for `INSERT INTO kg_relationships` outside the proposal-transition helper; flag every site.

**Schema.** None (tables already in place).
**Agent tools.** Phase 11 wires `mira_propose_relationship` and `mira_review_proposal`. Today the Hub UI's decide endpoint exists; we just need a backend-callable mirror.
**Risks.**
- Backfill: existing rows in `kg_relationships` need a status — Phase 1 migration 008/029 added `approval_state` with `verified` default to preserve current behavior. Don't break that.
- Double-write era: while old call sites still write directly, deduplicate (source_id, target_id, type, source_chunk_id) at insert time.
- `wiring_connections` (Hub 026) and `DRIVES` relationship type (Hub 028) are recent — make sure the proposal path covers them.

**Acceptance.**
- New evidence-bound relationships from a fresh manual ingest land in `relationship_proposals`, not `kg_relationships`.
- `/proposals` shows the new rows. Approve → row appears in `kg_relationships` with `approval_state='verified'`. Reject → marked `rejected`, no `kg_relationships` insert.
- Direct `INSERT INTO kg_relationships` from the engine ingest path = 0 occurrences outside the helper.

**Suggested files.**
- `mira_bots/shared/proposal_transition.py`
- `mira-hub/lib/proposal-transition.ts`
- `mira-crawler/ingest/kg_writer.py` — re-route through helper
- `docs/adr/0023-kg-write-through-helper.md` (or extend ADR-0017)

**Difficulty.** M.

---

### Phase 4 — PLC / Ignition tag collector

**Goal.** Make `tools/demo_plc_poller.py`'s pattern customer-deployable via Ignition (not direct Modbus from MIRA containers) AND ship the bench-equivalent mock for unblocking Phases 5/9/12 without hardware. Plus close D1/D2 from the Ignition checklist (approved-tags allowlist + WebDev `/chat` repoint).
**Why.** Per ADR-0021 and `docs/mira-ignition-secure-architecture.md` §8: customer-shipped MIRA never opens a Modbus socket to the plant. Ignition is the read path. The poller pattern is correct conceptually (poll → diff → publish events) — Phase 4 ports it to the Ignition gateway side.
**Inputs.** `tools/demo_plc_poller.py` (poll + diff pattern) · `mira-relay/relay_server.py` (cloud-side HMAC ingest) · `mira-pipeline/ignition_chat.py` (per-asset chat) · `approved_tags.json` (allowlist) · Ignition gateway scripts (Java/JS WebDev).
**Outputs.**
- **Customer-shipped path:** Ignition gateway script + WebDev module reads only allowlist tags, posts to `mira-relay /ingest` (HMAC) on diff. Schema: `{tenant_id, ts, asset_uns_path, tag_id, value, prev_value, quality}`.
- **D1:** Migrate `approved_tags.json` to `approved_tags` table (Phase 1 migration 035). Add `approved_tags_compat.json` writer for backwards compat during cutover.
- **D2:** Ignition WebDev `/chat` repointed to `mira-pipeline /api/v1/ignition/chat`.
- **Mock collector for dev / pre-PLC:** `tools/mock_tag_stream.py` — reads a YAML scenario file (`tools/scenarios/conveyor_normal.yaml`, `conveyor_flicker.yaml`, `conveyor_gs10_f0004.yaml`), emits events to `mira-relay /ingest` on a tick loop, ramps motor_speed, simulates fault windows. Conceptual successor to `demo_plc_simulator.py` (which is a Modbus server, not an event emitter).

**Schema.** Phase 1 already adds `approved_tags`. No further.
**Agent tools.** Phase 11 wires `read_tag_value(tag_id)`, `read_tag_history(tag_id, window)`, `list_tags_for_asset(uns_path)`.
**Risks.**
- HMAC key rotation — per Ignition arch §11, keys minted in Hub admin and rotated quarterly. Phase 4 must not regress to bearer-only.
- Two-master Modbus contention — **anything** that touches RS-485 must respect `--serial-bus-idle` per `.claude/rules/fieldbus-readonly.md`. Phase 4 work is Ignition-side, so this is informational, but the discover.py path remains the only sweep.
- Allowlist must be enforced at TWO points: Ignition WebDev `/tags` (D1) AND `mira-relay /ingest` (defense in depth). A tag absent from `approved_tags` is dropped at both.

**Acceptance.**
- Mock collector emits events that land in `live_signal_cache` + `tag_events` (Phase 5).
- Ignition WebDev `/tags` endpoint returns only allowlisted tags.
- mira-relay drops POSTs containing non-allowlisted tags with 403.
- HMAC key rotation script + Hub admin page exists.

**Suggested files.**
- `tools/mock_tag_stream.py` (new)
- `tools/scenarios/conveyor_normal.yaml`, `conveyor_flicker.yaml`, `conveyor_gs10_f0004.yaml` (new)
- `mira-relay/auth.py` — add allowlist check
- `ignition/webdev/` — gateway-side filter script (planning only, not in this repo today)

**Difficulty.** M (mock + relay enforcement) + L (Ignition WebDev side, requires Ignition designer access).

---

### Phase 5 — Tag diff & event stream logger

**Goal.** Convert raw poll/relay traffic into a *meaningful* event stream that Phase 7 (troubleshooting), Phase 8 (decision trace), and Phase 9 (flaky-wire detector) can query. Inspired by GitHub's diff model: not every value, only the ones that changed in ways worth recording.
**Why.** A poll-every-second firehose to `live_signal_cache` is fine for "latest value" but useless for retrospective troubleshooting. The diff pattern in `demo_plc_poller.py:174 detect_events()` is exactly right — promote it to a first-class layer.
**Inputs.** `tools/demo_plc_poller.py:detect_events` (rising_edge/falling_edge/value_changed) · `mira-relay /ingest` payloads · `live_signal_cache` (latest snapshot) · Phase 1 `tag_events` table.
**Outputs.**
- A **diff-logger worker** (Celery or asyncio loop in `mira-relay`) that:
  - For boolean/coil tags: emits `rising_edge` / `falling_edge` events.
  - For int/float tags: emits `value_changed` only when delta > config threshold (per-tag) OR when crossing a threshold (e.g., motor_current > 10A).
  - For fault-code tags: emits `fault_window_open` / `fault_window_close`.
  - For analog trend tags: emits `trend_segment` every N seconds with min/max/mean/stddev.
- Each event row: `{event_id, tenant_id, ts, uns_path, tag_id, event_type, prev_value, new_value, delta, threshold, window_start, window_end, fault_code?, severity?, raw_quality?}`.
- A retention policy: 90 days raw `tag_events`, then roll up to `tag_event_summary_daily`.

**Schema.** Phase 1 already adds `tag_events`. Phase 5 ships the writer and the rollup job.

**Event model (see deliverable D4 below for fields):** GitHub-diff inspired — only diffs that matter, with provenance. Every event traces back to a relay batch via `relay_batch_id`.

**Agent tools.** Phase 11 wires `get_tag_events(tag_id, window)`, `get_fault_windows(uns_path, window)`.
**Risks.**
- Threshold tuning — too low = noise, too high = missed flickers. Mitigation: per-tag config in `approved_tags.threshold` (added in Phase 1 migration), default deltas in the worker.
- Backfill — `live_signal_cache` has data but no event history. Decision: do NOT backfill; events start now. Document this in ADR.
- Multi-tenant noise — partition `tag_events` by `(tenant_id, ts)` index.

**Acceptance.**
- Mock collector running `conveyor_flicker.yaml` produces visible rising/falling edges on a prox tag at the configured cadence.
- A simulated GS10 F0004 produces a `fault_window_open` event, and clearing it produces `fault_window_close`.
- `tag_events` partition usage stays under target after 24h soak.

**Suggested files.**
- `mira-relay/diff_logger.py` (new)
- `mira-relay/rollup_worker.py` (new — Celery task running nightly)
- `docs/adr/0024-tag-event-stream-model.md`

**Difficulty.** M.

---

### Phase 6 — UNS Location-Confirmation Gate (close the gaps)

**Goal.** Two gaps from §1.1: (a) wire `state["uns_context"]["source"]="direct_connection"` on `mira-pipeline/ignition_chat.py` and validate the engine skips the gate accordingly; (b) extend the gate's location-resolution from "what equipment" to "where in the plant" (site → area → line → machine → asset → component), per the namespace-builder spec.
**Why.** §1.1 shows the gate works for vendor/model/fault scope (PRs #1220, #1280, #1295, #1314 already merged). The two outstanding pieces are direct-connection certification (so Ignition chat doesn't re-confirm a tech who's already in Perspective looking at CV-101) and hierarchy resolution (Phase 1 of the namespace-builder plan).
**Inputs.** `engine.py:_should_fire_uns_gate` (L4541) · `engine.py:1163–1187` (uns_context populate) · `ignition_chat.py` · `.claude/rules/direct-connection-uns-certified.md` · `docs/specs/maintenance-namespace-builder-spec.md` §UNS Location-Confirmation Gate · `uns_resolver.resolve_uns_path()`.
**Outputs.**
- `ignition_chat.py` populates `state["uns_context"]["source"]="direct_connection"` and `confidence="certified"` from the signed payload's `asset_context` field.
- `engine._should_fire_uns_gate` branches on `source`: `chat_resolver` / `technician_hint` → gate fires per existing rules; `direct_connection` → gate is satisfied at arrival.
- `mira-pipeline/ignition_chat.py` rejects (400/422 `{"error":"uns_required"}`) when `asset_context` is missing or unresolvable — does NOT downgrade to chat-gate.
- Hierarchy resolution in `uns_resolver.py`: in addition to vendor/model/fault, return candidate `(site, area, line, machine, asset, component)` from technician hints + tenant `kg_entities` tree.
- Confirmation card UX: when confidence < `certified`, the gate's confirmation message includes the resolved hierarchy path with "Did I find the right machine?" Y/N + correction affordances.

**Schema.** None.
**Agent tools.** None (gate runs inside the engine).
**Risks.**
- Regression on PRs #1220 / #1280 / #1295 / #1314 — run `mira-run-hallucination-audit` and the golden test suite (`tests/golden_factorylm.csv`, `tests/golden_hybrid.csv`) before merge.
- Direct-connection turn arriving with stale `asset_context` (e.g., Perspective panel cached) — the engine should still trust the connection but log warning when tag_snapshot disagrees with `asset_context`.

**Acceptance.**
- Ignition chat turn with `asset_context={site, area, line, equipment}` → engine goes straight to grounded diagnosis (no confirmation card).
- Ignition chat turn with no `asset_context` → 422 with `{"error":"uns_required"}`.
- Slack chat turn naming an asset → confirmation card with resolved hierarchy + Y/N.
- Mira-run-hallucination-audit flags zero new violations.

**Suggested files.**
- `mira-pipeline/ignition_chat.py`
- `mira-bots/shared/engine.py` (gate branch)
- `mira-bots/shared/uns_resolver.py` (hierarchy resolver)
- `tests/golden_uns_direct_connection.csv` (new)

**Difficulty.** M.

---

### Phase 7 — Troubleshooting session workflow

**Goal.** After the UNS gate passes (chat or direct-connection), open a `troubleshooting_session`, run grounded diagnosis (RAG + KG + live tags + WO history), enforce citations (not just observe), and close with either RESOLVED or HANDOFF_TO_TECH state.
**Why.** Hub 019 already gives us `troubleshooting_sessions` + `live_signal_events`. The engine already enters the diagnostic FSM. The two gaps: citation enforcement (TOO ⚠️ "logs; does not enforce") and explicit session lifecycle (open/close/timeout).
**Inputs.** `Supervisor.process` (engine.py:838) · `troubleshooting_sessions` table (Hub 019) · `citation_compliance.py` · `recall_knowledge` (neon_recall.py) · `kg_maintenance_context` MCP tool · `cmms_list_work_orders` MCP tool · `tag_events` (Phase 5).
**Outputs.**
- A `TroubleshootingSession` lifecycle: opened on gate-pass → updated on every turn → closed on RESOLVED / HANDOFF / timeout (24h).
- Citation enforcement: a reply that fails `check_citation_compliance` is rewritten by a second LLM pass with "you must cite ≥1 source from the retrieval set" — or, if still uncited, replaced with a KB-gap admission ("I don't have evidence for X; want me to file a tech-knowledge request?").
- Engine populates the `troubleshooting_session` row with: retrieval set (chunk_ids), KG hops used, tag_events queried, WO_ids cited, gate outcome, model usage, latency.
- Engine writes to `decision_traces` (Phase 1) at every turn (see Phase 8 for trace details).

**Schema.** None (uses Phase 1 + Hub 019).
**Agent tools.** Phase 11 wires `open_troubleshooting_session`, `close_troubleshooting_session`, `record_decision_trace_step`.
**Risks.**
- Latency — second-pass citation rewrite costs another LLM round-trip. Mitigation: only invoke when first reply fails compliance (most won't).
- Session leak — open sessions that never close. Mitigation: nightly cron closes sessions idle >24h with `state='timeout'`.
- Doubling up with `conversation_logger` — clarify: `conversation_logger` is the per-turn eval log; `troubleshooting_session` is the per-incident clinical record.

**Acceptance.**
- A Slack thread asking "why did the GS10 fault?" after UNS gate → session opened → grounded reply citing GS10 manual page → session updated with retrieval set + cited chunk_ids.
- Reply citing zero sources never reaches the user (rewritten or replaced with admission).
- `tests/regime3_kb` passes; `bot-grounding-tests` skill regression set passes.

**Suggested files.**
- `mira-bots/shared/troubleshooting_session.py` (new — wraps the Hub 019 table)
- `mira-bots/shared/citation_compliance.py` (enforce mode)
- `mira-bots/shared/engine.py` (lifecycle hooks)

**Difficulty.** L.

---

### Phase 8 — Decision trace storage & retrieval

**Goal.** Full audit of every troubleshooting turn so we can replay, evaluate, and learn. Each turn produces a `decision_trace` row tying together: gate outcome, intent, retrieval set, KG hops, tag events consulted, prompt, raw model response, citation check, final reply, latency, model_used, cascade-failures.
**Why.** TOO Invariant #6: "All troubleshooting is grounded." We can't audit groundedness without storing the trace. The Karpathy "evidence beats assertion" principle + the cluster's Law 1 "evidence-only completion" both rest on traces being durable, not in-memory.
**Inputs.** Phase 1 `decision_traces` table · `troubleshooting_session_id` FK · `Supervisor.process_full()` return shape (`{reply, confidence, trace_id, next_state}` already includes `trace_id`).
**Outputs.**
- `mira-bots/shared/decision_trace.py` — `DecisionTraceWriter` class with `start_turn`, `record_retrieval`, `record_kg_hops`, `record_tag_events_consulted`, `record_llm_call`, `record_citation_check`, `record_final_reply`, `commit`.
- `Supervisor.process_full` writes one row per turn via the writer.
- A `/decision-traces/<trace_id>` Hub page (read-only, admin-only) showing the full audit.
- A `decision_trace_replay` script for offline debug.

**Schema.** Phase 1 `decision_traces`. See Appendix B + deliverable D5.

**Agent tools.** Phase 11 wires `read_decision_trace(trace_id)` and `list_decision_traces(session_id)`.

**Risks.**
- Row volume — at 1 turn/s on a multi-tenant system, this grows fast. Mitigation: JSONB columns for the heavy bits (retrieval_set, kg_hops, tag_events_consulted); 90-day retention with rollup to `decision_trace_summary_daily`.
- PII — prompts contain technician messages. Mitigation: `InferenceRouter.sanitize_context()` already strips IP/MAC/SN; ensure the trace stores the sanitized form, not the raw.
- ID space — use UUIDv7 for `trace_id` (sortable, indexable).

**Acceptance.**
- Every Slack turn → one `decision_traces` row visible in `/decision-traces`.
- Replay script reconstructs a turn end-to-end.
- 5-regime tests pass; latency overhead < 30ms per turn (NeonDB INSERT is cheap).

**Suggested files.**
- `mira-bots/shared/decision_trace.py`
- `mira-hub/app/decision-traces/[id]/page.tsx` (admin-only)
- `tools/replay_decision_trace.py`

**Difficulty.** M.

---

### Phase 9 — Flaky wire / sensor anomaly detector

**Goal.** Detect unstable inputs (prox flicker, brown-out, intermittent disconnect) from the `tag_events` stream and surface them as proposed insights (`ai_suggestions` of a new type `flaky_signal_alert`).
**Why.** This is the wedge demo Mike wants. A technician watching a confused conveyor doesn't know the prox is flickering 14 times/hour. MIRA does — the stream is right there.
**Inputs.** `tag_events` (Phase 5) · `flaky_input_signals` (Phase 1) · `ai_suggestions` (Hub 027) · the `detect_events` cadence patterns from `demo_plc_poller.py`.
**Outputs.**
- A `FlakyInputDetector` worker (Celery task, every 5 min):
  - For each boolean tag in `tag_events` in the last 1h window, count rising_edge transitions.
  - If count > N (default 10) and not correlated with an expected cycle (e.g., conveyor cycle period), emit a row in `flaky_input_signals`.
  - Bridge an `ai_suggestions` row of type `flaky_signal_alert` for the reviewer queue.
- A first-class rule (see deliverable D6 for spec) covering: rapid toggle, brown-out, intermittent disconnect, value-spike (analog).

**Schema.** Phase 1 `flaky_input_signals` table + bridge to `ai_suggestions`.

**Agent tools.** Phase 11 wires `detect_flaky_input(tag_id, window)` and `list_flaky_alerts(uns_path, window)`.

**Risks.**
- False positives during commissioning (legitimate rapid cycling). Mitigation: per-tag baseline learned over first 7 days; suppress alerts until baseline established.
- Correlation with cycle — Phase 9 ships single-tag detection only; cross-tag correlation is Phase 12+ (out of scope here).
- Alarm fatigue if alerts hit Slack directly. Mitigation: alerts go to `/proposals` reviewer queue (Hub), not push notifications, until validated.

**Acceptance.**
- `conveyor_flicker.yaml` scenario via mock collector → detector emits a row in `flaky_input_signals` within 5 min.
- Hub `/proposals` shows the alert in the `flaky_signal_alert` lane.
- Marketing screenshot pair captured per Screenshot Rule.

**Suggested files.**
- `mira-bots/agents/flaky_input_detector.py` (new)
- `mira-bots/shared/flaky_rules.py` (the rule from D6)
- `tools/scenarios/conveyor_flicker.yaml` (already in Phase 4 list — extend)

**Difficulty.** M.

---

### Phase 10 — Slack bot interface (incremental upgrades)

**Goal.** Slack bot already works (`mira-bots/slack/bot.py`). Phase 10 closes the gaps: surface UNS confirmation cards as Block Kit interactive elements, log decision_trace_ids in thread, allow technician confirmation of proposals from the thread.
**Why.** Slack is the front door (TOO Invariant #2). Most of the lift is done. The remaining work is rendering the proposal/confirmation lifecycle in Slack-native UI rather than plain text.
**Inputs.** `mira-bots/slack/bot.py` · `chat/renderers/slack_blocks.py` · Block Kit · existing `/mira-*` slash commands.
**Outputs.**
- UNS confirmation card → Block Kit with `Yes / Different machine / Cancel` buttons.
- Proposal-approval card (when MIRA proposes a wiring relationship from a tech's photo) → Block Kit with `Approve / Edit / Reject` buttons.
- Thread footer with `trace_id` link to `/decision-traces/<id>`.
- New slash command: `/mira-trace` → shows last 5 traces from this user.

**Schema.** None.
**Agent tools.** None (Slack-only UX).
**Risks.**
- Socket Mode reconnect quirks under load — keep `slack-bolt` AsyncApp pattern.
- Multi-message threads vs. ephemeral — confirmation cards should be ephemeral, decisions persist.

**Acceptance.**
- A live Slack flow: tech asks "GS10 faulted" → confirmation card → tech clicks Yes → grounded reply with citations + trace link.
- Approve a relationship proposal from Slack → row in `kg_relationships` updated via `proposal-transition` helper.

**Suggested files.**
- `mira-bots/slack/bot.py`
- `mira-bots/shared/chat/renderers/slack_blocks.py`

**Difficulty.** M.

---

### Phase 11 — Agent tool layer

**Goal.** Add the missing structured MCP tools that Phases 6/7/8/9 reference. Group them so the tool surface stays manageable.
**Why.** Today there are 26 tools but no `get_asset_context(uns_path)` unified call. Phase 11 closes this so future agent work (LLM-driven troubleshooting, Hermes integration, etc.) has a clean tool surface.
**Inputs.** Existing `mira-mcp/server.py` · existing tool patterns (`@mcp.tool` decorator, return shapes).
**Outputs.** See deliverable D3 for the full list. Highlights:
- `get_asset_context(uns_path, tenant_id)` — unified bundle: asset + parents + children + installed components + tags + recent WOs + verified KG edges + open faults.
- `read_tag_value(tag_id)` / `read_tag_history(tag_id, window)` / `list_tags_for_asset(uns_path)`.
- `get_tag_events(tag_id, window, types?)` / `get_fault_windows(uns_path, window)`.
- `record_decision_trace_step(trace_id, step)` / `read_decision_trace(trace_id)` / `list_decision_traces(session_id)`.
- `open_troubleshooting_session(uns_path, tenant_id)` / `close_troubleshooting_session(session_id, resolution)`.
- `propose_relationship(source, target, type, evidence)` / `review_proposal(proposal_id, decision, edits?)`.
- `detect_flaky_input(tag_id, window)` / `list_flaky_alerts(uns_path, window)`.

**Schema.** None (uses existing + Phase 1).

**Risks.**
- Tool surface bloat — keep them grouped, name consistently (`mira_<domain>_<action>`), and document in `mira-mcp/CLAUDE.md`.
- Tool-invocation latency — every MCP roundtrip costs. Mitigation: `get_asset_context` returns one bundle so a follow-up troubleshooting turn doesn't make 7 calls.

**Acceptance.**
- All new tools registered via `@mcp.tool` and listed in `mcp-tools-index.md`.
- A test agent (script) can: `get_asset_context` → `read_tag_history` → `get_fault_windows` → `record_decision_trace_step` in one session.

**Suggested files.**
- `mira-mcp/server.py` (additions)
- `mira-mcp/CLAUDE.md` (tool index)

**Difficulty.** M.

---

### Phase 12 — Evaluation, testing & demo script

**Goal.** End-to-end demo script grounded in the existing bench (Micro820 + GS10 + Conv_Simple_1.6). Include the 5-regime test extension and a recorded demo for `docs/promo-screenshots/`.
**Why.** Mike has a working bench, a working FSM, a working KB, a working ingest pipeline, a working relay, and a working Slack bot. The piece that doesn't yet exist is the *narrative*: a 5-minute demo that shows the flywheel from photo to verified relationship to grounded answer.
**Inputs.** Existing `tests/regime*` framework · `tests/golden_*.csv` · `Fault-Detective` bench (`docker-compose.fault-detective.yml`) · MIRA Perspective views (`2026-05-31_ignition-perspective-*.png`) · Phase 4 mock collector.
**Outputs.**
- A 5-minute demo script (see deliverable D7 for full breakdown):
  1. Tech takes a photo of the GS10 nameplate → MIRA proposes a `component_template` match.
  2. Tech approves → `installed_component_instance` lands at the UNS path.
  3. PLC starts faulting (GS10 F0004 via the bench) → `tag_events` shows `fault_window_open`.
  4. Tech opens Slack: "GS10 just faulted" → UNS gate confirms → grounded reply with manual citation.
  5. MIRA proposes "PE-B16-2 → TB2-14" wiring relationship from the photo → reviewer queue → approve → KG enriched.
  6. Next plant onboards with the same GS10 → starts 80% structured (Knowledge Cooperative).
- 5-regime test additions: `regime8_decision_trace` (audit replay), `regime9_flaky_input` (mock scenarios).
- Eval set: 50 new golden turns covering the direct-connection bypass, the location-hierarchy gate, and the citation enforcement path.

**Schema.** None.

**Agent tools.** All from Phase 11.

**Risks.**
- Demo flakiness on stage. Mitigation: scenarios are YAML-driven mock collector; full replay deterministic.
- Eval-fixer skill drift — run weekly per the existing eval-fixer pattern.

**Acceptance.**
- Demo recorded end-to-end via `tools/seedance-video-gen.py` or Playwright.
- Promo screenshots in `docs/promo-screenshots/2026-06-XX_*.png`.
- Eval coverage: ≥95% on new golden turns.

**Suggested files.**
- `docs/demos/2026-06-XX_master-flywheel-demo.md`
- `tests/regime8_decision_trace/`
- `tests/regime9_flaky_input/`
- `tests/golden_factorylm.csv` (extended)

**Difficulty.** M.

---

### Phase 13 — Later graph database expansion (deferred)

**Goal.** Only revisit if Postgres-on-NeonDB demonstrably can't serve a real workload. Until then, do NOT introduce Neo4j / Memgraph / TerminusDB.
**Why.** Component-intelligence spec is explicit: "PostgreSQL only. No graph DB. No Neo4j." The KG today is ~tens of thousands of edges. ltree + GIN + GiST indexes handle multi-hop traversal within Hub's `mira-mcp` perf budgets. A graph DB is a complexity tax we don't yet need.
**Inputs (when triggered).** Profile of `kg_maintenance_context` p95 latency · `kg_traverse_chain` p95 · multi-hop spec `docs/specs/knowledge-graph-multi-hop-spec.md` · row counts in `kg_entities` / `kg_relationships`.
**Outputs (when triggered).** ADR comparing pgvector + ltree + recursive CTE vs. Memgraph (in-memory) vs. Neo4j (heavyweight). Migration plan for read-replica only (graph DB as cache, not source of truth — NeonDB remains canonical).
**Trigger conditions (commit these to the deferred-work doc).**
- `kg_maintenance_context` p95 > 800ms sustained.
- 4-hop traversal queries materially common in production traffic.
- KG row count > 5M edges.

**Schema.** N/A until triggered.
**Risks.** Premature optimization. Two stores = two truth sources = drift. Do not enter this phase without all three triggers.
**Acceptance.** When triggered: ADR ratified, read-replica POC built, latency measured, rollback path proven.
**Suggested files.** `docs/adr/00XX-graph-db-readreplica-decision.md` (only if triggered).
**Difficulty.** XL (if triggered).

---

## 3. Deliverables

### D1. Recommended folder structure

Grounded in the existing layout (see root CLAUDE.md repo map). Additions only — do NOT rename existing dirs.

```
MIRA/
├── docs/
│   ├── plans/
│   │   └── 2026-06-01-mira-master-architecture-plan.md  ← THIS DOC
│   ├── adr/
│   │   ├── 0022-decision-trace-storage.md               (Phase 1)
│   │   ├── 0023-kg-write-through-helper.md              (Phase 3)
│   │   └── 0024-tag-event-stream-model.md               (Phase 5)
│   ├── demos/
│   │   └── 2026-06-XX_master-flywheel-demo.md           (Phase 12)
│   └── migrations/            ← engine kg_entities/kg_relationships only
├── mira-hub/db/migrations/
│   ├── 032_decision_traces.sql                          (Phase 1)
│   ├── 033_tag_events.sql                               (Phase 1)
│   ├── 034_flaky_input_signals.sql                      (Phase 1)
│   ├── 035_approved_tags.sql                            (Phase 1)
│   ├── 036_decision_trace_session_link.sql              (Phase 1)
│   └── 037_kg_relationships_evidence_ref.sql            (Phase 1)
├── mira-bots/
│   ├── agents/
│   │   └── flaky_input_detector.py                      (Phase 9)
│   └── shared/
│       ├── decision_trace.py                            (Phase 8)
│       ├── flaky_rules.py                               (Phase 9)
│       ├── proposal_transition.py                       (Phase 3)
│       └── troubleshooting_session.py                   (Phase 7)
├── mira-hub/lib/
│   └── proposal-transition.ts                           (Phase 3)
├── mira-crawler/ingest/
│   └── api.py                                           (Phase 2)
├── mira-mcp/
│   ├── server.py                                        (Phase 2, 11 — additions)
│   └── CLAUDE.md                                        (tool index)
├── mira-relay/
│   ├── diff_logger.py                                   (Phase 5)
│   └── rollup_worker.py                                 (Phase 5)
├── tools/
│   ├── mock_tag_stream.py                               (Phase 4)
│   ├── scenarios/
│   │   ├── conveyor_normal.yaml                         (Phase 4)
│   │   ├── conveyor_flicker.yaml                        (Phase 4)
│   │   └── conveyor_gs10_f0004.yaml                     (Phase 4)
│   └── replay_decision_trace.py                         (Phase 8)
└── tests/
    ├── regime8_decision_trace/                          (Phase 12)
    └── regime9_flaky_input/                             (Phase 12)
```

### D2. First-pass Postgres schema (additions only)

All in `mira-hub/db/migrations/` per ADR-0013.

```sql
-- 032_decision_traces.sql
CREATE TABLE IF NOT EXISTS decision_traces (
  trace_id        UUID PRIMARY KEY,                          -- UUIDv7
  tenant_id       UUID NOT NULL,
  session_id      UUID REFERENCES troubleshooting_sessions(id),
  chat_id         TEXT NOT NULL,                             -- platform-scoped
  platform        TEXT NOT NULL,                             -- slack|telegram|ignition|hub|web
  ts              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_message    TEXT NOT NULL,                             -- sanitized
  router_intent   TEXT,
  gate_outcome    TEXT,                                      -- direct_connection|confirmed|fired|skipped
  uns_path        LTREE,
  uns_confidence  TEXT,                                      -- band per uns-message-resolver-spec
  retrieval_set   JSONB,                                     -- [{chunk_id, score, source}]
  kg_hops         JSONB,                                     -- [{entity_id, type, rel}]
  tag_events_consulted JSONB,                                -- [event_id]
  prompt          TEXT,                                      -- sanitized
  model_used      TEXT,                                      -- groq|cerebras|gemini|...
  llm_latency_ms  INT,
  cascade_failures JSONB,                                    -- [{provider, error}]
  raw_reply       TEXT,
  citation_check  TEXT,                                      -- pass|rewritten|admitted_gap
  final_reply     TEXT,
  total_latency_ms INT,
  next_state      TEXT,
  CONSTRAINT decision_traces_tenant_ts_idx UNIQUE (trace_id, tenant_id)
);
CREATE INDEX ON decision_traces (tenant_id, ts DESC);
CREATE INDEX ON decision_traces (session_id);
CREATE INDEX ON decision_traces USING GIST (uns_path);

-- 033_tag_events.sql
CREATE TABLE IF NOT EXISTS tag_events (
  event_id        UUID PRIMARY KEY,                          -- UUIDv7
  tenant_id       UUID NOT NULL,
  ts              TIMESTAMPTZ NOT NULL,
  uns_path        LTREE NOT NULL,
  tag_id          TEXT NOT NULL,                             -- e.g., "Line5.B16.PE2_Occupied"
  event_type      TEXT NOT NULL,                             -- rising_edge|falling_edge|value_changed|trend_segment|fault_window_open|fault_window_close
  prev_value      JSONB,
  new_value       JSONB,
  delta           DOUBLE PRECISION,
  threshold       DOUBLE PRECISION,
  window_start    TIMESTAMPTZ,
  window_end      TIMESTAMPTZ,
  fault_code      TEXT,
  severity        TEXT,
  raw_quality     TEXT,                                      -- good|bad|stale
  relay_batch_id  UUID                                       -- traces back to relay POST
);
CREATE INDEX ON tag_events (tenant_id, ts DESC);
CREATE INDEX ON tag_events (tag_id, ts DESC);
CREATE INDEX ON tag_events USING GIST (uns_path);
CREATE INDEX ON tag_events (event_type, ts DESC) WHERE event_type IN ('fault_window_open','fault_window_close');

-- 034_flaky_input_signals.sql
CREATE TABLE IF NOT EXISTS flaky_input_signals (
  alert_id        UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uns_path        LTREE NOT NULL,
  tag_id          TEXT NOT NULL,
  rule_id         TEXT NOT NULL,                             -- 'rapid_toggle' | 'brown_out' | 'intermittent_disc' | 'value_spike'
  window_start    TIMESTAMPTZ NOT NULL,
  window_end      TIMESTAMPTZ NOT NULL,
  transitions_count INT,
  expected_max    INT,
  ai_suggestion_id UUID REFERENCES ai_suggestions(id),
  status          TEXT NOT NULL DEFAULT 'open',              -- open|acknowledged|resolved|false_positive
  metadata        JSONB
);
CREATE INDEX ON flaky_input_signals (tenant_id, detected_at DESC);
CREATE INDEX ON flaky_input_signals (status) WHERE status='open';

-- 035_approved_tags.sql
CREATE TABLE IF NOT EXISTS approved_tags (
  tenant_id       UUID NOT NULL,
  tag_id          TEXT NOT NULL,
  uns_path        LTREE NOT NULL,
  data_type       TEXT NOT NULL,                             -- bool|int|float|enum
  threshold       DOUBLE PRECISION,                          -- value-changed threshold for floats
  baseline_period_days INT NOT NULL DEFAULT 7,
  hmac_key_ref    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID,
  PRIMARY KEY (tenant_id, tag_id)
);
CREATE INDEX ON approved_tags USING GIST (uns_path);

-- 036_decision_trace_session_link.sql
ALTER TABLE troubleshooting_sessions
  ADD COLUMN IF NOT EXISTS last_decision_trace_id UUID;
```

(Engine-side `docs/migrations/009_*.sql` adds nothing for this plan — engine path stays scoped to `kg_entities`/`kg_relationships` only.)

### D3. First-pass list of agent-callable tools

Existing 26 tools are listed in §1.2. **Additions (Phase 11):**

```
mira_get_asset_context(uns_path, tenant_id)
  → {asset, parents[], children[], installed_components[], tags[], recent_wos[], verified_kg_edges[], open_faults[]}

mira_read_tag_value(tag_id, tenant_id)
  → {tag_id, value, ts, quality}

mira_read_tag_history(tag_id, window_start, window_end, tenant_id)
  → [{ts, value, quality}, ...]   -- capped at 5000 rows

mira_list_tags_for_asset(uns_path, tenant_id)
  → [{tag_id, data_type, last_value, last_ts}, ...]

mira_get_tag_events(tag_id, window_start, window_end, types?, tenant_id)
  → [tag_event, ...]

mira_get_fault_windows(uns_path, window_start, window_end, tenant_id)
  → [{fault_code, opened_at, closed_at, duration_s, related_tag_ids[]}, ...]

mira_record_decision_trace_step(trace_id, step_kind, payload)
  → {ok: bool}

mira_read_decision_trace(trace_id, tenant_id)
  → decision_trace_row

mira_list_decision_traces(session_id, tenant_id)
  → [decision_trace_row, ...]

mira_open_troubleshooting_session(uns_path, tenant_id, opened_by)
  → {session_id}

mira_close_troubleshooting_session(session_id, resolution, tenant_id)
  → {ok: bool}

mira_propose_relationship(source_id, target_id, rel_type, evidence[], tenant_id)
  → {proposal_id}

mira_review_proposal(proposal_id, decision, edits?, tenant_id, reviewed_by)
  → {ok: bool, new_status}

mira_detect_flaky_input(tag_id, window_start, window_end, tenant_id)
  → {is_flaky: bool, rule_hits[], suggested_severity}

mira_list_flaky_alerts(uns_path, window_start, window_end, tenant_id)
  → [flaky_input_signal, ...]

mira_ingest(file_url|file_b64, kind, tenant_id)
  → {ingest_id, status}

mira_ingest_nameplate(photo_b64, tenant_id)
  → {mfr, model, serial, V?, FLA?, HP?, draft_instance_id}
```

All tools enforce tenant_id from the MCP session, never from caller argument alone.

### D4. First-pass event model for tag diffs

(See `tag_events` table above. Conceptual model:)

| Event type | Trigger | Fields populated |
|---|---|---|
| `rising_edge` | boolean tag goes false → true | `prev_value=false, new_value=true` |
| `falling_edge` | boolean tag goes true → false | `prev_value=true, new_value=false` |
| `value_changed` | numeric tag delta > `approved_tags.threshold` | `prev_value, new_value, delta, threshold` |
| `trend_segment` | every N seconds for analog tags | `window_start, window_end, new_value={min,max,mean,stddev,n}` |
| `fault_window_open` | fault tag becomes nonzero | `fault_code, severity, window_start=ts` |
| `fault_window_close` | fault tag becomes zero | `fault_code, window_end=ts, window_start=earlier_open_ts` |

**Diff semantics (GitHub-inspired).** A poll batch produces 0..N events, never a "no-op event." `live_signal_cache` continues to hold latest snapshot; `tag_events` holds the diff stream. Replay = `tag_events` rows in window. Latest = `live_signal_cache`.

### D5. First-pass decision trace model

(See `decision_traces` schema above. Lifecycle:)

```
[turn arrives at engine]
  → DecisionTraceWriter.start_turn(chat_id, platform, user_message)
  → trace_id = uuid7()
  → record_uns_resolution(uns_path, confidence, source)
  → record_gate_outcome(direct_connection|confirmed|fired|skipped)
  → if gate fires → return; trace is committed with gate=fired (no LLM call yet)
  → if gate passes:
    → record_retrieval(chunk_ids, scores)
    → record_kg_hops(entities, edges traversed)
    → record_tag_events_consulted(event_ids)
    → record_llm_call(prompt, model, latency, cascade_failures)
    → record_citation_check(pass|rewritten|admitted_gap)
    → record_final_reply(text)
  → commit() → INSERT into decision_traces
```

**Trace is the source of truth for post-hoc audit.** The `conversation_logger` continues to handle the per-turn eval log (lighter, regression-focused); the decision trace is the per-turn clinical log.

### D6. First-pass flaky-wire detection rule

Single rule, four sub-cases. Runs every 5 min over the last rolling window.

```python
# mira-bots/shared/flaky_rules.py  (pseudo)
def check_flaky(tag_id, tenant_id, window_start, window_end) -> list[RuleHit]:
    events = get_tag_events(tag_id, window_start, window_end, tenant_id)
    cfg = get_approved_tag_config(tag_id, tenant_id)
    if cfg.data_type == "bool":
        return _check_rapid_toggle(events, cfg) + _check_intermittent_disc(events, cfg)
    if cfg.data_type in ("int", "float"):
        return _check_brown_out(events, cfg) + _check_value_spike(events, cfg)
    return []

def _check_rapid_toggle(events, cfg):
    rising = sum(1 for e in events if e.event_type == "rising_edge")
    baseline = get_baseline_transitions_per_hour(cfg.tag_id, cfg.tenant_id)
    expected_max = max(baseline * 1.5, 10)            # +50% over learned baseline, floor 10
    if rising > expected_max:
        return [RuleHit("rapid_toggle", transitions=rising, expected_max=expected_max,
                        severity="warning" if rising < 2*expected_max else "alert")]
    return []

def _check_intermittent_disc(events, cfg):
    bad_quality_runs = count_bad_quality_runs(events)
    if bad_quality_runs >= 3:
        return [RuleHit("intermittent_disc", quality_drops=bad_quality_runs, severity="warning")]
    return []

def _check_brown_out(events, cfg):
    # consecutive value_changed events crossing low threshold and recovering
    crossings = count_low_threshold_excursions(events, cfg.brown_out_low)
    if crossings >= 2:
        return [RuleHit("brown_out", crossings=crossings, severity="alert")]
    return []

def _check_value_spike(events, cfg):
    max_delta = max((e.delta or 0) for e in events) if events else 0
    if max_delta > cfg.threshold * 5:                 # spike = 5× normal delta
        return [RuleHit("value_spike", max_delta=max_delta, severity="warning")]
    return []
```

**Calibration period: 7 days** (`approved_tags.baseline_period_days`). Alerts suppressed until baseline established. False positives during commissioning are the failure mode to avoid; under-alerting is acceptable in week 1.

### D7. First-pass bench demo plan

5-minute end-to-end demo grounded in the existing Lake Wales bench:

```
T+0:00  CAPTURE
        Tech opens Slack from phone. Photographs GS10 nameplate.
        Sends to MIRA in #maintenance channel.

T+0:15  EXTRACT
        nameplate_worker OCR: mfr=Durapulse, model=GS10, V=230, HP=1.
        → mira_ingest_nameplate returns draft installed_component_instance (status=pending).

T+0:30  PROPOSE
        MIRA: "Looks like Durapulse GS10. Component template found
              (manual: GS10-DURA-MANUAL.pdf, page 14). Install at
              enterprise.lake_wales.bench.conveyor.gs10?"
        Slack confirmation card (Phase 10).

T+0:45  CONFIRM
        Tech taps Yes.
        → installed_component_instances row promotes to verified.
        → KG: kg_relationships INSTANCE_OF, MANUAL_FOR auto-bridged via helper.

T+1:00  LIVE FAULT
        Bench operator hits emergency stop on conveyor.
        GS10 sees comm timeout → CE10 trip → fault_alarm latched.
        mock_tag_stream / Ignition polls → tag_events:
            fault_window_open (fault_code=CE10)
        Phase 5 logger fires.

T+1:30  ASK
        Tech in Slack: "GS10 just faulted, what's going on?"
        → UNS gate sees state=IDLE, asset_identified empty, router_intent=diagnose_equipment.
        → Resolves uns_path=enterprise.lake_wales.bench.conveyor.gs10 (high confidence).
        → Block Kit confirmation card.

T+1:45  CONFIRM CONTEXT
        Tech taps Yes.
        → Open troubleshooting_session.
        → Engine: recall_fault_code(CE10) + recent tag_events + kg_maintenance_context.
        → Grounded reply citing GS10 manual page 27 (comm timeout) + 5s vfd_err_timer.
        → decision_trace row committed.

T+2:30  PROPOSE WIRING
        From the nameplate photo, MIRA also extracted the terminal block.
        Proposes "PE-B16-2 → TB2-14" as a wiring relationship with
        evidence=[photo:photo_id#crop_42].
        → relationship_proposals row + ai_suggestions of type kg_edge.
        → Slack card: "I see PE-B16-2 wired to TB2-14. Verify?"

T+3:00  REVIEW
        Tech: "Yes, but it's TB2-15 not TB2-14."
        → Hub /proposals route: edit + approve.
        → kg_relationships row inserted via proposal-transition helper.
        → KG enriches.

T+3:30  FLAKY ALERT
        Background detector (Phase 9) has been watching PE-B16-2.
        Sees 14 rising_edge transitions in last hour vs. baseline 4.
        → flaky_input_signals row + ai_suggestions of type flaky_signal_alert.
        → Slack ephemeral DM to tech: "PE-B16-2 has been flickering.
          Likely loose wire at the terminal you just verified."

T+4:00  RESOLVE
        Tech fixes wire. Acknowledges alert.
        → flaky_input_signals.status='resolved'.
        → troubleshooting_session.state='resolved'.
        → decision_trace closes.

T+4:30  COOPERATIVE
        Next plant onboards with a Durapulse GS10.
        Their UNS auto-attaches to enterprise.<their_site>.<area>.gs10
        with INSTANCE_OF the same component_template.
        Their starting structure ≈ 80%.
```

Capture every step per Screenshot Rule → `docs/promo-screenshots/2026-06-XX_demo-step{1..9}_desktop.png` + mobile.

### D8. Open questions list

These need a decision before the phase that depends on them.

1. **`ltree` extension on NeonDB prod confirmed?** Blocks every Phase 1 table that uses ltree. (UNS-KG spec Q2 still open.)
2. **`cmms_fault_history` table — does it exist?** Blocks the "faults_90d" recurrence signal in `kg_maintenance_context`. (UNS-KG spec Q8.)
3. **Triple-extractor wired at runtime?** Without it, KG densification depends on manual-ingest side effects only. (TOO doc, namespace-builder spec.)
4. **`/m/[assetTag]/capture` unauthenticated access fence.** Phase 4 / namespace-builder Phase 3 question.
5. **HMAC key rotation flow.** Phase 4 needs a Hub admin page + rotation script.
6. **`mira-connect` rename to `mira-edge-mqtt`?** Naming gap per Ignition arch §11.2.
7. **Tag-event partitioning strategy when row count grows?** Time-partitioned table by month vs. single-table-with-index; decide before Phase 5 ships.
8. **Decision-trace retention policy.** 90 days raw + summary daily is the proposal; needs Mike's sign-off given storage cost.
9. **Approve-from-Slack vs. approve-from-Hub-only.** Phase 10 includes Slack approval; security model needs validation that the actor's tenant_id is enforced server-side.
10. **Flaky detector calibration period.** 7 days proposed; needs validation on first customer's data.
11. **`approved_tags` migration timeline.** File → table cutover in Phase 4 — needs a dual-write window to avoid breaking the existing JSON allowlist.
12. **Direct-connection bypass on Telegram / Hub web?** Today only Ignition is direct-connection. Future Hub views bound to a UNS path could be too — but the rule must be in the adapter, not retrofitted later.

### D9. What should be mocked first

(Mock = unblock downstream phases without hardware.)

1. **Mock tag collector** (Phase 4, `tools/mock_tag_stream.py`) — unblocks Phases 5, 7, 9, 12 without needing the bench PLC running.
2. **YAML scenarios** (`tools/scenarios/*.yaml`) — unblock Phase 12 demo and Phase 9 detector validation.
3. **Mock `read_tag_value` / `read_tag_history`** in `mira-mcp` test harness — unblocks Phase 11 tool-agent testing.
4. **Mock Ignition `asset_context` payloads** — unblock Phase 6 direct-connection branch without needing Perspective view to be built.
5. **Mock `relationship_proposals` queue with seeded fixtures** — unblocks Phase 10 Slack approval card development.
6. **`tests/regime9_flaky_input/fixtures/*.json`** — pre-recorded `tag_events` windows that produce known flaky-rule hits.

### D10. What should be built first

(Order matters. This is the dependency-true critical path.)

1. **Phase 0** (this doc) — already done.
2. **Phase 1** (schema additions) — every phase below depends on at least one of: `decision_traces`, `tag_events`, `flaky_input_signals`, `approved_tags`.
3. **Phase 4 mock collector** (no hardware dependency) — unblocks 5, 9, 12.
4. **Phase 5** (tag diff & event stream) — depends on Phase 1 + Phase 4 mock.
5. **Phase 6** (direct-connection wire-up + hierarchy resolver) — small, high-value engine change.
6. **Phase 8** (decision trace writer) — small, observability multiplier for everything after.
7. **Phase 7** (troubleshooting session lifecycle + citation enforcement) — depends on Phase 6 + 8.
8. **Phase 3** (KG write-through helper) — closes the proposal loop end-to-end.
9. **Phase 2** (ingest API) — can run in parallel with 3/7 but final cutover happens after 3.
10. **Phase 9** (flaky detector) — depends on Phase 5.
11. **Phase 11** (agent tool layer) — depends on 1/5/8/9.
12. **Phase 10** (Slack UX upgrades) — depends on 3/7/11.
13. **Phase 12** (demo + tests) — depends on everything above.
14. **Phase 4 Ignition side** (D1/D2/D6/D10 from ignition-secure-architecture) — depends on whichever Ignition designer access is available.
15. **Phase 13** (graph DB) — only if triggered; not on critical path.

---

## 4. Sub-Agent Dispatch Plan

12 agents. Each has scope, allow/deny lists, inputs, outputs, handoff format, examples, success criteria.

> **Standing rules for every sub-agent:**
> - Run the 3-command pre-flight before any tool call: `git fetch origin main`, `git log HEAD..origin/main --oneline | head -50`, `gh pr list --state open --limit 30`. Report what was found in the agent's opening message.
> - CodeGraph first for any symbol-shaped question (per `.claude/rules/codegraph-usage.md`).
> - No Anthropic. No LangChain / TensorFlow / n8n. No PLC writes. No bypass of `prod-guard.sh`.
> - Doppler for secrets. NeonDB pool-less via NullPool. `Optional[X]` typing.
> - Conventional Commit format.

### Agent 1 — Architecture Planner

- **Responsibility.** Owns this document. Re-syncs the §1 baseline before any phase opens. Updates §3.D8 as questions resolve. Files ADRs.
- **Can change.** This doc. `docs/adr/*.md`.
- **Must NOT change.** Any code. Any other plan doc without an explicit cross-link sign-off here.
- **Inputs.** Origin/main state, PR list, MEMORY.md, root + .claude/ CLAUDE.md.
- **Outputs.** Updated phase baselines, ratified ADRs, deferred-work entries.
- **Handoff format.** Edit this doc with `<!-- updated YYYY-MM-DD by Agent 1 -->` markers under each phase.
- **Example task.** "Update Phase 1 §1.3 schema table — Hub migration 032 has landed; verify the in-flight rows and move from 🔲 to ✅."
- **Success criteria.** Other agents never start a phase from a wrong baseline.

### Agent 2 — Database Schema

- **Responsibility.** Authors and ships Phase 1 migrations + ADR-0022.
- **Can change.** `mira-hub/db/migrations/032_*.sql` through `037_*.sql`. `docs/adr/0022-decision-trace-storage.md`.
- **Must NOT change.** Engine `docs/migrations/*`. Existing tables (column-add only). The proposal-transition helpers (Agent 5).
- **Inputs.** §1.3 schema inventory, §3.D2 first-pass SQL, ADR-0013.
- **Outputs.** 6 migration files, ADR, dry-run + apply log against staging.
- **Handoff format.** PR description includes the 3-command pre-flight output + `apply-migrations.yml --dry-run` output.
- **Example task.** "Ship `032_decision_traces.sql` per §3.D2 with the index set, then verify on staging."
- **Success criteria.** Acceptance per Phase 1.

### Agent 3 — Knowledge Ingestion

- **Responsibility.** Phase 2 ingest API + MiraDrop watcher cutover + nameplate ingest endpoint.
- **Can change.** `mira-crawler/ingest/api.py` (new), `mira-mcp/server.py` (REST router additions), `tools/mira-drop-watcher/watcher.py`, `docs/adr/0019-miradrop-ingest-v2.md`.
- **Must NOT change.** `chunker.py`, `embedder.py`, `dedup.py` (regression risk — these are tuned). The `kg_writer` interface (Agent 5 owns).
- **Inputs.** `mira-crawler/ingest/` modules, ADR-0019, `tools/mira-drop-watcher/README.md`.
- **Outputs.** Working `POST /api/v1/ingest`, working `POST /api/v1/ingest/nameplate`, MiraDrop watcher re-pointed, golden test on GS10 datasheet.
- **Handoff format.** PR with golden test screenshot + before/after `knowledge_entries` count.
- **Example task.** "Ship a `POST /api/v1/ingest` endpoint that accepts a PDF and returns `{ingest_id, status}`. Wire to existing chunker/embedder/store. Verify a manual roundtrips."
- **Success criteria.** Acceptance per Phase 2.

### Agent 4 — Knowledge Graph

- **Responsibility.** Phase 3 — proposal-transition helpers + rewire `kg_writer` to go through them.
- **Can change.** `mira_bots/shared/proposal_transition.py`, `mira-hub/lib/proposal-transition.ts`, `mira-crawler/ingest/kg_writer.py`, `docs/adr/0023-*.md`.
- **Must NOT change.** Existing `kg_entities` / `kg_relationships` rows (status defaults preserve current behavior). The Hub `/proposals` UI (already shipped per PR #1332).
- **Inputs.** §1.3 ADR-0017 spec, Hub migrations 018/027/029, `kg_writer.upsert_relationship()` current shape.
- **Outputs.** Helper modules in both Hub + bots, kg_writer re-routed, audit grep showing zero direct `INSERT INTO kg_relationships` outside the helper.
- **Handoff format.** PR description includes the audit grep output.
- **Example task.** "Implement `proposal_transition.py` per ADR-0017 mappings, then rewire `kg_writer.upsert_relationship` to write to `relationship_proposals` + `ai_suggestions(kg_edge)` instead of direct insert."
- **Success criteria.** Acceptance per Phase 3.

### Agent 5 — Runtime Tag Collector

- **Responsibility.** Phase 4 — mock tag collector + scenarios + relay allowlist enforcement.
- **Can change.** `tools/mock_tag_stream.py`, `tools/scenarios/*.yaml`, `mira-relay/auth.py` (allowlist check), `approved_tags.json` → table cutover.
- **Must NOT change.** `mira-relay/relay_server.py` core HTTP/WS handlers. `tools/demo_plc_poller.py` (read-only reference). `plc/*` (bench-only).
- **Inputs.** `demo_plc_poller.py`'s poll/diff pattern, `mira-relay /ingest` HMAC contract, Phase 1 `approved_tags` table.
- **Outputs.** Working mock that emits events landing in `live_signal_cache` + `tag_events`. Allowlist enforced at relay.
- **Handoff format.** PR with `pytest tests/regime9_flaky_input/test_mock_stream.py` passing + a recorded 30-second run.
- **Example task.** "Ship `tools/mock_tag_stream.py` driven by `conveyor_normal.yaml`. Stream events to `mira-relay /ingest`. Verify `tag_events` populates."
- **Success criteria.** Acceptance per Phase 4 (mock side).

### Agent 6 — Tag Diff (Event Stream)

- **Responsibility.** Phase 5 — diff logger + rollup worker + retention job.
- **Can change.** `mira-relay/diff_logger.py`, `mira-relay/rollup_worker.py`, `docs/adr/0024-*.md`.
- **Must NOT change.** Relay HTTP/WS handlers. `live_signal_cache` shape.
- **Inputs.** Phase 1 `tag_events` table, `demo_plc_poller.detect_events` patterns, Phase 4 mock for testing.
- **Outputs.** Logger emits rows; rollup runs nightly; retention cleanup.
- **Handoff format.** PR with 24h soak summary (event count, p95 latency, disk usage).
- **Example task.** "Wire the `mira-relay /ingest` handler to call `diff_logger.process(batch)` which writes one row per non-noop diff to `tag_events`. Threshold from `approved_tags.threshold`."
- **Success criteria.** Acceptance per Phase 5.

### Agent 7 — Context Graph (UNS Gate)

- **Responsibility.** Phase 6 — direct-connection branch + hierarchy resolution in UNS resolver + gate UX.
- **Can change.** `mira-pipeline/ignition_chat.py`, `mira-bots/shared/engine.py` (gate branch only — narrow surgical change), `mira-bots/shared/uns_resolver.py` (hierarchy resolver), `tests/golden_uns_direct_connection.csv`.
- **Must NOT change.** The existing FSM transitions outside the gate. The vendor/model/fault resolution logic (additive only).
- **Inputs.** `.claude/rules/direct-connection-uns-certified.md`, `.claude/rules/uns-confirmation-gate.md`, `engine.py:_should_fire_uns_gate`, `uns_resolver.resolve_uns_path`.
- **Outputs.** Direct-connection bypass works; hierarchy resolution returns plausible candidates; gate UX includes hierarchy correction.
- **Handoff format.** PR with hallucination-audit output + golden regression report.
- **Example task.** "Wire `ignition_chat.py` to set `state['uns_context']['source']='direct_connection'`. Branch `_should_fire_uns_gate` accordingly. Add 30 golden turns for direct-connection bypass + hierarchy."
- **Success criteria.** Acceptance per Phase 6.

### Agent 8 — Troubleshooting (Session + Citation Enforcement)

- **Responsibility.** Phase 7 + Phase 8 writer.
- **Can change.** `mira-bots/shared/troubleshooting_session.py` (new), `mira-bots/shared/decision_trace.py` (new), `mira-bots/shared/citation_compliance.py` (enforce mode), `mira-bots/shared/engine.py` (lifecycle hooks — narrow).
- **Must NOT change.** Retrieval logic. The FSM. The cascade router.
- **Inputs.** `troubleshooting_sessions` (Hub 019), Phase 1 `decision_traces`, current `citation_compliance.py`.
- **Outputs.** Lifecycle wrapper + writer + enforcement.
- **Handoff format.** PR with sample `/decision-traces/<id>` screenshot.
- **Example task.** "Ship `DecisionTraceWriter` per §3.D5 and a `TroubleshootingSession` wrapper. Wire both into `Supervisor.process_full`. Add citation-enforce mode that rewrites uncited replies."
- **Success criteria.** Acceptance per Phases 7 + 8.

### Agent 9 — Slack Bot

- **Responsibility.** Phase 10 — Block Kit cards for UNS confirmation + proposal approval + trace links + `/mira-trace` command.
- **Can change.** `mira-bots/slack/bot.py`, `mira-bots/shared/chat/renderers/slack_blocks.py`.
- **Must NOT change.** The dispatcher → engine handoff. Adapter normalization.
- **Inputs.** Existing Slack adapter, Phase 7 session lifecycle, Phase 3 proposal helper, Phase 8 trace IDs.
- **Outputs.** Three Block Kit card types + slash command + trace footer.
- **Handoff format.** PR with three screenshots (confirmation, proposal, trace footer).
- **Example task.** "Render UNS confirmation as a Block Kit card with Yes/Different machine/Cancel buttons. Wire button taps to the engine's existing confirmation handler."
- **Success criteria.** Acceptance per Phase 10.

### Agent 10 — Tool Layer

- **Responsibility.** Phase 11 — register all new MCP tools.
- **Can change.** `mira-mcp/server.py`, `mira-mcp/CLAUDE.md`.
- **Must NOT change.** Existing tools. The transport (SSE + REST) shape.
- **Inputs.** §3.D3 tool list, existing tool patterns at `mira-mcp/server.py:160+`.
- **Outputs.** All §3.D3 tools registered with consistent naming + tenant enforcement + structured returns.
- **Handoff format.** PR with `mira-mcp/CLAUDE.md` updated tool index.
- **Example task.** "Add `mira_get_asset_context(uns_path, tenant_id)` returning the unified bundle per §3.D3."
- **Success criteria.** Acceptance per Phase 11.

### Agent 11 — Evaluation

- **Responsibility.** Phase 12 — `regime8_*`, `regime9_*`, extend golden CSVs, run eval-fixer.
- **Can change.** `tests/regime8_decision_trace/`, `tests/regime9_flaky_input/`, `tests/golden_*.csv`, `tests/eval/`.
- **Must NOT change.** Engine code (regression discovery only — file bugs to the right agent).
- **Inputs.** Phases 5–11 outputs, existing `tests/regime*` patterns, eval-fixer skill.
- **Outputs.** Two new regimes, extended goldens, weekly eval-fixer run, regression report.
- **Handoff format.** PR + `docs/HANDOFF-eval-2026-06-XX.md`.
- **Example task.** "Build `tests/regime9_flaky_input/` covering 10 scenarios that exercise the rapid-toggle, brown-out, and value-spike rules."
- **Success criteria.** Acceptance per Phase 12.

### Agent 12 — Demo Conveyor

- **Responsibility.** Phase 12 demo recording + screenshots + Conv_Simple_1.6 promotion.
- **Can change.** `docs/demos/`, `docs/promo-screenshots/`, demo scripts in `tools/`.
- **Must NOT change.** `plc/MbSrvConf_v4.xml`. The ladder program. `plc/live-plc-bridge` core (bench-only protections).
- **Inputs.** Bench setup (Micro820, GS10, Conv_Simple_1.6 status), Phase 4 mock for non-hardware demos, Phase 11 tools.
- **Outputs.** 5-minute recorded demo, 9 promo screenshots (desktop + mobile), demo runbook.
- **Handoff format.** PR + a Loom or seedance-video output linked in PR description.
- **Example task.** "Record the §3.D7 9-step demo end-to-end. Capture each step's Slack thread + Hub Command Center screen. Save to `docs/promo-screenshots/` per Screenshot Rule."
- **Success criteria.** Acceptance per Phase 12 (demo side).

### Concurrency map

```
                 ┌── Agent 2 (Phase 1 schema)
                 │
Agent 1 ─────────┤── Agent 5 (Phase 4 mock collector)
(planner —       │
 standing)       ├── Agent 7 (Phase 6 gate)        ── Agent 8 (Phase 7+8) ── Agent 9 (Phase 10) ── Agent 11 (Phase 12 eval)
                 │
                 ├── Agent 3 (Phase 2 ingest)       Agent 4 (Phase 3 KG)
                 │
                 ├── Agent 6 (Phase 5 events) ──── Agent 10 (Phase 11 tools) ── Agent 12 (Phase 12 demo)
                 │
                 └── Agents 2/5/3/4 can run truly parallel; rest is gated as shown.
```

Hard prerequisites:
- 6 → 1, 5
- 8 → 6, 1
- 9 → 8, 10, 4
- 10 → 1, 5, 6, 8, 9
- 11 → 5, 6, 7, 8, 9, 10
- 12 → 5, 7, 8, 10, 11

---

## 5. Cross-references

- `docs/THEORY_OF_OPERATIONS.md` — primary doctrine
- `docs/specs/maintenance-namespace-builder-spec.md` — product-surface contract
- `docs/specs/mira-component-intelligence-architecture.md` — implementation-level (templates + KG mechanics)
- `docs/specs/uns-kg-unification-spec.md` — UNS + KG data architecture
- `docs/mira-ignition-secure-architecture.md` — Ignition integration
- `docs/plans/2026-05-15-maintenance-namespace-builder.md` — namespace-builder execution plan
- `docs/plans/2026-04-19-mira-90-day-mvp.md` — 90-day MVP plan
- `docs/adr/0013-...` — schema lineage (Hub canonical for product surface)
- `docs/adr/0017-...` — status transition through helpers
- `docs/adr/0019-miradrop-ingest-v2.md` — ingest v2 design lock
- `docs/adr/0021-ignition-module-first-edge.md` — cloud-to-plant reach forbidden
- `.claude/CLAUDE.md` — product rules
- `.claude/rules/uns-confirmation-gate.md` — chat-gate
- `.claude/rules/direct-connection-uns-certified.md` — direct-connection bypass
- `.claude/rules/uns-compliance.md` — UNS data shape
- `.claude/rules/fieldbus-readonly.md` — discovery + bench-only fencing
- `.claude/rules/security-boundaries.md`
- `.claude/rules/karpathy-principles.md`
- `.claude/rules/codegraph-usage.md`

## 6. Change Log

- **2026-06-01** — Initial draft. Master plan ties existing specs + 90-day MVP + namespace-builder plan + Ignition arch into one phase 0–13 roadmap, grounded in the actual 2026-06-01 baseline of merged PRs and shipped migrations. Adds 6 Hub migrations (032–037) covering the gap between today's schema and the trace/event/flaky/allowlist tables Phases 5–11 require. Defers Phase 13 (graph DB) behind explicit trigger conditions. Dispatch plan covers 12 sub-agents with allow/deny lists, prerequisites, and acceptance criteria each.

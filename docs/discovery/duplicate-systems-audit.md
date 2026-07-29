# Duplicate / Parallel Systems Audit

**Date:** 2026-07-03
**Auditor:** Agent C (Duplicate/Parallel System Auditor), FactoryLM/MIRA integration audit
**Tree audited:** `mira-integration` worktree @ main `9a3c6f80` (includes 2026-07-03 machine-memory merges)
**Method:** read-only code/migration/test inspection; every claim cites file:line, migration, or test. Empty searches are stated. Verdicts: **KEEP** (canonical) / **MERGE INTO X** / **DEPRECATE** / **LEAVE AS FIXTURE-DEMO** / **DELETE LATER**. Report only — no changes made.

---

## Executive summary of real duplication risks (ranked)

1. **P1 — Safety-keyword drift across three lists** (Area 5): the Hub TS chat routes carry a 15-phrase local `SAFETY_PHRASES` pre-LLM gate that claims to mirror `guardrails.py` but is missing the entire physical-hazard-observation category ("melted insulation", "sparking", "exposed wire", …). A phrase that hard-STOPs on Slack/Telegram/kiosk does not STOP on Hub asset chat.
2. **P1 — 4th unguarded copy of the anomaly rule engine** (Area 2/6): `NorthwindBottling`'s vendored `mira_diagnose_core` is byte-identical today but NOT covered by the parity test (only `ConvSimpleLive` is).
3. **P2 — Two rewritten retrieval engines over one corpus with two different tenant-filter mechanisms** (Area 4): Python hybrid-RRF (`neon_recall.py`, `SHARED_TENANT_ID` filter) vs TS BM25-only (`manual-rag.ts`, `is_private` hybrid filter). Equivalent today only because the OEM corpus lives under one well-known system tenant.
4. **P2 — Four relationship-type vocabularies in flight** (Area 10): mig 043 CHECK (UPPERCASE, proposals only), `types.ts` lowercase allowlist (contains types absent from 043), `proposals-writer.ts` + Python `proposal_writer.py` write-canonicalizers, and the new display-only `canonicalizeRelationshipType` — which itself documents the split. `kg_relationships.relationship_type` has NO CHECK at all (mig 038).
5. **P2 — Three UNS `slug()`/path-builder implementations** (Area 10): canonical `mira-crawler/ingest/uns.py`, independent `mira-plc-parser/.../uns.py` (divergent empty-input behavior), and an ad-hoc inline builder in `plc/discover.py:408-412` that is the literal anti-pattern named in `.claude/rules/uns-compliance.md`.
6. **P3 — Doctrine-ahead-of-code gaps** (Area 11): direct-connection reject-on-missing-identifier is unimplemented ("P6" per `engine.py:5741` comment); `MIRA_ENFORCE_APPROVED_ASK` aliases `MIRA_ENFORCE_APPROVED_RETRIEVAL` (two flag names, one concern).
7. **P3 — Doc drift in seeds** (Area 8): `tools/seeds/README.md` tenant/UNS claims for `demo-conveyor-001.sql` don't match the file's actual default tenant; prior memory claim "CV-200/Northwind = alias over filler01" is WRONG (it's a second tenant identity over the same physical garage rig).
8. **P1 — `conveyor_events` vs `faults`: same SQLite file, two never-joined tables** (Area 1): every production/staging compose sets `MIRA_DB_PATH=/mira-db/mira.db`; `plc/conv_simple_anomaly/engine.py` writes conveyor anomalies to `conveyor_events` in that exact file, but `mira-mcp`'s `/api/faults/active` only ever queries the separate `faults` table. Already independently flagged in `docs/discovery/2026-07-03-product-discovery-sweep.md`; still unresolved. Currently latent because the conveyor engine is bench-only (`docker-compose.fault-detective.yml`), but the schema/file-sharing design collides the day both run together.

Work orders (Area 9), approval gates (Area 11), Ignition file layout (Area 6), and fieldbus bench-only discipline (Area 7) came back **cleaner than expected** — layered by design, not competing.

---

## Area 1: Event / anomaly stores — which is canonical for "what happened to the machine"?

`tag_events` (Neon) is the canonical raw truth for the Hub product surface; the diff/run/window tables are explicitly-documented derived layers on top of it, not competitors. Separately, on the bench/SaaS SQLite side, `conveyor_events` and `faults` are genuinely un-reconciled duplicates.

| Artifact | Role | Verdict | Evidence |
|---|---|---|---|
| `tag_events` | Canonical raw ingestion stream, append-only, one row per accepted reading | **KEEP** (canonical raw truth) | `mira-hub/db/migrations/033_tag_events.sql:56-93`. Header (`:10-27`) states this is the Phase-2 production stream and explains why `live_signal_events`/`live_signal_cache` and the diff layer are kept separate. |
| `tag_event_diffs` | Derived meaningful-change stream (rising/falling edge, threshold cross, quality change) | **KEEP** (documented derived layer) | `mira-hub/db/migrations/037_tag_event_diffs.sql:1-29`. Header states it "carries no truth the raw stream lacks" — rebuildable by replaying `tag_events`. |
| `machine_run` / `run_step` / `run_baseline` / `run_diff` | Run-centric grouping + per-tag baseline + deviation detection | **KEEP** (documented additive layer) | `mira-hub/db/migrations/038_machine_runs.sql:1-20`. Explicitly built on `tag_events`/`tag_event_diffs`, joined by `uns_path` + time window, no FK (`:18-20`, by design). |
| `machine_state_window` (+ `run_diff` typed-anomaly columns) | Idle/comm-down/estopped state windows for machines with no run trigger | **KEEP** (documented additive layer) | `mira-hub/db/migrations/040_machine_memory_windows.sql:9-10`: "This is NOT a machine_events table — tag_events (033) remains the raw stream." |
| `live_signal_events` / `live_signal_cache` | Demo-simulator-coupled signal stream + latest-value cache for the tablet UX | **LEAVE AS FIXTURE-DEMO** — legacy May-2026 demo track, not merged into the 033/037/038/040 lineage | `mira-hub/db/migrations/019_sessions_and_signals.sql:17-20` (simulator-only, `simulated` defaults TRUE); `033_tag_events.sql:16-20` itself documents the split ("stays for the existing demo path"). Still live-read by `mira-hub/src/app/api/mira/ask/route.ts:217,245,285-288` — an active demo surface, not dead code. |
| `conveyor_events` (SQLite) | Bench fault-detective log: `(ts, fault, confidence, evidence_json, affected_json, resolved_ts)` | **DEPRECATE** — wire into `/api/faults/active` or unify with `faults` | Schema: `mira-bridge/migrations/005_conveyor_events.sql:2-11`. Writer: `plc/conv_simple_anomaly/engine.py:98-130` (`INSERT INTO conveyor_events` at `:126`); the file's own comment at `:7` claims "Telegram /fault + MCP /api/faults/active read it" — **false**, see next row. |
| `faults` (SQLite) | SaaS-path fault log: `(equipment_id, fault_code, description, severity, timestamp, resolved, resolved_at)` | **KEEP** as the SaaS-path table, but unify with `conveyor_events` | Schema inline in `mira-mcp/server.py:88-98`. Writer: `mira-relay/relay_server.py:172`. Reader: `mira-mcp/server.py:175-183` (`list_active_faults`), routed at `server.py:1286` (`/api/faults/active`). |
| `mira-bridge` SQLite (`conversation_state`, `wo_outbox`) | GSD conversation FSM state + work-order retry outbox | **KEEP** (unrelated domain) | `mira-bridge/migrations/001_add_gsd_state.sql`, `004_add_wo_outbox.sql` — not competing anomaly/event stores. |

**Confirmed live collision (not just historical):** `conveyor_events` and `faults` are two disjoint tables that **share the same physical SQLite file** in every real deployment. Every production/staging compose sets `MIRA_DB_PATH=/mira-db/mira.db` (`docker-compose.saas.yml:14,140,174,248,304,354,471`; `docker-compose.staging-vps.yml:184,224,398`; `docker-compose.staging.yml:25`), and `plc/conv_simple_anomaly/engine.py:38` reads the same path via a differently-named env var (`MIRA_DB`, same default). `/api/faults/active` only ever does `SELECT * FROM faults` (`server.py:180`) — it never reads `conveyor_events`. This exact gap was already independently found in `docs/discovery/2026-07-03-product-discovery-sweep.md:110,176,235` ("conveyor engine writes `conveyor_events`; Telegram `/faults` reads `faults`... different tables, never joined"). Re-verified against current code: still true, unresolved. `plc/conv_simple_anomaly/engine.py` is only wired into `docker-compose.fault-detective.yml` (bench-only, confirmed by grep of all compose files) so the collision is latent, not yet firing in a shipped path — but the shared-file/disjoint-table design will collide the day both run together.

## Area 2: Anomaly rule engines

Canonical source: `plc/conv_simple_anomaly/rules_core.py` (A0-A12 rules). Vendored byte-identical copies, each guarded by an automated test:

| Copy | Guard mechanism | Evidence |
|---|---|---|
| `ignition/webdev/FactoryLM/api/diagnose/diagnose_core.py` | Byte-identical check + behavior goldens | `tests/regime7_ignition/test_diagnose_parity.py:1-13` |
| `plc/ignition-project/ConvSimpleLive/ignition/script-python/mira_diagnose_core/code.py` | Same test file, "Phase 2... vendors the SAME rule core" | `test_diagnose_parity.py:26-30` |
| `mira-crawler/run_engine/anomaly_rules.py` | SHA-256 hash comparison against `rules_core.py` | `mira-crawler/tests/test_anomaly_rules_parity.py:1-32` (`_sha256`, `:20-32`). Independently re-ran `diff` between the two files: **0 lines of output — confirmed byte-identical.** |
| `signal_roles.py` / `asset_config.py` → `mira_signal_roles/code.py`, `mira_asset_config/code.py` | Same guard family | `test_diagnose_parity.py:33-37` |
| `anomaly_log.py`'s `NEXT_CHECK` map → `mira-crawler/run_engine/next_check.py` | AST-extracted dict-equality (not hash — `anomaly_log.py` mutates `sys.path` at import) | `test_anomaly_rules_parity.py:9-14` |

**Verdict: KEEP as-is.** This is 4-5 vendored copies of the same A0-A12 logic, but it's a deliberate, necessary pattern — the Ignition gateway runs Jython 2.7 and cannot `import` from `plc/` — enforced by two independent test suites. This is correctly-engineered vendoring, not accidental duplication. (See Area 6/Executive-summary item 2 for the one real gap in this pattern: the `NorthwindBottling` vendored copy is not yet covered by the parity test.)

## Area 3: Fault-code knowledge

Three independent stores, no real content overlap — different granularity and different purpose, not competing:

| Artifact | Role | Verdict | Evidence |
|---|---|---|---|
| `fault_codes` (Neon) | Manual-extracted, citation-backed fault-code KB across manufacturers | **KEEP** (canonical for the chat-citation path) | `docs/migrations/002_fault_codes.sql:1-27`. Read: `mira-bots/shared/neon_recall.py` `recall_fault_code` (comment at `002_fault_codes.sql:4`). Write: `mira-core/scripts/extract_fault_codes.py` `_insert_fault_code` (comment at `:5`). |
| `GS10_FAULT_CODES` dict | Hardcoded lookup, one VFD model, used only inside the live A2_VFD_FAULT rule | **KEEP** (different purpose, no overlap) | `plc/conv_simple_anomaly/rules_core.py:76-91` (40 numeric codes → mnemonic strings, e.g. `4: "GFF (ground fault)"`), used by the `A2_VFD_FAULT` rule (`~:234`). |
| SimLab troubleshooting docs (`simlab/docs/filler01/troubleshooting.md`, etc.) | Symptom-based guides for the simulated juice-bottling line | **KEEP** (different equipment domain, no overlap) | e.g. `simlab/docs/filler01/troubleshooting.md:1-30` — bowl-pressure/tank-level symptoms, no numeric fault-code table at all. |
| `fault_dictionary` (repo-wide grep) | Referenced only in a discovery doc, pointing at `demo/factory_difference_engine/` | **EMPTY on `main`** | Matches found only in `docs/discovery/2026-07-03-product-discovery-sweep.md:37,177`. `ls demo/` in this worktree returns nothing — the directory does not exist on `main@9a3c6f80`; it is uncommitted WIP in the original working copy, not part of the audited codebase. `tests/simlab/test_fault_dictionary.py` referenced by that doc is likewise absent here. |

**Conclusion:** `fault_codes` (manual-sourced, cross-vendor, citation-backed) and `GS10_FAULT_CODES` (hardcoded, single-drive, rule-internal) are complementary layers — a knowledge base vs. a lookup table for a live rule — not duplicates. The only gap is a planned-but-not-yet-built join (per the discovery doc) between an uncommitted `fault_dictionary` prototype and `fault_codes`/`recall_fault_code` — future work, not existing duplication.

---

## Area 4: RAG / retrieval paths

One real corpus (`knowledge_entries` + `fault_codes` in NeonDB), reached by **two independently-implemented retrieval engines** — not two data stores.

| Artifact | Role | Verdict | Evidence | Notes |
|---|---|---|---|---|
| `mira-bots/shared/neon_recall.py` (`recall_knowledge` L730-929) | Python retrieval for bots + pipeline: hybrid dense-vector (pgvector L797-827) + structured `fault_codes` (L323-374) + ILIKE fault fallback (L384-417) + product-name vector-rerank (L420-488) + BM25 tsvector (L491-579), fused via RRF k=60 (L582-688) | **KEEP** (canonical for the engine path) | Tenant filter is `(tenant_id = :tid OR tenant_id = :shared_tid)` with hardcoded `SHARED_TENANT_ID = 78917b56-…` (L104, L353, L412, L457, L559, L812) — it never reads `is_private` | Structurally different from the documented hybrid law in `.claude/rules/knowledge-entries-tenant-scoping.md`; safe today (no leak), fragile if OEM ownership ever moves off the single system tenant. Approval gate: `MIRA_ENFORCE_APPROVED_RETRIEVAL` → `AND verified = true` on all four streams (L126, L132), off by default. |
| `mira-hub/src/lib/manual-rag.ts` (573 lines) | Hub TS retrieval: **BM25-only**, no vector stream. `retrieveManualChunks` (L221-258) uses the canonical `(is_private = false OR tenant_id = $1)` filter (L322); `retrieveNodeChunks` (L372-461) uses `tenant_id = $1` only (L428, correct — tenant-private node docs) | **KEEP** (canonical for the Hub runtime) — but see recommendation | Same `MIRA_ENFORCE_APPROVED_RETRIEVAL` gate (L58-64). Asset chat calls it on the raw pool per the rule (`assets/[id]/chat/route.ts:259-288`, comment cites the tenancy rule) | Shared by all three Hub surfaces (asset chat, node chat, quickstart all import `@/lib/manual-rag`) — no reimplementation *within* the Hub. The duplication is Python-vs-TS ranking (hybrid RRF vs BM25-only): same corpus, different recall quality per surface. |
| Quickstart ask (`mira-hub/src/app/api/quickstart/ask/route.ts`) | Public unauthenticated ask | **KEEP** (reuses manual-rag) | Wraps retrieval in `withTenantContext(quickstartTenantId(), …)` (route.ts:135-136); `QUICKSTART_FALLBACK_TENANT_ID = "78917b56-…"` (route.ts:39-44) | Safe only because the fallback tenant IS the OEM system tenant — same UUID as `neon_recall.py`'s `SHARED_TENANT_ID`. If the env var diverges, RLS silently hides the corpus. Fragile coupling, not a bug. |
| `mira-sidecar/` (ChromaDB) | Legacy RAG | **DELETE LATER** (already dead) | `mira-sidecar/ARCHIVED.md` (archived 2026-04-12): "no longer referenced by any active service". `docker-compose.saas.yml:120-126`: removed 2026-05-20 per ADR-0014/0008, "no longer deployed". Grep for `mira_sidecar|mira-sidecar` imports in mira-bots/mira-pipeline/mira-core/mira-hub: **zero hits** outside markdown/compose | Only `docker-compose.pathb.yml:13-24` still defines the service (never-mainlined "Path B" compose). Directory retained for OEM-migration tooling per saas.yml comment. |
| `mira-pipeline/` retrieval | None of its own | **KEEP** (thin wrapper) | `ignition_chat.py:3-5` "Thin HTTP wrapper around the existing Supervisor engine"; `build_router(get_engine)` (L456) injects a live Supervisor; grep for `recall_knowledge|neon_recall|retriev` in mira-pipeline found no retrieval implementation (hits are comments, e.g. L205 "engine adds RAG context separately") | RAG happens inside `Supervisor.process()` → `neon_recall.py`. One documented micro-duplication: a local copy of `uns.py slug()` (`ignition_chat.py:322`, deliberate to avoid importing the crawler). |

**Recommendation:** KEEP both engines short-term (different runtimes), but (a) converge the tenant filter — port the `is_private` hybrid law into `neon_recall.py` or document `SHARED_TENANT_ID` as the sanctioned equivalent in the tenancy rule; (b) track "Hub gets vector/RRF parity or the engine becomes an internal HTTP service the Hub calls" as an explicit architecture decision; (c) delete `mira-sidecar/` + `docker-compose.pathb.yml` once OEM-migration tooling need lapses.

---

## Area 5: Ask MIRA surfaces

Eight surfaces; four share the one Supervisor engine, four are TS-native reimplementations (three on `manual-rag.ts` + the expo `/api/mira/ask` on live signals).

| Surface | File | Engine reuse | Gate | Verdict |
|---|---|---|---|---|
| Slack bot | `mira-bots/slack/bot.py:15,39` | `from shared.engine import Supervisor` — direct reuse | Chat UNS gate (in engine) | **KEEP** |
| Telegram bot | `mira-bots/telegram/bot.py:27,80` | Direct Supervisor reuse | Chat UNS gate | **KEEP** |
| Kiosk Ask API | `mira-bots/ask_api/app.py:6,21,43,122` | Direct — docstring: "call the same `Supervisor.process()` the Telegram bot [uses]" | Direct-connection carve-out via `ask_api/gate_state.py::derive_uns_gate` (L135) from live PLC tags | **KEEP** |
| Ignition cloud-chat | `mira-pipeline/ignition_chat.py` (688 lines) | Thin wrapper injecting Supervisor (`build_router(get_engine)` L456) | Direct-connection; local mirror of `engine._GATED_INTENTS` (L79-86, documented); defensive import of `shared.asset_agent_transition.gate_decision` (L61) | **KEEP** |
| Hub asset chat | `mira-hub/src/app/api/assets/[id]/chat/route.ts` | **TS reimplementation** — own `cascadeComplete` LLM cascade, own `retrieveManualChunks` call, own KG context builder, own safety scan | Gate-by-construction (asset row = `equipment_entity_id` FK); local `SAFETY_PHRASES` pre-check (L23-30) | **KEEP** (necessary runtime split) — fix safety drift |
| Hub node chat | `mira-hub/src/app/api/namespace/node/[id]/chat/route.ts` | TS reimplementation, **self-documented clone**: header L4-9 "Cloned from the asset chat route… intentionally duplicated leaf code" | "Node selection IS the UNS location-confirmation gate" (L13, UNS-020); duplicates the same `SAFETY_PHRASES` array again (L46 area / L37-43) | **MERGE INTO shared Hub chat lib** (extract the duplicated leaf code + safety list into one module) |
| Quickstart ask | `mira-hub/src/app/api/quickstart/ask/route.ts` | TS reimplementation (cascadeComplete + retrieveManualChunks) | No gate (public/educational, rate-limited L21-36) | **KEEP** |
| Hub `/api/mira/ask` (expo-booth iPad) | `mira-hub/src/app/api/mira/ask/route.ts` | **TS reimplementation** — direct `cascadeComplete` (route.ts:4,469), no Supervisor, no `manual-rag` import; grounds on `live_signal_events` reads (route.ts:217,245,285-288) + KG trace | Demo bearer token + per-IP rate limit 40/min (route.ts:16-20); `approvedAskEnforcementEnabled` gate from `@/lib/approved-context` (route.ts:8-12) — the `MIRA_ENFORCE_APPROVED_ASK` alias flagged in Area 11 | **LEAVE AS FIXTURE-DEMO** (expo/demo surface tied to the legacy `live_signal_events` demo lineage — see Area 1) |

### Finding: THREE independent safety-keyword lists (live drift)

1. `mira-bots/shared/guardrails.py:11-76` — canonical `SAFETY_KEYWORDS`, ~25+ phrases incl. the physical-observation category ("exposed wire", "sparking", "visible smoke", "burn mark", "melted insulation", "electrical fire", "rotating hazard", "pinch point", "entanglement", "pressurized", "caught in", "crush hazard", "gas leak", "chemical spill").
2. `mira-hub/src/lib/agents/safety-alert.ts:17-` — `SAFETY_PATTERNS` (24 by `grep -c "keyword:"`), post-response compliance logging (`scanBoth`/`handleSafetyAlert`, wired at `assets/[id]/chat/route.ts:424-427`, `namespace/node/[id]/chat/route.ts:362-365`).
3. Local `SAFETY_PHRASES` (15 phrases) duplicated in BOTH `assets/[id]/chat/route.ts:24-30` and `namespace/node/[id]/chat/route.ts:37-43`, used as the pre-LLM hard-stop (`hasSafetyKeyword`, route.ts:233 / :230). Missing the entire physical-hazard category above; contains phrases guardrails.py lacks ("live wire", "permit required", "ppe required", "asphyxiation", "explosive atmosphere", "fall arrest" vs Python "fall hazard"). Both files claim to "mirror mira-bots/shared/guardrails.py SAFETY_KEYWORDS" — they don't.

**Concrete failure:** "I see melted insulation on the panel" → immediate STOP on Slack/Telegram/kiosk; **no pre-LLM STOP** on Hub asset/node chat.

**Recommendation:** designate `guardrails.py` `SAFETY_KEYWORDS` the single source; generate the TS lists from it (build step or parity test à la `test_diagnose_parity.py`); collapse the two in-route copies into one imported module. Verdicts: guardrails.py **KEEP**; `safety-alert.ts` patterns **MERGE INTO generated-from-canonical**; in-route `SAFETY_PHRASES` **MERGE INTO shared module** (do not leave as-is).

---

## Area 6: Ignition integration code

Three locations, cleanly separated by purpose; the code triplication of the diagnose core is intentional and (mostly) parity-guarded.

| Artifact | Role | Verdict | Evidence | Notes |
|---|---|---|---|---|
| `ignition/webdev/FactoryLM/api/` + `ignition/gateway-scripts/` | WebDev REST source-of-truth for gateway diagnose (`diagnose/diagnose_core.py`, 287 lines; `asset_config.py`, `signal_roles.py`, `tag_topic_map.py`; chat/connect/ingest/tags/alerts/status endpoints) + 4 gateway scripts (tag streaming to mira-relay) | **KEEP** | Vendored `diagnose_core.py` is byte-identical to `plc/conv_simple_anomaly/rules_core.py` (diff: empty) | Parity-tested — see Area 2. |
| `plc/ignition-project/` | Four Perspective projects: `ConvSimpleLive`, `NorthwindBottling`, `testing` (sandbox per `feedback_ignition_sandbox_workflow.md`), `gateway-snapshot/` backup | **KEEP** (ConvSimpleLive) / **LEAVE AS FIXTURE-DEMO** (testing, gateway-snapshot) | Both live projects vendor byte-identical `mira_diagnose_core`, `mira_tag_map`, `mira_signal_roles`, `mira_asset_config`, `mira_diagnose`, `mira_setup` script-python modules (`diff -rq`: only `mira_chat` unique to NorthwindBottling) | **GAP:** `NorthwindBottling/ignition/script-python/mira_diagnose_core/code.py` is byte-identical to `rules_core.py` today but `grep -n "NorthwindBottling" tests/regime7_ignition/test_diagnose_parity.py` → **no matches**. 4th copy, unguarded — add it to the parity test or it drifts silently. |
| `mira-ignition-exchange/` | Free Ignition Exchange listing: `MIRA/ChatDock` + `MIRA/ScanWidget` Perspective views only, lead-gen distribution | **KEEP** (distinct product surface) | `mira-ignition-exchange/README.md:1-14` | No overlap with the diagnose rule engine; marketing/public distribution, not the customer diagnose module. |

**Recommendation:** one-line fix — extend `tests/regime7_ignition/test_diagnose_parity.py` to cover the NorthwindBottling copies (all six vendored modules, same pattern as lines 123-178 for ConvSimpleLive).

---

## Area 7: PLC / fieldbus paths

No `fieldbus-readonly.md` violations found. Classification:

| Artifact | Classification | Verdict | Evidence |
|---|---|---|---|
| `plc/live-plc-bridge/bridge.py` | Bench-only, compliant | **KEEP** (bench tool) | BENCH-ONLY banner `bridge.py:2-14` ("NEVER SHIPPED TO CUSTOMERS"); referenced ONLY by `docker-compose.fault-detective.yml:127-130`, which itself carries a "BENCH HARNESS — NOT a customer architecture" banner (lines 1-9). Grep across all root `docker-compose*.yml` for `live-plc-bridge|live_monitor`: no other hits. |
| `plc/live_monitor.py` | Bench-only, compliant | **KEEP** (bench tool) | Banner lines 2-13, cites `.claude/rules/fieldbus-readonly.md`; absent from every compose file. |
| `mira-connect/` | Dormant stub | **DEPRECATE** (or DELETE LATER once "Config 4" is formally re-scoped) | Only `drivers/base.py`, `drivers/modbus_driver.py` (78 lines), empty `__init__.py`, one 44-line test. No CI job runs it; no imports from any other module (grep for `mira_connect|mira-connect` outside its dir: only a bare string in `.github/workflows/ci.yml`, a docstring mention in `plc/live_monitor.py`, and false-positives on `mira-connectors`). Matches root CLAUDE.md "DEFERRED — post-MVP". |
| `mira-connectors/` | Different system — NOT a fieldbus duplicate | **KEEP** — rename recommended | `mira-connectors/README.md:1-22`: generic CMMS/SCADA/Historian/Document connector framework (Maximo/Ignition/SAP/MaintainX/PI mocks + `confirmation_gate.py` per ADR-0017) that "extends… does not replace" mira-mcp/cmms, Ignition, mira-crawler, mira-relay. Actively CI-tested: `ci.yml:196-201` runs its 79 offline tests. | Name collision with dormant `mira-connect` is the real problem — confusing but unrelated codebases. Recommend renaming one when convenient. |
| `mira-relay/mqtt_ingest/` | Compliant transport | **KEEP** (canonical ingest transport) | `decode.py:24` imports `build_tag_entry` from `ingest_contract`; `subscriber.py:25,133` imports/calls `build_ingest_batch`. No forked normalizer/persistence — satisfies `.claude/rules/one-pipeline-ingest.md`. |
| `plc/litmus/` | Bench-only, read-only, compliant | **KEEP** (bench proof) | README lines 1-6: explicit BENCH-ONLY banner citing fieldbus-readonly.md + one-pipeline-ingest.md ("Not the mira-relay ingest path"). `provision.py:5`: "READ tags only; never writes a PLC register". Structural guard test `plc/litmus/test_dashboard_api.py:90-100` asserts no `write_register`/`write_coil`/`pymodbus`/blocked read-route in the adapter. `mira_on_litmus.py --source plc` opens a read-only Modbus socket (FC reads only) — bench baseline, compliant. |

---

## Area 8: Demo aliases / tenants

Catalog from `tools/seeds/*.sql` + `tools/seeds/README.md`:

| Tenant | UNS root | Seed file(s) | Purpose | Verdict |
|---|---|---|---|---|
| `78917b56-f85f-43bb-9a08-1bb98a6cd6c3` (system/OEM) | `enterprise.knowledge_base.*` (implicit, `knowledge_entries` only) | `tools/seeds/demo-conveyor-001.sql:52` | Garage GS10/Micro820 component-template chunks. **Doc drift:** comment at line 36 says default is `'mike-garage-demo'` but the code sets the UUID — stale comment in the same file. | **KEEP** (it IS the shared corpus owner) |
| `__TENANT_ID__` placeholder | `enterprise.home_garage.conveyor_lab.conveyor_1.*` | `tools/seeds/factorylm-garage-conveyor.sql:28-68` | Live `kg_entities` for the garage bench rig, applied per-caller | **KEEP** |
| `00000000-…-0000000000d1` ("demo") | `enterprise.garage.area.demo_cell.line.conveyor_line.equipment.*` | `tools/seeds/demo-hub-tenant.sql:101,150,160` | Full Hub demo tenant (kg_entities, cmms_equipment, work_orders, pm_schedules) — README calls this "Garage conveyor (CV-101)" | **LEAVE AS FIXTURE-DEMO** |
| (README claims `…d1` again) | `enterprise.demo.site.lake_wales.area.assembly.line.line_a.equipment.cv_001.*` | `tools/seeds/README.md:121-131` documenting `demo-conveyor-001.sql` | **README ≠ code**: the file's actual default tenant is `78917b56…`, not `…d1`. Either the README is wrong or an undocumented third UNS root reuses `…d1`. Unresolved — needs a direct follow-up. | **fix README** |
| `00000000-…-0000000000b1` (Northwind) | `enterprise.riverside.area.packaging.line.line1.*` (CV-200) | `tools/seeds/northwind-bottling-hub.sql:34,104-160`; `tools/seeds/approved_tags_northwind_cv200.sql:29-44` | **Second tenant identity over the SAME physical garage rig** (Micro820+GS10). `approved_tags_northwind_cv200.sql:6-10`: the gateway timer "publishes the rig tags a SECOND time as the Northwind tenant"; the home_garage allowlist row "is NOT touched". **Prior memory claim "CV-200/Northwind = alias over filler01" is WRONG** — filler01 is SimLab, unrelated. | **LEAVE AS FIXTURE-DEMO** (intentional dual-tenanting, documented in the seed itself) |
| `00000000-…-000000515ab1` (SimLab) | `enterprise.florida_natural_demo.plant1.juice_bottling.line01.{depalletizer01…filler01…cipskid01}` (11 assets) | `tools/seeds/approved_tags_simulator.sql:83-96`; `tools/seeds/seed-simlab-docs.py`; `tools/seeds/README.md:164` | Synthetic juice-bottling line, 11 assets × 7 doc types = 77 fixtures, BM25-only KB | **LEAVE AS FIXTURE-DEMO** (platform oracle) |
| `__TENANT_ID__` placeholder | `enterprise.celestial_park.stardust_racers.*` | `tools/seeds/epic-universe-stardust-racers.sql:1-35` | Universal Epic "Stardust Racers" coaster demo — a distinct theme-park vertical, not an alias | **LEAVE AS FIXTURE-DEMO** |

**No accidental tenant duplication found.** The one true dual identity (CV-101/CV-200) is deliberate and documented in-file. Action items are doc-only: fix the `demo-conveyor-001.sql:36` stale comment and the `tools/seeds/README.md:121-131` tenant/UNS mismatch; correct the stale "filler01 alias" memory.

---

## Area 9: Work order paths

**ONE declared system of record, multiple documented front doors — not competing systems.**

| Artifact | Role | Verdict | Evidence |
|---|---|---|---|
| Hub NeonDB `work_orders` table | Source of truth for FactoryLM-side WOs | **KEEP** (canonical) | `mira-hub/db/migrations/007_atlas_sync_cols.sql:1-6` states: "NeonDB is the source of truth (recorded 2026-05-06 in docs/specs/hub-cmms-integration-spec.md §3.4 #1). Atlas receives synced copies… NeonDB wins on conflict." Insert path: `mira-hub/src/app/api/work-orders/route.ts:191-211`. Table predates mig 005 (005/006/007/008 all `ALTER TABLE work_orders`; no CREATE found in the migrations dir grep). |
| Atlas CMMS (`mira-cmms/`, own Postgres in `atlas-db`) | Execution backend | **KEEP** | Sync worker `mira-hub/src/lib/atlas/sync.ts:1-30`: forward push NeonDB→Atlas, reverse poll Atlas→NeonDB, `cmms_sync_conflicts` for rejected reverse-syncs. |
| mira-mcp `cmms_create_work_order` | Diagnostic-session front door | **KEEP** — but note the bypass | `mira-mcp/server.py:304-323`: if external CMMS configured (`server.py:41-48` MaintainX/Limble/UpKeep) writes there; else `diagnostic_record_case` (`server.py:244-267`) → `mira-mcp/cmms/atlas.py:20-53` → **direct REST POST to atlas-api:8080**, bypassing the Hub sync worker. Converges via reverse-sync poll ("if local row not found: insert new") — eventual consistency, real latency/race window between mcp-created WO and Hub UI visibility, but no permanent second store. |
| `wo_outbox` | Local SQLite retry queue, NOT a store of record | **KEEP** (delivery mechanism) | `mira-bots/shared/integrations/wo_outbox.py:1-61`; schema `mira-bridge/migrations/004_add_wo_outbox.sql`. Retries failed submissions from `mira-bots/shared/integrations/atlas_cmms.py` (`AtlasCMMSClient`, used by `mira-bots/telegram/bot.py`) → POST `{MCP_BASE_URL}/api/cmms/work-orders` (`mira-mcp/server.py:1289`). Full Telegram chain: bot → outbox-guarded HTTP → mira-mcp REST → tool → Atlas/external CMMS. |

**Recommendation:** no structural change. Consider routing the mcp path through the Hub API (or documenting the convergence latency) so all writes share one door — a P3 consistency nicety, not a duplication defect.

---

## Area 10: Relationship types & UNS conventions

### Relationship-type vocabularies: FOUR overlapping definitions, split is self-documented

| Artifact | Role | Verdict | Evidence |
|---|---|---|---|
| Mig 043 CHECK on `relationship_proposals` | Canonical UPPERCASE_SNAKE list (~30 values: `HAS_COMPONENT`, `WIRED_TO`, `CAUSES`, `HAS_WORK_ORDER`, `HAS_PM_SCHEDULE`, `HAS_TAG`, …) | **KEEP** (canonical, but proposals-only) | `mira-hub/db/migrations/043_has_work_order_relationship_type.sql:35-50`. NOTE: mig 038 (`038_relationship_type_asset_graph.sql:26`) explicitly leaves `kg_relationships.relationship_type` as free TEXT — **the promoted/verified edge table has NO constraint at all**. |
| `mira-hub/src/lib/knowledge-graph/types.ts:11-51` | Independent lowercase `RELATIONSHIP_TYPES` allowlist | **MERGE INTO canonical vocabulary** | Contains types absent from 043: `electrically_connected`, `controls`, `protects`, `references_drawing`, `feeds`, `triggered_pm`, `maintained_by`, `had_fault` — genuinely out of sync, not just case-different. |
| `canonicalizeRelationshipType` (`mira-hub/src/lib/knowledge-graph/canonical-relationship-type.ts:1-61`) | NEW display-only fold (#2403) | **KEEP** (as stopgap) — but it documents the debt | Header L5-11: "The hub has two relationship-type vocabularies in flight at once." Explicitly display-layer-only (L25); `CONTROLS` called out as out-of-vocabulary with "no clean canonical equivalent yet" (L39-41). Authority note (L19-23) names the two write-path canonicalizers it must stay in lockstep with. |
| Write-path canonicalizers | `mira-hub/src/lib/…/proposals-writer.ts:19-84` (`CANONICAL_PROPOSAL_RELATIONSHIP_TYPES` + `LOWERCASE_TO_CANONICAL_EDGE`) and `mira-crawler/ingest/proposal_writer.py:68-75` (`_CANONICAL_RELATION_TYPE`) | **MERGE INTO one generated table** | Two languages × one mapping = lockstep-by-discipline today. |

**Recommendation:** single YAML/JSON vocabulary file → generate the TS types, the Python map, and the 043-successor CHECK; add a CHECK (or trigger) on `kg_relationships.relationship_type`.

### UNS path builders: THREE implementations

| Artifact | Role | Verdict | Evidence |
|---|---|---|---|
| `mira-crawler/ingest/uns.py:118-131` (+~15 builder functions) | Canonical `slug()` + path builders per `.claude/rules/uns-compliance.md` | **KEEP** (canonical) | `slug()` returns `""` on empty input. |
| `mira-plc-parser/mira_plc_parser/uns.py:25-33,93` | Independent reimplementation for PLC-tag→UNS proposals (`propose_uns(report, prefix)`) | **KEEP short-term, MERGE slug() later** | Own `slug()` — near-identical regex but falls back to `"x"` (not `""`) on empty input: real behavioral divergence. Does not import mira-crawler (parser is deliberately standalone/offline). Different API purpose, but the slug primitive should be one implementation (shared micro-package or parity test). |
| `plc/discover.py:408-412` | Ad-hoc inline `slug()` + `f"enterprise.knowledge_base.{slug(mfr)}.{slug(model)}"` | **MERGE INTO mira-crawler builders** | The literal anti-pattern named in uns-compliance.md rule 1. Self-admitted: docstring L400 "Best-effort UNS path stub from a profile (real builder wiring is v1.5)" — known deferred debt. |

Ad-hoc `enterprise.` grep sample (`*.py`): `plc/discover.py:412` is the only production offender found; `tests/simlab/test_publishers.py:67`, `tests/simlab/ingestion/ai4i.py:351`, `tests/integration/test_phase0_schema.py:94` are test fixtures (acceptable); `mira-crawler/ingest/uns_topic_map.py:20` is a comment criticizing hand-formatting, not an offender. (Also noted in Area 4: `mira-pipeline/ignition_chat.py:322` carries a documented local copy of `slug()` — a deliberate one-function duplication to avoid importing the crawler.)

---

## Area 11: Approval gates — layered, not contradictory (two gaps)

Five gates, five distinct concerns; **no two govern the same decision**:

| Gate | Guards | Where | Verdict | Evidence / gaps |
|---|---|---|---|---|
| Chat UNS confirmation gate | WHERE the technician is (chat surfaces) | `mira-bots/shared/engine.py` ~L5744-5755, `_UNS_GATE_ENABLED` | **KEEP** | — |
| Direct-connection carve-out | Skips gate #1 when the surface certifies the asset | `engine.py:5747` (`if uns_ctx.get("source") == "direct_connection": return False`) | **KEEP** — implement the missing half | **GAP:** comment at `engine.py:5741` admits "The broader reject-on-missing-identifier contract for direct surfaces is still P6" — only the "don't ask if present" half of `.claude/rules/direct-connection-uns-certified.md` is implemented; the reject-on-missing half is doctrine-only. |
| `MIRA_ENFORCE_APPROVED_RETRIEVAL` | WHICH knowledge content may be cited | `neon_recall.py:126`, `manual-rag.ts:59`, `mira-hub/src/lib/approved-context.ts:23` | **KEEP** — collapse the alias | **GAP:** `approved-context.ts:23` aliases a second env-var name `MIRA_ENFORCE_APPROVED_ASK` to the same boolean. Two flag names, one concern — collapse to one. |
| Asset-agent FSM (`ENFORCE_ASSET_AGENT_GATE`) | WHETHER a trained agent may answer on the HMI | `mira-pipeline/ignition_chat.py:51,392,538`; migs `046_asset_agent_status.sql`/`047_asset_validation_qa.sql`/`048_asset_agent_tenant_text.sql` | **KEEP** | Default-OFF (`ignition_chat.py:392`). Orthogonal axis (agent readiness). |
| `approved_tags.enabled` | WHICH raw tag paths enter ingest | `mira-relay/tag_ingest.py:141,299,339-367` | **KEEP** | New tags land `enabled=false`, never auto-flipped (L339-342). |

---

## Consolidated recommendations (priority order)

1. **[P1] Unify safety keywords** — canonical `guardrails.py` list; generate/parity-test the Hub TS lists; extract the duplicated in-route `SAFETY_PHRASES` into one module. (Area 5)
2. **[P1] Extend `test_diagnose_parity.py` to the NorthwindBottling vendored modules** — one small test addition kills the 4th-copy drift risk. (Areas 2/6)
3. **[P2] Relationship-type vocabulary: one generated source** for mig-CHECK / types.ts / proposals-writer.ts / proposal_writer.py / canonical-relationship-type.ts; add a CHECK on `kg_relationships.relationship_type`. (Area 10)
4. **[P2] Reconcile the two tenant-filter mechanisms** (`SHARED_TENANT_ID` vs `is_private` hybrid) — either port the hybrid law into `neon_recall.py` or amend the tenancy rule to sanction the shared-tenant equivalent. (Area 4)
5. **[P2] Wire `plc/discover.py` to the canonical UNS builders** (self-declared v1.5 debt); share or parity-test `slug()` with `mira-plc-parser`. (Area 10)
6. **[P3] Implement the direct-connection reject-on-missing-identifier contract** (the "P6" engine comment); collapse `MIRA_ENFORCE_APPROVED_ASK` into `MIRA_ENFORCE_APPROVED_RETRIEVAL`. (Area 11)
7. **[P3] Doc fixes:** `tools/seeds/README.md:121-131` vs `demo-conveyor-001.sql` tenant mismatch; stale comment `demo-conveyor-001.sql:36`; correct the "CV-200 = filler01 alias" memory. (Area 8)
8. **[P3] Deprecate `mira-connect/`** (dormant stub) and rename it or `mira-connectors/` to end the name collision; **DELETE LATER:** `mira-sidecar/` + `docker-compose.pathb.yml`. (Areas 4/7)
9. **[P1] Unify `conveyor_events` and `faults`**, or point `/api/faults/active` at both — the conveyor anomaly engine's writes are currently invisible to the Telegram/MCP fault surface despite sharing one SQLite file. Already flagged pre-existing (`docs/discovery/2026-07-03-product-discovery-sweep.md`); fix before `conv_simple_anomaly` leaves bench-only status. (Area 1)

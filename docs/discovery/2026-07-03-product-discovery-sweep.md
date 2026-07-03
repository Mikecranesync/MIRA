# Product Discovery Sweep — One Cohesive Product from Four Months of Conveyor Work

**Date:** 2026-07-03 · **Branch inspected:** `feat/litmus-bench-proof` · **Window:** 2026-03-01 → 2026-07-03 (2,319 non-merge commits)
**Method:** 5 parallel read-only research agents (repo inventory, conveyor bench evidence, Hub product flows, connectors/ingestion, intelligence chain) + synthesis. Every claim cites a file, commit, PR, issue, or doc. Where evidence was searched for and not found, that is stated.

---

## 0. Executive summary — the one-paragraph verdict

**The product is real at both ends and cut in the middle.** The physical bench (Micro820 + GS10) genuinely works and produces a grounded, cited, refusal-honest maintenance answer via a local script (`plc/litmus/demo_context_model.py`). The cloud Hub genuinely works: signup, namual upload → cited chat, proposal review, and a server-enforced train→validate→approve gate (`mira-hub/src/lib/asset-agent-transition.ts`). What does **not** exist is the connective tissue: no physical-machine tag has ever landed in the cloud (`tag_events` is SimLab-only), the anomaly rules never run continuously against the canonical ingest stream, detected anomalies are computed and discarded (no persistence, no work order), the onboarding wizard dead-ends before "add equipment," and the grounding-refusal gate ships **off by default**. Closing ~6 specific gaps turns a pile of proofs into one sellable loop: *connect equipment → map tags → attach evidence → approve context → get maintenance outcomes.*

---

## 1. Product map — every piece, where it lives, what it does, status

Status legend: **production** = merged + deployed/verified · **prototype** = merged, bench/sandbox only · **demo-only** = replay/seed for a demo · **blocked** = external dependency stops it · **in-flight** = untracked/uncommitted in the working tree · **doc-only** = plan/spec/vision.

### 1a. Physical bench (Micro820 + GS10 conveyor)

| Piece | Where | What it does | Status | Evidence |
|---|---|---|---|---|
| Conv_Simple PLC lineage (v1.4→v2.1) | `plc/Prog_init_ConvSimple_v2.1.st`, `plc/build_conv_simple_*.py` | ST programs driving GS10 over RS-485/Modbus Ch2; clone-from-baseline builders | prototype (flashed, validated: rpm 878≈880) | commits `2e681366`, `4f55af9e`; PR #1522; `docs/RESUME_2026-06-14_maintenance-intelligence-module.md:29-35` |
| GS10 Modbus map + deploy tools | `plc/MbSrvConf_ConvSimple_v1.9.xml`, `plc/deploy_modbus_map.py` | Register map (0x2100/0x2101 monitor), CCW import | prototype | commits `78c46846`, `996f99ee` |
| Bench tooling (monitor/diag/discover/bridge) | `plc/live_monitor.py`, `plc/vfd_diag.py`, `plc/discover.py`, `plc/live-plc-bridge/bridge.py` | Read-only bench polling, GS10 decode, fieldbus discovery, MQTT republish | prototype, BENCH-ONLY by rule | `.claude/rules/fieldbus-readonly.md`; PR #1638 |
| Electrical print package (E-005, E-007) | `plc/conv_simple_electrical/` (YAML → SVG/PDF) | Model-first prints: PLC inputs + RS-485/Modbus | prototype (merged); **not consumed by any answer path** | commits `6c379744`, `1645e6a1` |
| Trend historian / viewer | `plc/conv_simple_anomaly/trend_*.py`, `mira-trend-viewer/` | HR117-124 historian + ISA-101 trend viewer | prototype | commit `d3e16b8e` |

### 1b. Detection & difference intelligence

| Piece | Where | What it does | Status | Evidence |
|---|---|---|---|---|
| A0–A12 anomaly rules (12 rules; no A11) | `plc/conv_simple_anomaly/rules_core.py` | Pure dual-Py2.7/3.12 machine-card rules → Anomaly(severity, evidence, components); vendored into Ignition gateway | production-grade logic; deployment mixed | PR #1635; 27 tests `test_rules.py`; `tests/regime7_ignition/` parity |
| Next-check map + offline battery | `plc/conv_simple_anomaly/anomaly_log.py` | Per-rule "what to check" + Ask-MIRA question; 14-scenario deterministic battery | prototype (merged) | commit `dc9de9ba` |
| Approved CV-101 context model | `plc/conv_simple_anomaly/context_model.cv101.json` | Raw register → named signal, per-signal evidence + approval; explicit `unmapped` list | proven, human-approved (`approved_by: mike`, 2026-07-01) | file; `docs/demo/garage_conveyor_context_model_demo.md` |
| Baseline learner + difference detectors | `plc/conv_simple_anomaly/{baseline_learner,difference_detectors}.py` | Learns normal band; drift/never-seen detection; SEED for the difference engine | merged to main, **not wired** (no `signal_baselines`/`machine_events` tables) | PR #2387 `e61e3979`; `docs/plans/2026-06-30-mira-difference-engine-backlog.md` (🔲 rows) |
| tag_diff_logger + flaky detector | `mira-relay/tag_diff_logger.py`, `mira-relay/flaky_detector.py` | Edge/threshold diffs → `tag_event_diffs` (mig 037); chatter → KG proposal | production (diff logger); flaky **detection shipped, runtime trigger not built** | `flaky_detector.py:32-34` |
| Difference-engine ProveIt demo | `demo/factory_difference_engine/` (pipeline, fault_bundle, fault_dictionary, fault_report, flight_report) | Deterministic Connect→Pick→Prove→Explain→Learn over SimLab; fault dictionary (53 codes / 11 assets: cryptic code→meaning→tags→cited source) | **in-flight (untracked)**; offline only; join to live differences explicitly not built | `demo/factory_difference_engine/README.md`; untracked `tests/simlab/test_fault_*.py` |
| SimLab (platform oracle) | `simlab/` | Deterministic juice-bottling factory, PackML, fault injection, self-scoring rubric | production-of-demo (merged) | PRs #2218, #2154, #2236, #1741 |
| Flight recorder | branch `codex/flight-recorder-phased` | Deterministic run recording for replay | in-flight (DRAFT PR #2335) | PR #2335; `docs/prd/factorylm_flight_recorder_black_box_prd.md` (untracked) |

### 1c. Connectors & ingestion (full matrix in §4)

| Piece | Where | Status | Evidence |
|---|---|---|---|
| Canonical ingest pipeline (REST/HMAC → `tag_events`) | `mira-relay/{relay_server,ingest_contract,tag_ingest,auth}.py` | **production** | PR #2281; Contract 5 `tests/test_architecture.py:256-271` |
| Ignition tag stream (gateway → relay) | `ignition/gateway-scripts/tag-stream.py`, `ignition/webdev/FactoryLM/api/tags/collector.py` | working-demo / near-production (customer-deployable; no live customer deployment cited) | ADR-0021; HMAC `signing.py`; dual allowlist |
| Sparkplug B MQTT subscriber | `mira-relay/mqtt_ingest/` | **built + 41 tests, opt-in compose profile, not deployed** | PR #2358; `docker-compose.saas.yml:508`; runbook `docs/runbooks/2026-06-28-sparkplug-mqtt-consumer.md` |
| Litmus Edge | `plc/litmus/` + docs | bench proof only; API hop **blocked**; license = 2-hour dev trial | `docs/RESUME_2026-07-01_litmus-devicehub-bench.md`; `docs/product/litmus_connector_product_gap.md` |
| PLC export parsing (5 formats) | `mira-plc-parser/` + `mira-hub .../api/connectors/plc/import` | production (parse → `ai_suggestions` proposals) | PRs #2068, #2084, #2091, #2097, #2147 |
| MIRA Contextualizer (offline desktop) | `mira-contextualizer/` | prototype (P0-P6 done, packaged exe) | `mira-contextualizer/README.md`, `PACKAGING.md` |
| External-AI MCP (ChatGPT connector) | `mira-mcp/factorylm_external_ai/` | **in-flight (untracked)**; 9 read-only tools over static approved context | module + untracked tests; `docs/external-ai/*.md` |
| OPC UA / Kepware / HighByte | — | **absent** (docs/ADRs only; zero code — searched `rg -il "opc.?ua\|kepware\|highbyte"`) | ADR-0001 defers OPC UA |

### 1d. Hub (Command Center, app.factorylm.com)

| Piece | Where | Status | Evidence |
|---|---|---|---|
| Signup / tenant / session | `mira-hub/src/app/signup/`, `src/lib/session.ts` | production | `ensureUserAndTenant`; UUID guard `session.ts:75-78`; #2360 |
| Onboarding wizard | `src/app/(hub)/onboarding/page.tsx` | production but **scope-limited: creates site+line only, dead-ends at "No assets yet"** | `onboarding/page.tsx:16, 630-636` |
| Tag import in wizard | `onboarding/page.tsx` TagImportStep | **stub — mock only** ("live gateway coming in a future release") | `onboarding/page.tsx:915-952` |
| Real PLC import | `/plc-import`, `api/connectors/plc/import`, `lib/plc-import.ts` | production, **disconnected from wizard** | `plc-import.ts:106-129`; #2147/#2145 |
| Document upload (real) | `api/uploads/local` → mira-ingest | production (`is_private=true`, node-scoped) | `lib/local-upload.ts`; poll loop `onboarding/page.tsx:690-716` |
| Document upload (demo shim) | `api/documents/upload/route.ts` | **prototype — self-labeled "NOT the full ingest pipeline"** | its docstring lines 19-24 |
| Proposals / suggestions / graph review | `/proposals`, `/knowledge/suggestions`, `/graph`, `api/proposals/[id]/decide` | production (capability-gated) | decide `route.ts:53-89`; #2368 |
| Train→validate→approve FSM | `lib/asset-agent-transition.ts`, migrations 046/047/048 | **production: server-enforced gate, ≥5 cited good answers, human actor required** | `asset-agent-transition.ts:69-86`; transition `route.ts:70-98` |
| Cited chat (asset / node / quickstart / hub ask) | `api/assets/[id]/chat`, `api/namespace/node/[id]/chat`, `api/quickstart/ask`, `api/mira/ask` | production (citations real) | `lib/manual-rag.ts`; #1875, #2178/#2190 |
| Approved-context refusal gate | `lib/approved-context.ts`, env `MIRA_ENFORCE_APPROVED_RETRIEVAL` | **built but DEFAULTS OFF** | `manual-rag.ts:58-60`; asset chat `route.ts:351` |
| Command Center status view | `/command-center` | prototype (read-only, PR-1) | #2365 |
| CMMS / work orders | `/cmms`, Atlas SSO, `mira-mcp` `cmms_create_work_order`, `wo_outbox.py` | production (human/chat-triggered only) | `mira-mcp/server.py:305`; #2319 |

### 1e. Diagnosis engine & chat surfaces

| Piece | Where | Status | Evidence |
|---|---|---|---|
| Supervisor engine (UNS gate, groundedness 1–5, citation compliance, refusal) | `mira-bots/shared/engine.py`, `citation_compliance.py` | production | `engine.py:284-286, 694, 1164, 1774` |
| Hybrid RAG (vector+BM25+ILIKE, RRF; fault-code recall) | `mira-bots/shared/neon_recall.py` (~83k OEM chunks) | production | `neon_recall.py:1-15, 323, 498` |
| Ignition chat endpoint + in-gateway diagnose | `mira-pipeline/ignition_chat.py`; `ignition/webdev/FactoryLM/api/diagnose/doGet.py` | working-demo; **gateway WebDev module NOT installed (404)** | `docs/RESUME_2026-06-14…:59-63`; CRA-245 |
| Perspective panels (ConvSimpleLive, NorthwindBottling CV-200, MaintenancePanel/MiraAsk) | `plc/ignition-project/` | prototype; live panel deploy "awaits bench deploy + screenshot" | PRs #1601, #2370, #2394; `RESUME_2026-07-03…:108-110` |
| Ask MIRA kiosk | `mira-bots/ask_api/` + `machine_context.py` | production (garage conveyor) | kiosk runbook |
| Telegram/Slack bots | `mira-bots/telegram/bot.py`, `mira-bots/slack/bot.py` | production (grounded, cited); `/faults` reads `faults` table — **not** conveyor anomalies | `bot.py:847-855`; `server.py:180` |
| Wiring-diagram generator | `mira-bots/shared/wiring_diagram/` | **in-flight (untracked)** | module + untracked test; `docs/discovery/electrical_print_reuse_audit.md` |

---

## 2. Conveyor truth table — proven live vs simulated vs inferred vs missing

| # | Capability | Status | Evidence | To make it live |
|---|---|---|---|---|
| 1 | PLC drives VFD (control + telemetry) | **PROVEN LIVE** | rpm 878≈880 keypad validation; `plc/Prog_init_ConvSimple_v2.1.st` | Nothing (sparse map caveat, row 12) |
| 2 | Litmus collects the conveyor | **PROVEN LIVE, license-blocked for durability** | `conv-101`, 11 registers, 0 Modbus exceptions (`RESUME_2026-07-01_litmus-devicehub-bench.md:24-28`); trial-expired screenshot `litmus-relogin-factory2026-verified.png` | Paid Litmus license; re-provision after every 2-h reset |
| 3 | MIRA reads *through* Litmus API | **BLOCKED** | `:8094` UUID-apiKey mismatch, container-internal (`litmus_mira_demo_decision.md:27-40`) | Supported egress (MQTT preferred) per `docs/integrations/litmus_supported_connector_plan.md` |
| 4 | MIRA contextualizes live conveyor data (direct Modbus) | **PROVEN LIVE (once) + PROVEN REPLAY** | `demo_context_model.py --source plc`; live A1 injection claimed in RESUME prose (not screenshot-captured); 17 CI tests | Bench LAN required; claimed-not-captured live run should be recorded |
| 5 | Approved context model (registers → named signals) | **PROVEN** | `context_model.cv101.json`, approved_by mike 2026-07-01 | Photo-eye still `proposed`; 2 signals structurally unmapped |
| 6 | Anomaly detection on replay fixtures | **PROVEN (deterministic, CI)** | 12 rules × 14-scenario battery, 27+17 tests | Nothing (A2/A12 reflash-gated) |
| 7 | Anomaly detection on live bench faults | **INFERRED-DESIGNED** (one live check claimed, not captured) | `live_check.py` runs identical `rules_core`; panel verify "awaits bench deploy + screenshot" | Record the bench run (e-stop→A3, RS-485 unplug→A1, both-dirs→A4) |
| 8 | Grounded cited answer w/ refusals (offline script) | **PROVEN** | `demo_context_model.py` "Evidence used" + "What MIRA will NOT claim" | Nothing — but it's a local script, not the cloud product |
| 9 | Ignition HMI "Ask MIRA" button | **BLOCKED / built-but-dark** | WebDev 404 (`RESUME_2026-06-14…:59-63`); Perspective fallback built, undeployed | Install WebDev or deploy the project-script panel + screenshot |
| 10 | Live conveyor telemetry → cloud (`tag_events`) | **NOT WIRED** (pipeline production, conveyor never connected) | Only SimLab round-trip proven (`wiki/hot.md` 2026-06-23); no conveyor row in `tag_events` found | Ignition tag-stream on the bench gateway + HMAC key |
| 11 | Cloud Ask MIRA grounded on live conveyor | **NOT BUILT** (seeded/fabricated conveyor data only) | `tools/seeds/factorylm-garage-conveyor.sql` labeled fabricated (`docs/architecture/real-vs-simulated.md:72-73`) | Rows 10 + cloud grounding on live context |
| 12 | Torque/RPM/power mechanical anomalies live | **BLOCKED (sparse map)** | HR117-124 "silently absent until reflash" (`wiki/hot.md` 2026-06-12b); issue #2393 | Slave-map-v2 reflash (human CCW step) — un-gates A2/A7/A8-family/A12 |
| 13 | Electrical print grounding in answers | **PROVEN as documents; NOT wired into answers** | commits `6c379744`, `1645e6a1` | Wiring-print *reader* path (designed, not built) |
| 14 | Anomaly → work order / outcome | **NOT BUILT** | "No anomaly table in 56 migrations" (`litmus_connector_product_gap.md:48-50`); anomalies "computed and discarded" | Outcome model + persistence + WO hook (see P0/P1) |
| 15 | Factory I/O | **NOT BUILT (aspirational, SimLab-only concept)** | `docs/simlab/factory-io-optional-adapter.md` header "Not Built" | N/A |
| 16 | OpenPLC | **NOT BUILT (parser corpus only)** | untracked WIP folder; parser eval fixture mentions | N/A |

**Broken links in the intelligence chain (verified in code):**

1. `tag_events` → A0–A12 rules: no continuous live path; rules run only in-gateway on-demand, bench script, or an MQTT subscriber that is `# pragma: no cover` / "not exercised in CI" (`plc/conv_simple_anomaly/engine.py:14,163`).
2. Difference detectors → machine events: SEED only; no `signal_baselines` / `machine_events` tables (backlog 🔲 rows).
3. Anomaly persistence → fault surface: conveyor engine writes `conveyor_events`; Telegram `/faults` reads `faults` (`mira-mcp/server.py:180`) — different tables, never joined.
4. Anomaly → work order: `cmms_create_work_order` exists (production) but nothing calls it from detection — searched `create_work_order` callers; none from any anomaly path.
5. Fault dictionary → production: untracked, offline, SimLab-only; join to `recall_fault_code` "not built yet" (its README).
6. `event_context.build_event_context` → `ask_api`: planned `machine_event_id` on AskRequest unimplemented (`event_context.py:14-17`).
7. `flaky_detector.run()` → runtime: no worker/cron calls it (`flaky_detector.py:32-34`).
8. Litmus API → MIRA: parallel collection, not a data dependency (`demo_context_model.py:283-287` "Honest gap").
9. Context model → live A7/A12: the two most diagnostic signals are in the `unmapped` list until reflash.

---

## 3. The cohesive product narrative

> **FactoryLM lets a factory connect its equipment, map its tags, attach its evidence, approve its context, and then get maintenance outcomes — grounded answers, likely causes, next checks, and work orders — from MIRA, an agent that only says what the approved context can prove.**

Every piece built in the last four months is one of those five verbs:

- **Connect** — the one-pipeline ingest (`mira-relay`), Ignition tag stream, Sparkplug B subscriber, Litmus bench proof, PLC bridge.
- **Map** — PLC parser (5 formats) → UNS proposals, tag mapper/VFD Analyzer wizard, context model, approved_tags allowlist, Contextualizer.
- **Attach** — manual upload → `knowledge_entries`, electrical prints, wiring diagrams, fault dictionary, work-order history.
- **Approve** — proposals queue, train→validate→approve FSM, human-approved context model, approved-context gate.
- **Outcome** — A0–A12 + difference engine → state/cause/next-check, grounded cited chat with refusals, work-order creation, reports/notifications.

The wedge (per `NORTH_STAR.md`) holds: nobody else makes messy factory data *trustworthy enough for AI* with an explicit human-approval loop. The bench demo is the proof artifact: a real machine, a real approved context model, and an answer that **refuses** what it can't prove. What is missing is not vision or components — it is ~6 pieces of connective tissue (§5).

**Who it's for:** small/mid-size manufacturers already running Ignition (or any Sparkplug-B-speaking edge), specifically the maintenance manager/technician who today diagnoses cryptic VFD faults from memory and paper manuals.

---

## 4. Recommended MVP product flow (first login → live conveyor diagnostic answer)

Each step is marked with today's status.

1. **Sign up** at app.factorylm.com → tenant provisioned. ✅ works (`api/auth/register`).
2. **Onboarding wizard**: company → site → line. ✅ works (`/api/wizard/finish`).
3. **Add equipment** (CV-101, GS10 VFD, Micro820). ❌ **missing from wizard** — dead-ends at "No assets yet" (`onboarding/page.tsx:630-636`). → P0-2.
4. **Import tags**: upload the PLC export (L5X/CSV) → UNS proposals → approve → `tag_entities`/`approved_tags`. 🟡 real at `/plc-import` (#2147/#2145) but **not in the wizard**; wizard button is mock. → P0-2.
5. **Attach evidence**: upload GS10 manual + E-005/E-007 prints → parsed → citable. ✅ works (`api/uploads/local`).
6. **Connect live data**: install the Ignition tag-stream (or point a Sparkplug broker at the subscriber) → tags land in `tag_events`. 🟡 mechanism production; **no physical machine has ever done it**; CLI/manual-only, no Hub affordance. → P0-4.
7. **Train & approve**: ≥5 validation questions with good cited answers → human approves agent. ✅ works and is server-enforced (`asset-agent-transition.ts:69-86`).
8. **Live detection**: A0–A12 + diff rules run continuously over `tag_events` → anomaly persisted → Hub tile + notification. ❌ **not built** (broken links 1–3). → P0-5.
9. **Ask MIRA**: "Why is CV-101 stopped?" → grounded cited answer + next check, refusing unproven claims. 🟡 works against uploaded docs; grounding gate **off by default**. → P0-3.
10. **Close the loop**: one-click work order from the anomaly (human-confirmed). ❌ not built. → P1-1.

---

## 5. Gap report — P0 / P1 / P2 / P3

### P0 — without these there is no product loop (do first)

| # | Gap | Fix | Evidence |
|---|---|---|---|
| P0-1 | **A large slice of the product is uncommitted.** `demo/factory_difference_engine/`, fault dictionary + 5 test files, `mira-mcp/factorylm_external_ai/`, `mira-bots/shared/wiring_diagram/`, `mira-plc-parser/evals/`, ~15 discovery/PRD/runbook docs — all untracked; PRs #2401/#2390/#2399/#2397 open. | Land the branch: commit, split into reviewable PRs, merge or explicitly park each. Nothing else in this report is durable until this is. | `git status` untracked list; inventory §8 |
| P0-2 | **Onboarding breaks in the middle**: no add-equipment step; wizard tag import is mock-only while real `/plc-import` is disconnected. | Add "Add your first machine" wizard step; wire `/plc-import` (L5X/CSV → proposals) into the wizard as the real tag-import step. | `onboarding/page.tsx:16, 630-636, 915-952` |
| P0-3 | **The product promise is off by default**: `MIRA_ENFORCE_APPROVED_RETRIEVAL` defaults false, so chat cites unverified chunks and never emits the 412 "context not ready" refusal. | Flip default on (or per-tenant on) after a staging eval pass; make "approved-context-only" the shipped behavior, not an env var. | `manual-rag.ts:58-60`; asset chat `route.ts:351` |
| P0-4 | **No physical machine has ever reached the cloud.** `tag_events` round-trip proven for SimLab only. | Deploy the Ignition tag-stream on the bench gateway (or bridge → relay REST) with HMAC key; land the first real CV-101 row in `tag_events`; screenshot it. | `wiki/hot.md` 2026-06-23; connector matrix |
| P0-5 | **Anomalies are computed and discarded.** No cloud anomaly/machine-event persistence (none in 56 migrations); no continuous rules-over-`tag_events` worker. | One migration (`machine_events` or `anomalies` table) + one worker: A0–A12 (+ diff logger grouping) over `tag_events` → persisted event → Hub tile. This is also the difference-engine backlog's top 🔲. | `litmus_connector_product_gap.md:48-50`; broken links 1–3 |

### P1 — makes it sellable

| # | Gap | Fix | Evidence |
|---|---|---|---|
| P1-1 | Anomaly → work order not connected | Persisted event → "Create work order" (human-confirmed) calling existing `cmms_create_work_order` + `wo_outbox` | `mira-mcp/server.py:305`; broken link 4 |
| P1-2 | Sparkplug subscriber built but dark; gap doc stale ("not built") | End-to-end proof vs a live broker; enable compose profile; **correct `docs/product/litmus_connector_product_gap.md`** | PR #2358; `docker-compose.saas.yml:508` |
| P1-3 | Ignition HMI button dark (WebDev 404; panel undeployed) | Install WebDev module (CRA-245) or deploy the Perspective project-script panel; capture the screenshot | `RESUME_2026-06-14…:59-63` |
| P1-4 | A2/A7/A8-family/A12 reflash-gated (sparse map) | Slave-map-v2 reflash — human CCW step per `plc-ccw-deploy` skill | `wiki/hot.md` 2026-06-12b; issue #2393 |
| P1-5 | Live bench fault-injection proof claimed-not-captured | Record the bench run (e-stop→A3, RS-485 unplug→A1) with `live_check.py`; commit artifacts | truth table row 7 |
| P1-6 | `conveyor_events` vs `faults` table mismatch (Telegram `/faults` blind to conveyor anomalies) | Unify on the P0-5 event store; point `/api/faults/active` at it | `server.py:180` vs conv engine `:100-120` |
| P1-7 | Fault dictionary not joined to live fault codes | Join fault_dictionary → `recall_fault_code`/`fault_codes` (mig 002) so a live A2 decode cites the manual page | `demo/factory_difference_engine/README.md` §Fault Dictionary |

### P2 — deepens the moat

- **P2-1** Baseline learner / difference engine wiring: `signal_baselines` table + scheduled learner + grouping worker (backlog `2026-06-30-mira-difference-engine-backlog.md` 🔲 rows).
- **P2-2** `event_context` consumed by `ask_api` (`machine_event_id` on AskRequest) — "explain this event" from any chat surface (`event_context.py:14-17`).
- **P2-3** `flaky_detector` runtime trigger (worker/cron) (`flaky_detector.py:32-34`).
- **P2-4** Litmus supported connector via MQTT egress — only after P1-2, and only with a real license/customer pull (`litmus_supported_connector_plan.md`).
- **P2-5** Wiring-print reader → grounded citations from E-005/E-007 in answers (today prints are narrative only; truth table row 13).
- **P2-6** Hub "Connect live data" affordance (replace the CLI/manual relay provisioning seam; `GARAGE_CONVEYOR_ONBOARDING.md` Part A 🟡).
- **P2-7** Retire the demo-shim upload route (`api/documents/upload`) or make it delegate to the real pipeline (trap documented in its own docstring).

### P3 — later / opportunistic

- OPC UA (nothing exists; arrives naturally via Sparkplug-speaking gateways).
- External-AI (ChatGPT) MCP productization — park until the core loop closes.
- Flight-recorder black-box PRD build-out (EPIC #2341) beyond the P0-5 event store it shares.
- Ignition Exchange listing polish (`mira-ignition-exchange/`).
- Mechanical-anomaly experiment v1 (webcam/belt-tracking, issue #2393) beyond the reflash.

---

## 6. Demo script for a novice human operator

Two tiers: **Tier 1 runs today, deterministically, anywhere.** Tier 2 is the live-bench stretch (requires bench LAN + reflash/WebDev items above).

### Tier 1 — "The grounded conveyor diagnosis" (works today, ~8 min, no hardware required)

1. Open a terminal in the repo. Say: *"This is a real conveyor's approved context model — a human signed every signal mapping."* Show `plc/conv_simple_anomaly/context_model.cv101.json` (point at `approved_by`, and at the `unmapped` list: "MIRA knows what it does NOT know").
2. Run the healthy replay: `python plc/litmus/demo_context_model.py --source replay --fixture cv101_idle_healthy`. Read the verdict aloud (healthy, DC bus ~320 V, evidence table).
3. Run the fault replay: `... --fixture cv101_comm_down`. Point at: A1 CRITICAL comm-down, the trust-gate ("VFD values stale — not trusted"), the **"What MIRA will NOT claim"** refusal block.
4. Run the 14-scenario battery: `python plc/conv_simple_anomaly/anomaly_log.py` — every rule fires with a named next check. Say: *"Twelve failure modes, each with 'what to check next' — this is the machine card, executable."*
5. Switch to app.factorylm.com: sign in, open the CV-101 asset, upload/point at the GS10 manual, ask **"What does GS10 fault code oL mean and what should I check?"** — show the cited answer with source chips.
6. Show `/proposals` and the train→approve tab: *"Nothing MIRA relies on got here without a human approving it."*

*(If the bench is present, insert after step 4: pull the e-stop → run `python plc/conv_simple_anomaly/live_check.py --host 192.168.1.100` → A3 fires on the real machine.)*

### Tier 2 — the target demo (after P0-4/P0-5/P1-3)

Real conveyor running → visitor unplugs the RS-485 cable → within seconds the Hub tile goes red with "A1 COMM_STALE — check the RS-485 connector at TB-3 (print E-007)" → tap Ask MIRA on the Perspective panel → cited answer → tap "Create work order" → work order appears in the CMMS. That is the sellable 3 minutes.

---

## 7. PRD-style roadmap — build tickets

**Phase 1 — Land & close the loop (P0s)**
- **T1** chore: commit/split/merge the untracked work on `feat/litmus-bench-proof` (difference-engine demo + fault dictionary + tests; external-AI MCP; wiring_diagram; parser evals; docs). Decide land-vs-park per piece. (P0-1)
- **T2** feat(hub): "Add equipment" wizard step (creates `cmms_equipment` + kg entity under the line). (P0-2)
- **T3** feat(hub): replace mock TagImportStep with the real `/plc-import` flow inline (upload L5X/CSV → proposals → approve within the wizard). (P0-2)
- **T4** feat(hub): default-on `MIRA_ENFORCE_APPROVED_RETRIEVAL` behind a staging eval gate; per-tenant override. (P0-3)
- **T5** ops/feat(ignition): bench gateway tag-stream → relay with HMAC; first physical row in `tag_events`; evidence screenshot to `docs/promo-screenshots/`. (P0-4)
- **T6** feat(relay): migration `machine_events` + detection worker (A0–A12 + tag_diff grouping over `tag_events`) + Hub anomaly tile + ntfy/Telegram notification. (P0-5)

**Phase 2 — Sellable (P1s)**
- **T7** feat: "Create work order" action on a persisted machine event → `cmms_create_work_order` + `wo_outbox`. 
- **T8** feat(relay): Sparkplug end-to-end proof vs live broker; enable profile; docs correction in the gap register.
- **T9** ops(ignition): WebDev install or Perspective project-script panel deploy + screenshot (CRA-245).
- **T10** bench: slave-map-v2 reflash (human, `plc-ccw-deploy`); then record the live fault-injection battery (A1/A3/A4 + unlocked A2/A7/A8).
- **T11** fix: unify `conveyor_events`/`faults` on the `machine_events` store; repoint `/api/faults/active`.
- **T12** feat: fault-dictionary join to `fault_codes`/`recall_fault_code` — live decode cites manual page.

**Phase 3 — Moat (P2s)**: T13 baselines table + learner worker; T14 `machine_event_id` on AskRequest; T15 flaky-detector cron; T16 Hub "Connect live data" page; T17 Litmus MQTT-egress connector (license-gated); T18 wiring-print reader grounding.

---

## 8. What We Should Stop Building

1. **Litmus internal-API reverse engineering.** The `:8094` UUID-apiKey hop is undocumented, container-internal, and resets every 2 hours on the dev license. The decision doc already concluded the demo doesn't depend on it (`litmus_mira_demo_decision.md`). The supported path is MQTT egress (P2-4), *if* a customer pulls for it. Stop poking the internal API.
2. **New demo aliases and parallel demo narratives.** CV-101 garage, Northwind/CV-200 (an alias over SimLab that "does not exist" per its own README), Cappy Hour, ProveIt difference-engine demo, weekend interlock demo — five overlapping stories. Pick ONE canonical demo (the CV-101 bench + Tier 1/Tier 2 script above) and freeze the rest as fixtures.
3. **Direct-Modbus customer paths.** `plc/live-plc-bridge` and `mira-connect` Modbus are bench-only/deferred by our own architecture (`.claude/rules/fieldbus-readonly.md`, ADR-0021). Don't revive them; customer telemetry arrives via Ignition/Sparkplug.
4. **Factory I/O and OpenPLC integrations.** Explicitly "Not Built" / parser-corpus-only; the headless SimLab already covers the simulation need. No demo value the bench doesn't already provide.
5. **External-AI (ChatGPT) connector polish — for now.** It's a clever distribution idea, but it exposes *static* approved context while the core live loop is still cut. Land the code (P0-1) then park until Phase 2 is done.
6. **New electrical print sheets beyond demo needs.** E-005/E-007 exist and support the narrative; more sheets add nothing until the print *reader* path (P2-5) lets answers cite them.
7. **New anomaly rules.** Twelve rules with 2 reflash-gated is plenty; the constraint is deployment (live wiring + persistence), not rule count.
8. **Promo/video branch churn** (~40 `chore/promo-director-refresh-*` branches) — freeze until there is one canonical demo to film.

---

## 9. Final recommendation

**What this product is:** FactoryLM Command Center + MIRA — a maintenance-context platform where a factory connects equipment (Ignition/Sparkplug → one canonical pipeline), maps tags (PLC-export import → human-approved proposals), attaches evidence (manuals, prints, fault tables), approves context (train-before-deploy gate), and gets maintenance outcomes (persisted machine events with likely cause + next check, grounded cited chat that refuses what it can't prove, one-click work orders).

**Who it's for:** the maintenance manager at a small/mid manufacturer running Ignition (or any Sparkplug-B edge), whose techs burn hours decoding cryptic VFD faults against paper manuals and tribal memory.

**What demo proves it:** the CV-101 bench. Today: Tier 1 (replay + Hub cited answer + refusal block) is honest and runs anywhere. The sellable version: pull a cable on a real conveyor → red Hub tile with named cause + next check + print reference → cited Ask-MIRA answer → work order. Every component of that 3-minute arc exists; none of it is connected.

**What must be built next (in order):** (1) land the untracked branch work; (2) fix the onboarding wizard's missing middle (add-equipment + real tag import); (3) turn the grounding gate on by default; (4) put the first physical tag row in `tag_events` via the Ignition tag stream; (5) persist detections in a `machine_events` store with a continuous rules worker; (6) hang the work-order button off it. That is ~6 tickets, most of them small, and they convert four months of proofs into one product.

---

## 10. Appendix — NeonDB ground truth (read-only `db-inspect.yml`, 2026-07-03)

Ran the sanctioned read-only inspect against **prod** (run 28666022597) and **staging** (run 28666024200). The database is a numeric photograph of the sweep's verdict — *real at both ends, cut in the middle*:

| Table | PROD | STAGING | Reading |
|---|---|---|---|
| `knowledge_entries` (KB) | **83,629** | 83,798 | The library is real at scale. But vs the 2026-06-09 verified baseline of 83,553 (`docs/xprize/2026-06-09-1841-schema-drift-resolution.md`), prod grew only **~76 chunks in 24 days** — the upload door is open (beta gate met) and almost nobody is walking through it. |
| `kg_entities` | 1,633 (29 NULL `uns_path`) | 655 (39 NULL) | A namespace skeleton. 29 prod entities violate UNS compliance (no path). Prod has 2.5× staging's entities — entity creation has been happening on prod directly (demo/seed/secret-shopper), inverting the dev→staging→prod promotion doctrine. |
| `kg_relationships` | **308** | 309 | The "intelligence graph" barely exists. **269 of 308 (87%) are `has_manual`** attachment edges from ingest. The edges the product narrative *is* — the sensor→wire→tag→rung→fault→asset chain (issue #1258) — are single-digit demo seeds: `CAUSES`=1, `WIRED_TO`=1, `TRIGGERS`=1, `CONTROLS`=1, `MAPS_TO`=1, `POWERED_BY`=1, `DRIVES`=2, `USED_IN_LOGIC`=2, `has_fault_code`=5, `has_work_order`=1. All sampled rows belong to the single system tenant (`78917b56-…`), `properties={}`, `confidence=1`. |
| `tag_events` (live telemetry) | **28 rows — total, ever** | 89 | The flight recorder is empty. This is the sweep's central claim (truth-table row 10, broken link 1) in one number: the continuous historian that the difference engine, baselines, fault intelligence, and live diagnosis all depend on has effectively never received data. |
| `approved_tags` (allowlist) | 227 | 158 | The approval scaffolding IS seeded and ready — 227 tags approved and waiting for a stream that never comes. The gate works; the pipe is dry. |

**KB:KG ratio: ~271 knowledge chunks per relationship edge; ~7,000 chunks per causal edge.** The system today is a *library with a card catalog stub*, not yet a knowledge graph. The maintenance-intelligence claim rests on the KG being the connective layer between documents and live signals — the DB shows that layer is the emptiest part of the whole stack, emptier even than live ingest relative to its scaffolding.

**Corrections/refinements to §5 from the DB:**

1. **P0-5 should build on migration `038_machine_runs.sql`, not a new table.** The run-centric persistence layer (`machine_run` / `run_step` / `run_baseline` / `run_diff`, issue #2341, append-only with GRANT discipline) is already authored — the sweep's "no anomaly persistence" is about *writers*, not schema. The missing piece is the worker that populates it (and the A0–A12 event store can be the same family). Verify 038 is applied to prod before building (`db-inspect` doesn't currently probe it).
2. **New data-hygiene findings** (add to P1): `relationship_type` case/name drift in prod (`has_component` AND `HAS_COMPONENT`; staging has `LOCATED_IN` AND `located_at`) — the enum-drift check the enforcement layer was built for; 29 prod / 39 staging `kg_entities` with NULL `uns_path` (UNS-compliance violations); prod↔staging KG entity drift (1,633 vs 655) shows environments are diverging by hand-seeding.
3. **The `db-inspect.yml` #1899b tenants-FK probe is broken** — `ERROR: operator does not exist: uuid = text` on the `orphan_hub_tenants` query (tenants.id vs hub_tenants.id type mismatch). The orphan-signup check has been silently not running. Small fix: cast in the workflow query.
4. **Grants are healthy** (no drift): `knowledge_entries` = INSERT,SELECT for `factorylm_app` (mig 049 landed); kg/proposals tables fully granted; `tag_events` schema matches canonical 033 (14 cols incl. `simulated`, `source_system`).

**What this means for the roadmap:** the DB confirms the build order in §9 and sharpens it — every P0 is ultimately in service of making three numbers move: `tag_events` (28 → thousands/day, via T5), a detection/event store (0 → every bench fault, via T6 on top of mig 038), and non-`has_manual` KG edges (~39 → hundreds, via the proposals pipeline once live evidence exists to propose from). Those three numbers ARE the maintenance-intelligence system; everything else in the stack is already waiting on them.

---

*Compiled from 5 parallel read-only research agents + a NeonDB `db-inspect.yml` prod/staging probe, 2026-07-03. Negative searches recorded inline (OPC UA/Kepware/HighByte: docs only; Factory I/O/OpenPLC: no integration; anomaly→work-order caller: none; conveyor row in `tag_events`: none found).*

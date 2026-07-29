# Diagnostic Reasoning / Fault Trees / Troubleshooting / Safety / Eval — Discovery Report

Repo: `C:/Users/hharp/Documents/GitHub/MIRA`. Sibling repos (`RideView`, `mira-cappy-factory`, `mira-events`, `mira-flightsim`, `mira-gui`, `mira-uns`, `mira-why`, `proveit-factory`) were not found to contain matching domain code — all relevant work lives in `MIRA`.

## 1. Diagnosis engine core

| Component | Path | What it does | Status |
|---|---|---|---|
| **FSM / turn engine** | `mira-bots/shared/engine.py` (5,951 lines) | Central conversation engine: intent routing (LLM router `route_intent` + keyword classifier `classify_intent` fallback), FSM states (IDLE/Q1/Q2/Q3/DIAGNOSIS/AWAITING_UNS_CONFIRMATION/etc.), quality gate (`_apply_quality_gate`, L1553), diagnostic dispatch. | Production, actively maintained (last commit `c0124700`, #2391) |
| **SAFETY_ALERT path** | `engine.py` L2065-2076, L4757 | "Safety ALWAYS wins" — router (`safety_concern`) OR keyword classifier (`safety`) triggers immediate STOP reply + `push_safety_alert()`, short-circuits all other routing. Both call sites return `_make_result(reply, "high", trace_id, "SAFETY_ALERT")`. | Production |
| **UNS location-confirmation gate** | `engine.py` L5703-5751+ `_should_fire_uns_gate` | Non-negotiable: no diagnosis without a confirmed asset. Fires when router intent in `_GATED_INTENTS`, no `asset_identified`, session IDLE. Carve-out: `source="direct_connection"` (Ignition/MQTT/Sparkplug/PLC bridge/Hub/QR) never interrupted. Refs `.claude/rules/direct-connection-uns-certified.md`. | Production |
| **Inference router/cascade** | `mira-bots/shared/inference/router.py`, `class InferenceRouter` (L192) | Cascades Groq → Cerebras → Together. LLM backbone for diagnostic replies. | Production |

Verdict: **reuse** — live, heavily-tested product core. No duplication found.

## 2. Guardrails / safety keywords

| Component | Path | What it does |
|---|---|---|
| `SAFETY_KEYWORDS` | `mira-bots/shared/guardrails.py` L11-72 | Broad list (LOTO, arc flash, hot work, live-wire phrasing, isolate/pull/cut/disconnect power) — routes to RAG/educational unless paired with immediate-hazard signal. |
| `SAFETY_KEYWORDS_IMMEDIATE` | `guardrails.py` L77-100+ | Frozenset of observed-hazard phrases — bypasses educational carve-out, forces STOP+escalate ("what is arc flash" → RAG; "exposed wire" → STOP). |
| Usage | `guardrails.py` L826-832 | immediate check first, then broad list with educational carve-out. |

1,080 lines, incident-driven hardening trail (v2.4.1, Karpathy loop 2026-04-19, BUG-FORENSIC-003). Verdict: **reuse**, do not fork.

## 3. Deterministic fault dictionary / fault trees / troubleshooting formats

Most active area of new work (see `docs/RESUME_2026-07-01_fault-intelligence.md`).

| Component | Path | What it does | Status |
|---|---|---|---|
| **Discovery/plan doc** | `docs/discovery/fault_intelligence_from_flight_recorder_plan.md` | Inventory of exists-vs-missing. §2 "What should NOT be rebuilt": GS10 dictionary, `fault_codes` table, difference engine, decision_traces, review queue, Flight Recorder Report, SimLab manuals. | Planning doc; Options A/B/C now built |
| **Fault Dictionary Extractor (A)** | `demo/factory_difference_engine/fault_dictionary.py` | Deterministic offline parser of `simlab/docs/<asset>/fault_code_table.md` (11 assets, 53 codes) → structured fault entries with cited_source, referenced_tags, confidence, missing_evidence; `lookup_fault(code, asset)`. No DB/UI/LLM. | Built (`9de9dc3a`), tested |
| **Fault→Bundle join (B)** | `demo/factory_difference_engine/fault_bundle.py::build_fault_bundle()` | Joins fault code to `run_pipeline()` result: corroborated/uncorroborated/no_referenced_tags/fault_not_found, baseline-vs-current per tag, cited sources, missing_evidence, `review_state="pending"`. Fails safe. Pure/deterministic/offline. | Built (`81cf90d3`), tested |
| **Fault Report (C)** | `demo/factory_difference_engine/fault_report.py` | Renders bundle as "Fault observed → meaning → what changed → evidence → check first → what's missing → review" report incl. `--html`. | Built (`7b109bdd`), tested |
| **Flight Recorder Report** | `demo/factory_difference_engine/flight_report.py` | Static readout: what changed → why → evidence → check → learn. | Built, intentionally uncommitted per resume doc |
| **Real-conveyor GS10 fault dictionary** | `plc/conv_simple_anomaly/rules_core.py::GS10_FAULT_CODES` (L76) + `_GS10_CRITICAL` (L95, 21 codes) | ~50 real GS10 fault codes → meaning, decodes `vfd/vfd101/fault_code`. Gold-standard real-hardware dictionary; NOT yet folded into `fault_dictionary.py`. | Production (real bench) |
| **Production fault-code lookup** | `docs/migrations/002_fault_codes.sql` + `mira-bots/shared/neon_recall.py::recall_fault_code` (L323) / `_extract_fault_codes` (L276) | DB-backed fault code recall in live bot RAG path — separate from offline SimLab dictionary. | Production |
| **Manual fault tables** | `simlab/docs/<asset>/fault_code_table.md` (11 assets) | Code|Label|Severity|Description|Likely Cause|Recommended Action, backtick-tagged to UNS tags. | Reference data |

Tests: `tests/simlab/test_fault_dictionary.py`, `test_fault_bundle.py`, `test_fault_report.py`, `test_flight_report.py`, `test_proveit_demo.py` — 29 pass (verified).

**Known gap:** GS10_FAULT_CODES not folded into fault_dictionary.py; sim data-poor for VFD/electrical signals (torque%, DC bus, drive temp absent) — `docs/discovery/proveit_2026_factory_data_richness_audit.md` has the full gap audit.

Verdict: **reuse/extend** — do not rebuild A/B/C.

## 4. SimLab platform oracle / CI grader gate

| Component | Path | What it does | Status |
|---|---|---|---|
| **CI merge gate** | `.github/workflows/ci.yml` job `simlab-gate` + `tests/simlab/test_grader_gate.py` | Commit `b463c97e`. Scenarios A–F: at fault-manifested tick `assemble_evidence()` must surface right asset + abnormal tags + candidate docs; ground-truth reply must pass `grade()` (root_cause_hit, asset_hit, evidence_recall ≥ 0.5). Replay-identity guard (advance(60)==60×advance(1), seed 42). Blocks merge. Fully offline. | Production, merge-blocking |
| **Grader/oracle internals** | `simlab/diagnostic.py` (`assemble_evidence`, `grade`, 271 lines); `simlab/evaluation.py` (400 lines); `simlab/approval.py` (256); `simlab/{engine,scenarios,packml,mutation,publishers,uns,api}.py`, `simlab/lines/juice_bottling.py` | Ground-truth simulation engine + rubric grader. Deterministic, seeded, replay-identical. | Production |
| Related tests | `tests/simlab/test_{evaluation,mutation,dashboard,difference_engine,ingest_contract,cross_surface_conformance,runner_tenant,live_publish,juice_bottling,publishers,relay_ingest_e2e,approved_tags_seed,parser_simlab_arc}.py` | Broad regression coverage. | Production |

Verdict: **reuse** — compose `assemble_evidence`/`grade`, don't reimplement.

## 5. Factory Difference Engine (Connect→Pick→Prove→Explain→Learn)

| Component | Path | Status |
|---|---|---|
| **Pipeline** | `demo/factory_difference_engine/pipeline.py` — `run_pipeline()`, deterministic 5-stage over SimLab data; "Northwind Bottling / CV-200" = alias over filler01, seed 42 | Built (branch `feat/proveit-difference-engine-demo`, `e06fe1ba`) |
| CLI/report | `demo/factory_difference_engine/__main__.py`, `README.md`, `--html` | Built |
| Underlying diff detectors | `plc/conv_simple_anomaly/{difference_detectors,baseline_learner,event_context}.py` | Production (main, `2a7af723`, VERSION 3.53.3) |
| Tests | `tests/simlab/test_proveit_demo.py`, `test_difference_engine.py` | Passing |

Verdict: **reuse** — this IS the Factory Difference Engine; fault_bundle/report compose it, no duplicate.

## 6. Eval/benchmark harnesses

| Component | Path | What it does |
|---|---|---|
| `deepeval_suite.py` | `mira-bots/benchmarks/deepeval_suite.py` | DeepEval LLM-judge benchmark (Groq llama-3.3-70b), 4 categories × 5 metrics, 20 cases; offline (CI) + live modes. Complements `benchmark_suite.py` (keyword-check). |
| Golden CSVs | `tests/golden_gs11_conveyor.csv`, `golden_hybrid.csv`, `golden_staging_benchmark_2026-05-20/21.csv`, `golden_factorylm.csv` | Golden-answer regression sets (GS11 grounding suite mandatory pre-push for retrieval edits). |
| SimLab grader | `simlab/diagnostic.py::grade()` | Deterministic no-LLM rubric — complementary to deepeval. |
| Confidence scoring (bot) | threaded through `engine.py` `_make_result(reply, "high"/...)` + `neon_recall.py`; numeric confidence in fault_dictionary/bundle + external-AI SDK | Scattered, not centralized. |
| Hallucination audit | skill `mira-run-hallucination-audit` only — no standalone script located | Needs verification |
| Drive-pack grader (#2505) / print-translator benchmark | not located by this agent (see drive-pack + print/wiring discovery reports — they exist on origin/main) | Covered by other agents |

## 7. `mira-mcp/factorylm_external_ai/` — external AI verification stack (untracked, new)

| Component | Path | What it does | Status |
|---|---|---|---|
| `conveyor_context.py` (432 lines) | SDK | `ConveyorContextSDK` — read-only, approved-only context for garage conveyor demo asset (`enterprise.home_garage.conveyor_lab.conveyor_1`, GS10 + Micro820 + Banner photoeye). Hardcoded demo data: asset, related assets (confidence), tags, evidence docs (`golden://garage_conveyor/*.md`), 2 named diagnostic hypotheses (`conveyor:not_running`, `conveyor:photoeye_blocked`) each with likely_causes/next_checks/citation_ids/confidence. LOTO safety tie-in in next_checks. | Experimental/demo (static fixture data) |
| `api_adapter.py` | read-only HTTP routes: /health, assets/search, context, tags, tag context, evidence, diagnostics, live/{tag}, status | Experimental |
| `mcp_server.py` | FastMCP, 9 read-only tools with READ_ONLY_ANNOTATIONS, streamable-http :8012 | Experimental, blocked on `fastmcp` dep |
| Verification harness | `scripts/verify_factorylm_external_ai_stack.py` (541 lines) — anti-fake checks, writes `docs/external-ai/verification-report.md` | Last run FAIL only on `mcp_server_runtime` (fastmcp not installed); SDK/API/metadata/e2e PASSED |
| Tests | `mira-mcp/tests/test_factorylm_external_ai.py` (8), `test_factorylm_external_ai_verification.py` (4) | 12 meaningful safety/grounding assertions |
| Docs | `docs/external-ai/{chatgpt-conveyor-connector-*,customer-enterprise-connector-backlog}.md` | Docs only, untracked |

No duplicate MCP server. **Convergence flag:** its hand-authored diagnostics are a THIRD "fault→causes→checks→confidence" shape (vs SimLab ground truth and Fault Dictionary/Bundle) with no shared schema. Wire it to read from the canonical dictionary before extending.

## 8. Audit logs / approval flows / decision traces

| Component | Path | Status |
|---|---|---|
| `decision_traces` | migrations 032/055 + `event_context.py` | Production (per plan doc) |
| Review queue / ADR-0017 | `proposal_transition.py`, `review-queue.tsx`, `/decide` routes, `ai_suggestions` (mig 027), `kg_*.approval_state` | Production (not independently verified this pass) |
| `simlab/approval.py` | SimLab-side approval logic (distinct from production KG review queue) | Test infra |

## Summary — duplicates flagged

1. **Diagnostic hypothesis format fragmentation**: SimLab scenario ground truth / Fault Dictionary+Bundle / external-AI SDK static diagnostics = three independent "fault → likely causes → checks → confidence" shapes, no shared schema. Converge on Fault Dictionary/Bundle.
2. **GS10_FAULT_CODES not folded into fault_dictionary.py** — two fault-code sources, no join yet.
3. **Two eval mechanisms** (deepeval LLM-judge vs SimLab deterministic rubric) — intentionally complementary, not duplicative.

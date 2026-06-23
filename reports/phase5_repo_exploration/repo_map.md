# Phase 5 — Repo Map (existing FactoryLM / MIRA)

**Read-only exploration, 2026-06-23. Branch `feat/cappy-northstar-factory`.** Paths relative to the MIRA repo root. Migration head **056**; mira-hub package `2.17.2`.

## Major packages / apps

| Area | Path | Stack | Role |
|---|---|---|---|
| **Hub (frontend + API)** | `mira-hub/` | Next.js App Router, Bun, vitest, Playwright, Neon | The Command Center: contextualization, proposals/approval, asset views, Ask-MIRA demo surfaces. **System of record (ADR-0023).** |
| **Engine (the brain)** | `mira-bots/shared/engine.py` | Python, asyncio | `Supervisor` — UNS gate, FSM, RAG grounding, citation enforcement, decision traces. One brain, many adapters. |
| **Bot adapters** | `mira-bots/{telegram,slack}/`, `mira-bots/ask_api/` (kiosk) | Python | Thin fronts over `engine.process()`. |
| **Pipeline (OpenAI-compat + Ignition)** | `mira-pipeline/` | FastAPI | `main.py` (OpenAI-compat), **`ignition_chat.py`** (`/api/v1/ignition/chat` — the integrated direct-connection door). |
| **Ingest / RAG** | `mira-core/mira-ingest/`, `mira-crawler/ingest/` | Python | PDF/manual chunking → `knowledge_entries`; `mira-crawler/ingest/uns.py` (UNS builders). |
| **MCP server** | `mira-mcp/server.py` | FastMCP | NeonDB recall + CMMS tools (`get_fault_history`, `cmms_*`). |
| **CMMS (Atlas)** | `mira-cmms/` | — | work orders, PM, asset registry (history/corrective actions). |
| **Relay** | `mira-relay/` | FastAPI | Ignition factory→cloud tag streaming — **HTTP/WS only, NO MQTT**; writes `live_signal_cache`/`tag_events`. |
| **Bridge** | `mira-bridge/` | Node-RED + mosquitto | bench MQTT broker + routing. |
| **SimLab** | `simlab/` | Python | deterministic juice-bottling benchmark (separate from the Phase-1 `factory_context` model). |
| **Ignition / HMI** | `ignition/`, `plc/ignition-project/ConvSimpleLive/` | Perspective `view.json`, Jython/WebDev, project scripts | Ask-MIRA HMI (MaintenancePanel/MiraAsk/AnomalyCard), in-gateway diagnose. |
| **PLC / bench** | `plc/` | Python, CCW/ST | `conv_simple_anomaly` (in-gateway rules), `live-plc-bridge`/`live_monitor` (BENCH-ONLY), `discover.py` (read-only). |

## Database / migrations

- **`mira-hub/db/migrations/`** (head 056) — Hub system-of-record schema. Key tables: `kg_entities`/`kg_relationships` (mig 001, `approval_state`, `uns_path ltree`), `relationship_proposals`+`relationship_evidence` (018), `ai_suggestions` (027, the proposal queue), `tag_entities` (025, signals), `component_templates` (016), `knowledge_entries` (001 + 045 chunk anchors), `decision_traces` (032) + `decision_trace_feedback` (055), `contextualization_projects`/`ctx_sources`/`ctx_extractions`/`ctx_import_batches` (055/056), `display_endpoints` (030), `health_scores`/`wizard_progress`/`namespace_versions` (021).
- `docs/migrations/` — older/engine-side variants (e.g. `004_kg_entities.sql` TEXT+embedding, **not** the deployed shape).
- **tenant_id split:** CMMS/equipment family = TEXT; kg/Hub/ctx family = UUID. Only UUID tenants authenticate.

## Ingestion / contextualization

- **Two ingestion families** converge on the approval queue:
  - **(A) Contextualization project** — `/api/contextualization/{route,[id]/sources,import,[id]/promote,batches/[id]/review}` → `ctx_*` → `kg_entities` verified on batch publish. The `import` route comment says **"P5 migrates the offline client onto the contract."**
  - **(B) Direct PLC connector** — `/api/connectors/plc/import` → `plc-proposals.ts` → `ai_suggestions` → `suggestion-accept.ts` → `kg_entities`/`tag_entities`.
- Manual/PDF ingest → `knowledge_entries` (BM25 `content_tsv` + `embedding vector(768)`).

## Ask MIRA / explanation surfaces

- Engine: `engine.py` `process_full` → `_make_result` → `_evidence_from_parsed` → citation enforce → `_schedule_decision_trace` → `decision_trace.build_trace_row` → `decision_traces`.
- Doors: `mira-pipeline/ignition_chat.py` (Ignition, answer-card envelope — fields empty today), Hub `/api/mira/ask` (typed `[Cn]` citations + `trend_proposal`), kiosk `ask_api`, Slack/Telegram.
- UI: `WhyMiraThinksThis.tsx` (the answer-card skeleton) + `/api/decision-trace/[id]`.

## Ignition / HMI / PLC

- **Perspective HMI:** `plc/ignition-project/ConvSimpleLive/.../views/{MaintenancePanel,MiraAsk,AnomalyCard,Conveyor}/view.json` (BUILT). Ask MIRA button → MiraAsk popup → **currently POSTs bench `/ask`**, should target `/api/v1/ignition/chat`.
- **In-gateway diagnose:** `plc/conv_simple_anomaly/rules_core.py` + `mira_diagnose/code.py` (project-script, **no WebDev needed**) + vendored `ignition/webdev/FactoryLM/api/diagnose/` (404 on bench — WebDev not installed).
- **Demo:** `mira-hub/(hub)/command-center`, `mira-hub/demo/conveyor/[tag]`.

## CI / gates (full detail in the first-PR report)

`.github/workflows/`: `ci.yml` (Migration Order, Lint/ruff/pyright, Unit Tests, Architecture, **SimLab Grader Gate**, Eval Offline, Docker), `migration-verify.yml` (staging Neon, on `db/migrations/**`), `staging-gate.yml`, `smoke-test.yml`, `hub-e2e.yml` (the phantom required check → `--admin`), `version-gate.yml`, `kg-write-guard.yml`, `proposal-state-canary.yml`.

## The one-line shape

**FactoryLM is a mature, Hub-of-record platform with a single engine, a single proposal queue, a contextualization intake stack, an answer-card UI skeleton, and a built (but un-rewired) Ask-MIRA HMI.** The Phase 0–4 spine is a standalone codebase that re-proves capabilities this platform already has homes for — so Phase 5 is wiring, not building.

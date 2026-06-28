# MIRA Workflow Durability Audit

**Date:** 2026-06-06
**Author:** Claude Code (CHARLIE), commissioned by Mike Harper
**Method:** 10 parallel CodeGraph + file-read investigators, one per surface. Every verdict carries `file:line` evidence. No guessing — "no evidence found" where applicable.
**Framework:** "Durable workflow vs fragile feature" — every major function should be *a machine with a dashboard, not a hidden code path.*
**Audited ref:** `origin/main` @ `62b31feb`; working tree at `8f25bb3c` (3 commits behind origin/main — the 3 are a Hub UI fix, a CI string-match fix, and migration 043 [relationship *types*], none of which create run-record tables, so the negative findings below were re-confirmed against `origin/main`). **Negative findings (`kg_ingest_runs`, `connector_runs`, `cmms_sync_runs`, `eval_runs`, `prospect_runs`, `workflow_runs`, `ingest_batches`) verified absent on `origin/main`, not just the local tree.**
**Concurrent-writer caveat:** this is a shared checkout; HEAD and the working tree move under active peer sessions. One surface (#10 Self-Healer) was caught mid-edit — see its note. Where a claim depends on uncommitted state, it is labeled as such.

---

## The 10-point durability framework

A surface is a **durable workflow** (not a fragile feature) when:

1. **Name** — the action has a workflow name, not just a call-chain
2. **Version** — the workflow is versioned
3. **Run record** — every run gets a database record
4. **Run fields** — every run records input, output, status, timestamps, error details
5. **Step artifacts** — every step saves its intermediate output
6. **Retry rules** — bounded retry with backoff
7. **Idempotent** — re-running does not double-write or diverge
8. **Golden fixtures** — known-good test cases catch regressions
9. **Status view** — a simple status view exists in the app
10. **Smoke test** — an automated check runs regularly and proves the path works end-to-end

---

## Executive summary

**Bottom line: MIRA has zero durable workflows. All 10 audited surfaces are fragile features.** Average score **4.95/10**. The product is built as a constellation of fire-and-forget async closures and cron scripts that log to stdout, persist state in flat files or last-write-wins rows, and surface "status" through hardcoded mock data and `/health` liveness pings that prove a container is alive but never that it can do its job.

Three surfaces are **actively, silently broken in production right now** — and the existing observability could not see it:

| 🔴 Live failure | Surface | Evidence |
|---|---|---|
| **HubSpot push has been 0 across every recorded run** | Lead Discovery | `hs_pushed=0` across **all 1,096 runs** in the local CHARLIE run log; every alert logs `HUBSPOT_ACCESS_TOKEN: false`. 3 leads qualified this morning, pushed to nothing. Alerting into a JSONL file no one reads. *(Confirm the prod runner location for `com.mira.lead-hunter` before treating "~6 weeks in production" as fact — the run log audited is local.)* |
| **2-hourly bot QA has never actually run** | Adversarial Review / QA | Every `qa-regression.yml` run exits in ~12s with `TELEGRAM_TEST_SESSION_B64 not set`. The schedule fires into the void; baseline `qa_regression_baseline.json` is `seeded: false`. Green checks, zero signal. |
| **Self-healer cannot fix the incident it was built for** *(fix in flight)* | Self-Healer | On **committed `origin/main`** the 2026-06-04 `container_missing` → `docker restart` gap persists (`self_healer.py:188` routes `container_missing` → `restart_container`, which returns "No such container" for a *removed* container). **An uncommitted working-tree fix exists** (`recreate_container` + `_compose_up` via `docker compose up -d --no-deps`, routing wired at `self_healer.py:272`) but is in **no commit on any branch**, untested, and unmerged. The production code still has the gap until that lands. |

These three are not architecture problems. They are **the predictable consequence of having no run records, no status views, and no real smoke tests** — exactly the framework's missing criteria. A fragile feature fails silently; a durable workflow can't, because something is always watching the run record.

### Scorecard

| # | Surface | Score | Verdict | Biggest gap | Feasibility | Best tool |
|---|---|---|---|---|---|---|
| 1 | PDF/Manual Ingest | **5/10** | Fragile | No step artifacts + fire-and-forget exec; smoke only pings `/health` | MEDIUM | Trigger.dev |
| 2 | Knowledge Graph Building | **5/10** | Fragile | No durable per-run record; standalone TS worker exits silently on failure | MEDIUM | Celery |
| 3 | Diagnostic Engine (Ask MIRA) | **6/10** | Fragile | `decision_traces.session_id` & `model_used` always NULL; UI is mock data | MEDIUM | (none — async is right) |
| 4 | CMMS Sync / Work Orders | **6/10** | Fragile | No sync-run log; every tick evaporates to stdout | MEDIUM | Bun ticks + DB record |
| 5 | Tag Ingestion | **4/10** | Fragile | No batch record; non-idempotent; absent from CI; mostly on unmerged branch | EASY–MEDIUM | asyncio task in relay |
| 6 | Connector Framework | **4.5/10** | Fragile | `SyncResult` computed then garbage-collected; import side double-writes | MEDIUM | Celery |
| 7 | Document Upload → Retrieval | **4/10** | Fragile | Uploads hit OW only, never `knowledge_entries` → **not citable in chat**; status is misleading | HARD | Celery / Trigger.dev |
| 8 | Adversarial Review / QA | **5/10** | Fragile | Scheduled bot QA silently no-ops; no queryable run history | EASY–MEDIUM | GitHub Actions + NeonDB |
| 9 | Lead Discovery / HubSpot | **6/10** | Fragile | HubSpot delivery broken 1,096 runs; no status view, no canary | MEDIUM | launchd + DB + canary |
| 10 | Self-Healer / VPS Health | **4/10** | Fragile | Cannot recreate a removed container; zero tests; no dashboard | EASY | cron + fill the gap |

---

## Cross-cutting patterns (the systemic gaps)

Tallying all 100 cells (10 surfaces × 10 criteria) reveals where MIRA is *structurally* weak — these are the gaps to fix once, platform-wide, instead of ten times:

| Criterion | YES | PARTIAL | NO | Read |
|---|---|---|---|---|
| 1. Name | 6 | 4 | 0 | ✅ Strongest. Surfaces are nameable. |
| 2. **Version** | **0** | 2 | 8 | 🔴 **Universal gap. Not a single workflow is versioned.** |
| 3. **Run record** | 2 | 4 | 4 | 🔴 The core durable-workflow primitive is mostly absent. |
| 4. Run fields | 1 | 9 | 0 | 🟡 Data is captured — but **in-memory / stdout, not durably**. |
| 5. Step artifacts | 1 | 6 | 3 | 🟡 Intermediate state is garbage-collected after the call returns. |
| 6. Retry | 3 | 5 | 2 | 🟡 Best-covered "hard" criterion — provider cascades + outbox drains. |
| 7. Idempotent | 4 | 4 | 2 | 🟡 Write-side good (`ON CONFLICT`); **import/append-side double-writes**. |
| 8. Golden fixtures | 2 | 5 | 3 | 🟡 Unit tests exist; true input→output golden fixtures rare. |
| 9. **Status view** | 2 | 4 | 4 | 🔴 And **several "status views" are hardcoded mock data** (see below). |
| 10. **Smoke test** | **0** | 5 | 5 | 🔴 **Not one surface has a real, regularly-running end-to-end smoke.** |

### The five recurring anti-patterns

1. **Fire-and-forget execution.** `void (async () => {…})()` (Hub ingest), standalone `kg-infer-proposals.ts`, cron-piped self-healer. No run envelope, no durability if the process restarts mid-flight. This single pattern is the root of the missing criteria 3, 4, and 5 across most surfaces.

2. **Stdout is the database.** CMMS sync `tick complete in Xms`, connector `SyncResult` logged at INFO then GC'd, KG pipeline `PipelineReport` printed and dropped. The operational record evaporates on container restart. You cannot answer "did the Maximo sync succeed yesterday?" or "when did we last build KG proposals for tenant X?"

3. **`/health` ≠ correctness ("false green").** `install/smoke_test.sh` pings `:8002/health` and the marketing pages — it never uploads a PDF, never drives a bot turn, never posts a tag batch. Every surface's smoke test (where one exists) proves the container is *alive*, not that the *workflow works*. This is precisely how all three live failures stayed invisible.

4. **Mock data masquerading as a status view.** `/integrations` (`CMMS_SYSTEMS` hardcoded array), `/conversations` (`NEXT_PUBLIC_LABS_ENABLED`-gated mock), CMMS page `STATIC_SUMMARY` fallback. The dashboards *exist as pixels* but are not wired to real run data — arguably worse than no dashboard, because they imply observability that isn't there.

5. **Write-side idempotent, append-side not.** Entity/relationship upserts use `ON CONFLICT … DO UPDATE` correctly everywhere. But `tag_events`, `ai_suggestions` (connector import), `interactions`, and `wo_outbox` all append fresh-UUID rows on retry. A network retry silently doubles the data. Idempotency was solved for the KG and forgotten for the streams.

### The one primitive that fixes most of this

**A shared `workflow_runs` table + a thin decorator/wrapper.** Nine of ten surfaces are missing criterion 3 (run record) in whole or part, and criteria 4, 5, 9, and 10 mostly *cascade off* not having it. A single platform primitive —

```
workflow_runs(
  run_id uuid pk, workflow_name text, workflow_version text,
  tenant_id text, status text,                    -- running|ok|degraded|failed
  input jsonb, output jsonb, error_detail text,
  started_at timestamptz, finished_at timestamptz
)
```

— wrapped around each surface's entry point, would lift the whole codebase from "fragile feature" to "observable workflow" without rearchitecting any one surface. The run record makes criterion 9 (status view = `SELECT … ORDER BY started_at`) and criterion 10 (smoke = "assert a success row exists in the last N hours") nearly free. **This is the highest-leverage single change in this audit.**

---

## Per-surface findings

### 1. PDF/Manual Ingest Pipeline — 5/10 — Fragile feature

`mira-core/mira-ingest/`, `mira-crawler/ingest/`

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Name | PARTIAL | `runIngestPipeline` (`mira-hub/src/lib/upload-pipeline.ts:58`), endpoint `/ingest/document-kb` (`mira-ingest/main.py:818`) — a call-chain, no registry entry |
| 2 | Version | NO | No `PIPELINE_VERSION`, no version column on `hub_uploads` |
| 3 | Run record | YES | `createUpload()` inserts `hub_uploads` row at receipt (`uploads.ts:141`); all paths create/reset a row before running |
| 4 | Run fields | PARTIAL | 6-state status enum + `status_detail` + timestamps (`uploads.ts:44-88`); no started/completed split, no step timing |
| 5 | Step artifacts | NO | Extracted text & intermediate chunks never persisted; goes straight to OW |
| 6 | Retry | PARTIAL | Manual `POST /api/uploads/:id/retry` (cloud only); embedder has 3-attempt backoff; **no auto-retry** |
| 7 | Idempotent | PARTIAL | Content-hash dedup + unique index for cloud picks; **local re-uploads create new rows** |
| 8 | Golden fixtures | NO | Unit tests use 1-byte stub PDFs; no real-PDF end-to-end golden |
| 9 | Status view | YES | `UploadSummaryCard.tsx:63` polls every 3s, shows status + counts; `/documents` lists by status |
| 10 | Smoke test | NO | `smoke_test.sh:39` pings `/health` only; no upload round-trip in CI |

**Biggest gap:** No step-artifact persistence + no auto-retry + smoke that only proves liveness. On failure, all that survives is `status="failed"` and a one-line string — no replay, no inspection of what was extracted.
**To close:** version constant (1h); `ingest_artifacts` table for extracted text (MEDIUM); `retry_count` + cron sweep (MEDIUM); one real-PDF golden (EASY); one `curl -F file=@fixture.pdf` smoke (EASY).
**Feasibility:** MEDIUM (run record already exists — gaps are additive).
**Tool:** **Trigger.dev** — replaces the fire-and-forget closure with durable runs + step artifacts + retries natively (note the VPS-OOM caveat on concurrent docling).

### 2. Knowledge Graph Building — 5/10 — Fragile feature

`mira-mcp/server.py`, `mira-crawler/ingest/kg_writer.py`, `mira-hub` proposals API

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Name | PARTIAL | `upsertInferredProposal`, `kg-infer-proposals`, `step_kg` — 4 independent entry points, no shared name |
| 2 | Version | NO | `relationship_proposals.version` exists (`018:80`) but is dead schema, defaulted to 1, never incremented |
| 3 | Run record | NO | No `kg_ingest_runs` table; Celery `AsyncResult` is ephemeral Redis; `kg-infer-proposals.ts` logs to stdout only |
| 4 | Run fields | PARTIAL | `PipelineReport` counts in-memory → stdout; never persisted |
| 5 | Step artifacts | PARTIAL | Final entities/proposals/evidence durable; raw extraction output never stored |
| 6 | Retry | PARTIAL | URL-ingest Celery task has `max_retries=3` backoff; **`kg-infer-proposals.ts` has zero retry, exits 1 on any error** |
| 7 | Idempotent | YES | `ON CONFLICT … DO UPDATE` on entities & relationships; pre-checks existing proposals (`proposals-writer.ts:135-152`) |
| 8 | Golden fixtures | PARTIAL | Strong unit tests for type/direction; no "this PDF → these entities" golden |
| 9 | Status view | YES | `/knowledge/suggestions` page + `GET /api/proposals` + namespace-tree counts |
| 10 | Smoke test | PARTIAL | Nightly `proposal-state-canary.yml` checks state consistency, not extraction correctness |

**Biggest gap:** No durable per-run record. If a nightly run silently writes zero proposals (upstream query changed), there's no alert, no history, no "when did tenant X last get KG proposals?"
**To close:** `kg_ingest_runs` table + wrap the two writers + nightly "success row within 25h" smoke + `GET /api/kg/runs`. ~2–3 days.
**Feasibility:** MEDIUM (lifecycle machinery already solid — pure instrumentation).
**Tool:** **Celery** — migrate the standalone `kg-infer-proposals.ts` into a Python Celery task to inherit task IDs, result backend, retry decorators, beat scheduling (already configured in `celeryconfig.py`).

### 3. Diagnostic Engine (Ask MIRA) — 6/10 — Fragile feature

`mira-bots/shared/engine.py`, `inference/router.py`, `decision_traces`

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Name | PARTIAL | `Supervisor` class (`engine.py:504`); no version stamp per trace |
| 2 | Version | NO | `VERSION` file (`0.5.3`) never written to any row; `decision_traces.model_used` exists but `_schedule_decision_trace` never passes it → always NULL |
| 3 | Run record | PARTIAL | SQLite `conversation_state` (last-write-wins) + `interactions` (append). NeonDB `troubleshooting_sessions` exists but **engine never writes it** → `decision_traces.session_id` always NULL |
| 4 | Run fields | PARTIAL | `interactions` + `decision_traces` capture most fields; **error class never persisted** (swallowed to `GENERIC_ENGINE_ERROR`); `model_used` NULL |
| 5 | Step artifacts | PARTIAL | `tag/manual/kg_evidence` JSONB persisted; self-critique groundedness scores stored only transiently in state blob |
| 6 | Retry | YES | `InferenceRouter.complete()` Groq→Cerebras→Gemini cascade w/ 429 retry-after backoff (`router.py:308-440`) |
| 7 | Idempotent | NO | No dedup guard; duplicate delivery → two `interactions` + two `decision_traces` rows; concurrent turns can corrupt `context` JSON |
| 8 | Golden fixtures | YES | `golden_factorylm.csv`, `golden_hybrid.csv`, `golden_gs11_conveyor.csv` + 51 YAML scenarios + hourly Celery eval |
| 9 | Status view | NO | `/conversations` hard-gated behind `NEXT_PUBLIC_LABS_ENABLED`, renders **mock data only**; no trace viewer |
| 10 | Smoke test | PARTIAL | `smoke-test.yml` checks page 200s, never drives an engine turn; QA regression skip-gated (see #8) |

**Biggest gap:** Two durable stores that can't talk: `decision_traces.session_id` is always NULL because no code opens a `troubleshooting_sessions` row. The per-incident clinical trace cannot be joined to its session. `model_used` NULL means you can't even tell which provider answered.
**To close:** open a `troubleshooting_sessions` row at turn 1 and thread its UUID into `write_trace`; pass `model_used`; build `/admin/sessions` (JOIN, ~150 LOC); activate the QA secret.
**Feasibility:** MEDIUM (schema fully exists — 3–5 precise wiring changes + one Hub page).
**Tool:** **None needed** — async fire-and-forget trace write is architecturally correct given "never block the reply." It just needs the missing wiring.

### 4. CMMS Sync / Work Order Pipeline — 6/10 — Fragile feature

`mira-cmms/`, `mira-bots/shared/cmms/`, `mira-hub` Atlas sync

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Name | YES | `mira-cmms-sync` container, `[cmms-sync]` log prefix, `cmms-sync-worker.ts` |
| 2 | Version | NO | No sync-contract version; `cmms_synced_etag` is a data watermark, not a schema version |
| 3 | Run record | NO | `cmms_sync_state` is a poll *cursor*, not a run log; `SyncResult` "suitable for an `ingest_status` row" but never written |
| 4 | Run fields | PARTIAL | `SyncStats` (pushed/updated/pulled/conflicts/errors) printed to stdout, never persisted |
| 5 | Step artifacts | PARTIAL | `cmms_sync_state` cursor + row watermarks + `wo_outbox` (durable for bot→Atlas); none for KG-sync path |
| 6 | Retry | YES | 3-attempt backoff on WO create; 5-min outbox drain w/ 3h alert; quota circuit-breaker 5min→1h |
| 7 | Idempotent | YES | `cmms_synced_at < updated_at` predicate skips processed rows; `ON CONFLICT` throughout |
| 8 | Golden fixtures | PARTIAL | Type-shape + retry tests; no full round-trip golden (push→watermark→pull→conflict) |
| 9 | Status view | PARTIAL | `/hub/cmms` health + stats (live Atlas API); event-log shows per-event sync status; **no last-run/pushed/conflict surface** |
| 10 | Smoke test | NO | Zero CMMS references in `smoke_test.sh`; sync worker not health-checked in CI |

**Biggest gap:** No durable per-run record. Every sync tick evaporates to stdout; circuit-breaker state is lost on restart; the only alerting (3h outbox) covers bot-created WOs, not the main NeonDB↔Atlas loop.
**To close:** `cmms_sync_runs` table (per tick×resource) + wrap `runForwardSync`/`runReverseSync` + `/api/cmms/sync-runs` + `wo_outbox` dedup key. ~1–2 days.
**Feasibility:** MEDIUM (`SyncResult` already has the fields).
**Tool:** **Keep Bun interval-tick** (correct for 60s poll) + add the DB run record. Trigger.dev only if connectors graduate to Hub-scheduled syncs.

### 5. Tag Ingestion (Current State) — 4/10 — Fragile feature

`mira-relay/` — **mostly on `feat/dt2026-gap-closure`, NOT on main**

| # | Criterion | Verdict | Evidence (branch) |
|---|---|---|---|
| 1 | Name | YES | `tag_ingest.py` / `POST /api/v1/tags/ingest` (DT branch) |
| 2 | Version | NO | Relay pkg `0.1.0`; no ingest-schema/protocol version on the payload |
| 3 | Run record | NO | `tag_events` is the raw stream (one row/reading); no `ingest_batches` table; `metadata` "batch id" is a comment, not written |
| 4 | Run fields | PARTIAL | Handler logs tenant/source/accepted/rejected; rejected reasons only in HTTP body; no request-id |
| 5 | Step artifacts | PARTIAL | `tag_events` + `live_signal_cache` persisted; **`tag_event_diffs` & `flaky_input_signals` schemas exist but loggers are NOT wired to any cron** |
| 6 | Retry | PARTIAL | Collector has bounded backoff; relay only guarantees partial-write safety, **not dedup on retry** |
| 7 | Idempotent | NO | `live_signal_cache` upsert idempotent; `tag_events` appends fresh-UUID rows; no `(tenant,tag,ts)` unique |
| 8 | Golden fixtures | PARTIAL | 54 inline unit tests across ingest/collector/diff/flaky; not eval-framework golden fixtures |
| 9 | Status view | PARTIAL | `command-center-freshness.ts` logic correct & tested; **Command Center page unmerged to main** |
| 10 | Smoke test | NO | No `/api/v1/tags/ingest` in smoke; `ci.yml` has zero `mira-relay` steps |

**Biggest gap:** No batch run record + no true idempotency. Ignition explicitly retries 3×; each retry silently appends duplicate `tag_events`, indistinguishable from real double-readings. No CI step would catch any relay regression.
**To close:** `source_batch_id` + `ON CONFLICT DO NOTHING` (EASY); `ingest_batches` table (MEDIUM); add `mira-relay` pytest to `ci.yml` (5 lines YAML, tests already pass); wire diff/flaky loggers via `asyncio` background task.
**Feasibility:** EASY (CI, idempotency) → MEDIUM (run record, runtime wiring).
**Tool:** **asyncio background task in the relay** (Starlette `on_startup`) — sufficient for one gateway polling every 2s; Celery is premature.

### 6. Connector Framework — 4.5/10 — Fragile feature

`mira-connectors/` (Maximo/Ignition/SAP/MaintainX/PI)

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Name | YES | `provider="maximo"` etc.; `ConnectorKind` enum (`base.py:48-53`) |
| 2 | Version | PARTIAL | Pkg `0.1.0`; no schema version on `SyncResult` or per-connector protocol |
| 3 | Run record | NO | `SyncResult` "suitable for an `ingest_status` row" (`base.py:136`) but never inserted; `_finish()` just `logger.info` + return |
| 4 | Run fields | PARTIAL | All fields present **in-memory**; `started_at` is `0.0` (monotonic only), no run UUID, no stored status string |
| 5 | Step artifacts | NO | Raw/normalized records + validation issues are local vars, GC'd after `sync()` returns |
| 6 | Retry | NO | Zero retry logic; catches `Exception`, increments error counter, returns |
| 7 | Idempotent | PARTIAL | Write-side `ON CONFLICT`; **import side re-inserts duplicate `ai_suggestions` every run** (`confirmation_gate.py:127`) |
| 8 | Golden fixtures | PARTIAL | 5 realistic JSON fixtures + count assertions; no locked snapshot/diff-on-failure |
| 9 | Status view | PARTIAL | `/integrations` page exists but renders **hardcoded `CMMS_SYSTEMS` static array** (`page.tsx:29-56`) |
| 10 | Smoke test | PARTIAL | Hermetic `pytest` in CI (`connector-framework-tests`); no live-source round-trip |

**Biggest gap:** No durable run record (computed → logged → GC'd) **and** the import side isn't idempotent — re-running multiplies the admin review queue (a correctness bug, not just ops).
**To close:** `connector_runs` table + `SyncResult.persist()` + wall-clock `started_at` + run UUID; pre-check pending `ai_suggestions` before insert; real staging smoke (MaintainX stg token); wire `/integrations` to a real `/api/connectors/status`.
**Feasibility:** MEDIUM (persistence layer already wired; ~2 days/gap).
**Tool:** **Celery** when scheduled runs are needed (already in stack via mira-ops Flower); Trigger.dev contraindicated on the 8GB VPS.

### 7. Document Upload → Retrieval — 4/10 — Fragile feature

Hub upload routes, `mira-ingest`, Open WebUI KB

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Name | PARTIAL | `runIngestPipeline`; no registry entry |
| 2 | Version | NO | `hub_uploads` built via inline `CREATE TABLE IF NOT EXISTS` + bare `ALTER`, no migration version |
| 3 | Run record | YES | `hub_uploads` row at upload time w/ status transitions (`uploads.ts:141`) |
| 4 | Run fields | PARTIAL | Status/timestamps/error string yes; `IngestResult.processingStatus` returned but **discarded** (`upload-pipeline.ts:90-91`) |
| 5 | Step artifacts | PARTIAL | `kb_file_id`/`kb_chunk_count` recorded; **chunks live in OW internal tables, NOT `knowledge_entries`** |
| 6 | Retry | PARTIAL | Manual retry (cloud, failed-only); no auto-retry/backoff/DLQ |
| 7 | Idempotent | PARTIAL | Cloud picks deduped; **local re-uploads create new row + new OW file** |
| 8 | Golden fixtures | NO | Tests assert `status==="parsed"`, never that content is *retrievable* |
| 9 | Status view | PARTIAL | Shows "Document indexed successfully" — **but "indexed" = OW collection, not the citable store; misleading** |
| 10 | Smoke test | NO | CI smoke covers page/auth only; no upload→retrieve round-trip |

**Biggest gap (the worst single finding in this audit):** `ingest_document_kb` writes files to Open WebUI + a dedup ledger but writes **zero rows to `knowledge_entries`**. All chat retrieval (`recall_knowledge`, `neon_recall.py:606`) reads `knowledge_entries`. **A document uploaded through the Hub UI is invisible to every Slack, Telegram, and bot chat channel** — and the UI cheerfully reports "Document indexed successfully." The fix is specced (ADR-0020, PR #1592) but **PR #1592 is still OPEN as of 2026-06-06**.
**To close:** ship PR #1592 (Slices 2–4: `node-knowledge-ingest.ts` writes real `knowledge_entries`, migration 030, retrieval wiring); add upload→RAG-query smoke; stop discarding `processingStatus`; add auto-retry.
**Feasibility:** HARD (new extraction runtime + chunking pass + migration + retrieval blast radius; 2–3 days clean).
**Tool:** **Celery** (already deployed) or **Trigger.dev** — current pipeline is a fire-and-forget Promise with no restart durability.

### 8. Adversarial Review / QA — 5/10 — Fragile feature

`.github/workflows/code-review.yml`, `tests/qa_regression.py`, `tests/eval/`

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Name | YES | Named workflows: Automated Code Review, MIRA QA Regression, Benchmark Weekly, Evaluations |
| 2 | Version | PARTIAL | `offline_run.py` "v3.4.0"; baseline JSON "v2"; code-review + self-fix unversioned |
| 3 | Run record | PARTIAL | `offline_run.py` → committed `.md` scorecards (178 files); `qa_regression` → **`.gitignore`d** runs; no DB |
| 4 | Run fields | PARTIAL | `run_id`/scores/elapsed captured; no end-timestamp, no CI exit code in JSON |
| 5 | Step artifacts | PARTIAL | QA/bench upload GH artifacts (30–90d); **code-review output is transient PR comment only** |
| 6 | Retry | NO | `pr_self_fix.sh` 3-loop is for patches; no review-run retry; flaky Groq → silent `sys.exit(0)` |
| 7 | Idempotent | PARTIAL | Issue-filing dedups (append comment); scorecard writer emits duplicate files per SHA |
| 8 | Golden fixtures | YES | `golden_*.csv` + seeded `mira-bench.json`; **but `qa_regression_baseline.json` is `seeded: false` (floors all 0)** |
| 9 | Status view | NO | No Hub page, no `/api/eval`, no metric; scores live in MD files + ephemeral artifacts |
| 10 | Smoke test | PARTIAL | 3 schedules wired — **but QA regression has silently no-op'd every run** (`TELEGRAM_TEST_SESSION_B64` unset, ~12s exits) |

**Biggest gap:** The most operationally important layer — the 2-hourly end-to-end bot QA that the README says caught every real production outage — **has never executed in CI**. The schedule is theater; the baseline it would compare against was never seeded. False-green checks, zero regression signal.
**To close:** auth a Telegram test account once → set `TELEGRAM_TEST_SESSION_B64` in the `staging` GH environment → `--seed-baseline` (1 person, 1 hour); then `eval_runs` NeonDB table + `/api/internal/eval/history` + a sparkline page.
**Feasibility:** EASY (secret) → MEDIUM (DB persistence) → HARD (full dashboard).
**Tool:** **GitHub Actions** — already has schedule/artifacts/dedup. The missing piece is the persistence layer (NeonDB), not the orchestrator.

### 9. Lead Discovery / HubSpot Pipeline — 6/10 — Fragile feature

`tools/lead-hunter/`, `marketing/prospects/`, launchd + Celery

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Name | YES | `com.mira.lead-hunter` plist; Celery `lead_hunter.discover_and_enrich` |
| 2 | Version | NO | No version field anywhere in lead-hunter |
| 3 | Run record | PARTIAL | Appends to `hourly-runs.log` + `hardening-alerts.jsonl` (flat files); no `prospect_runs` DB table |
| 4 | Run fields | YES | `RunReport` dataclass: started/finished/duration/overall + per-step status/error/alerts (`hardening.py:176-207`) |
| 5 | Step artifacts | YES | Per-run JSONL append + alert JSONL + `.hourly_state.json` snapshot |
| 6 | Retry | YES | `with_retries()` on scrape/search/upsert/push, exponential backoff + jitter |
| 7 | Idempotent | YES | `.hourly_state.json` budget tracking + `ON CONFLICT DO NOTHING` + singleton lock |
| 8 | Golden fixtures | PARTIAL | 20 snippet-parser fixtures (tied to 2026-04-22 incident); no full-run golden |
| 9 | Status view | NO | Zero Hub references to `prospect_facilities`/`lead-hunter`; status only in flat logs |
| 10 | Smoke test | NO | No CI/cron canary; tests cover harness logic, not live run |

**Biggest gap (live failure):** `hs_pushed=0` across **all 1,096 recorded runs** in the CHARLIE run log. 3 leads qualified this morning (Lake Wales) — pushed to nothing. Every alert logs `HUBSPOT_ACCESS_TOKEN: false` / `HUBSPOT_API_KEY: true`. HubSpot moved to private-app access tokens; the pipeline is sending the wrong credential. **Broken across the entire recorded run history, alerting into a JSONL file no one watches.** (The audited run log is the local CHARLIE artifact; confirm where `com.mira.lead-hunter` actually executes before asserting the prod-runner duration.)
**To close:** fix the Doppler token (`HUBSPOT_ACCESS_TOKEN`, private-app bearer) — 30 min; `prospect_runs` DB table; Hub admin status page; daily canary ("last run <2h" AND "`hs_pushed` rising when `hs_qualified>0`"); `VERSION` constant.
**Feasibility:** EASY (token, version) → MEDIUM (status view, canary).
**Tool:** **Keep launchd + Celery** — singleton lock + hard timeout + RunReport + per-step retry already give it Prefect-like bones. Prefect Cloud free tier would add a dashboard but is over-engineered for 1 hourly job; DB run table + Hub page + canary closes it cleanly.

### 10. Self-Healer / VPS Health — 4/10 — Fragile feature

`mira-crawler/agents/self_healer.py`

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Name | YES | `self_healer.py`; cron label `self_healer` (`install_crons.sh:101`) |
| 2 | Version | NO | No `__version__`; only implicit via monorepo SHA |
| 3 | Run record | PARTIAL | `log_actions()` inserts per-`HealAction` to `system_health_log`; **no run envelope; a clean run leaves no trace** |
| 4 | Run fields | PARTIAL | Per-action service/hint/action/succeeded/details/escalated + `ts`; no run input/duration/post-verify status |
| 5 | Step artifacts | NO | Heartbeat JSON in `/tmp` overwritten each tick; reverify results only in the Telegram string |
| 6 | Retry | PARTIAL | `neondb_retry()` 3×; **`restart_container()` has no retry** |
| 7 | Idempotent | YES | `docker restart`/`prune` are no-ops; docstring declares the contract |
| 8 | Golden fixtures | NO | **Zero tests**; no mock of the `container_missing` path that caused the incident |
| 9 | Status view | NO | No Hub page queries `system_health_log`; output only via Telegram + log files |
| 10 | Smoke test | PARTIAL | Heartbeat every 15min is a scheduled check; but no CI test runs the healer to verify it heals |

**Biggest gap (live on `origin/main`; fix uncommitted in flight):** On committed `origin/main`, the 2026-06-04 incident is unfixed — `container_missing` routes to `restart_container` (`self_healer.py:188`), which issues only `docker restart <service>` and returns "No such container" for a *removed* container. **At audit time a peer had an uncommitted working-tree fix** that adds `_compose_up()` (`self_healer.py:141`) and `recreate_container()` (`:175`) and routes `container_missing → recreate_container` (`:272`) via `docker compose up -d --no-deps`. That fix is in **no commit on any branch**, has **no golden tests**, and is **unmerged** — so production is still exposed until it lands and is verified. (The sub-agent that scored this surface initially read a pre-edit working-tree state and reported the gap as still-present in the tree; the authoritative status is: *unfixed on `origin/main`, fix in progress uncommitted*.)
**To close:** commit + test the in-flight `recreate_container` path (add subprocess-mocked golden tests for `container_missing`/`container_removed`/`container_exited` routing — currently zero tests); add a run-envelope row; build an `/admin/health` Hub page over `system_health_log`.
**Feasibility:** EASY (the code fix is essentially written — it needs committing, a golden test, and a dashboard).
**Tool:** **Keep cron + subprocess** — the healer is a bounded remediation script, not a workflow; the fix is filling the implementation gap, not adding an orchestrator.

---

## Orchestration tool recommendation

No single tool fits all ten surfaces, and **the audit's central finding is that MIRA's gaps are mostly *instrumentation*, not *orchestration*** — a `workflow_runs` table + status views would close more criteria than any scheduler swap. With that caveat, the fit-by-surface:

| Tool | Where it fits in MIRA | Verdict |
|---|---|---|
| **Celery** | KG building, Connector scheduled runs, Document ingest. Already deployed (mira-ops Flower, mira-crawler beat). Gives task IDs, result backend, retry decorators, beat. | ✅ **Primary for Python background work.** Lowest marginal cost — it's already here. Migrate the standalone `kg-infer-proposals.ts` into it. |
| **Trigger.dev** | Hub/Next.js ingest (`upload-pipeline.ts`), CMMS-from-Hub. TypeScript-native, first-class durable runs + step artifacts + retry UI — exactly the fire-and-forget closures' missing half. | 🟡 **Best technical fit for Hub workflows, but gated** by the 2026-06-02 VPS-OOM incident (concurrent docling). Needs mem-limited workers before reintroduction. |
| **Prefect** | Lead Discovery, Python ingestion needing a run dashboard. | 🟡 **Over-engineered at current scale** (1 hourly job). Prefect Cloud free tier would add a dashboard with zero infra, but a `prospect_runs` table + Hub page is lighter. |
| **Temporal** | Mission-critical multi-step durability (CMMS bi-directional sync, tag ingest if it grows to multi-gateway fanout). | 🔴 **Not yet.** Real durability guarantees, but operationally heavy (server + workers). No surface today has the cross-process, long-running, must-not-lose-state profile that justifies it. Revisit when CMMS sync becomes revenue-critical. |
| **DBOS** | Postgres-backed durable workflows — *uniquely well-matched to MIRA's "NeonDB is the source of truth" architecture.* Run record + workflow state live in the same Postgres you already query. | 🟢 **The dark-horse pick.** For any surface where the durable-run-record gap is the whole problem (KG building, CMMS sync, connectors), DBOS gives durability + idempotency + run records natively in NeonDB with no new broker/server. Strongly worth a spike — it directly addresses this audit's #1 systemic gap. |
| **GitHub Actions** | Adversarial Review / QA. Already has schedule + artifacts + issue dedup. | ✅ **Keep.** The gap is persistence (NeonDB `eval_runs`), not orchestration. |

**Recommended sequence:**
1. **Platform primitive first:** `workflow_runs` table + a thin Python decorator and TS wrapper. This is the single highest-leverage change — it lifts run-record / status-view / smoke coverage across nearly every surface at once. **Spike DBOS here** — it may give you this primitive plus idempotency and retries for free, in the Postgres you already run.
2. **Keep Celery** for Python background work; fold the standalone TS KG worker into it.
3. **Re-evaluate Trigger.dev** for Hub ingest *after* mem-limits are proven (OOM gate).
4. **Defer Temporal/Prefect** until a surface's scale or revenue-criticality actually demands them.

---

## Prioritized hardening roadmap

Ordered by **(live damage × ease of fix)**, not by score.

### P0 — Broken in production right now (fix this week)
1. **HubSpot token** (Lead Discovery) — set `HUBSPOT_ACCESS_TOKEN` private-app bearer in Doppler `factorylm/prd`. **30 min. Recovers 6 weeks of dead lead delivery.**
2. **Self-healer recreate path** — an uncommitted working-tree fix already wires `recreate_container` (`docker compose up -d --no-deps`); **commit it, add a routing golden test, and deploy.** Until it lands, `origin/main` still can't recover a removed container. **Prevents the next 7-hour outage.**
3. **QA regression Telegram secret** — auth once, set `TELEGRAM_TEST_SESSION_B64` in the `staging` GH env, seed the baseline. **~1 hour. Turns the dead 2-hourly gate back on.**

### P1 — Silent correctness bugs (fix this sprint)
4. **Document upload → retrieval** — ship PR #1592 so Hub uploads write `knowledge_entries` and become citable in chat. Stop the UI lying about "indexed." **(HARD but specced.)**
5. **Tag-event + connector-import idempotency** — add `source_batch_id`/`ON CONFLICT` to `tag_events`; pre-check pending `ai_suggestions`. **Stops silent double-writes.**
6. **`decision_traces` wiring** — open `troubleshooting_sessions` rows, thread `session_id` + `model_used`. **Makes incidents reconstructable.**

### P2 — The platform primitive (the structural fix)
7. **`workflow_runs` table + decorator/wrapper**, spiking **DBOS** — closes criteria 3/9/10 across KG building, CMMS sync, connectors, ingest in one stroke.
8. **Real smoke tests** — replace `/health` pings with end-to-end round-trips (upload→retrieve, tag→batch, sync push→pull, engine turn→trace). Wire `mira-relay` into CI.
9. **Workflow versioning** — the universal 0/10 gap. A `workflow_version` constant stamped on every run record. Trivial once `workflow_runs` exists.

### P3 — Observability polish
10. Replace the **mock-data status views** (`/integrations`, `/conversations`) with real queries against the run records. Add the `/admin/health`, `/admin/sessions`, eval-history, and lead-status Hub pages — each becomes a `SELECT … ORDER BY started_at` once the run records exist.

---

## Closing assessment

MIRA is a **capable product built on fragile plumbing.** The domain logic is genuinely good — the UNS gate, groundedness scoring, KG proposal lifecycle, provider cascade, connector contracts, retry/idempotency on the write side. But almost none of it is *operationally observable*. The recurring story across all ten surfaces is identical: **the workflow runs, does real work, and then forgets it ever happened** — leaving a stdout line, an overwritten temp file, or a last-write-wins row where a durable run record should be. The three live production failures are not bad luck; they are the deterministic output of a system with no run records, no real smoke tests, and status views made of mock data.

The good news: the fix is mostly **instrumentation, not rearchitecture.** A single `workflow_runs` primitive (DBOS is worth a serious look here) plus three small P0 fixes would move MIRA further toward "durable workflows with dashboards" than any amount of feature work. The machines are built. They just need dashboards bolted on — and one of them needs the wire reconnected that's been cut since 2026-06-04 (a fix for that one was sitting uncommitted in the working tree at audit time — the very fact that a production-recovery fix can exist un-committed and un-tested in a shared checkout is itself the fragile-feature pattern this report indicts).

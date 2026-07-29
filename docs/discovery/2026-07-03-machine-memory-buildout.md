# Machine Memory Buildout — Discovery Log & Working Plan

**Date started:** 2026-07-03 · **Orchestrator:** Agent 0 (Discovery Recorder) · **Status:** DISCOVERY IN PROGRESS
**Mission:** close the "cut middle" from `docs/discovery/2026-07-03-product-discovery-sweep.md` (§10): turn canonical `tag_events` into persisted machine behavior (migration 038 layer: `machine_run` / `run_step` / `run_baseline` / `run_diff`) and explainable maintenance outcomes.

**Hard rules in force:** sub-agent-driven development · no prod writes · sanctioned read-only DB inspection only (`db-inspect.yml`) · schema changes via migrations only · staging/local first · no new demos / anomaly rules / OPC UA / Factory I/O / OpenPLC / Litmus internal-API work · CV-101 conveyor canonical · build on existing code · every conclusion cites evidence · **no competing `machine_events` table unless a written note proves 038 insufficient**.

---

## 1. Stop-condition pre-checks (Agent 0, done before dispatch)

| Check | Result | Evidence |
|---|---|---|
| Migration 038 present in checkout | ✅ PASS | `mira-hub/db/migrations/038_machine_runs.sql` read 2026-07-03 — defines `machine_run`, `run_step`, `run_baseline`, `run_diff`, append-only GRANT discipline, implicit run↔tag_events link via `[started_at, stopped_at]` + `uns_path` |
| `tag_events` schema matches sweep claim | ✅ PASS | db-inspect run 28666022597 (prod): 14 columns incl. `value/value_type/quality/source_system/simulated/event_timestamp`, matches canonical 033 |
| Worker writes require prod credentials? | ✅ NO — local/staging first; fixtures use local store | doctrine `docs/environments.md` |
| Tenant scoping provable? | ⏳ pending Agent A (tenant_id type on 038 tables vs session UUID) | — |

## 2. Baseline scoreboard (measured 2026-07-03, read-only `db-inspect.yml` runs 28666022597 prod / 28666024200 staging)

| Metric | PROD baseline | STAGING baseline | Target |
|---|---|---|---|
| `tag_events` rows | **28 (total ever)** | 89 | thousands/day once bench stream connects |
| `machine_run` / `run_step` / `run_baseline` / `run_diff` writer activity | 0 (no writer exists) | 0 | populated by the machine-memory worker |
| non-`has_manual` KG edges | ~39 of 308 | ~40 of 309 | hundreds, via evidence-backed proposals |
| `kg_entities` NULL `uns_path` | 29 | 39 | 0 |
| `relationship_type` enum drift | `has_component`+`HAS_COMPONENT` (prod); `LOCATED_IN`+`located_at` (stg) | same class | canonicalized |
| `knowledge_entries` | 83,629 | 83,798 | (context metric — growth signals upload traffic) |

Scoreboard SQL: to be finalized by Agent A (§5 evidence) and embedded in the verification workflow.

## 3. Sub-agent roster & dispatch state

| Agent | Scope | State |
|---|---|---|
| A — DB/Migration Inspector | 038 fitness, 033/035/036/037 relations, grants, scoreboard SQL | 🔄 dispatched |
| B — Ingest Inspector | canonical path trace, WebDev-needed?, bench-to-cloud runbook, missing tests | 🔄 dispatched |
| C — Machine Memory Worker | implementation — **blocked until A+B report** | ⏸ not dispatched |
| D — Data Quality | enum drift writers, NULL uns_path origin, db-inspect uuid=text fix | 🔄 dispatched (discovery) |
| E — Hub Surface | minimal endpoint+tile spec, DB-access pattern, test pattern | 🔄 dispatched (discovery) |
| F — Test/CI/PR Guard | per-PR verification | ⏸ not dispatched |

## 4. Working plan (PR-sized branches; small reviewable PRs, not one giant one)

All implementation happens in isolated worktrees branched from `origin/main` (this checkout `feat/litmus-bench-proof` carries unrelated WIP that must not be swept — session-discipline rule 3).

| PR | Branch | Contents | Depends on |
|---|---|---|---|
| PR 1 | `fix/db-inspect-orphan-probe` | uuid=text probe fix + data-hygiene discovery doc + scoreboard SQL queries in the workflow | Agent D findings |
| PR 2 | `feat/machine-memory-worker` | worker foundations + CV-101 fixtures + tests; consumes `tag_events`, writes 038 layer | Agent A + B findings |
| PR 3 | `feat/hub-machine-memory-surface` | minimal Hub API (+ tile) for latest run/diff + docs + verification | Agent E + PR 2 |
| PR 4 | `docs/bench-to-cloud-runbook` | first-physical-tag-row runbook + deterministic ingest tests; manual bench checklist where hardware is required | Agent B |

Enum-drift canonicalization + NULL uns_path backfill: plan lands in PR 1 as a documented proposal; any data-touching migration ships separately after staging verification (migrations immutable once applied — `.claude/rules/mira-hub-migrations.md` §8).

## 5. Evidence table (Discovery Recorder)

| # | Claim | Evidence path | Command used | Result | Implementation implication |
|---|---|---|---|---|---|
| 1 | 038 defines the run-centric layer (4 tables, append-only, implicit tag_events link) | `mira-hub/db/migrations/038_machine_runs.sql` | Read (head -40) | Confirmed; header cites issue #2341, historian link #2339 TODO | Build the writer on 038; no new table |
| 2 | `tag_events` prod = 28 rows ever; staging 89 | db-inspect runs 28666022597 / 28666024200 | `gh workflow run db-inspect.yml` + log extraction | Confirmed | Live pipe is the bottleneck; PR 4 runbook |
| 3 | `approved_tags` prod = 227, staging 158 | same runs | same | Confirmed | Allowlist seeded; worker must respect fail-closed gate |
| 4 | KG causal edges are single-digit; 87% has_manual | same runs (`kg_relationships by type`) | same | Confirmed | Worker evidence → future proposals is the growth path (P2, out of scope here) |
| 5 | enum drift: has_component/HAS_COMPONENT, LOCATED_IN/located_at | same runs | same | Confirmed | PR 1 canonicalization plan (Agent D) |
| 6 | db-inspect #1899b probe broken (`uuid = text`) | `.github/workflows/db-inspect.yml:255-259`; prod log line "ERROR: operator does not exist: uuid = text" | log read | Confirmed | PR 1 fix |
| 7 | `tag_events` schema matches canonical 033 | db-inspect prod log, `tag_events columns` section | same | 14 columns confirmed | Worker reads real columns; fixtures mirror them |
| 8–n | *(pending Agent A/B/D/E reports)* | | | | |

## 6. Discovery findings

### Agent A — DB/Migration Inspector (reported 2026-07-03)

**Verdict: use 038 as-is for runs/baselines/numeric diffs; additive migration 040 only for (b) idle windows and (c) typed A0–A12 anomalies + explicit evidence pointers. Never a `machine_events` table.**

Key findings (full citations in the agent report, mirrored here):

1. **THE WORKER ALREADY EXISTS.** `mira-crawler/run_engine/` (PR #2351 / issue #2341, commit `22a32dd1`, 2026-06-27): `segmentation.py` (trigger-tag run grouping), `baseline.py` + `diff.py` (k·σ severity: >kσ critical / >σ warning), `pipeline.py::run_historization()`, `store.py` with `RunStore` Protocol + `InMemoryRunStore` + `NeonRunStore` (full SQL for all four 038 tables + implicit-window `readings_for_window`), Celery beat task `tasks/historize_runs.py`. Tests: `mira-crawler/tests/test_run_diff.py`, `test_historize_runs_integration.py`. **BUT:** (a) the task NO-OPs unless `MIRA_RUN_DIFF_ENABLED=="1"` — default OFF (`historize_runs.py:47-48`); (b) `store.py:12-13` admits NeonRunStore SQL "is NOT exercised against a live Postgres in CI"; (c) the read side is unwired — `historian.py:264-266` `list_runs()` raises `NotImplementedError`, `PostgresHistorianAdapter` has no override (TODO(#2339) open).
2. **038 tenant scoping is UUID family** (all 4 tables `tenant_id UUID`, `::UUID` RLS casts, `038:60,101-104`) — consistent with `tag_events` (033) and session.ts UUID-only auth. Worker must use UUID tenants. GRANTs: worker's role has SELECT/INSERT(/UPDATE where sanctioned) on all needed tables; `run_diff` is append-only (no UPDATE/DELETE).
3. **038 capability matrix**: (a) runs from tag_events ✅; (b) idle/not-running windows ❌ (`status` CHECK only open/closed/anomalous; no run row if trigger never rises — with prod at 28 tag_events mostly idle, 038 alone records nothing); (c) typed A0–A12 anomalies ❌ (`run_diff` has NO diff_type/anomaly-code column, only severity CHECK info/warning/critical; 037's diff_type CHECK vocabulary doesn't include A-codes either); (d) baselines ✅; (e) evidence pointers PARTIAL (implicit window link only; `run_diff` lacks 037-style `from_event_id`/`to_event_id`).
4. **037 vs 038 complementary, not overlapping**: `tag_event_diffs` = typed per-instant transitions with event-id anchors; `run_diff` = per-run statistical deviation vs baseline. Different writers (TagDiffLogger vs run_engine).
5. **Application status**: staging = applied per `migration-verify.yml` auto-apply on PR #2351 (inference); prod = unverifiable without the gated read-only probe — extend `db-inspect.yml` to probe 038 table presence (feeds PR 1).
6. **Proposed migration 040 (additive only)**: `ALTER TABLE run_diff ADD COLUMN IF NOT EXISTS diff_type TEXT / from_event_id UUID / to_event_id UUID`; idle windows via either status-CHECK extension or a small `machine_state_window` table (genuinely new concept, not a machine_events clone).
7. **Scoreboard SQL delivered** (§6 of agent report) — with the correction that hub `kg_relationships`/`kg_entities` tenant_id is TEXT (kg family), so no `::UUID` casts there.

### Agent E — Hub/Product Surface (reported 2026-07-03)

**Recommended minimal patch: one new route + one new card, copying existing patterns verbatim.**

1. **Home for the tile: asset detail page** `mira-hub/src/app/(hub)/assets/[id]/page.tsx` OverviewTab (tab list `:204`; overview/activity/WO/parts tabs are mock data — the real-API tabs are documents/intelligence/validate/ask). Command Center is the wrong altitude (whole-plant tree).
2. **`machine_run`/`run_step`/`run_baseline`/`run_diff` appear in ZERO mira-hub source files** — the read surface doesn't exist anywhere; only the migration defines the tables.
3. **DB-access pattern: `withTenantContext`** (`src/lib/tenant-context.ts:22-41` — `SET LOCAL ROLE factorylm_app` + dual `app.tenant_id`/`app.current_tenant_id` set_config), exactly matching 038's grants (`SELECT` to factorylm_app) and dual-setting RLS policies. No new grant or policy needed. Pattern donors: `api/hub/status/route.ts:39-57`, `api/assets/[id]/signals/route.ts:32-100`.
4. **New endpoint**: `GET /api/assets/[id]/machine-memory` → `{uns_path, latest_run, latest_diffs[≤5], evidence_window, next_check:null}`. Resolve `uns_path` from `kg_entities` by copying `context/route.ts:59-69` (TEXT vs UUID tenant care); query `machine_run`/`run_diff` with `tenant_id=$1::uuid AND uns_path=$2::ltree`. "Evidence source" = the run's implicit tag_events window (038:18-20).
5. **New component**: `MachineMemoryCard.tsx` (`.card` + Badge + StatusPill pattern from `AssetIntelligencePanel.tsx:151-164` + FreshnessDot severity dot from `command-center/page.tsx:499-534`); disabled "Create work order (soon)" button linking `/workorders/new?prefill=…` (page exists).
6. **Optional +5-line freebie**: add a `machine_memory` block to `api/assets/[id]/context` (#2402) — Ask MIRA gets machine-memory context free since that route already resolves `uns_path`.
7. **Test pattern to copy verbatim**: `api/assets/[id]/context/__tests__/route.test.ts` (mock demo-auth + tenant-context, SQL-regex-dispatching mockClient). Cases: null uns_path empty state; run+diffs mapped; no-runs; guards.
8. **Risks**: join key is `uns_path` (equipment_id NULL in v1) → empty state is the norm until UNS promotion — design it first-class; never join machine_run to cmms_equipment (uuid=text); ltree casts `$2::ltree`; `next_check` has NO column — derive in worker or null in v1 (spec gap flagged); UI token divergence (hub cards use `--foreground` family, rule says `--fl-*`) — match the file, flag the pre-existing divergence.

### Agent D — Data Quality / Graph Hygiene (reported 2026-07-03)

1. **No CHECK on `kg_relationships.relationship_type`** — free TEXT by design (`038_relationship_type_asset_graph.sql:26-28`: "the proposal table is the gate, not the materialized edge"). The UPPERCASE 35-value canonical vocabulary is CHECK-enforced only on `relationship_proposals` (newest: migration 043:43-64; TS mirror `proposals-writer.ts:19-40`). **Canonical casing = UPPERCASE_SNAKE.**
2. **Drift root cause — three writers**: (1) proposal→decide route writes UPPERCASE verbatim (`decide/route.ts:207-211`); (2) legacy crawler auto-verify (`kg_writer.py:242-256`, gated by `MIRA_KG_INGEST_AUTOVERIFY`, default off) wrote the lowercase rows incl. `has_manual`×269; (3) seeds write UPPERCASE literals incl. **`CONTROLS` which is OUT-OF-VOCABULARY** (explicitly unmapped, `proposals-writer.ts:83`) — needs a vocabulary decision.
3. **Canonical mapping table delivered** (has_component→HAS_COMPONENT; located_at→LOCATED_IN flip:false — but `parent_of`→LOCATED_IN **flip:true**, so no blind folding; has_manual/documented_in→HAS_DOCUMENT; has_fault_code→HAS_FAILURE_MODE; has_work_order→HAS_WORK_ORDER). **No read-time normalizer exists in code** (searched; only a docstring in the 2026-06-05 audit which already flags this drift as known-open).
4. **NULL `uns_path` origin**: exactly two Hub writers omit the column — chat KG extractor (`extractor.ts:126-133`) and node-document proposal writer (`node-document-proposals.ts:109-121`). Backfill precedents exist: SQL `014_uns_path_backfill.sql` (+ audit view `kg_entities_uns_orphans`) and TS `uns-backfill.ts` (`runUnsBackfill`, dry-run capable, parent_of graph walk). Plan: run graph-walk backfill → place residue under `enterprise.unassigned.*` via `mira-crawler/ingest/uns.py` builders → leave truly un-anchorable rows NULL surfaced by the orphans view.
5. **db-inspect uuid=text fix (exact)**: `hub_tenants.id` = TEXT, `tenants.id` = UUID (prod; confirmed by 051's own header). Fix mirrors migration 051's join: guard `ht.id ~ '^[uuid-regex]$' AND NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = ht.id::uuid)` — counts precisely "rows 051 still needs to fix", keeps the uuid index usable, regex prevents cast errors on slug ids. Validation: integration fixture `000_base_cmms_rls.sql` has both tables with real types — testable locally, zero prod access.
6. **Cleanup strategy recommendation: (b) additive read-time normalizer** (extend existing `mapToCanonicalEdge`/`canonical_relation_type` maps, apply in graph query/view layer). Rewrite migration rejected: UNIQUE `(tenant_id,source_id,target_id,relationship_type)` means folding could collide (needs de-dup logic), a CHECK on kg_relationships contradicts the deliberate free-TEXT design, and `CONTROLS` has no canonical target yet. ~10 affected rows don't justify prod DML.

### Agent B — Ingest/Tag-Events Inspector (reported 2026-07-03)

1. **The canonical REST/HMAC path is production-grade and fully wired**: `POST /api/v1/tags/ingest` (`relay_server.py:726,259-303`) → HMAC (`auth.py`; env `MIRA_IGNITION_HMAC_KEY`; headers X-MIRA-Tenant/Nonce/Timestamp/Signature; HMAC tenant authoritative over body) → `ingest_batch` fail-closed allowlist (`tag_ingest.py:161-260`; unapproved tag → `RejectedTag("not_allowlisted")`, NEVER stored, **no auto-discovery on the REST path** — auto-discover-as-disabled is Sparkplug-only) → `tag_events` append + `live_signal_cache` upsert in one transaction. Deployed as `mira-relay` in `docker-compose.saas.yml:461-491` (127.0.0.1:8765 behind nginx; public `https://api.factorylm.com/api/v1/tags/ingest`).
2. **DEFINITIVE: tag-stream does NOT need WebDev.** `ignition/gateway-scripts/tag-stream.py` is a Gateway **Timer** script; `collector.py`/`signing.py`/`allowlist.py` are pure-stdlib modules copied into the project script library; egress is outbound `system.net.httpClient().post(...)`. The bench 404 is the WebDev Ask-MIRA chat surface, unrelated (`cv101_perspective_mira_dashboard_integration.md:35,50`). **P0-4 shrinks to: timer + 3 files + `factorylm.properties` + HMAC key + seed.**
3. **SimLab round-trip proof**: `RelayIngestPublisher` (`simlab/publishers.py:236-335`), staging validation runbook (PR #2280; tenant `…515ab1`, source `simulator`); CI tests `tests/simlab/test_relay_ingest_e2e.py` etc. Honest gap: the runbook's live-staging column is "pending infra" — proven at the code seam, not asserted against live Neon.
4. **CV-101 seed exists**: `tools/seeds/approved_tags_conveyor.sql` (58 rows, `source_system='ignition'`, all → `enterprise.home_garage.conveyor_lab.conveyor_1`, `__TENANT_ID__` placeholder via `apply-seeds.yml`). Garage tenant UUID: `e88bd0e8-8a84-4e30-9803-c0dc6efb07fe` (`docs/command-center-ignition-display.md:102`).
5. **Bench-to-cloud runbook drafted** (§6 of agent report): cloud pre-reqs → seed → signed smoke test → gateway install [BENCH/manual] → verification SQL + screenshot to `docs/promo-screenshots/`. No standalone signer script exists (only a runbook heredoc + `publishers.py` internals) — a committed `mira-relay/tools/sign_and_post.py` is recommended.
6. **Missing deterministic tests (no hardware needed)**: (i) CV-101-shaped batch through `ingest_batch`+InMemory store; (ii) seed-vs-normalizer drift guard for `approved_tags_conveyor.sql` (exists for simulator + CV-200, NOT for CV-101 — silent break risk); (iii) gateway `approved_tags.json` ⇄ SQL seed parity; (iv) signed CV-101 batch → relay ASGI app e2e; (v) signer tool + test.

## 7. Decisions

| # | Decision | Justification (evidence) |
|---|---|---|
| D1 | **No `machine_events` table. Build on 038 + existing `mira-crawler/run_engine`.** | Agent A: worker exists (PR #2351); 038 capability matrix; "Reuse Before Build" precedent (036:9-16). Acceptance criterion 10 satisfied. |
| D2 | **Migration 040 (additive only)**: `run_diff` + `diff_type TEXT`, `from_event_id UUID`, `to_event_id UUID`; plus minimal `machine_state_window` table for idle/not-running windows. | Agent A proved 038 cannot represent (b) idle windows (no run row when trigger never rises; 3 of the 4 required CV-101 fixtures are idle-state faults) or (c) typed A0–A12 anomalies (`run_diff` has only severity CHECK). This is the *written discovery note* required before any new table; `machine_state_window` is a genuinely distinct concept, not a machine_events clone. |
| D3 | **Worker location: extend `mira-crawler/run_engine/`** (not a new `mira-relay/machine_memory_worker.py`). | Agent A: segmentation/baseline/diff/store/Celery task already live there with tests; mission rule "build on existing code". |
| D4 | **A0–A12 integration = vendor `rules_core.py` with a parity test** (pattern: `tests/regime7_ignition/test_diagnose_parity.py`); worker builds rule snapshots from `tag_events` via the approved-signal mapping. No new rules. | Rules are pure/dual-Py (`plc/conv_simple_anomaly/rules_core.py`); vendoring+parity is the established pattern. |
| D5 | **Enum drift: additive read-time normalizer**, no data rewrite; `CONTROLS` flagged for a vocabulary decision. | Agent D: UNIQUE-key collision risk on folding; free-TEXT kg_relationships is deliberate (038_rel:26-28); ~10 rows. |
| D6 | **db-inspect fix mirrors migration 051's join** (uuid-regex guard + `ht.id::uuid`), counts "rows 051 still needs to fix"; also add a 038-tables presence probe. | Agent D exact SQL; Agent A §5 (prod application unverifiable without probe). |
| D7 | **Hub surface: `GET /api/assets/[id]/machine-memory` + `MachineMemoryCard` in asset Overview** via `withTenantContext`; `next_check` derived by worker (from A-rule NEXT_CHECK map) or null; empty state first-class. | Agent E full spec; 038 grants/RLS align with `withTenantContext` exactly. |
| D8 | **Flag stays default-off** (`MIRA_RUN_DIFF_ENABLED`); enablement is an ops step documented in the runbook, staging first. | Env doctrine; worker SQL never CI-exercised against live PG (store.py:12-13). |
| D9 | **NULL uns_path: no destructive migration.** Graph-walk backfill (`uns-backfill.ts` dry-run first) + `enterprise.unassigned.*` fallback plan documented; residue surfaced via `kg_entities_uns_orphans` view. | Agent D origin analysis (2 writers) + existing precedents (014, uns-backfill.ts). |

## 7a. Revised PR plan (post-discovery)

| PR | Branch (from `origin/main`, own worktree) | Contents |
|---|---|---|
| PR 1 | `fix/db-inspect-orphan-probe` | db-inspect uuid=text fix (D6) + 038-presence probe + scoreboard SQL step + relationship-type read-time normalizer + unit tests (D5) + this discovery doc + sweep doc |
| PR 2 | `feat/machine-memory-worker` | migration 040 (D2) + run_engine extension: state windows, vendored A-rules + parity test, evidence pointers, CV-101 fixtures (healthy idle / comm stale / e-stop / both-directions), idempotency + tenant-isolation + unapproved-tag tests, docs (D3/D4) |
| PR 3 | `feat/hub-machine-memory-surface` | machine-memory endpoint + card + route tests (D7); optional context-route block |
| PR 4 | `docs/bench-to-cloud-runbook` | runbook + `mira-relay/tools/sign_and_post.py` + missing deterministic ingest tests (Agent B §6) |

## 8. Deterministic workflows / tests added

*(to be appended during implementation phase)*

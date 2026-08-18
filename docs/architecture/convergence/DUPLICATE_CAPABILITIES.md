# Semantic Duplicate-Capability Report — Gate 0

**Date:** 2026-08-15 · **Method:** four explorer agents, one per capability family, evidence file:line-cited.
Verdicts use the registry vocabulary: `CANONICAL | CONSUMER | MIGRATE | DUPLICATE | LEGACY | EXPERIMENTAL | DATA | DELETE_CANDIDATE`.

## 1. Diagnostic engine & chat bots — clean win, ready for strangulation

| Implementation | Verdict | Evidence |
|---|---|---|
| `MIRA/mira-bots/shared/engine.py` (Supervisor) | **CANONICAL** | 925 commits through 2026-08-13; deployed via saas.yml |
| `factorylm/services/diagnosis/main.py` | **LEGACY → DELETE_CANDIDATE** | frozen 2026-03-08; predecessor of the Supervisor |
| `factorylm/services/telegram_bot/handler.py` (329 lines) | **LEGACY → DELETE_CANDIDATE** | frozen 2026-03-08 vs `mira-bots/telegram/bot.py` (2,805 lines, 175 commits) |
| `factorylm/services/llm-router/` | **LEGACY → DELETE_CANDIDATE** | skeleton only (redis_logger + plist, no router logic) vs `shared/inference/router.py` (702 lines) |
| `MIRA/mira-pipeline` | **CANONICAL** (unified API) | factorylm has no equivalent unified contract |

**Caution before Gate 11:** CLUSTER.md still *declares* a Telegram bot running on CHARLIE from `services/troubleshoot/adapters/telegram_bot.py` — runtime consumers must be proven zero on the actual nodes (launchd/crontab on ALPHA/CHARLIE), not just in-repo. Deletion is a separate milestone.

## 2. PLC parsing & analysis — five capabilities, mostly NOT duplicates

| Implementation | Verdict | Why |
|---|---|---|
| `MIRA/mira-plc-parser` | **CANONICAL** (export-based analysis) | 6 formats (L5X/CSV/ST/PLCopen/AWL/Ignition JSON) → pinned `report@1` IR with golden tests; deployed via `mira-core/mira-ingest` `POST /ingest/plc-parse`; consumed by Hub PLC Import wizard (`mira-hub/src/lib/plc-import.ts:28-42`) |
| `MIRA/mira-machine-logic-graph` | **EXPERIMENTAL — keep separate** | CCW/Micro800-specific tokenizer → Ignition OPC-UA namespace JSON; different output contract, different consumer; merging would help nobody. If i3X needs both, orchestrate (parser → mlg), don't merge |
| `MIRA/plc/` | **CANONICAL** (bench + live rules) | orthogonal: program *construction* + live anomaly rules (A0-A12) on tag snapshots, not export parsing |
| `factorylm/services/plc-modbus` | **LEGACY** (dormant 5+ mo) | live I/O protocol tooling, not parsing; do not revive without review |
| `factorylm/apps/plc-reader` | **LEGACY** (dormant) | NiceGUI live tag browser |

**Conclusion:** the apparent 5-way duplication collapses to *one real canonical per distinct job*. No consolidation migration needed; registry statuses + a one-page "which PLC tool for which job" note suffice.

## 3. Simulation — SimLab canonical; two bench standalones; factorylm lineage dormant

| Implementation | Verdict | Why |
|---|---|---|
| `MIRA/simlab` | **CANONICAL** | CI-gated (`simlab-gate` on every PR), deterministic, publishes through the canonical `ingest_contract` ("one contract, every transport", `simlab/publishers.py:221`) |
| `MIRA/mira-fault-sim`, `MIRA/mira-fault-detective` | **EXPERIMENTAL (bench-only)** | only referenced by `docker-compose.fault-detective.yml`; zero imports from main codebase; last touched May/June. Keep as bench harness OR nominate for Gate 11 review — decision, not assumption |
| `factorylm/simulation` | **DELETE_CANDIDATE** (confirmed by CU-04) | stale since 2026-03-01; zero inbound on every Gate 11 axis, including across all 65 `origin` refs — the only one of the four that clears |
| `factorylm/sim` | **LEGACY** (CU-04 downgrade) | `workers/plc_simulator_tasks.py:24-25` imports it at TOP LEVEL in a module that registers Celery tasks — deletion breaks worker startup |
| `factorylm/cosmos` | **LEGACY** (CU-04 downgrade) | `services/plc_monitor/monitor.py:9-10` top-level import, plus 5 more inbound |
| `factorylm/cookoff` | **LEGACY** (CU-04 downgrade) | `core/pipeline.py:195,374` imports it after a deliberate `sys.path.insert` |

> **⚠️ CORRECTED 2026-08-18 by CU-04 (#3306).** This section previously read *"15+ internal imports
> mean the four factorylm sim dirs must be evaluated as one deletion unit"*. **Measured cross-imports
> among the four: 2** — both `cookoff/visual_test_loop.py:56-57` → `sim`. `simulation` and `cosmos`
> have no quartet coupling in either direction, so the four are **not** one deletion unit; they are
> one coupled pair plus two independents and can be sequenced separately.
>
> The "coupled" framing also hid the constraint that actually matters. What blocks three of them is
> **inbound imports from CANONICAL code** (`workers`, `core`, `scripts`, `tests`), not coupling to
> each other — a different and stronger blocker. All four were reclassified on Gate 11 runtime
> evidence in `units/CU-04.md`; the rows above reflect that, and the registry carries the
> `blocking_evidence` per component.

## 4. Knowledge ingestion — multi-path by design, but three real write-path issues

The one-pipeline law (`.claude/rules/one-pipeline-ingest.md`) governs **factory tag data only** — document ingestion is intentionally multi-path (7 live writers to `knowledge_entries`, all MIRA-side, inventoried in the DB-ownership sweep). No law violation. But the sweep surfaced:

| Issue | Severity | Evidence |
|---|---|---|
| I-1: `mira-crawler/ingest/store.py::insert_chunk` hardcodes `is_private=false` with **no parameter** — any future per-tenant caller silently publishes tenant docs to the shared corpus | **high** | `store.py:78,111` vs write law in `.claude/rules/knowledge-entries-tenant-scoping.md:71-78` (already tracked as the rollout-status ⏳ item there) |
| I-2: `tasks/ingest.py::ingest_url` performs no `sources.yaml` membership check — non-curated URLs can land in the shared OEM corpus (as unverified) | **high** | `tasks/ingest.py:58-66`; `.claude/rules/oem-crawler-trusted.md` residual-gaps section already names this path |
| I-3: `mira-bots/tools/learning_ingester.py` is_private handling unaudited | medium | needs a targeted read before any verdict |

These become **CU-03** in the backlog (security-adjacent → xhigh adversarial review per §Gate 7).

## 5. Databases — no conflicting writers found

All 13 core NeonDB tables are created by `mira-hub/db/migrations/` and written only from MIRA modules; **zero factorylm writers** (blind spot §13.3: clear). Other stores: `atlas-db` (separate Postgres, Atlas-owned, bridged by `atlas-hub-sync.py` writing `cmms_equipment.atlas_id` back), Node-RED local SQLite (ephemeral), legacy `mira-core/mira.db` (no active writers → DELETE_CANDIDATE data audit).

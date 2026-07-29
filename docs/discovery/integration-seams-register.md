# Integration Seams Register

**Date:** 2026-07-03 · **Author:** Agent B (Integration Seam Finder) · **Branch/commit:** `main` @ `9a3c6f80` (includes today's merges: machine-memory worker + mig 040, Hub machine-memory card, bench→cloud runbook + signer, relay bind-addr, db-inspect scoreboard + KG canonicalizer)
**Method:** read-only trace of ACTUAL inputs/outputs (who reads/calls whom), file:line cited for every claim. Where a link was searched for and not found, that is stated. Verifies the seam lists in `docs/discovery/2026-07-03-machine-memory-buildout.md` and `…-product-discovery-sweep.md` §2 against current `main`.
**Priority frame:** the CURRENT product priority is the **physical CV-101 proof** — staging flag (`MIRA_RUN_DIFF_ENABLED=1`) → bench Ignition timer → first real `tag_events` row → `machine_run`/`run_diff` written → `MachineMemoryCard` renders it. **P0 = needed for, or directly after, that proof.** P1 = the next loop (outcomes / grounded answers). P2 = real gap, off the CV-101 critical path. PARK = not on main / deferred / no near-term value.

---

## Priority-sorted summary

| # | Seam (left → right) | State on main | Priority | One-line gap / action |
|---|---|---|---|---|
| 2 | machine memory tables → Hub card | **CLOSED today** (#2406) | P0 (verify-only) | Route reads real `machine_run`/`machine_state_window`/`run_diff`; card renders on asset page. Endpoint of the proof — nothing to build. |
| 1 | `tag_events` → machine-memory worker | **WIRED, flag-off** | P0 | Worker + beat exist in `saas.yml` (`mira-historian-*`), gated `MIRA_RUN_DIFF_ENABLED=0`. **Compose env omits `MIRA_MACHINE_MEMORY_UNS_PATHS`** → CV-101 idle windows won't derive unless CV-101 is also a run trigger. Add the env var + set CV-101 uns_path. |
| 15 | CV-101 / CV-200 / Northwind / SimLab naming & tenant aliases | **COLLISION, tenant-disambiguated** | P0 | One physical rig → two tenant identities → two UNS subtrees, **identical normalized_tag_path**; disambiguated ONLY by `tenant_id`. Plus a 2nd CV-101 identity in `create_bench_equipment_node.py`. Pin tenant + one canonical CV-101 uns before flipping the flag. |
| 5 | `approved_tags` → worker trust gate | **STATIC map, no parity guard** | P1 | Worker maps tag→topic via a hardcoded `CV101_TAG_TOPIC_MAP` dict, NOT a DB read; no test binds it to the seed. Add a drift-guard test (mirror `test_conveyor_allowlist_parity.py`). |
| 3 | machine memory → Ask MIRA context | **OPEN** | P1 | `context/route.ts` has NO `machine_memory` block; `build_event_context` used only by tests; neither chat surface reads run_diff. Add the ~5-line context block (Agent E's freebie). |
| 4 | run_diff/anomaly → work order | **OPEN** | P1 | `cmms_create_work_order` reachable only via REST/MCP/chat; zero callers from any anomaly path. Add an opt-in WO-draft hook off `run_diff` (critical severity), human-approved. |
| 14 | Litmus/Sparkplug/Ignition ingest → one contract (Contract 5) | **ENFORCED, path+lang-scoped** | P1 | Real ingest surfaces conform. But Contract 5 scans only `mira-relay/**` + `simlab/publishers.py` (Python) → **two direct `live_signal_cache` writers escape**: `tools/demo_plc_poller.py`, `mira-hub/src/lib/signal-recorder.ts`. Widen scan / add a TS guard. |
| 6 | PLC-import proposals (`ai_suggestions`) → `approved_tags`/`tag_entities` | **DISCONNECTED** | P2 | Accepting a proposal writes `tag_entities` (verified); relay allowlist reads only `approved_tags`; relay never reads `tag_entities`. An accepted PLC tag never becomes ingest-approved. Bridge on accept (write both, or promote). |
| 12 | Telegram/Slack `/faults` → same event source as Hub | **THREE disjoint surfaces** | P2 | `/faults`→`faults` (written by relay); `conveyor_events` write-only dead-end (stale README claims MCP reads it — false); `run_diff` in Neon, isolated. Converge on `run_diff`; delete/redirect `conveyor_events`. |
| 8 | electrical prints → cited answers | **UNWIRED** | P2 | `plc/conv_simple_electrical/**` has ZERO references in any ingest/retrieval path. Needs the (designed, unbuilt) wiring-print reader → `knowledge_entries`. |
| 13 | Ignition Ask MIRA vs Hub asset chat | **DIVERGENT stacks** | P2 | Ignition = Python Supervisor engine + `neon_recall`; Hub = TS `manual-rag` BM25 + `buildGraphContext`. Different languages, cascades, citation logic. Neither reads machine memory. Architectural; converge later. |
| 10 | telemetry → baseline learner | **TWO impls, one live** | P2 | `run_engine/baseline.py` (stdlib stats) writes `run_baseline` — the live path. `plc/conv_simple_anomaly/baseline_learner.py` (richer lo/hi range + lag, the PRD "difference engine") is orphaned to SimLab tests. Decide: adopt or retire. |
| 11 | `flaky_detector` → runtime | **DARK (built, no trigger)** | P2 | `flaky_detector.run()` has zero callers; self-documented "Phase-9 follow-up". Detection + proposal + store logic complete; needs a Celery beat entry (would feed `/proposals`). |
| 7 | documents/manuals → KG relationships | **CONNECTED (healthy)** | — (document) | Upload → `proposeDocumentEdgesForNode` → `HAS_DOCUMENT` in `relationship_proposals` → human decide → `kg_relationships`. Human-in-the-loop by design. No action; note kill switch `NODE_DOC_PROPOSALS=0`. |
| 9 | fault dictionary → recall/diagnosis | **NOT ON MAIN** | PARK | No SimLab fault dictionary in code; no `demo/` dir (`demo/factory_difference_engine` absent); `recall_fault_code` reads only the `fault_codes` table. Nothing to join yet. |

New seams surfaced during this audit (not in either source list) are folded into the sections above: **N1** = worker compose env gap (§1), **N2** = TS/tools ingest bypasses (§14), **N3** = CV-101 dual identity (§15), **N4** = worker-map has no parity guard (§5), **N5** = `conveyor_events` write-only dead-end + stale README (§12), **N6** = worker summary object consumed by nothing but logs (§3).

---

## Seam 1 — `tag_events` → machine-memory worker  ·  P0

**LEFT (source):** canonical `tag_events` (mig 033), fed by the relay REST/HMAC path (`mira-relay/tag_ingest.py:461` INSERT).
**RIGHT (worker):** `mira-crawler/tasks/historize_runs.py` — Celery task `tasks.historize_runs.historize_runs` (`:138`). Reads recent `tag_events` with its own minimal reader (`:68-135`), runs `run_historization` (runs/baselines/diffs) and `historize_machine_memory` (state windows + typed A0–A12 anomaly diffs, mig 040) (`:181-218`).

**Deployed / scheduled?** YES.
- Beat schedule: `mira-crawler/celeryconfig.py:143-152` `_HISTORIAN_SCHEDULE` runs `historize-runs` every 30 s (and `tag-diff-historizer` every 5 min), selected by `CELERY_BEAT_PROFILE=historian`.
- Containers: `docker-compose.saas.yml:812` `mira-historian-worker` (`celery … worker -Q historian`) + `:841` `mira-historian-beat` (`celery … beat`, `CELERY_BEAT_PROFILE=historian` at `:853`).
- Rate-limit cap: `celeryconfig.py:110` `"tasks.historize_runs.historize_runs": {"rate_limit": "4/m"}`.

**Why it produces nothing today (the gap, not "not connected"):**
1. **Flag off.** `historize_runs.py:52-53` `_enabled()` returns `MIRA_RUN_DIFF_ENABLED == "1"`; task returns `{"status":"disabled"}` otherwise. Compose default `MIRA_RUN_DIFF_ENABLED=${MIRA_RUN_DIFF_ENABLED:-0}` (`saas.yml:829`). **This is exactly the CV-101 proof's "staging flag" step.**
2. **NEW (N1) — compose env is missing the machine-memory vars.** `historize_runs.py:17,155-159` reads `MIRA_MACHINE_MEMORY_UNS_PATHS` (extra uns_paths to derive state windows + anomalies for even WITHOUT a run trigger). `saas.yml:826-833` plumbs only `MIRA_RUN_TRIGGERS` — **`MIRA_MACHINE_MEMORY_UNS_PATHS`, `MIRA_RUN_K_SIGMA`, `MIRA_RUN_LOOKBACK_SECONDS` are NOT in the worker env.** Consequence: with 3 of the 4 CV-101 fixtures being *idle/fault* states (e-stop, comm-stale — no run trigger ever rises), the machine-memory pass will derive **zero** windows/anomalies for CV-101 unless CV-101's uns_path is supplied as a run trigger. `K_SIGMA`/`LOOKBACK` fall back to safe defaults (3.0 / 3600 s).
3. **Worker SQL never CI-exercised against live Postgres** (`run_engine/store.py:12-13`, per Agent A / D8) — staging-first is mandatory before prod enable.

**Smallest SAFE step (P0):** in `docker-compose.saas.yml` `mira-historian-worker` env, add `MIRA_MACHINE_MEMORY_UNS_PATHS=${MIRA_MACHINE_MEMORY_UNS_PATHS:-}` (+ optionally `MIRA_RUN_K_SIGMA`, `MIRA_RUN_LOOKBACK_SECONDS` for tuning), then on staging set `MIRA_MACHINE_MEMORY_UNS_PATHS=enterprise.home_garage.conveyor_lab.conveyor_1` and `MIRA_RUN_DIFF_ENABLED=1`. No code change; no prod write. This is the enablement half of the proof.

---

## Seam 2 — machine-memory tables → Hub card  ·  P0 (verify-only, CLOSED today)

**Closed by #2406** (`eceeaf66`).
**RIGHT (route):** `mira-hub/src/app/api/assets/[id]/machine-memory/route.ts` reads REAL tables — `machine_run` (`:75-84`), `machine_state_window` (`:90-99`, 040-tolerant try/catch on `42P01/42703`), `run_diff` with 040 typed-anomaly columns and a 038-only fallback (`:108-136`). Resolves `uns_path` from `kg_entities` (`:53-63`) — deliberately NOT joining `cmms_equipment` (uuid=text hazard, comment `:49-52`). Tenant via `withTenantContext` + `$1::uuid AND uns_path=$2::ltree`. Empty state is first-class (`:65-72`).
**Consumer:** `mira-hub/src/app/(hub)/assets/[id]/page.tsx:14` imports and `:304` renders `<MachineMemoryCard assetId={assetId} />`; component `mira-hub/src/components/MachineMemoryCard.tsx`.

**Verdict:** the "→ card" endpoint of the CV-101 proof is built and reads real tables. No gap. The card will render populated the moment Seam 1 writes the first CV-101 `run_diff`/window row. **Action: none — verify live after the flag flips.**

---

## Seam 3 — machine memory → Ask MIRA context  ·  P1

**LEFT:** persisted machine memory (`machine_run`/`run_diff`/`machine_state_window`) + the worker's return summary (`historize_runs.py:209-218` `machine_memory` dict) + the offline `plc/conv_simple_anomaly/event_context.py::build_event_context` (renders a `MachineEvent` into a grounded prompt block).
**RIGHT:** Ask MIRA surfaces — `mira-bots/ask_api/app.py`, the Hub `context/route.ts` (#2402), the Hub asset chat.

**Why not connected (proof):**
- `mira-hub/src/app/api/assets/[id]/context/route.ts` has **no** `machine_memory` / `machine_run` / `run_diff` reference (grep: NONE). Agent E's "optional +5-line freebie" block was **not** taken.
- `build_event_context` is consumed ONLY by tests: `plc/conv_simple_anomaly/test_event_context.py`, `tests/simlab/test_difference_engine.py:122`. No `ask_api` import (grep of `mira-bots/ask_api/` for `machine_event_id`/`machine_memory`/`event_context` → NONE). Matches sweep §2 broken-link #6 (`event_context.py:14-17` planned `machine_event_id` unimplemented).
- **NEW (N6):** the worker's `machine_memory` return summary is consumed by nothing beyond `logger.info` (`historize_runs.py:223-230`); the read side is the Hub route querying tables directly, not the worker object.

**Smallest SAFE step (P1):** add a `machine_memory` block to `context/route.ts` (it already resolves `uns_path`) — query the latest `run_diff`/window and attach. Ask MIRA then grounds on machine memory for free. Read-only, ~5 lines, mirrors the machine-memory route's queries.

---

## Seam 4 — run_diff/anomaly → work order  ·  P1

**LEFT:** anomaly outputs — `mira-crawler/run_engine/store.py` / `machine_memory.py` (`run_diff` rows), `plc/conv_simple_anomaly/anomaly_log.py`, `mira-relay/flaky_detector.py`.
**RIGHT:** `cmms_create_work_order` — def `mira-mcp/server.py:305` (→ `cmms_write_work_order` → adapter `create_work_order`, base contract `mira-mcp/cmms/base.py:33`).

**Why not connected (proof):** grep for `work_order|cmms|create_work` across `mira-crawler/run_engine/`, `plc/conv_simple_anomaly/`, `mira-relay/` → **zero matches**. The only `cmms_create_work_order` callers are the MCP tool decorator (`server.py:304`) and the REST wrapper `rest_cmms_create_work_order` (`server.py:894`, `POST /api/cmms/work-orders` at `:1289`). All other `create_work_order` callers are human/chat/seed (`mira-bots/shared/engine.py:2879,3064`; `pm_suggestions.py:112`; `mira-hub/src/lib/atlas/sync.ts:273`; web csv/seed). Matches sweep §2 broken-link #4. Anomaly persistence terminates at `run_diff` with no downstream call.

**Smallest SAFE step (P1, after the proof):** a small, opt-in worker step that, on a NEW `critical`-severity `run_diff`, drafts a work order via the existing `cmms_create_work_order` contract in a **proposed/draft** state for human approval (never auto-dispatch; respects read-only-in-beta). Gate behind its own flag.

---

## Seam 5 — `approved_tags` → worker trust gate  ·  P1

**Question:** does the worker load the allowlist from the DB, or a static mapping? Who maintains the CV-101 mapping when tags change?

**Answer:** **STATIC mapping, not a DB read.** `mira-crawler/run_engine/snapshot.py:42` defines `CV101_TAG_TOPIC_MAP: dict[str,str]` — a hardcoded module constant translating `normalized_tag_path` → rules topic (e.g. `default_conveyor_vfd_comm_ok → vfd/vfd101/comm_ok`). It is derived by hand from `context_model.cv101.json` × `tools/seeds/approved_tags_conveyor.sql` (docstring `:9-17`). No runtime `approved_tags` query in `snapshot.py` or `machine_memory.py` (grep: only doc-comment mentions). Unmapped tags are excluded and counted (`snapshot.py:133-145`) — an unapproved tag never enters a snapshot (correct, fail-closed).

**The gap (N4):** a parity guard exists for gateway JSON ⇄ relay SQL seed (`tests/test_conveyor_allowlist_parity.py`) but **none binds `CV101_TAG_TOPIC_MAP` to the seed.** When the seed adds/renames a `normalized_tag_path`, the worker map silently misses it (tag excluded, counted as `unmapped_tags`, no anomaly fed). The CV-101 mapping is maintained by a human editing `snapshot.py`. Notably `CV101_TAG_TOPIC_MAP` also has **no** torque/rpm/power topics — consistent with the sparse-map/HR117-124 caveat (the 6 VFD-analyzer tags are gateway-only, `test_conveyor_allowlist_parity.py:56-64`).

**Smallest SAFE step (P1):** add a deterministic test asserting every `CV101_TAG_TOPIC_MAP` key exists as a `normalized_tag_path` in `approved_tags_conveyor.sql` (and document the intentional non-rule-input exclusions), mirroring the existing parity test. Turns silent drift into a red build.

---

## Seam 6 — PLC-import proposals (`ai_suggestions`) → `approved_tags` / `tag_entities`  ·  P2

**LEFT (Hub accept → tag_entities):** `mira-hub/src/lib/suggestion-accept.ts:137` `INSERT INTO tag_entities (… approval_state 'verified', proposed_by 'import:plc_parser' …)` when a `tag_mapping` `ai_suggestions` row is accepted (`decideSuggestion` `:188-189`). Proposals created by `mira-hub/src/lib/plc-proposals.ts` + `api/connectors/plc/import/route.ts`. Mig `025_tag_entities.sql:24`: "writers MUST go through `ai_suggestions`".
**RIGHT (ingest allowlist reads approved_tags):** `mira-relay/tag_ingest.py:286` `load_allowlist()` → `SELECT normalized_tag_path, uns_path FROM approved_tags WHERE … enabled=true` (`:296`). Writers of `approved_tags`: (a) seed SQL only (`tools/seeds/approved_tags_*.sql`, all `enabled=true`); (b) relay self-discovery `record_seen_tags()` (`tag_ingest.py:365`, INSERT `enabled=false`). Table mig `035_approved_tags.sql:39`.

**Why not connected (proof):** `suggestion-accept.ts` never writes `approved_tags` (no `INSERT/UPDATE approved_tags` anywhere in `mira-hub/src`); the relay never reads `tag_entities` (grep `tag_entities` in `mira-relay/` → zero). **Two disconnected worlds:** an accepted PLC-import proposal materializes a verified `tag_entities` row (Hub-queryable) that does NOT populate the `approved_tags` allowlist gating real ingest; `approved_tags` is fed only by seeds + relay self-discovery.

**Smallest SAFE step (P2):** on proposal accept, additionally upsert an `approved_tags` row (`enabled=false`, pending a human "enable"), or add a Hub action that promotes a verified `tag_entity` into `approved_tags`. Not on the CV-101 proof path (CV-101 uses the seed), but it's the onboarding→ingest bridge for real customers.

---

## Seam 7 — documents/manuals → KG relationships  ·  CONNECTED (document only)

**Healthy, human-in-the-loop.** Upload finishes parsing (`mira-hub/src/lib/node-knowledge-ingest.ts:344`) → fire-and-forget `proposeDocumentEdgesForNode` (`:350`) → `mira-hub/src/lib/node-document-proposals.ts:149-158` `upsertInferredProposal({ relationshipType:"HAS_DOCUMENT", targetEntityType:"manual", evidence:[document_page chunks] })` writes `relationship_proposals` (status `proposed`, never auto-verified) → human approves via `api/proposals/[id]/decide/route.ts` → `INSERT INTO kg_relationships (… approval_state='verified')` (`:207`), and `markDocumentChunksVerified` flips `knowledge_entries.verified=true` for `HAS_DOCUMENT` (`:53-79`). Crawler path mirrors this: `mira-crawler/ingest/kg_writer.py:150-206` routes through `proposal_writer.propose_relationship` unless `MIRA_KG_INGEST_AUTOVERIFY` (default off). Type canonicalization `has_manual`/`documented_in` → `HAS_DOCUMENT` at `proposal_writer.py:70-71` + `canonical-relationship-type.ts:46-47`.

**Action: none.** Note the kill switch `NODE_DOC_PROPOSALS=0` (`node-document-proposals.ts:172`) disables proposal generation (chunks still ingested, no edge proposed).

---

## Seam 8 — electrical prints → cited answers  ·  P2

**LEFT:** `plc/conv_simple_electrical/` — model-first package (`model/*.yaml`, `render_sheet.py`, rendered `sheets/E-005_plc_inputs.*`, `E-007_rs485_modbus.*`).
**RIGHT:** retrieval/ingest that could cite — `mira-bots/shared/neon_recall.py::recall_knowledge` (reads `knowledge_entries`/`fault_codes`), `mira-hub/src/lib/manual-rag.ts`, `mira-crawler/ingest/`.

**Why not connected (proof):** repo-wide search for `conv_simple_electrical|e007_rs485|E-005|E-007` → **zero hits in any code path** (only docs/CHANGELOG). The prints are never chunked, embedded, or inserted into `knowledge_entries`/`fault_codes`; no ingest connector exists in `mira-crawler/ingest/` for them. Corroborated by the sweep (prints "not consumed by any answer path"). An untracked `mira-bots/shared/wiring_diagram/` module is a diagram *generator*, not an ingest of these prints.

**Smallest SAFE step (P2):** the designed-but-unbuilt wiring-print READER path — extract the `model/*.yaml` structured facts into `knowledge_entries` (UNS-tagged, page/sheet cited) so retrieval can surface them. Off the CV-101 telemetry proof; belongs to the grounded-answers track.

---

## Seam 9 — fault dictionary → recall/diagnosis  ·  PARK

**RIGHT (recall):** `mira-bots/shared/neon_recall.py:323` `recall_fault_code(code, tenant_id, model)` → `SELECT … FROM fault_codes WHERE tenant_id=… AND code=…` (`:350-361`); table `docs/migrations/002_fault_codes.sql:7`; only caller `recall_knowledge()` (`neon_recall.py:836`, Stage-2 structured lookup); write path `mira-core/scripts/extract_fault_codes.py`.
**LEFT (SimLab fault dictionary):** **does not exist in code.** `fault_dictionary`/`fault_bundle` appear only in the sweep doc, not in `simlab/` or `tests/simlab/`. `demo/factory_difference_engine` is **absent** — no `demo/` directory at repo root (referenced but not on main). Matches sweep §2 broken-link #5.

**Verdict:** nothing to join. `recall_fault_code` reads only the `fault_codes` table. PARK until a fault-dictionary artifact lands on main.

---

## Seam 10 — telemetry → baseline learner  ·  P2

**Two DIFFERENT implementations; one is live:**
- **Live path:** `mira-crawler/run_engine/baseline.py::compute_baseline` (stdlib `statistics` only; per-tag per-phase over last N normal runs) → persisted `INSERT INTO run_baseline` at `run_engine/store.py:590` (read back `:637`). This is what the worker uses (`pipeline.run_historization`).
- **Orphaned:** `plc/conv_simple_anomaly/baseline_learner.py` — the PRD "signal difference engine" learner (dual Py2.7/3.12; learns lo/hi normal RANGE + mean/stddev + paired-signal LAG; richer than the live one). Its ONLY consumer is `tests/simlab/test_difference_engine.py:30`. Not imported by `run_engine`.

**Verdict:** they are **not** the same and not connected. The live worker uses the simpler stats baseline; the richer PRD learner is unused in production. **Smallest SAFE step (P2):** decide explicitly — either adopt `baseline_learner`'s range/lag concepts into `run_engine/baseline.py`, or mark `baseline_learner.py` SimLab-only in its header. No behavior change needed for the CV-101 proof.

---

## Seam 11 — `flaky_detector` → runtime  ·  P2

**LEFT (source):** `mira-relay/flaky_detector.py` reads the raw `tag_events` stream (mig 033) for configured digital-input tags, counts transitions, records `flaky_input_signals` alerts (mig 034) with real `evidence_event_ids`, and (Phase 8) opens a `relationship_proposals` + `ai_suggestions(kg_edge)` edge into the Hub `/proposals` queue (never auto-verified).
**RIGHT (runtime):** none. `flaky_detector.run()` has **zero external callers** (grep across repo, docker-compose, celeryconfig → none). Self-documented: "Runtime trigger (the worker/cron that calls run()…) is a documented Phase-9 follow-up" (`flaky_detector.py:35-37`). Matches sweep §2 broken-link #7.

**Verdict:** built-but-dark — detection + proposal + store boundary + tests complete; no scheduler. **Smallest SAFE step (P2):** add a beat entry (mirror `historize-runs`, own flag) once a live window + tenant are configured; it would feed the reviewer queue, growing the KG from real chatter. Off the CV-101 proof path.

---

## Seam 12 — Telegram/Slack `/faults` → same event source as Hub  ·  P2

**THREE disjoint fault surfaces, never joined:**
1. **`/faults` → `faults` (SQLite).** Handlers `mira-bots/telegram/bot.py:847` + `mira-bots/slack/bot.py:236` → HTTP `GET {MCP_BASE_URL}/api/faults/active` → `mira-mcp/server.py:1286` → `rest_active_faults` (`:881`) → `list_active_faults()` (`:175`) → `SELECT * FROM faults WHERE resolved=0` (`:180`). **Writer of `faults`:** `mira-relay/relay_server.py:172` `INSERT INTO faults (…)` — NOT the PLC anomaly engine. DB `/data/mira.db` (`server.py:19`).
2. **`conveyor_events` (SQLite) — write-only dead-end (N5).** Writers: `plc/conv_simple_anomaly/engine.py:126` + `mira-fault-detective/engine.py:81` (both DB `/mira-db/mira.db`). **No reader:** no `SELECT/FROM conveyor_events` anywhere; `mira-mcp/server.py` has zero references. **Stale doc:** `plc/conv_simple_anomaly/engine.py:7` / `README.md:9` claim MCP `/api/faults/active` reads it — **contradicted by `server.py:180`, which reads `FROM faults`.** Even the two SQLite paths default to different files (`/data/mira.db` vs `/mira-db/mira.db`).
3. **`run_diff` (NeonDB) — the go-forward surface.** Written only by `run_engine/store.py` (mig 038/040), read only by the Hub machine-memory route. Isolated from both SQLite surfaces.

**Smallest SAFE step (P2):** treat `run_diff` (Neon) as the single go-forward fault surface; redirect `/faults` to read it (or an anomaly view over it) and **fix or delete** the stale `conveyor_events` README claim. Not on the CV-101 telemetry proof, but a real correctness/expectation bug.

---

## Seam 13 — Ignition HMI Ask MIRA vs Hub asset chat  ·  P2

**Two entirely separate implementations; neither reads machine memory.**
- **Ignition (`mira-pipeline/ignition_chat.py`):** thin HTTP wrapper delegating ALL reasoning to the Python Supervisor engine — `reply = await engine.process(...)` (`:608-615`); grounding = the engine's own retrieval (`mira-bots/shared/engine.py:86` imports `neon_recall`; retrieval in `mira-bots/shared/neon_recall.py`). Adds a live tag-snapshot preamble enriched from `tag_entities` (`ignition_chat.py:202-294`).
- **Hub asset chat (`mira-hub/src/app/api/assets/[id]/chat/route.ts`):** self-contained TypeScript; own retrieval `retrieveManualChunks`/`runBm25Query` from `@/lib/manual-rag` (`:8-15,288`; `manual-rag.ts:274`) + `buildGraphContext` (`:332`) + `cmms_equipment` row; own inline Groq→Cerebras→Gemini cascade (`:65-159`). Does NOT call the Python engine.

**Shared?** No shared retrieval module — different languages, cascades, citation logic; they converge only on the "Ask MIRA" name and the underlying Neon tables. **Machine memory:** absent from both — `mira-bots/**` has zero `machine_run`/`run_diff`/`machine_memory` references; `route.ts` builds context only from `cmms_equipment` + manual chunks + KG.

**Verdict:** architectural divergence, not on the CV-101 proof path. **Smallest SAFE step (P2):** longer term, factor a shared grounding contract; near term, at least give BOTH the machine-memory context block (see Seam 3) so the two surfaces answer consistently about live machine behavior.

---

## Seam 14 — Litmus/Sparkplug/Ignition ingest → one contract (Contract 5)  ·  P1

**Contract 5** = `tests/test_architecture.py:256` `test_ingest_surface_obeys_one_pipeline`. **Scan globs** (`:154-158`): `mira-relay/*.py`, `mira-relay/**/*.py`, `simlab/publishers.py` (excludes tests). **Allowlist** (`:162-174`): `ingest_contract.py`, `tag_ingest.py`, `relay_server.py`. **Enforces** (`scan_ingest_module` `:201-240`): no rival `normalize_tag_path`/`build_ingest_batch`/`ingest_batch`/`load_allowlist`, no inline `{source_system,tags}` batch, no direct `INSERT/UPDATE tag_events|live_signal_cache` (`_STORE_WRITE_RE` `:188`), no direct `approved_tags` query.

**Covered & conforming:**
- **Sparkplug/MQTT subscriber** is under `mira-relay/mqtt_ingest/**` → scanned, and conforms: `subscriber.py:25-26` imports `build_ingest_batch`+`ingest_batch`, `flush()` emits ONE `ingest_batch` (`:124-154`); "NO allowlist check, NO normalizer, NO direct tag_events write" (`:14-15`). Codec `mqtt_ingest/codecs/sparkplug_b.py`.
- **Litmus** (`plc/litmus/mira_on_litmus.py`): a PARALLEL bench read that explicitly "does NOT touch ingest_contract / ingest_batch / tag_events" (`:5`) — it feeds the local rules, never lands the canonical store. Not a bypass; a non-ingesting bench tool (and `plc/**` is outside the scan by construction).

**BYPASS PATHS not covered by the scan (N2):** the guard is **path- AND language-scoped**, so two direct `live_signal_cache` writers escape it:
1. `tools/demo_plc_poller.py:457` — its own `INSERT INTO live_signal_cache … ON CONFLICT` (`_sync_db_write` `:440-479`, own `SCHEMA_DDL`). "Pushes to mira-relay + NeonDB" (header) — the NeonDB half writes the canonical store directly. Path `tools/*.py` is outside the scan globs → **uncaught** (bench/demo tool, read-only vs PLC).
2. `mira-hub/src/lib/signal-recorder.ts:179,194` — `INSERT INTO live_signal_cache … ON CONFLICT (tenant_id, plc_tag)`, used by Hub `api/demo/signals/*` and `api/mira/ask/route.ts`. Contract 5 is Python-only (`ast.parse`, `.py` glob) → **structurally invisible** (demo/seed path, but it is a real canonical-store write).

**Smallest SAFE step (P1):** (a) widen the scan globs to include `tools/**.py` that touch the canonical stores, or explicitly allowlist `demo_plc_poller.py` with a "bench-only" reason; (b) add a lightweight TS guard (grep/CI check) forbidding `INSERT … live_signal_cache|tag_events` outside a sanctioned Hub helper. The real relay ingest (the CV-101 proof path) is compliant — this hardens the law, doesn't block the proof.

---

## Seam 15 — CV-101 / CV-200 / Northwind / SimLab naming & tenant/UNS aliases  ·  P0

**Canonical bindings:**
- **CV-101** (Home Garage bench rig) → `enterprise.home_garage.conveyor_lab.conveyor_1`, demo tenant (`__TENANT_ID__`). Seeds: `tools/seeds/factorylm-garage-conveyor.sql:44`, `tools/seeds/approved_tags_conveyor.sql:37-58` (source paths `[default]Mira_Monitored/conveyor_demo/*`, `[default]Conveyor/*`). Pinned by `tests/test_approved_tags_conveyor_seed.py:32` and `tests/test_northwind_cv200_seed_and_config.py:26` (`GARAGE_UNS`).
- **CV-200 / Northwind** (Discharge Conveyor) → `enterprise.riverside.area.packaging.line.line1.equipment.discharge_conveyor_cv200`, Northwind tenant `…0000b1`. Seeds: `tools/seeds/northwind-bottling-hub.sql:160-162` (cmms `CNV-200` `:231`), `tools/seeds/approved_tags_northwind_cv200.sql:37-48`. `tests/test_northwind_cv200_seed_and_config.py:25` `CV200_UNS`.

**CV-200 is NOT a SimLab alias — it is a dual-publish over the SAME PHYSICAL RIG as CV-101.** `approved_tags_northwind_cv200.sql:6-11`: "…ADDS a Northwind-tenant allowlist for the SAME physical rig (Micro820 + GS10), mapped onto the CV-200 UNS subtree… the gateway timer publishes the rig tags a SECOND time as the Northwind tenant — ADD, never repoint." The genuinely synthetic/SimLab-style Northwind assets are the OTHER bottling machines (rinser/filler/capper/labeler/palletizer, `northwind-bottling-hub.sql:116-134`, mirroring `tests/simlab/scenarios/juice_*`). SimLab's own filler lives under a THIRD namespace entirely: `enterprise.florida_natural_demo.plant1.juice_bottling.line01.filler01` (`simlab/docs/filler01/*`).

**THE COLLISION (N3):**
- **Same tag path, two identities.** CV-101 and CV-200 share the EXACT `source_tag_path` AND `normalized_tag_path` (e.g. `[default]Mira_Monitored/conveyor_demo/State` → `default_mira_monitored_conveyor_demo_state` in BOTH `approved_tags_conveyor.sql:37` and `approved_tags_northwind_cv200.sql:37`), resolving to two DIFFERENT uns_paths under two DIFFERENT tenants — disambiguated ONLY by `tenant_id` (PK `(tenant_id, source_system, source_tag_path)`). **Any code that keys on tag path without pinning tenant cross-maps CV-101 ↔ CV-200.** This directly threatens the CV-101 proof: the worker's `CV101_TAG_TOPIC_MAP` (Seam 5) and `MIRA_MACHINE_MEMORY_UNS_PATHS` (Seam 1) must be scoped to the garage tenant + garage uns, or a Northwind-tenant publish of the same rig would land under the wrong machine memory.
- **CV-101 has a SECOND identity.** `tools/create_bench_equipment_node.py:36` sets uns `factorylm.bench.conv_simple.cv101`, tenant `factorylm`, MQTT prefix `demo/cell1/conveyor/cv101` — same "cv101" name, DIFFERENT tenant + uns than the `home_garage` seed. Two CV-101 truths in the tree.
- **Adjacent confusable:** CV-100 (`conveyor_cv100`, non-live accumulation conveyor) in the SAME Northwind seed (`northwind-bottling-hub.sql:143-145`, cmms `CNV-100`) — differs from CV-200 by one digit.
- **Minor drift:** Northwind equipment ltrees start `enterprise.riverside.*` while the enterprise-node label/comment is `enterprise.northwind.site.riverside.*` (`northwind-bottling-hub.sql:100`). Equipment rows are internally consistent (kg_entities ⇄ approved_tags both `enterprise.riverside…`), so binding works, but the prefix label is inconsistent.

**Smallest SAFE step (P0):** before flipping `MIRA_RUN_DIFF_ENABLED=1` for the CV-101 proof, (1) pin the worker to the **garage tenant UUID + `enterprise.home_garage.conveyor_lab.conveyor_1`** explicitly (both `MIRA_TENANT_ID` and `MIRA_MACHINE_MEMORY_UNS_PATHS`), and (2) decide/document ONE canonical CV-101 identity — either reconcile `create_bench_equipment_node.py` to the `home_garage` seed or mark it a distinct dev fixture. Tenant scoping already protects ingest (PK includes tenant); the risk is any tenant-blind reader downstream.

---

## Cross-cutting notes

- **What today's merges CLOSED vs the sweep's §2 list:** the machine-memory worker (Seam 1) + mig 040 give `tag_events → typed A0–A12 anomaly persistence` a real, if flag-gated, path — softening sweep broken-links #1 and #2 (the team chose mig 040 `run_diff`/`machine_state_window` over a `machine_events` table). Seam 2 (card) is fully closed. Broken-links #4 (WO), #5 (fault dict), #6 (event_context→ask), #7 (flaky), #8 (Litmus parallel) remain OPEN and are Seams 4/9/3/11/14 here.
- **The CV-101 proof is gated by three things, all P0:** the flag + missing compose env (Seam 1), a tenant/uns pin against the CV-101↔CV-200 collision (Seam 15), and the already-closed card (Seam 2). The worker's static tag map (Seam 5) works for the seeded tags today but should get a drift guard before it's trusted long-term.
- **One healthy seam** (Seam 7, docs→KG) is the model to copy: source → proposal → human decide → verified edge. The gap seams mostly lack the "proposal/persist → surface" back half.

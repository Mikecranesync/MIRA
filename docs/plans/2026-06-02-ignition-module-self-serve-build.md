# Ignition-Module Self-Serve — Build Execution Plan

**Status:** ACTIVE BUILD — sub-agent task breakdown + dispatch log
**Authored:** 2026-06-02
**Owner:** Mike Harper
**Parent plan:** `docs/plans/2026-06-01-mira-master-architecture-plan.md` (phases 0–13 + 12-agent dispatch)
**Reframes around:** the **downloadable Ignition Module** a company installs themselves and into which they **enter their own UNS structure** — the self-install/self-configure wedge (`docs/strategy/services-vs-saas-pricing-fork.md` §4.1).

> **What "self-serve" means here.** Not card-swipe billing. A company **downloads the Module from the Ignition Exchange, installs it, enters their UNS structure, and picks their tags** — and within ~30 min a technician gets a grounded answer in Perspective. This plan slices the master plan + the Ignition secure-architecture checklist (D1–D12) into **short, independent, sub-agent-sized tasks** and tracks dispatch.

---

## 0. Build rules (every sub-agent obeys)

- **Base:** worktree off `origin/main` (`feat/ignition-module-self-serve`). origin/main migrations top out at **029**; 030/031 are unmerged command-center work, so new migrations start at **032** (master-plan reservation) — if a collision appears, suffix `032b_*`.
- **3-command pre-flight** is unnecessary inside the dispatched task (the orchestrator pinned the base); each agent instead **writes only the files in its allow-list at the absolute paths given** and returns a summary + the exact paths written. The orchestrator commits.
- **Hard constraints (locked):** No Anthropic. No LangChain/TF/n8n. No customer-shipped Modbus/OPC-UA/EtherNet-IP socket (Ignition is the read path). No PLC writes. `Optional[X]` typing, ruff, httpx, NullPool. Conventional Commits. Doppler for secrets. Never apply migrations to prod; staging dry-run only.
- **Engine edits require `codegraph_impact` first** and golden-test regression — those tasks run in the **main checkout** (where the codegraph index lives), not the worktree. Flagged per-task.
- **Model policy:** sonnet for write/architect tasks, haiku for pure search.

---

## 1. The self-serve journey this build delivers

```
DOWNLOAD            INSTALL              CONNECT             ENTER UNS            MAP TAGS            ASK
Ignition Exchange → deploy_ignition.ps1 → tag-stream.py    → Hub /namespace     → tag-import wizard → Perspective
listing (D9)        (3-cmd installer)     (allowlisted,       (customer builds     (CSV → tag→UNS      "Ask MIRA"
                                          outbound HTTPS)      their own tree)      proposals)         grounded answer
   │                    │                     │                   │                    │                  │
  Phase G            Phase A/C             Phase A/B           Phase C             Phase C            Phase D
```

Every box is a phase below. The customer never needs a FactoryLM engineer to traverse it.

---

## 2. Phases → waves → tasks

Each **task** is scoped to be completable by one sub-agent in a focused session. Tasks within a wave are **independent** (disjoint files) and run in parallel. Waves are gated by dependency.

### PHASE A — Foundation (Wave 1, dispatching now)

| Task | Scope (allow-list) | Deny | Acceptance | Model |
|---|---|---|---|---|
| **A1 — Schema** | `mira-hub/db/migrations/032_decision_traces.sql` … `037_*.sql` (per master-plan §D2) + `docs/adr/0022-decision-trace-storage.md` | engine `docs/migrations/*`; existing tables (column-add only) | 6 migration files with the index sets from §D2; ADR written; SQL parses; references resolve (`troubleshooting_sessions`, `ai_suggestions` exist on origin/main) | sonnet |
| **A2 — Mock collector** | `tools/mock_tag_stream.py` + `tools/scenarios/{conveyor_normal,conveyor_flicker,conveyor_gs10_f0004}.yaml` | `mira-relay/relay_server.py` core; `plc/*` | Reads a YAML scenario, emits rising/falling/value_changed + fault-window events to `mira-relay /ingest` on a tick loop; `--dry-run` prints events; ruff clean | sonnet |
| **A3 — Tag allowlist (self-serve UNS core)** | `ignition/project/approved_tags.json` (seed ~36 conveyor tags) + allowlist filter in `ignition/webdev/FactoryLM/api/tags/doGet.py` + `ignition/tests/test_allowlist.py` | other WebDev handlers; gateway scripts | `/tags` returns only allowlisted paths; non-allowlisted → 404; test asserts it (Ignition secure-arch D1, §10.6 task 1) | sonnet |

**Why these three first:** A1 is the dependency root for every later data task; A2 unblocks Phases B/E without hardware; A3 is the trust primitive the self-serve Module *must* have before anyone downloads it. All three touch disjoint directories — zero conflict.

### PHASE B — Current-state pipeline (Wave 2, after A1+A2)

| Task | Scope | Acceptance |
|---|---|---|
| **B1 — Relay allowlist enforcement** | `mira-relay/auth.py` allowlist check + `approved_tags` table read (file→table cutover, dual-write window) | relay drops non-allowlisted tags with 403; HMAC path stubbed (D4 follow-up) |
| **B2 — Diff logger (`tag_events`)** | `mira-relay/diff_logger.py` + `mira-relay/rollup_worker.py` (master-plan Phase 5) | `/ingest` → one `tag_events` row per non-noop diff; fault-window open/close; nightly rollup |
| **B3 — HMAC upgrade** | `mira-relay/relay_server.py` bearer→HMAC+nonce+tenant (Ignition secure-arch D4) + sign in `ignition/gateway-scripts/tag-stream.py` | HMAC verified; bearer kept behind `RELAY_LEGACY_BEARER=1` for bench |

### PHASE C — Self-serve UNS entry (Wave 3, the heart)

| Task | Scope | Acceptance |
|---|---|---|
| **C1 — Tag-import wizard backend** | CSV → `ai_suggestions` of type `tag_mapping` (Ignition secure-arch D8; namespace-builder spec §AI Pipeline) | upload a tag CSV → mapping proposals in `/proposals` |
| **C2 — UNS-entry guided flow** | Hub `/namespace` "build your tree" affordance — customer adds site→area→line→machine, tags attach to leaves | customer creates a UNS path + attaches a tag without an engineer |
| **C3 — Cloud Ignition chat endpoint** | `POST /api/v1/ignition/chat` wrapper (Ignition secure-arch D3) — wraps engine, returns `{answer, sources, confidence}` | synthetic question → UNS gate fires → cited answer |
| **C4 — Perspective ChatPanel view** | `ignition/project/.../views/ChatPanel/resource.json` (D6) + repoint `chat/doPost.py` to cloud (D2) | technician asks in Perspective → grounded answer with citations |

### PHASE D — Engine grounding (Wave 4, MAIN CHECKOUT — codegraph required)

| Task | Scope | Acceptance |
|---|---|---|
| **D1 — Direct-connection source flag** | `mira-pipeline/ignition_chat.py` set `state["uns_context"]["source"]="direct_connection"`; `engine.py` gate branch (master-plan Phase 6) | Ignition chat skips chat-gate; missing `asset_context` → 422; `mira-run-hallucination-audit` clean |
| **D2 — Citation enforcement** | `citation_compliance.py` enforce mode + `engine.py` hook (Phase 7) | uncited reply rewritten or replaced with KB-gap admission |
| **D3 — Decision-trace writer** | `mira-bots/shared/decision_trace.py` + wire into `Supervisor.process_full` (Phase 8) | one `decision_traces` row per turn |

### PHASE E — Flaky detection + demo (Wave 5, after B2)

| Task | Scope | Acceptance |
|---|---|---|
| **E1 — FlakyInputDetector** | `mira-bots/agents/flaky_input_detector.py` + `flaky_rules.py` (Phase 9) | `conveyor_flicker.yaml` → `flaky_input_signals` row + `ai_suggestions(flaky_signal_alert)` |
| **E2 — Demo runbook execution** | run `docs/demos/walker-aligned-bench-flywheel-demo.md` end-to-end; capture screenshots | promo screenshots per Screenshot Rule |

### PHASE F — KG proposal loop (Wave 4, parallel with D)

| Task | Scope | Acceptance |
|---|---|---|
| **F1 — Proposal-transition helpers** | `mira_bots/shared/proposal_transition.py` + `mira-hub/lib/proposal-transition.ts` (ADR-0017) | status updates go through helper |
| **F2 — kg_writer re-route** | `mira-crawler/ingest/kg_writer.py` → `relationship_proposals` not direct insert (Phase 3) | `grep 'INSERT INTO kg_relationships'` outside helper = 0 |

### PHASE G — Module packaging (Wave 6, after C)

| Task | Scope | Acceptance |
|---|---|---|
| **G1 — Ignition Exchange manifest** | `ignition/EXCHANGE/manifest.json` + screenshots + install doc + license (D9) | a stranger can download + install from the listing |
| **G2 — Agent tool layer** | `mira-mcp/server.py` add `get_asset_context`, `read_tag_value`, etc. (Phase 11) | tools registered + tenant-enforced |

---

## 3. Dependency order (critical path)

```
A1 ─┬─ B1 ─ B2 ─┬─ E1 ─ E2
    │           └─ G2
A2 ─┘
A3 ─── B1
        B2 ─ B3
C1 ─ C2 ─ C3 ─ C4 ─ G1     (C can start once A3 lands)
D1 ─ D2 ─ D3               (main checkout; parallel with C)
F1 ─ F2                    (parallel)
```

Truly parallel now: **A1, A2, A3** (Wave 1). Everything else gates on these.

---

## 4. Dispatch log

| Wave | Task | Agent | Status | Output paths | Notes |
|---|---|---|---|---|---|
| 1 | A1 Schema | sonnet | ✅ **done** (bc64e8b3) | `mira-hub/db/migrations/032–037`, `docs/adr/0022` | FKs resolve to 019/027/018; ltree guarded; CHECK constraints added. **Not applied to any DB** — staging dry-run pending. 037 adds real `relationship_proposal_id` FK (was JSONB soft-ref). |
| 1 | A2 Mock collector | sonnet | ✅ **done** (bc64e8b3) | `tools/mock_tag_stream.py`, `tools/scenarios/{normal,flicker,gs10_f0004}.yaml` | Verified --dry-run: 244 events, 14-edge `pe101` flaky signature, fault_window open/close. ⚠️ `print()` in --dry-run (intentional CLI output, pre-commit warns); active-high health bits need `invert:` for fault polarity. |
| 1 | A3 Tag allowlist | sonnet | ✅ **done** (bc64e8b3) | `ignition/project/approved_tags.json`, `ignition/webdev/FactoryLM/api/tags/{allowlist.py,doGet.py}`, `ignition/tests/test_allowlist.py` | self-serve trust primitive. 9/9 tests pass. Fail-closed (503 if list missing), 404 on non-allowlisted, read-only. |

**Wave 1 verdict:** ✅ all three landed, verified, committed on `feat/ignition-module-self-serve` (worktree `/Users/charlienode/MIRA-ignition-build`, off origin/main).

**Staging gate (between Wave 1 and 2):** ✅ migrations 032–037 dry-run + **applied to staging** via `apply-migrations.yml` (runs 26815931096 dry-run, 26815987634 apply, both success). **`ltree` confirmed working on Neon** — open-question D8 #1 answered. Branch pushed to origin.

| Wave | Task | Agent | Status | Output | Notes |
|---|---|---|---|---|---|
| 2 | W2-A Diff logger / `tag_events` (B2 + light B1) | sonnet | ✅ **done** (26d2bd67) | `mira-relay/{neon,diff_logger,rollup_worker}.py`, `relay_server.py`, `tests/test_diff_logger.py` | 49 tests pass (22 new + 27 existing, 0 regressions). Neon write behind `RELAY_TAG_EVENTS=1` (default off — bench unaffected). Thresholds from `approved_tags`; fault-window state is in-process (restart/multi-worker caveats documented). |
| 2 | W2-B Tag-import wizard (C1) | sonnet | ✅ **done** (26d2bd67) | `mira-hub/src/app/api/tags/import/route.ts`, `mira-hub/src/lib/tag-import.ts` + tests | 312 tests pass, tsc+eslint clean. `POST /api/tags/import`: CSV→`ai_suggestions(tag_mapping, status=pending)` via RLS; UNS via uns.ts builders; tenant from session. **status is `pending`** (CHECK constraint), not `proposed`. |

**Wave 2 verdict:** ✅ both landed, committed. Current-state event stream + the self-serve tag→UNS mapping path exist (env-gated / proposal-only).

| Wave | Task | Agent | Status | Output | Notes |
|---|---|---|---|---|---|
| 3 | W3-A relay HMAC (B3 / D4) | sonnet | ✅ **done** (8abbe742) | `mira-relay/relay_server.py`, `ignition/gateway-scripts/tag-stream.py`, `tests/test_hmac_auth.py` | 66 relay tests. `X-MIRA-{Tenant,Nonce,Signature}` HMAC-SHA256 (nonce bound into sig), 10-min replay window. Bearer behind `RELAY_LEGACY_BEARER=1` (default on). Per-tenant key mint/rotate = Hub-admin follow-up. |
| 3 | W3-B self-serve UNS entry (C2) | sonnet | ✅ **done** (8abbe742) | `mira-hub/src/app/(hub)/namespace/page.tsx`, `.../api/namespace/node/route.test.ts` | 25 tests. create-node API already existed; gap was UI hardcoding `kind="area"` — now site/area/line/machine/component picker. |
| 3 | W3-C FlakyInputDetector (E1 / Phase 9) | sonnet | ✅ **done** (8abbe742) | `mira-bots/{shared/flaky_rules.py,agents/flaky_input_detector.py,tests/...}`, migration `038` | 31 tests. 4 rules + 7-day baseline + 6h dedup → `flaky_input_signals` + `ai_suggestions(flaky_signal_alert)`. **Migration 038 applied to staging.** Run worker via `cd mira-bots && python3 agents/flaky_input_detector.py` (hyphen breaks `-m`). |
| 3 | W3-D KG proposal loop (F1/F2 / Phase 3) | sonnet | ✅ **done** (8abbe742) | `mira-bots/shared/proposal_transition.py`, `mira-hub/src/lib/proposal-transition.ts`, `mira-crawler/ingest/kg_writer.py` | 20 tests. Ingest edges → `relationship_proposals` + `ai_suggestions(kg_edge)`; verified `kg_relationships` only on human approve. ⚠️ 2 legacy direct INSERTs remain in `mira-crawler/tasks/full_ingest_pipeline.py` (follow-up). ⚠️ behavior change: ingest-derived edges return empty from verified-only KG queries until approved (correct per ADR-0017). |
| 3 | W3-E direct-connection gate (D1 / Phase 6) | sonnet | ✅ **done** (8abbe742) | `mira-bots/shared/{engine.py,uns_paths.py,uns_resolver.py}`, `mira-pipeline/{main.py,ignition_chat.py,ignition_audit.py}`, `tests/test_uns_confirmation_gate.py`, `tests/golden_uns_direct_connection.csv` | 23 tests (12 preserved + 11 new). codegraph_impact: gate contained to engine.py (7 symbols, no external callers). **Key-path note:** flag lives at `state["context"]["uns_source"]` (rule doc's `state["uns_context"]["source"]` gets clobbered by `resolve_uns_path`; self-documented in `seed_direct_connection`). **Reconcile `.claude/rules/direct-connection-uns-certified.md` on merge** (rule not on origin/main yet). `ignition_chat.py`/`ignition_audit.py` new here — possible merge conflict with command-center branch. |

**Wave 3 verdict:** ✅ all five landed, re-verified on python3.12 (66+25+31+20+23 tests), committed `8abbe742`, pushed. Migrations 032–**038** all applied to staging.

**Wave 3 verdict:** ✅ all five landed, committed `8abbe742`. Migrations 032–**038** applied to staging.

### Staging integration test ✅ (commit 378fce26)
`tools/staging_tag_events_integration.py` ran the **real** path `mock_tag_stream → relay (RELAY_TAG_EVENTS=1) → staging tag_events`: **244 events landed, 14 pe101 flaky edges (7+7), correct ltree `uns_path`**, self-cleaned. **It caught two production bugs the mocked unit tests missed** — `neon.py` used `:uns_path::ltree` (SQLAlchemy can't bind before `::`) and passed raw floats into JSONB columns; both fixed + 4 regression guards added (`mira-relay/tests/test_neon_sql.py`). The current-state spine is now proven on real Neon schema.

### Final wave ✅ (commit a071c103)
| Task | Outcome |
|---|---|
| WF-A (D2/D6) | WebDev `/chat` repointed to cloud `/api/v1/ignition/chat` w/ HMAC; Perspective `ChatPanel` view (sibling-matched, offline-validation caveat noted). |
| WF-B (Phase 7+8) | Citation **enforcement** (rewrite-or-admit) + `DecisionTraceWriter` → `decision_traces`, wired into `process_full`, fail-soft. 29 new tests; gate 23 + relay 70 green; UNS gate untouched. |
| WF-C (D9) | `ignition/EXCHANGE/` listing (manifest, INSTALL, MIT LICENSE, listing copy). Honest shipped-vs-roadmap. |
| WF-D | 2 legacy direct KG INSERTs re-routed through `propose_relationship` (0 live INSERTs left in mira-crawler); `mock_tag_stream` `invert:` for active-high health bits. |

C3 (cloud chat endpoint) was already delivered by W3-E.

**Still open (honest):**
- **Wire physical PE-101** (hardware) — flip demo step 4 🟥→🟢. Code is ready.
- **Enable `RELAY_TAG_EVENTS=1`** on a real stream (needs per-tenant UUID + seeded `approved_tags` — proven safe by the integration test).
- **Perspective view** + **Exchange manifest** are offline-authored — need a running gateway to validate import + a signed ZIP + screenshots to actually submit.
- **D3 sources**: `ignition_chat.py` still returns `sources: []` until the engine populates citations into the response shape (the ChatPanel renders them when present).
- **Rule-doc reconcile**: `.claude/rules/direct-connection-uns-certified.md` (not on origin/main) must record the real key `state["context"]["uns_source"]` on merge.
- **License harmonize**: a sibling `mira-ignition-exchange/` uses Apache-2.0; this listing uses MIT.

(Updated as waves complete.)

## 5. Cross-references

- `docs/plans/2026-06-01-mira-master-architecture-plan.md` — phases 0–13, §D2 schema, §4 dispatch.
- `docs/mira-ignition-secure-architecture.md` — D1–D12 checklist (the Module's spec).
- `docs/strategy/services-vs-saas-pricing-fork.md` §4.1 — the two senses of self-serve.
- `docs/specs/dtma-to-mtr-bridge.md` — where a customer's UNS-entry scope comes from.
- `docs/demos/walker-aligned-bench-flywheel-demo.md` — the E2 demo this build makes real.
- `docs/integrations/ignition-tag-collector.md` — the collector the Module ships.

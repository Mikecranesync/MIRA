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
**Next (Wave 2, gated on Wave 1):** B1 relay allowlist enforcement → B2 diff logger (`tag_events`) → B3 HMAC; Phase C (self-serve UNS entry) can start in parallel now A3 is in.

(Updated as waves complete.)

## 5. Cross-references

- `docs/plans/2026-06-01-mira-master-architecture-plan.md` — phases 0–13, §D2 schema, §4 dispatch.
- `docs/mira-ignition-secure-architecture.md` — D1–D12 checklist (the Module's spec).
- `docs/strategy/services-vs-saas-pricing-fork.md` §4.1 — the two senses of self-serve.
- `docs/specs/dtma-to-mtr-bridge.md` — where a customer's UNS-entry scope comes from.
- `docs/demos/walker-aligned-bench-flywheel-demo.md` — the E2 demo this build makes real.
- `docs/integrations/ignition-tag-collector.md` — the collector the Module ships.

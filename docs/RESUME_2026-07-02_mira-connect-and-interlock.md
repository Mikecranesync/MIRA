# RESUME — MIRA Connect gap report + interlock layering — 2026-07-02

Paste the block below the `---` into a fresh Claude Code session to resume. Untracked, not committed
(standing RESUME_* convention).

---

Resume the **MIRA Connect interoperability gap report** work and the **interlock intelligence
layering**. REPO: `C:\Users\hharp\Documents\GitHub\MIRA` (Windows / Git Bash + PowerShell).

## Read first
- This session's arc lives across several branches/PRs (below). The primary checkout
  `C:\Users\hharp\Documents\GitHub\MIRA` is on **`feat/litmus-bench-proof` with ~35 foreign-WIP
  entries — DO NOT touch/stage/commit them**. All my work was done in **git worktrees off
  `origin/main`**; keep doing that.
- Memory: `.claude/projects/.../memory/` — esp. `project_litmus_edge_bench`,
  `project_ingest_one_pipeline`, `project_maintenance_intelligence_module`.

## Open PRs / issues (verify with `gh pr list` / `gh issue list`)
- **PR #2399** — `docs/mira-connect-gap-report` — MIRA Connect gap report (4 docs). **OPEN, pushed.**
  Docs-only, no VERSION bump. Merge needs `--admin` (branch-protection gate).
- **PR #2397** — `feat/cv200-interlock-db-integration` — CV-200 interlock DB round-trip test
  (`DATABASE_URL`-gated, ephemeral temp tables). **OPEN.** VERSION 3.55.2. Worktree `../mira-cv200-db`.
- **PR #2390** — `feat/litmus-micro820-bench` — older Litmus DeviceHub bench proof. **OPEN** (stale-ish).
- **Issue #2393** — Mechanical Anomaly Experiment v1 (belt/torque/coupling/webcam). Branch not started.
- **Issue #2396** — DB-backed CV-200 interlock integration — **PR #2397 is the first pass**; further
  work = seed real staging Neon (dev→staging→prod).
- Merged this session: #2392 (CV-101 Litmus context proof), #2394 (CV-101 Perspective dashboard),
  #2395 (CV-200 interlock replay proof). `main` VERSION = **3.55.1** (before #2397's 3.55.2).

## MIRA Connect gap report — DONE (Phases 0–4), PR #2399 open
Docs-only decision-grade audit. Four docs on `docs/mira-connect-gap-report` (worktree
`../mira-connect-docs`):
- `docs/discovery/mira_connect_interoperability_gap_report.md` (main)
- `docs/discovery/mira_connect_connector_matrix.md` (18×10 matrix)
- `docs/product/mira_connect_prd_gap_outline.md` (PRD outline)
- `docs/product/mira_connect_video_proof_plan.md` (build-in-public plan)

Conclusions (evidence-cited, Phase-4 verified):
- **3 of 4 universal ingest surfaces built** — REST/JSON (`mira-relay/relay_server.py`
  `/api/v1/tags/ingest`+`/ws`+`/ws/tags`, HMAC `mira-relay/auth.py`), MQTT/Sparkplug
  (`mira-relay/mqtt_ingest/**`; **opt-in `sparkplug` compose profile** in `docker-compose.saas.yml`,
  NOT started by default deploy), Ignition push (`ignition/gateway-scripts/tag-stream.py`). One
  canonical pipeline (`ingest_contract`→`tag_ingest.ingest_batch`→`tag_events`/`live_signal_cache`),
  one-pipeline law CI-enforced (`tests/test_architecture.py` Contract 5).
- **OPC UA = the one strategic connectivity gap** (0 code; ADR-0001). One generic OPC UA connector
  unlocks Kepware/HighByte/Siemens Edge/OPC Router as thin recipes.
- **Core value gap = maintenance layer**: no formal Outcome object; cloud A0–A12 anomalies computed
  then **discarded** — the only `mira_anomalies` writers are gateway-local Jython
  (`ignition/gateway-scripts/timer-stuck-state.py`, `tag-change-fsm-monitor.py` →
  `ignition/db/schema.sql`); no queryable cloud store the Supervisor reads.
- **Architecture:** one connector registry (merge `mira-connect` drivers + `mira-connectors` registry)
  over four surfaces + explicit **Context Packet** boundary + **Outcome object**. Connectivity never
  reasons about failure modes; outcome never opens a socket.
- **P0 roadmap:** P0-1 consolidate registry · P0-2 generic OPC UA connector · P0-3 first-class Context
  Packet · P0-4 Maintenance Outcome model · P0-5 cloud anomaly persistence.
- **Smallest serious beta = ship P0-3/4/5 on existing REST/Ignition/Sparkplug** (no new connector);
  add OPC UA in parallel.

## Interlock intelligence layering (the flywheel)
Order: **replay proof ✅ (merged #2395) → DB proof (PR #2397, open) → live engine turn → Perspective UI.**
- Consume module (unchanged prod): `mira-bots/shared/interlock_context.py`
  (`recall_interlocks` verified-only, `build_interlock_answer` pure, `evaluate_permissive`).
- Approve helper: `mira-bots/shared/proposal_transition.py` `apply_kg_approval(trigger="accept")` (ADR-0017).
- Flag `MIRA_INTERLOCK_CONTEXT_ENABLED` is **default-OFF** (`engine.py:388`) — keep it off; enable
  only scoped per-run. Gate: `engine._build_interlock_context`.
- Replay demo: `tools/flywheel/cv200_interlock_demo.py` + `fixtures/northwind_cv200_interlocks.json` +
  `tests/flywheel/test_cv200_interlock_demo.py`. CV-200 UNS
  `enterprise.riverside.area.packaging.line.line1.equipment.discharge_conveyor_cv200`.

## Likely next steps (pick one; confirm with user)
1. **Merge the open PRs** (#2399 docs, #2397 DB test) — need `--admin`.
2. **Connect P0 execution** — start with P0-3 (Context Packet contract, in `mira-relay/ingest_contract.py`)
   or P0-4/P0-5 (Outcome model + cloud anomaly persistence) since those are the *smallest-beta* core.
3. **Interlock next layer** — the **live engine turn** behind `MIRA_INTERLOCK_CONTEXT_ENABLED`
   (flag-gated, still no UI), per Issue #2396 follow-up.
4. **Issue #2393** — mechanical anomaly experiment (needs torque/RPM/power which the live sparse
   Micro820 map does NOT expose → replay-first, current as load proxy).

## Hard rules / conventions (do not violate)
- Work in a **git worktree off `origin/main`**; never `git checkout main` in the primary tree (WIP +
  local `main` is checked out in the `MIRA-prod-approval` worktree). Never `git add -A`; stage explicit
  paths only. Never touch foreign WIP or other worktrees.
- **Version gate:** any PR touching non-doc code (`.py`/`.json`/etc.) needs a patch **/VERSION** bump;
  docs-only (`.md`) does NOT. Merge-base comparison, so bump forward from current `origin/main` VERSION.
- **Commit trailers:** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` +
  `Claude-Session: https://claude.ai/code/session_01EU2Ck4Hpy777Z1ekpN9FU6`. PR bodies end with the
  🤖 Generated-with-Claude-Code footer.
- Read-only toward PLCs; no PLC writes; no Litmus `:8094`; no Ignition/UI changes unless asked.
  `MIRA_INTERLOCK_CONTEXT_ENABLED` stays default-off. Don't commit unless explicitly asked.
- **Multi-agent orchestration** (the "ultracode"/workflow style) worked well for the Connect audit:
  Phase 1 fan-out (7 read-only inventory agents) → Phase 2 synthesis (2) → author → Phase 4 adversarial
  verify (2). Reuse this pattern; always verify agent claims against code before acting on them.

## Worktrees currently on disk (clean up when done)
- `../mira-connect-docs` → `docs/mira-connect-gap-report` (PR #2399)
- `../mira-cv200-db` → `feat/cv200-interlock-db-integration` (PR #2397)
Remove with `git worktree remove --force <path>` once merged.

Start by: `gh pr list`, `gh issue list`, confirm `origin/main` VERSION, and ask the user which of the
four "next steps" to pursue.

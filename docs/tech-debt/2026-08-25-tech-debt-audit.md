# Technical Debt Audit — MIRA + factorylm — 2026-08-25

**Auditor:** Claude (CHARLIE) · **Method:** 6 parallel read-only explorer agents (CI/tests, security/tenancy, convergence/dead-code, code-quality/deps, factorylm repo, backlog/docs-drift) + hand verification of every P0/P1 claim against the working tree (`origin/main` @ `d387b679e`). **No code modified.**
**Prior registers this builds on:** `2026-06-09-critical-debt-audit.md`, `docs/architecture/convergence/GATE0_SUMMARY.md`, `docs/known-issues.md`.

---

## TL;DR — High-priority debt (fix in this order)

| # | Debt | Sev | Evidence | Fix effort |
|---|------|-----|----------|-----------|
| 1 | **Approved-context gate configured ON, enforced OFF** — `MIRA_ENFORCE_APPROVED_RETRIEVAL='true'` in Doppler prd reaches zero containers | **P0** | Issue #3328 OPEN; `CAPABILITY_CLOSURE.yaml:141-150` | ~1h: add var to each consumer's `environment:` block in `docker-compose.saas.yml`; verify with `docker exec … env` |
| 2 | **Hub role defaults to `owner` when session role missing** — silent privilege escalation | **P1** | `mira-hub/src/providers/auth-provider.ts:35`, `providers/access-control.ts:47`, `lib/users.ts:102` — all `?? "owner"` | ~2h: fail closed (throw / `viewer`), add test; mobile app already avoids this fallback (Gate 0 finding #3) |
| 3 | **Library routes hide the OEM corpus** — `tenant_id = $1` only, via `withTenantContext`, on the hybrid `knowledge_entries` table (#1761 class) | **P1** | `mira-hub/src/app/api/library/{tree,chunks,documents}/route.ts` (tree:73-80 verified). **Correction 2026-08-26:** `namespace/node/[id]/chat/route.ts:302` is NOT in scope — it is an already-justified TENANT-ONLY, doc-scoped read (see PR #3422 scope note) | ~3h: raw pool + `(is_private = false OR tenant_id = $1)` per `.claude/rules/knowledge-entries-tenant-scoping.md`; add to read-allowlist — **PR #3422** |
| 4 | **~50 test files never run by CI** — `mira-contextualizer/` (14 tests, 0 workflow mentions), `mira-relay/` (14), `mira-plc-parser/` (15), `mira-connect/` (1); `bench-harness-tests` job not in `ci-gate` needs | **P1** | `ci.yml` enumerates paths (memory: `project_ci_runs_only_named_tests`); verified counts | ~2h: add to `ci.yml` test matrix + `ci-gate.needs` — **PR #3425** (`module-suites` job: 517 tests executed on its first run, 8 expected xfails; `bench-harness-tests` promoted into the gate) |
| 5 | **Nightly eval truth is broken** — #2759 `cp_keyword_match` gate unsatisfiable → hard-stops every patch; #2952 13-night audit corrupted by stale-branch bug (true main band ~35–39/57, not 44–51); #3301 DeepEval nondeterministic | **P1** | `wiki/hot.md` last 2 entries; issues #2759/#2952/#3301/#2258 | ~1–2d: record/replay cascade (#2258), fix stale-branch checkout, raise `MIRA_PROCESS_TIMEOUT` in eval plist |
| 6 | **`engine.py` is 8,428 lines; `telegram/bot.py` 2,805** — untestable monolith; every engine PR needs `codegraph_impact` and still surprises | **P1** | `wc -l` verified | Multi-PR: extract FSM / grounding / gate / prompt-builder into `shared/engine/` package (CU-05-adjacent; needs R0 + Gate 7) |
| 7 | **Three diagnostic engines still coexist** — Supervisor + fault-detective + factorylm predecessors; CMMS history not in diagnostic path | **P1** | Issues #2442, #2444, #2445, #2446 (all P1, open since June); CU-04 "done" = classification only | Product decision (Mike) + CU-04 strangulation execution |
| 8 | **52 git worktrees on CHARLIE; 922 remote branches (263 from Apr-2026)** | P2 | `git worktree list \| wc -l` = 52; RCA `2026-07-27-worktree-clutter-rca.md` says this recurs | ~1h: run `tools/worktree-health.sh`, remove own leftovers, prune merged branches (human confirms deletes) |
| 9 | **P0 label is meaningless** — 26 open "P0" issues, most from Apr–May (Ignition CRA-2xx chain, ops chores, legal) | P2 | `gh issue list --label P0` | Triage sweep: close/relabel; keep ≤3 true P0s |
| 10 | **CLAUDE.md is 347 lines (target ~120)**, and carries stale numbers ("76 offline tests", "25 env vars" vs 122) + 11 undocumented `mira-*` dirs (mira-hub, mira-mobile, mira-plc-parser, mira-fault-*, mira-connectors, mira-contextualizer, …) | P2 | `wc -l CLAUDE.md`; agent diff vs tree | ~2h: cut to map, move detail to `docs/`; CU-02 fix isn't CI-gated — add a drift check |

---

## MIRA — by area

### A. Security / tenancy
- **OPEN:** role `?? "owner"` fallback ×3 (row 2). Mobile app deliberately bypasses it — Hub should too.
- **OPEN:** hybrid-read violations in `/api/library/*` + node chat (row 3). `/api/knowledge/route.ts:44` is correct (`is_private = false`).
- **CLOSED since Gate 0:** `insert_chunk` `is_private` now a required param (`mira-crawler/ingest/store.py:79`, `enforce_visibility()` :113); `ingest_url` has a `sources.yaml` curation gate (`tasks/ingest.py:266-279`). CU-03 shipped.
- **P2:** `code-review.yml:115` runs ast-grep for IPs/secrets only — `.ast-grep-rules/no-unscoped-tenant-query.yml`, `unvalidated-api-input.yml`, `missing-error-handling.yml` never execute in CI.
- **P3:** `tools/backfill_knowledge_embeddings.py:96,118` builds `WHERE` via f-string (internal tool, operator-controlled inputs). Agent-reported `blog.py` / `smoke_proposal_writer.py` f-string SQL **not reproduced** by grep — treat as unverified.
- 13 Hub routes without session guards; `/health`, `/version`, `/auth/*`, `/i3x/v1/info` are intentionally public. **Verify intent** for `/quickstart/ask` (rate-limited #1838), `/public/report`, `/internal/kg`, `/picker/dropbox/key`.
- Secrets scan: clean. No tracked `.env`, no real keys.

### B. CI / tests
- Row 4 (unrun test dirs). Also: mira-cmms, mira-bridge, mira-machine-logic-graph, mira-scan-monday have **zero** tests; mira-web bun suite marked "provably non-deterministic" (`ci.yml:722`).
- Coverage gate only covers `mira-bots/shared` + `mira-ingest` (`pyproject.toml:39` fail_under=25; ci.yml hardcodes 20/30 separately) — uncoordinated.
- Post-deploy workflows failing on main but outside merge gate: inline-create E2E, PrintSense Activation, provider-health canary, CV-101 live gate. Same "records failures, exits green" class as #3054.
- `ci.yml:1159-1166` permanently `--ignore`s tests for starlette/chromadb/API-drift conflicts — documented, never fixed.
- 2 hardcoded `@pytest.mark.skip` with no tracking link (`tests/test_edge_cases.py:129,156`).

### C. Convergence / dead code
- CU status: **done** P1, 02, 03 (awaiting Gate 9 GO — #3343), 04, 06, 08, 11. **Open:** CU-05 asset identity (flagship, xhigh), CU-07 SWE-bench, CU-09 ADR-0033 status (Mike), CU-10 Atlas bridge.
- Capability closure: `run_diff_engine` production-enabled with **no owner, no CI**; 4 `*_ENABLED` flags unregistered (`FAULT_DETECTIVE_HTTP_ENABLED`, `REDDIT_BENCHMARK_ENABLED`, `RELEVANCE_GATE_ENABLED`, + test fixture).
- Legacy still in tree: mira-sidecar 2,815 LOC (still referenced by `pathb.yml`; #2446 P1 open), email_adapter, reddit, teams, whatsapp, mira-connect — ~6,900 LOC total, Gate-11 delete candidates.
- Migrations: head 087, 10 duplicate-prefix pairs (cosmetic — **do not renumber**, rule §7).

### D. Code quality / deps
- Monoliths (row 6) + `mira-pipeline/main.py` 1,482.
- `ruff check .` from root: **487 errors** (97 E702, 96 F401, 68 I001, 65 undefined names) — CI ruff must be scoped narrower than repo root; undefined names = probable dead code. `mira-hub tsc`: 17 errors; `bun lint`: 5 (setState-in-effect).
- Duplicate helpers: `slug()` ×8 files, `normalize_tag_path()` ×3, `resolve_uns_path()` ×2 — violates `.claude/rules/uns-compliance.md` §1/§3 and one-pipeline law.
- Loose pins: `mira-crawler/requirements-celery.txt` 9 unpinned, `mira-pipeline/requirements.txt` 5 unpinned; 20+ `pyproject.toml`, no central lock.
- 30+ `tools/*.py` use PEP 604 unions; safe only while launchd plists point at the 3.12 venv (they do today).

### E. Process / docs
- ≥200 open issues, 61 `needs-triage`, 49 unlabeled; oldest untriaged cluster #2117–#2161 (66 days). 100 open PRs (~11 drafts, 2 CONFLICTING: #3340, #3320).
- `.planning/STATE.md` last touched 2026-07-12 ("Interlock Flywheel") vs `wiki/hot.md` 2026-08-14 (Mobile Phase 4 / Groq retirement) — planning layer out of sync.
- `docs/QUALITY_SCORE.md` frozen at 2026-04-17; `known-issues.md` header 2026-06-21.
- ADR-0030 (35d) and ADR-0033 (27d, **blocks WS1**) still Proposed — human gate.

---

## factorylm repo

No P1s. Repo is effectively cluster-infra + frozen predecessors, consistent with `OWNERSHIP.md`.

| Sev | Finding | Path |
|---|---|---|
| P2 | `core/tests/unit` collection broken (4 errors: `test_llm_interface`, `test_logger`, `test_validators`) — `pytest` can't run | `core/tests/unit/` |
| P2 | `CLUSTER.md` contradicts itself: Alpha retired (l.32-39) but STARTUP/SHUTDOWN (l.58-73) + ONE FILESYSTEM (l.47-56) still require Alpha SMB paths. **Uncommitted edits present** in working tree — someone is mid-fix | `CLUSTER.md` |
| P2 | LaunchAgents failing: `health-monitor` exit 127 (missing script — flagged June, still broken); `brain-ingest`, `brain-mcp`, `mira-drop-watcher`, `mira-offline-eval` exit 1 (doppler/keychain) | `~/Library/LaunchAgents/com.factorylm.*` |
| P2 | Live imports into frozen code: `integrations/telegram_alerts` and `factorylm.plc.modbus` used by active collectors — diverge from MIRA equivalents | `integrations/`, `plc/` |
| P3 | 200MB+ mp4 + 25MB `kb/chroma_db/chroma.sqlite3` tracked in git | `cookoff/clips/`, `.playwright-mcp/`, `kb/` |
| P3 | `requires-python` spans 3.9→3.12; 95 caret/wildcard npm deps in `apps/cmms/frontend` | various |
| — | Frozen ≥173d: agents, core, brain, gateway, cookoff, cosmos, openclaw, antfarm, kb, my-ralph (submodule) — expected per Gate 0, not debt until CU-04 deletes them | |

---

## Recommended sequencing

1. **Today (≤1 day, no product decision needed):** rows 1, 2, 3, 4 — all are small, evidence-backed, and touch customer-visible correctness/security.
2. **This week:** row 5 (eval truth) — without it every "eval gain" claim is noise; row 8 worktree/branch prune; row 9 P0 relabel; factorylm LaunchAgents + `core/tests` collection.
3. **Needs Mike:** row 7 engine consolidation decision (#2442/#2444/#2446), ADR-0033 status (CU-09), CU-03 Gate 9 GO (#3343), CU-05 asset-identity kickoff.
4. **Ongoing:** row 6 engine.py decomposition as a gated convergence unit, not a drive-by.

## Hazard ledger (this audit)
- Agent claim `blog.py:136` / `smoke_proposal_writer.py` SQL f-strings — **not reproduced**, dropped to unverified.
- Agent claim "4,191 test functions" — not independently recounted; the direction (CLAUDE.md "76" is stale) is certain, the magnitude is not.
- Worktree/branch deletion **not performed** — human confirms per `dangerous-commands-safety.md`.

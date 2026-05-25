# Hot — Where to resume

> **Last updated:** 2026-05-25 (session-end handoff)
> **Read this first.** Then check `CLAUDE.md` build state and `docs/plans/2026-05-15-maintenance-namespace-builder.md` for the active 90-day plan.

---

## TL;DR for the next Claude

A long session just wrapped. Two new feature branches are open as PRs (QA regression + conversational engine spec). The current working branch (`docs/plc-rs485-bench-runbook`) has 7 unmerged docs commits including 3 new Modbus training PDFs — **PR not yet open for it**. Six follow-up issues filed (#1549–#1554). PR #1526 (schematic vision fix) merged but staging deploy is still pending behind prod-guard.

**Priority #1: QA regression Phase 2** (issue #1549). It's the lock-in against the GS11-style silent regression pattern.

---

## In flight — PRs open

| # | Title | Branch | What it is |
|---|---|---|---|
| **#1531** | docs(specs): conversational engine upgrade — 3-layer model | `feat/conversational-engine-spec` | Spec for splitting Supervisor into front desk / router / grounded specialist. **Implementation tracked at #1551.** |
| **#1530** | feat(qa): boundary-level regression routine for staging Telegram bot | `feat/qa-regression-routine` | Phase 1 runner. Two run artifacts exist. **Phases 2-4 tracked at #1549.** |
| **#1529** | chore(promo-director): COMPETITOR_ANALYSIS.md refresh 2026-05-25 | `chore/promo-director-refresh-2026-05-25` | Draft. |
| **#1527** | security(scan-monday): CRA-159 per-account burst rate limit on /chat/message | `fix/cra-159-chat-burst-rate-limit` | |
| **#1524** | docs: Modbus RTU framing mismatch golden case + product case study + Q14 benchmark | `docs/modbus-troubleshooting-golden-case-2026-05-24` | |
| **#1523** | feat: component hierarchy — sibling tree + DRIVES edge + state-machine glossary (ADR-0017, 0018, mig 028) | `feat/component-hierarchy-grilling-2026-05-24` | |
| **#1522** | docs(plc): Conv_Simple v1.4 bench-code review with byte-level evidence | `claude/cool-moser-0152ac` | |
| **#1521** | fix(engine): snapshot kb_status before self-critique await (closes #1520) | `fix/engine-kb-status-race-1520` | Draft. |
| **#1508** | docs(benchmark): empirical KG addendum + db-inspect target-confusion prevention | `chore/kg-benchmark-2026-05-23` | |
| **#1452** | docs(research): Fuuz deep-dive — Episode 6 + skills + repos + MIRA action plan | `claude/charming-ride-719fde` | |
| **#1392** | feat(hub): Windows 3.1 namespace explorer | `feat/hub-namespace-explorer` | |
| **#1377** | feat: answer-quality standard + scaffolding benchmark | `claude/agitated-kowalevski-17c2c5` | |
| **#1340** | experiment(plc): CCW Ladder Diagram .isaxch import format | `experiment/ccw-ld-isaxch` | Draft. |
| 1532-1548 | dependabot updates | various | Routine. |

**Recently merged this session:**
- **#1526** — `fix(engine): analyze schematic photos with vision LLM when a question is attached`. Merged 2026-05-25 05:50Z. **Staging deploy still blocked** by prod-guard (correctly) — see issue #1552.

---

## Current branch state

```
docs/plc-rs485-bench-runbook (HEAD)
  ba94a213 chore: session 2026-05-25 cleanup — eval runs, lead-hunter state, PROGRESS
  6deb3348 docs(guides): Modbus RTU student workbook + implementation guides + domain glossary
  b591fe47 docs(plc): corrected ST code review (MSG_MODBUS retraction)
  31607d61 docs(plc): add RS-485 bench troubleshooting runbook + Claude driver brief
  4239d680 docs(wiki): eval-fixer run 2026-05-24
  d7af5b66 chore: session 2026-05-23 cleanup
  8115ba00 docs: benchmark results, evaluations, and research from 2026-05-23 session
```

- 7 commits ahead of `origin/main`, 78 commits behind `origin/main`. **No PR yet.**
- Pushed to `origin/docs/plc-rs485-bench-runbook` (up to date).
- Decide whether to (a) open a PR for the whole branch, (b) cherry-pick the recent docs commits to a fresh branch off `main`, or (c) rebase. Option (b) is cleanest — the branch name no longer reflects the contents.

**Local `main` is 79 commits behind `origin/main`** with 5 stale local commits ahead — see issue #1554 for the rebase task.

---

## Open issues filed this session

| # | Title | Status |
|---|---|---|
| **#1549** | QA regression routine — finish Phases 2-4 (golden / load / regression suites) | **Priority #1** |
| #1550 | Hermes Agent — provision DigitalOcean VPS + install | Blocked on droplet creation |
| #1551 | Conversational engine upgrade — implement 3-layer architecture from spec | Depends on #1549 Phase 2 |
| #1552 | Staging deploy of PR #1526 (schematic vision fix) — blocked by prod-guard this session | Resume via `smoke-test.yml` → `deploy-vps.yml` |
| #1553 | Modbus RTU student workbook + implementation guides — next iteration | Open PR for `docs/plc-rs485-bench-runbook` branch |
| #1554 | Rebase `main` — local was 79 commits behind origin/main | Mechanical |

---

## Decisions locked this session

1. **Hermes Agent provisioning:** DigitalOcean droplet (NOT Hetzner — see memory `project_vps_provider_digitalocean.md`). Reuse OpenRouter key from Doppler `factorylm/prd`. NEW Telegram bot (`@Hermes_FactoryLM_bot` proposed). Subdomain `hermes.factorylm.com`.

2. **QA regression is Priority #1.** Without it the GS11 embedding-gate pattern repeats. See `feedback_lock_in_chronic_ops_bugs.md`.

3. **Conversational engine 3-layer architecture** (front desk / router / grounded specialist). UNS confirmation gate MUST sit in the router, not the specialist. Feature-flag behind `ENGINE_3LAYER=true` until golden-set parity.

4. **PR #1526 staging promotion goes through the gate.** Don't bypass prod-guard with `MIRA_ALLOW_PROD=1`.

---

## What to do next (priority order)

1. **Resume QA regression Phase 2** (issue #1549) — wire `tests/golden_factorylm.csv` + `tests/golden_hybrid.csv` into the runner. Branch: `feat/qa-regression-routine` (already pushed, PR #1530 open).

2. **Open a PR for `docs/plc-rs485-bench-runbook`** OR cherry-pick the recent docs commits to a fresh branch. The branch has 7 commits ahead and no PR — the Modbus PDFs need review.

3. **Promote PR #1526 to staging** (issue #1552). `gh workflow run smoke-test.yml` then `gh workflow run deploy-vps.yml -f services="…"` if green.

4. **Rebase local main** (issue #1554). Mechanical. Do this before starting any new branch.

5. **Hermes Agent provisioning** (issue #1550) when Mike is back at a keyboard for DO droplet creation.

6. **Conversational engine implementation** (issue #1551) — but ONLY once Phase 2 of QA regression is in flight, so parity can be verified.

---

## Untracked files left on disk (intentional)

- Root-level `gs10-*.pdf` (6 files) — session scratch from Modbus troubleshooting. Not committed. Mike can clean up.
- `tests/qa_regression/runs/2026052*.json` + `.md` (4 files) — runner outputs. **Will be gitignored once PR #1530 merges** (the gitignore commit is on that branch).

---

## Worktrees

30+ `.claude/worktrees/*` exist; most point at stale `claude/*` branches from prior sessions. Cleanup is part of issue #1554. Don't accidentally cd into one and start work — confirm `git rev-parse --show-toplevel` first.

---

## Memory updates this session

Added (all under `~/.claude/projects/-Users-charlienode-MIRA/memory/`):
- `project_modbus_guides_2026_05_25.md`
- `project_hermes_agent.md`
- `project_conversational_engine_3layer.md`
- `project_qa_regression_priority.md`
- `project_vps_provider_digitalocean.md`
- `project_pr_1526_staging_blocked.md`

Index updated in `MEMORY.md`.

---

## Pointers (unchanged, but re-stating for the next session)

- **Primary doctrine:** `docs/THEORY_OF_OPERATIONS.md`
- **Product surface contract:** `docs/specs/maintenance-namespace-builder-spec.md`
- **Active plan:** `docs/plans/2026-05-15-maintenance-namespace-builder.md`
- **Environments doctrine:** `docs/environments.md` (read before any deploy / migration)
- **Build state:** `CLAUDE.md`
- **Product rules:** `.claude/CLAUDE.md`
- **Karpathy principles:** `.claude/rules/karpathy-principles.md`

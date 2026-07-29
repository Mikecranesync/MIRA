# Insights Friction-Fix Plan — 2026-06-08

Source: `/insights` report `report-2026-06-08-164222.html` (65 sessions, 2026-05-04→06-08).
Goal: convert the report's suggestions into shipped guardrails, ordered by **impact × inverse-effort** (highest-impact + quickest-win first). Each item is independently shippable as one atomic commit.

## Prioritization at a glance

| # | Fix | Friction it kills | Impact | Effort | Ship |
|---|-----|-------------------|--------|--------|------|
| **P0** | Git-collision elimination: cron guard + session lock + `PreToolUse` git-state guard | #1 recurring derailer — hourly cron wedges rebases, byte-identical parallel fixes, lost commits/stashes | 🔴 Highest | ~40m | today |
| **P1** | Behavior rules: premise-verify, regression-recheck, scoped-commits, migration-safety | ~25-40% of friction (wrong paths/schemas/bug-status, introduced regressions, bundled WIP) | 🟠 High | ~15m | today |
| **P2** | `/ship-pr` skill — encode propose→CI→merge→deploy→verify loop | Repeated re-explanation of the most-run workflow | 🟠 High | ~40m | this week |
| **P3** | Pre-commit scope guard (extend `.githooks/pre-commit`) | Unrelated WIP bundled into commits | 🟡 Med | ~25m | this week |
| **P4** | Long-task checkpoint discipline (handoff-early rule + background-eval default) | Context exhaustion leaving work at 78-90% | 🟡 Med | ~15m | this week |
| **P5** | Background eval loop w/ revert-on-regression (script + skill) | Evals stall: 9 regressions for +3 net; 35-min runs burn context | 🟢 Strategic | ~2h | next |
| **P6** | Full multi-session coordination (worktree-per-session + lock claims) | The ambitious version of P0 | 🟢 Strategic | ~½ day | next |

If forced to ship ONE thing: **P0** — it's the single biggest time sink in the data and the fix is now cheap (exact cron lines identified).

---

## P0 — Git-collision elimination  🔴 highest impact, quick now

**Root cause (verified `crontab -l`):** two crons run `git pull` against the *active* dev tree `/Users/bravonode/Mira`:
- `0 * * * * cd /Users/bravonode/Mira && git pull --rebase --autostash`  ← hourly `mira-wiki-pull`, the wedger
- `0 3 * * * cd ~/Mira && git pull origin main -q && pytest …`  ← 3am test run

Both autostash/pull mid-session → wedged rebases, dropped stashes, detached HEAD.

**Fix (three layers):**
1. **`tools/hooks/safe-cron-pull.sh`** — wrapper the crons call instead of raw `git pull`. Aborts (exit 0, log reason) if ANY of: `.git/rebase-merge`/`.git/rebase-apply` exists; `git status --porcelain` non-empty (dirty = active work); session lock `/tmp/mira-claude-active.lock` mtime < 2h; current branch ≠ `main`. Otherwise does the pull. Preserves "keep main fresh when idle" intent without ever touching an active session.
2. **Session lock** — `SessionStart` hook `touch /tmp/mira-claude-active.lock`; `Stop` hook leaves it (mtime freshness is the signal; auto-expires at 2h). Coordination primitive for both crons and future agents.
3. **`tools/hooks/git-state-guard.sh`** — new `PreToolUse(Bash)` hook (chained, not replacing gitleaks). When the command is a git *mutator* (`commit`/`rebase`/`merge`/`push`/`reset`/`stash drop`), block with a clear message if `.git/rebase-merge`/`rebase-apply` present or HEAD detached. Read-only git ops pass through.

**Also restore `prod-guard.sh`** to `PreToolUse(Bash)` — it's documented as wired but absent from `settings.json` (drift). Chain all three.

**Verify:** simulate a paused rebase (`git rebase -X` then leave `.git/rebase-merge`), confirm `git-state-guard.sh` blocks a `git commit`; run `safe-cron-pull.sh` against a dirty tree and confirm it no-ops with a logged reason; confirm a clean idle tree still pulls.

**Commit:** `chore(hooks): git-state guard + safe-cron-pull + session lock — kill rebase wedges`
**Update crontab** (manual step — surface the two exact `crontab -e` line replacements; don't edit crontab from a hook).

---

## P1 — Behavior rules  🟠 high impact, quickest win

Add to `.claude/rules/karpathy-principles.md` (behavior layer) or a new `.claude/rules/session-discipline.md`, and a 1-line pointer in `CLAUDE.md`:

1. **Premise verification.** Before implementing, verify every stated premise (file paths, table/column names, bug status, branch) against the actual codebase + `git log`. Surface mismatches before building. (Pairs with the "orient first" pattern.)
2. **Regression recheck.** After any change intended to raise an eval/test pass rate, re-run the *full* affected suite and compare to baseline before reporting net gains. Never report "+N" from a partial run.
3. **Scoped commits.** Stage only files your change touched. Never `git add -A` when untracked/foreign WIP exists; never touch a stash you didn't create. (Already bitten: `tools/__init__.py`, `ANTIGRAVITY_*.md` noise.)
4. **Migration/seed safety.** Before applying a migration or seed: confirm prerequisite migrations exist in the target env, and validate schema constraints (UUID vs TEXT, enum membership, `ON CONFLICT` targets) against the live schema.

**Verify:** rules render; `wc -l CLAUDE.md` stays < 150 (CLAUDE.md targets ~120 — put depth in the rule file, 1 pointer line in CLAUDE.md).
**Commit:** `docs(rules): session discipline — premise-verify, regression-recheck, scoped-commits, migration-safety`

---

## P2 — `/ship-pr` skill  🟠 high repeat value

`.claude/skills/ship-pr/SKILL.md` encoding the loop the report shows you run constantly:
1. Git-state preflight (reuse P0 guard) — halt on detached HEAD / active rebase / wrong tree.
2. Branch fresh from `origin/main` if on a stale/long-lived branch (the 187-behind trap).
3. Run affected tests + lint; **distinguish pre-existing main failures from branch-introduced regressions** (check against `origin/main` HEAD).
4. Open PR with evidence body (tests run + results).
5. Poll CI; if green → report mergeable; if red → triage real vs flaky.
6. Update memory + `.planning/STATE.md` / handoff.

**Verify:** dry-run the skill on a trivial no-op branch end-to-end.
**Commit:** `feat(skills): ship-pr — propose→CI→merge→deploy→verify loop with git-state guard`

---

## P3 — Pre-commit scope guard  🟡

Extend `.githooks/pre-commit`: warn (don't hard-block) when staged set includes files outside the diff's apparent scope, or when untracked WIP exists alongside staged changes. Keep existing shellcheck + credential scan.
**Commit:** `chore(githooks): warn on out-of-scope / WIP-bundled commits`

---

## P4 — Long-task checkpoint discipline  🟡

Rule + default behavior: for any task likely to exceed context (long evals, multi-file builds, codebase maps), write a handoff to `.planning/STATE.md` *early* and after each phase; run 30-min+ evals as **background** jobs (`run_in_background`) rather than blocking interactively. Add to `session-discipline.md`.
**Commit:** folds into P1's rule commit or a follow-up.

---

## P5 — Background eval loop w/ revert-on-regression  ✅ DONE (2026-07-09, as the eval-fixer agent)

Built as `.claude/agents/run-eval-fixer.sh` + `eval-fixer-instructions.md` (launchd
`com.mira.eval-fixer`, nightly 05:00 UTC) rather than the originally-sketched
`tools/eval-loop.sh` bash script — a Claude agent runs `tests/eval/eval_watchdog.py`,
picks the single highest-impact failing file-cluster, baselines the offline eval,
applies one minimal patch (hard limits: 1 file, ≤50 lines, no SAFETY/PLC/CRITICAL,
never touches fixtures), re-runs the eval, and **`git checkout -- .` (revert) if the
pass count didn't improve** — else opens a draft PR. Same algorithm as originally
scoped; safer mechanism (PR review, not auto-merge to main).

**Found broken 2026-07-09:** it was loaded and firing nightly but had failed silently
every night since at least 2026-07-06 with `Error: Exceeded USD budget (1)` — the
`--max-budget-usd 1.00` ceiling was far too low for a workflow that runs the full
offline eval suite through live LLM inference *twice* (baseline + post-patch). Also
its `git pull --ff-only origin "$CURRENT_BRANCH"` step grabbed whatever branch
happened to be checked out in the shared working tree (often an unpushed feature
branch), erroring `couldn't find remote ref`. Fixed both: bumped budget to $10.00,
and routed the pull through the existing `tools/hooks/safe-cron-pull.sh` (skips
cleanly unless the tree is clean/idle/on `main`, instead of erroring).

> ⚠️ **Correction (2026-07-27):** "Fixed both" above was true only of a *working
> tree*, not of `main`. Both fixes were committed to `fix/precommit-untracked-sigpipe`
> (`017d5aa7`) and that branch was never merged, so `main` kept `--max-budget-usd 1.00`
> for another 18 days. The nightly kept working purely by accident — launchd executes
> the script from the shared checkout, which happened to have that branch checked out.
> Actually landed on `main` 2026-07-27 in **#2951**. *"Fixed" means merged, not present
> in a working tree.*
>
> The `safe-cron-pull.sh` routing also turned out to be a **partial** fix. That wrapper
> skips when the tree is dirty, idle-locked, **or** off `main` — and the shared tree is
> permanently dirty (cron rewrites tracked `tools/lead-hunter/.hourly_state.json` and
> `marketing/prospects/hardening-alerts.jsonl` hourly) and was parked off `main` for
> weeks. Net effect: the nightly graded a checkout up to 465 commits stale from 07-10
> through 07-27, so every scorecard in that window measures pre-`main` code. Root cause
> and the proposed `main`-pinned-worktree fix are tracked in **#2952**.

## P6 — Multi-session coordination  🟢 strategic

Worktree-per-session + lock-claim (file or Linear-issue claim) so two agents never ship duplicate fixes (the PR #1081 byte-identical abandonment). P0's session lock is the seed; this generalizes it. Defer until P0 proves the lock primitive.

---

## Suggested execution order
P0 → P1 → P2 → P3/P4 (parallel-safe) → P5 → P6. P0+P1 are "today"; everything else is independently grabbable. Each = one atomic commit + verify; write progress to `.planning/STATE.md` after each so context exhaustion never loses ground.

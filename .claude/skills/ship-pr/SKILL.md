---
name: ship-pr
description: Use when turning working changes into a green, mergeable PR — branch fresh off main, run the affected tests + lint, distinguish pre-existing main failures from branch-introduced regressions, open a PR with an evidence body, and poll CI to green. The propose→CI→mergeable half of the ship loop. Hands off to the `ship` skill for merge→deploy→verify-live. Triggers on "open a PR", "get this PR green", "propose this change", "make this mergeable".
---

# ship-pr

The upstream half of shipping: from "I have changes" to "the PR is green and a
human can merge it." It deliberately STOPS at mergeable — it does not merge or
deploy.

## Route first (don't reimplement a sibling)

- **Merge + deploy + verify-live** (a PR is already green/ready) → use `ship`.
  This skill ends where `ship` begins.
- **Visible mira-web change** (`/`, `/cmms`, `/pricing`, views, CSS) → use
  `design-ship-routine` (snapshot→PR→deploy→verify:live). It owns the visual
  proof loop.
- **Commit hygiene only** (no PR yet) → `smart-commit`.
- Otherwise continue below.

## 0. Git-state preflight (reuse the P0 guard)

The `tools/hooks/git-state-guard.sh` PreToolUse hook already blocks git
mutators when the tree is mid-rebase or HEAD is detached. Before anything else,
confirm a sane state yourself:

```bash
git rev-parse --abbrev-ref HEAD              # know which branch you're on
git rev-parse --git-dir                       # then check for rebase markers:
ls "$(git rev-parse --git-dir)"/rebase-merge "$(git rev-parse --git-dir)"/rebase-apply 2>/dev/null \
  && echo "WEDGED — finish/abort the rebase before continuing"
```

If wedged: `git rebase --continue` or `git rebase --abort` first. Never force a
mutator past the guard (`MIRA_ALLOW_GIT_WEDGE=1`) unless you are deliberately
scripting a rebase.

## 1. Branch fresh off main (avoid the 187-behind trap)

If you're on a stale or long-lived branch, don't pile onto it:

```bash
git fetch origin
git rev-list --count origin/main..HEAD        # commits you'd carry
git rev-list --count HEAD..origin/main         # how far BEHIND main you are
```

If behind by more than a handful, branch fresh and bring only your change:

```bash
git stash                                      # if you have uncommitted work
git checkout -b <type>/<short-desc> origin/main
git stash pop
```

Scope the branch to ONE logical change (see `session-discipline.md` §3).

## 2. Run affected tests + lint — and separate regressions from pre-existing red

The non-negotiable step. A red test you didn't cause is NOT your fix to make; a
green test you turned red IS a regression you must own.

```bash
# Baseline: does main already fail this suite? (run on a clean origin/main checkout
# or a worktree) — capture the count BEFORE attributing any failure to your branch.
ruff check $(git diff --name-only origin/main...HEAD | grep '\.py$') 2>&1 | tail -5
pytest <affected test paths> -q 2>&1 | tail -20
```

- **Lint:** `ruff check` (Python) / `npm run build` (mira-hub TS) on changed files.
- **Tests:** the regimes / golden cases your change touches (`tests/`,
  `mira-bots/tests/`). Engine / RAG / FSM / classifier changes MUST pass the
  staging gate (`smoke-test.yml` + the relevant `tests/eval/` regime) — name it.
- Report **net**, with regressions called out explicitly. Never "+N" from a
  partial run (`session-discipline.md` §2).

## 3. Open the PR with an evidence body

```bash
git push -u origin HEAD
gh pr create --base main --title "<conventional title>" --body "$(cat <<'BODY'
## What
<one-paragraph summary>

## Why
<the friction / bug / goal this closes; link issue #>

## Tests run
<exact commands + results — pasted, not asserted>

## Risk / blast radius
<modules touched; codegraph_impact summary if a shared module>
BODY
)"
```

Body must show **commands + results**, not "tests pass" (Cluster Law 1).

## 4. Poll CI → triage real vs flaky (with re-verification for cache lag)

```bash
gh pr checks <PR#> --watch
```

- **Green** → **Re-verify once more before declaring mergeable** (GitHub API caches responses; a single read is not enough, especially if it conflicts with what you expected). Wait a few seconds, then:
  ```bash
  sleep 2
  gh pr checks <PR#> --json status,conclusion -q
  ```
  Only declare the PR "mergeable" if BOTH reads agree it's green. If they conflict, report the discrepancy explicitly rather than silently picking one.
- **Red** → triage. Is it a real failure your branch introduced, or a known-
  flaky / pre-existing-on-main check? Compare against `origin/main`'s latest run
  before "fixing" anything. Note: on this repo, squash-merge can bypass
  pending/advisory checks — know which checks actually gate (see
  `reference_ci_checks` memory).

## 4b. API cache lag: the insights-report pattern

GitHub's API (`gh pr view`, `gh pr checks`) can lag behind the actual PR state by up to ~5 seconds when a merge or status change just landed. **If a single read conflicts with what you expected or what the user just told you, do NOT silently pick one — always re-fetch after a short delay.** The 2026-06-08 insights report noted this exact pattern: "A merge chain stalled when you reported a PR had merged but the GitHub API still showed it OPEN due to cache lag, requiring multiple re-checks before confirmation." Trust an answer only when two independent reads agree.

## 5. Handoff

Update `.planning/STATE.md` (and memory if a durable fact emerged): PR number,
what's green, what's blocked, what manual steps the operator still owes. This is
the checkpoint a future session resumes from (`session-discipline.md` §5).

## Done-when

PR is open, CI is green (or every red is triaged to pre-existing/flaky with
evidence), and the handoff is written. **Not** merged, **not** deployed — hand
to `ship` for that.

## What NOT to do

- ❌ Pile commits onto a branch that's far behind main — branch fresh.
- ❌ `git add -A` over foreign WIP (`tools/__init__.py`, `ANTIGRAVITY_*.md`).
- ❌ Report "+N passing" from a partial suite, or attribute a pre-existing main
  failure to your branch.
- ❌ Merge or deploy here — that's `ship` / `design-ship-routine`, and it needs
  its own explicit human OK.
- ❌ Claim "PR is green" without reading the actual check rollup.

## Cross-references

- `.claude/skills/ship.md` — the merge→deploy→verify-live half this hands off to
- `.claude/skills/design-ship-routine.md` — visible mira-web ship loop
- `.claude/skills/smart-commit.md` — commit hygiene before a PR exists
- `.claude/rules/session-discipline.md` — scoped commits, regression recheck, checkpointing
- `tools/hooks/git-state-guard.sh` — the P0 preflight guard reused in §0
- `docs/environments.md` — staging gate + promotion discipline

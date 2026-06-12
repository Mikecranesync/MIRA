# Merge PRs

**Authoritative doctrine:** `docs/environments.md` — full promotion workflow at §"The promotion workflow".
**For the deploy that fires after merge:** `docs/runbooks/deploy-to-production.md`.

This runbook covers the safe PR merge procedure: what checks must pass, how to verify
them, what triggers on merge, and the gotchas.

---

## Prerequisites

- `gh` CLI authenticated: `gh auth status`
- PR branch pushed to `origin` and a PR open against `main`

---

## Step 1 — Verify the required check has passed

Only **one** check is required by branch protection before you can merge:

```
staging-gate
```

Verified from GitHub Ruleset #17097034 (`main-branch-protection`, enforcement: active,
target: default branch). The full check context string is `"staging-gate"`, which maps
to the job named `staging-gate` inside the workflow `Staging Gate`
(`.github/workflows/staging-gate.yml` job name at line 50: `name: staging-gate`).

```bash
# See all checks on a PR
gh pr checks <PR_NUMBER>

# Or watch checks live as they run
gh pr checks <PR_NUMBER> --watch
```

Expected output includes a line like:
```
staging-gate   pass   ...
```

If `staging-gate` shows `skipped`, that is also acceptable — the workflow skips
the LLM eval for non-runtime-only PRs (docs/CI/wiki/.claude changes only) and
Dependabot bumps, and still exits success so the branch-protection contract holds.
(Source: `.github/workflows/staging-gate.yml:86-112`)

---

## Step 2 — Compare failing checks against main

Other checks (smoke-test, ci, code-review, enforcement-audit, deepeval-ci) may show
as failing on your PR without blocking merge. Before merging through a failing check:

```bash
# See what's failing on main right now
gh run list --branch main --limit 10 --status failure

# Compare: is this check also failing on main's HEAD?
gh run list --branch main --workflow <WORKFLOW_NAME> --limit 3
```

If a check is already failing on `main` and is unrelated to your change, confirm
with the human before merging. Do not auto-merge through new red checks.
(Rule from `.claude/CLAUDE.md` CI & Merge Policy)

---

## Step 3 — Merge

Auto-merge is **disabled** on this repo (`allow_auto_merge: false`, verified via
GitHub API). You must merge manually.

All three merge strategies are permitted by the ruleset:

```bash
# Squash merge (preferred for feature branches — clean history)
gh pr merge <PR_NUMBER> --squash

# Merge commit
gh pr merge <PR_NUMBER> --merge

# Rebase
gh pr merge <PR_NUMBER> --rebase
```

The ruleset requires no approving reviews (0 required reviewers). Force-push and
branch deletion are allowed post-merge.

---

## What happens after merge

1. Push to `main` fires `smoke-test.yml` (if the push touches non-docs/non-markdown files).
2. If smoke passes → `deploy-vps.yml` fires automatically.
3. `deploy-vps.yml` also checks that `staging-gate` ran successfully on the PR head SHA.
4. If both conditions are met → VPS deploy proceeds (~8-12 minutes total).

**Path-filter note:** if your merged PR touched *only* `docs/**`, `wiki/**`, `**/*.md`,
or `.claude/**`, the smoke test is skipped (path-ignore in `.github/workflows/smoke-test.yml:24-35`),
and `deploy-vps.yml` never fires. That is the correct behavior — documentation-only
changes do not need a VPS deploy.

---

## Staging Gate behavior on specific PR types

| PR type | Staging Gate behavior |
|---|---|
| Runtime code change (engine, bots, mira-web, etc.) | Runs full LLM eval + grading against NeonDB staging branch |
| Docs/wiki/markdown/.github/.claude only | Scope check exits early; job exits success; eval not run |
| Dependabot dependency bump | Skipped entirely (Dependabot cannot access `staging` env secrets) |
| Mixed (runtime + docs) | Runtime files detected → full eval runs |

Source: `.github/workflows/staging-gate.yml:86-112` (scope check step).

---

## Monitoring the post-merge deploy

```bash
# Watch deploy log live
gh run list --workflow=deploy-vps.yml --limit 3
gh run watch <RUN_ID>
```

See `docs/runbooks/deploy-to-production.md` for the full post-deploy verification steps
and the false-failure gotcha (8s health probe).

---

## What can go wrong

| Symptom | Cause | Fix |
|---|---|---|
| `staging-gate` is pending but never completes | Ollama sidecar slow to start, or LLM provider outage | Wait; the gate retries once. If it fails after 2 attempts, check Actions log for provider errors |
| `staging-gate` failed and the PR is about a runtime change | Engine regression or cascading provider failure | Read the staging results artifact; fix the regression before merging |
| `staging-gate` passed but deploy didn't fire | Smoke test was skipped (path filter) | Run: `gh workflow run smoke-test.yml` on main, then watch for deploy trigger |
| Merge blocked even though `staging-gate` passed | Ruleset enforcement sees a different check name | Verify the job name in Actions is exactly `staging-gate` (not `Staging Gate / staging-gate`) |
| PR branch is behind `main` by many commits | Long-lived branch with diverged history | Rebase: `git fetch origin && git rebase origin/main` then force-push |
| `strict_required_status_checks_policy: false` means branch doesn't need to be up to date | This is correct — branches do NOT need to be up to date with main before merge | You can merge a branch that's behind main as long as `staging-gate` passed |

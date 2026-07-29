# Orchestrator freshness fix — stop auditing stale branches

**Created:** 2026-06-09 (interactive session with Mike)
**Root cause of the 2026-06-09 false RED.**

## What went wrong

The beta-readiness orchestrator audits the **checked-out working tree**. On 2026-06-09 it ran on
`feat/orchestrator-kg-query`, which was **51 commits behind `origin/main`**. It read that stale tree and
reported all six beta blockers as OPEN — a false RED. Every one had already merged to `main`:

| Blocker | Closed by | On `origin/main` |
|---|---|---|
| #1 rate-limit public LLM door | PR #1832 / #1837 | ✅ `quickstart/ask/route.ts` has the per-IP-hash limiter |
| #8 `/api/documents` cross-tenant IDOR | PR #1837 (refs #1833) | ✅ `WHERE id=$1 AND tenant_id=$2` |
| #3 money-path smoke gate | PR #1837 | ✅ smoke-test.yml gates the `/quickstart` money path |
| #2 citation "lie" (relevance) | PR #1845 | ✅ enforce-mode (`MIRA_CITATION_ENFORCE`, strips conflicting sources) |
| #4 eval non-determinism | PR #1845 | ✅ `tests/eval/llm_replay.py` + `offline_run --replay` |
| #5 migration ledger | PR #1845 | ✅ `048_schema_migrations_ledger.sql` + apply-migrations skip-applied |

Production deploys from `main` HEAD (`deploy-vps.yml`), so prod already had the fixes while the scorecard
showed RED. **Beta-readiness must be judged against `origin/main`, not the working branch.**

## The fix (two parts)

### 1. `freshness-guard.sh` (already added, this dir)

Run it at vitals time with the paths the current lens will audit:

```bash
bash wiki/orchestrator/freshness-guard.sh <path1> <path2> ...
# exit 0 = tree matches origin/main → audit the tree
# exit 3 = STALE → audit origin/main (git show origin/main:<path>), note the delta
```

It fetches origin, prints the behind/ahead count, and flags every audited path that differs from
`origin/main`. (Verified 2026-06-09: correctly reported "behind origin/main by 51" and exit 3.)

### 2. Two edits to the scheduled-task SKILL.md

**(a) In `# Every run — vitals first`, add a step 0:**

> 0. **Freshness gate.** Run `bash wiki/orchestrator/freshness-guard.sh <paths-this-lens-will-audit>`.
>    If it exits 3 (STALE), this run audits **`origin/main`** — the deploy/beta truth — by reading
>    `git show origin/main:<path>` (or a detached worktree of `origin/main`), NOT the working tree.
>    Put a one-line `⚠️ audited origin/main (HEAD was N behind)` banner at the top of the scorecard.

**(b) In `# Then — rotate ONE lens`, add one sentence:**

> When the freshness gate reports STALE, **every file read in the lens audit targets `origin/main`**
> (`git show origin/main:<path>`). The working tree is authoritative only when the guard exits 0.
> A blocker is only "open" if it is open on `origin/main` — the branch a code session sits on is irrelevant
> to beta-readiness.

## Why this is the right boundary

`deploy-vps.yml` checks out `main`; a beta tester hits whatever is on `main` (then prod). The orchestrator's
North Star — "a stranger signs up and nothing breaks/leaks/lies" — is a statement about `origin/main`, never
about a half-finished feature branch. Auditing the working tree was a category error; this guard fixes it.

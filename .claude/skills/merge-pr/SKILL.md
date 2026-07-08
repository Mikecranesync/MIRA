---
name: merge-pr
description: Use when an open PR needs to go from "ready" to "merged" — rebase it onto main, bump VERSION + CHANGELOG, push, watch CI to green, then merge and confirm the release tag. Triggers on "merge this PR", "rebase and merge", "get this to green and merge", "land this PR".
---

# merge-pr

The rebase→version→push→green→merge→tag loop for an **already-open** PR. It
does not create the PR (`ship-pr` does that) and does not deploy (`ship` does
that) — it is the narrow middle: take a PR that exists and land it cleanly on
`main` with a version bump and a confirmed release tag.

## Route first (don't reimplement a sibling)

- **No PR yet** → use `ship-pr` to get one open and green, then come back here.
- **PR is merged and needs deploying** → use `ship`.
- Otherwise continue below.

## 0. Git-state preflight

Reuse the same guard `ship-pr` uses — never rebase into an already-wedged tree.

```bash
git rev-parse --abbrev-ref HEAD
ls "$(git rev-parse --git-dir)"/rebase-merge "$(git rev-parse --git-dir)"/rebase-apply 2>/dev/null \
  && echo "WEDGED — resolve before continuing, do not force past this"
git status -s      # nothing of yours uncommitted before a rebase
```

If already wedged, stop and ask the user how they want it resolved — do not
guess your way out (see the hard rule below).

## 1. Rebase onto main

```bash
git fetch origin
git rebase origin/main
```

- Conflicts you can resolve **correctly and confidently** (you understand both
  sides, the resolution is unambiguous) → resolve them, `git rebase --continue`.
- Conflicts you're not sure about, or a rebase that won't converge → **STOP and
  ask the user**. See "Never do this" below — there is no safe automatic
  workaround for a wedged rebase.

## 2. Bump VERSION + CHANGELOG

Per `docs/versioning.md`: every code PR bumps `/VERSION` (skip only for
docs/config-only PRs — the version-gate CI check enforces this).

```bash
cat VERSION                              # current, e.g. 3.70.0
# pick the increment: MAJOR (breaking) / MINOR (feature, migration, endpoint) / PATCH (bugfix)
echo "3.71.0" > VERSION
```

Add a one-line entry at the top of `docs/CHANGELOG.md` (and
`mira-hub/CHANGELOG.md` too if this is a hub-scoped change — see
`mira-hub/AGENTS.md`) matching the existing entry format: version, date, PR
title, then 2-5 bullets of what/why/scope/tests. Commit both together:

```bash
git add VERSION docs/CHANGELOG.md
git commit -m "chore: bump VERSION → 3.71.0"
```

## 3. Push

```bash
git push --force-with-lease origin HEAD
```

`--force-with-lease`, never bare `--force` — a rebase rewrites history on a
branch that may have an open PR with in-progress review; lease fails safely if
the remote moved since your last fetch instead of silently clobbering it.

## 4. Monitor CI until every check is green

```bash
gh pr checks <PR#> --watch
```

- **All green** → proceed to merge.
- **Red** → triage before touching anything: is it a real failure your rebase
  introduced, or pre-existing/flaky on `main`? Compare against `origin/main`'s
  latest run (`gh run list --branch main`). Per root CLAUDE.md's CI & Merge
  Policy: if the failing checks are pre-existing on `main` and unrelated,
  **confirm with the user before merging** — never merge through new red
  checks you haven't explained.
- Still red after a genuine fix attempt and you can't converge → stop and ask,
  don't loop retries blindly (`session-discipline.md`).

## 5. Merge

Only with explicit user go-ahead (a merge is its own one-word OK, separate
from having started this skill):

```bash
gh pr merge <PR#> --squash --delete-branch
```

Squash, conventional commit title, delete the branch after.

## 6. Confirm the release tag — don't hand-create a duplicate

`version-tag.yml` auto-tags on merge to `main`: reads `/VERSION` and creates
`v<VERSION>`, a paired `rollback/<date>-v<VERSION>` checkpoint, and a GitHub
Release — automatically, from the bump in step 2. Verify it fired instead of
creating your own tag:

```bash
gh run list --workflow version-tag.yml --branch main --limit 1
git fetch --tags && git tag --list "v3.71.0"
```

- **Tag exists** → done. Report the tag + rollback checkpoint name as evidence.
- **Tag missing** (workflow didn't run, or VERSION wasn't actually bumped) →
  don't paper over it with a manual `git tag` before understanding why; check
  the workflow run's logs first. Only hand-create the tag if you've confirmed
  the automation is genuinely broken, and say so explicitly.

## Never do this (no destructive rebase workarounds)

- ❌ `git rebase --abort` and merge a stale/conflicting branch anyway.
- ❌ Blind `git checkout --ours` / `--theirs` to make conflicts disappear
  without reading what each side actually changed.
- ❌ `git push --force` (bare) on a branch with an open PR — always
  `--force-with-lease`.
- ❌ `git rebase --skip` to dodge a conflicted commit you haven't understood.
- ❌ Any `--no-verify` / skipped hook to push past a failing pre-commit check.
- ❌ Manually tagging a release when `version-tag.yml` already did it —
  creates a duplicate/conflicting tag.
- ❌ Merging through red CI you haven't triaged, or that the user hasn't
  confirmed is pre-existing/unrelated.

**If any of the above would be the only way forward, that's "wedged" — stop
and ask the user exactly what's blocking and how they want it resolved. Do not
route around it.**

## Done-when

PR is merged into `main`, `/VERSION` + `CHANGELOG.md` reflect the bump, all
required CI checks were green (or explicitly user-confirmed pre-existing), and
the `v<VERSION>` release tag + rollback checkpoint are confirmed to exist.

## Cross-references

- `.claude/skills/ship-pr/SKILL.md` — gets a PR to green; hands off here
- `.claude/skills/ship/SKILL.md` — merge→deploy→verify-live, for after this
- `docs/versioning.md` — VERSION bump rule, version-gate.yml, version-tag.yml
- `.claude/rules/session-discipline.md` — regression recheck, scoped commits
- `tools/hooks/git-state-guard.sh` — the P0 preflight guard reused in §0
- root `CLAUDE.md` § "CI & Merge Policy" — pre-existing-vs-new-red confirmation rule

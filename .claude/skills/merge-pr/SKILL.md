---
name: merge-pr
description: Use when an open PR needs to go from "ready" to "merged" — rebase it onto main, push, watch CI to green, then merge and confirm the release tag. Triggers on "merge this PR", "rebase and merge", "get this to green and merge", "land this PR".
---

# merge-pr

The rebase→push→green→merge→tag loop for an **already-open** PR. It
does not create the PR (`ship-pr` does that) and does not deploy (`ship` does
that) — it is the narrow middle: take a PR that exists and land it cleanly on
`main` with a confirmed release tag.

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

## 2. No version bump — check the commit subject instead

**`/VERSION` was deleted 2026-08-02 (#3064) and `docs/CHANGELOG.md` is frozen as
an archive.** Do not bump a file; do not hand-write a changelog line. Both were
the shared-line that conflicted every other open PR (`docs/versioning.md`).

The version is derived from the git tag by `version-tag.yml`, which takes the
bump level from the **merge commit's Conventional Commit type** — so the only
thing to check here is that the PR title is well-formed:

```bash
gh pr view <num> --json title --jq .title   # feat(x): … → MINOR, fix(x): … → PATCH
```

`feat!`/`BREAKING CHANGE` → MAJOR. An unrecognised subject is treated as a
PATCH, never a skip — a merge without a tag would lose a restore point.

Release notes come from the merged PRs, categorised by label per
`.github/release.yml`. For a hub-scoped change, `mira-hub/package.json` +
`mira-hub/CHANGELOG.md` still follow `mira-hub/AGENTS.md` — that per-component
line is unaffected.

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

`version-tag.yml` auto-tags on merge to `main`: derives the next semver from the
latest `v*` tag + the merge commit's Conventional Commit type, then creates
`v<X.Y.Z>`, a paired `rollback/<date>-v<X.Y.Z>` checkpoint, and a GitHub
Release. Verify it fired instead of creating your own tag:

```bash
gh run list --workflow version-tag.yml --branch main --limit 1
git fetch --tags && git tag --list 'v*' --sort=-v:refname | head -1
```

- **Tag exists** → done. Report the tag + rollback checkpoint name as evidence.
  Verify by **correspondence, not existence**: `git rev-list -n1 <tag>` must be
  your merge commit. Tags from 2026-07-29 → 08-02 are skewed one minor ahead of
  the merge they appear to name (`docs/versioning.md`).
- **Tag missing** (the workflow didn't run) →
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

PR is merged into `main`, all required CI checks were green (or explicitly
user-confirmed pre-existing), and the `v<X.Y.Z>` release tag + rollback
checkpoint are confirmed to exist **at the merge commit**.

## Cross-references

- `.claude/skills/ship-pr/SKILL.md` — gets a PR to green; hands off here
- `.claude/skills/ship/SKILL.md` — merge→deploy→verify-live, for after this
- `docs/versioning.md` — tag-derived versioning (no VERSION file), version-tag.yml
- `.claude/rules/session-discipline.md` — regression recheck, scoped commits
- `tools/hooks/git-state-guard.sh` — the P0 preflight guard reused in §0
- root `CLAUDE.md` § "CI & Merge Policy" — pre-existing-vs-new-red confirmation rule

# `changelog.d/` — changelog fragments

**Purpose: stop every PR from editing the same two lines.**

`/VERSION` is a single monotonic counter and `docs/CHANGELOG.md` is prepended to at
the top. Both mean *every* PR touches the *same line* of the *same file*, so **each
merge to `main` conflicts every other open PR** — and a conflicting PR receives **no
CI at all** (GitHub cannot build the merge ref), so it silently stops being verified
while still looking open and healthy.

With ~30 PRs open and several merges an hour, that is a structural throughput tax,
not bad luck. It was observed twice in one hour on 2026-07-29 (#3012 and #3011 both
went `CONFLICTING` the moment #3010 merged).

A fragment is a **new file per change**, so two PRs never collide.

## Writing one

Create `changelog.d/<short-slug>.md`. Use the branch name or issue number as the
slug — anything unique. Front matter declares the semver impact:

```markdown
---
type: fix
title: "fix(spine): recall adapter recovers Hub document coordinates"
---

`recall_knowledge` dropped the real OEM page on Hub-shaped chunks because the
adapter refused `source_page` unconditionally. Now applies the Hub's own
mis-stamp test (`source_page == chunk_index`), matching `manual-rag.ts`.
```

`title` is optional but **write one** — it becomes the release heading, matching the
existing `### vX.Y.Z (date) - type(scope): subject` house style. Without it the
heading degrades to "N change(s)". A colon inside the title is fine.

`type` must be one of:

| `type` | semver bump | use for |
|---|---|---|
| `breaking` | **major** | a change that breaks a consumer |
| `feat` | **minor** | new capability |
| `fix` | **patch** | bug fix |
| `security` | **patch** | security fix |
| `docs`, `chore`, `refactor`, `test` | **none** | no release impact on its own |

The body is normal Markdown, written for someone reading release notes later. Match
the house style in `docs/CHANGELOG.md`: say what was broken, what the root cause
was, and what evidence proves the fix. One fragment per logical change; a PR may
add more than one.

## What happens to it

`tools/changelog/assemble.py` consumes the fragments:

```bash
# See what the next release looks like — reads only, writes nothing.
py -3 tools/changelog/assemble.py --dry-run

# Assemble: compute the version bump, prepend the entry, delete the fragments.
py -3 tools/changelog/assemble.py --apply
```

The bump is the **highest** impact across all pending fragments (one `feat`
alongside three `fix`es is a minor bump).

## Current status — read this before changing your workflow

**Both paths are accepted right now.** `version-gate.yml` passes a code PR that
either bumps `/VERSION` (the existing convention) **or** adds a fragment. Nothing
is forced, no flag day, and the ~30 in-flight PRs keep working untouched.

Using a fragment is what actually buys the conflict immunity, so prefer it.

**Assembly is deliberately manual.** Deriving `/VERSION` automatically at merge
time would need a bot that pushes to `main`, which changes a required status check
and the auto-tag contract in `docs/versioning.md`. That is a human decision about
release doctrine, not something to switch on inside an unrelated PR — so the
mechanism ships here and stays operator-triggered until someone chooses otherwise.

Until it is automated: `--apply` before cutting a release, or keep bumping
`/VERSION` in the PR as before.

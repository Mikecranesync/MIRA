# Versioning & Rollback

**Source of truth:** the repo-root [`VERSION`](../VERSION) file — the **overall** monorepo version counter (semver `MAJOR.MINOR.PATCH`).

This doc defines the one rule the team kept forgetting: **every merge advances the version and leaves a rollback point.** It is now enforced by CI instead of memory.

## The rule

1. **Every code PR bumps `/VERSION`.** Pick the increment by change type:
   - **MAJOR** — a breaking change (API/schema/contract removal or incompatibility).
   - **MINOR** — a new feature, new endpoint, schema migration, provider addition, UI overhaul.
   - **PATCH** — a bug fix / hotfix on the released line.
2. **Docs/config-only PRs don't need a bump.** Changes limited to `docs/`, `wiki/`, any `CHANGELOG`, `*.md`/`*.mdx`/`*.txt`, `LICENSE`, `docs/promo-screenshots/`, or `VERSION` itself pass the gate without a bump.
3. **The bump is required.** `.github/workflows/version-gate.yml` ("Version Gate" → "Version Bump Check") fails any code PR whose `/VERSION` did not increase vs the merge-base. It is wired as a **required** status check, so a forgotten bump blocks merge.
4. **The tag is automatic.** On merge to `main`, `.github/workflows/version-tag.yml` reads `/VERSION` and — if `v<VERSION>` doesn't already exist — creates:
   - `v<VERSION>` (annotated git tag at the merge commit),
   - `rollback/<date>-v<VERSION>` (paired rollback checkpoint at the same commit),
   - a GitHub Release for `v<VERSION>`.
   Because the gate guarantees a fresh number on every code merge, every code merge gets a unique tag + rollback point.

## How to bump (author checklist)

```bash
# in your PR branch, before pushing for review:
echo "3.17.0" > VERSION          # next number per the rule above
# add a one-line note to docs/CHANGELOG.md (overall) and/or mira-hub/CHANGELOG.md (hub)
git commit -am "chore: bump VERSION → 3.17.0"
```

That's it — the tag + rollback checkpoint + release happen on merge. No manual `git tag`.

## Rolling back

Every merge has a checkpoint. To inspect or revert to a known-good point:

```bash
git tag --list 'rollback/*' --sort=-creatordate | head        # recent checkpoints
git tag --list 'v*' --sort=-v:refname | head                   # recent versions
git checkout v3.16.0                                            # inspect a released state
# to revert main to a checkpoint, branch from it and PR the revert:
git checkout -b revert/to-v3.16.0 rollback/2026-06-14-v3.16.0
```

Pre-merge "before" checkpoints (created by hand before a risky merge) follow `rollback/before-pr<N>` and remain valid alongside the auto `rollback/<date>-v<VERSION>` tags.

## Relationship to the other version counters

| Counter | Scope | Status |
|---|---|---|
| **`/VERSION` + `v<MAJOR>.<MINOR>.<PATCH>` tags** | **Overall monorepo** | **Authoritative** (this doc). Revived from the dormant `v3.15.0` line at `3.16.0`. |
| `mira-hub/package.json` + `mira-hub/vX.Y.Z` tags | `mira-hub` component only | Still valid — `mira-hub/AGENTS.md` keeps the per-component release line for hub-scoped releases. The overall counter advances regardless. |

A hub-only PR may bump **both** the overall `/VERSION` (required) and the hub `package.json` (per `mira-hub/AGENTS.md`). A non-hub PR bumps only `/VERSION`.

## Rollout note

The "Version Gate" check must be added to `main` branch protection's **required** checks once it has reported green on at least one PR (GitHub won't let you require a check it has never seen). Until then it runs and reports but does not block.

# Versioning & Rollback

**Source of truth:** the **git tags** (`v<MAJOR>.<MINOR>.<PATCH>`). The version is *derived*, not stored.

The goal has always been: **every merge advances the version and leaves a rollback point** — a save point you can go back to. That still holds. What changed on 2026-07-29 is *where the number comes from*.

## Why it changed — the shared-line problem

`/VERSION` was one monotonic line in a tracked file, and `docs/CHANGELOG.md` was prepended to at the top. So **every PR edited the same line of the same file.** Each merge to `main` therefore conflicted every other open PR — and **a conflicting PR receives no CI at all**, because GitHub cannot build the merge ref. It silently stops being verified while still looking open and healthy.

With ~30 PRs open and several merges an hour that is a structural tax, not bad luck: it happened **four times in one session** (#3010 → #3012 and #3011; then #2798 and #3008 → #3013).

The fix is GitHub's own documented model, which has no shared line:

- **[Releases are built on tags](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases).** GitHub's docs contain *no* guidance about storing a version in a repository file — that was our invention, and it was the only thing causing the conflicts.
- **[Release notes are generated from merged pull requests](https://docs.github.com/en/repositories/releasing-projects-on-github/automatically-generated-release-notes)**, configured in [`.github/release.yml`](../.github/release.yml). Nobody hand-maintains a changelog line.
- **Tags are not protected.** The `main-branch-protection` ruleset targets `branch` only, so the workflow creates tags **without pushing to `main`** — no bot write access to the protected branch, no branch-protection accommodation, no release-PR dance.

## How it works now

`.github/workflows/version-tag.yml`, on every push to `main`:

1. reads the latest `v*` tag,
2. derives the next semver with [`tools/release/next_version.py`](../tools/release/next_version.py), taking the bump from the merge commit's **Conventional Commit** type — which `CLAUDE.md` already mandates, so there is no new authoring discipline (`feat` → MINOR, `feat!`/`BREAKING CHANGE` → MAJOR, everything else → PATCH; an unrecognised subject is a PATCH, never a skip, because a merge without a tag loses a restore point),
3. creates `v<X.Y.Z>` **and** `rollback/<date>-v<X.Y.Z>` at the merge commit,
4. publishes a GitHub Release with `--generate-notes`.

**You do nothing per PR.** No version bump, no changelog line. Label your PR (see `.github/release.yml`) and the notes categorise themselves.

## Transition status (as of 2026-07-29)

`/VERSION` still exists and is still honoured as a **floor** — the derived version can never go backwards relative to it — so tag-derivation is safe to run while PRs are still bumping the file.

**One known consequence of the floor, so it isn't a surprise:** while `/VERSION` is hand-bumped *ahead* of the tags, the floor dominates and distinct bump levels collapse to the same number — a `fix` and a `feat` both land on the floor. The number is never wrong (it can't go backwards and can't collide), but the semver *signal* is muted during the changeover. It resolves on the first merge where the tags catch up to the file. Pinned by `test_floor_temporarily_flattens_the_bump_signal`; the end state is pinned by `test_steady_state_after_version_file_retires`.

Two operator steps finish the job:

1. **Remove `Version Bump Check` from `main`'s required status checks** (`main-branch-protection` ruleset). This is an admin action; an agent cannot do it. Until it happens, PRs must still bump `/VERSION` and the conflicts continue.
2. Optionally delete `/VERSION`, `.github/workflows/version-gate.yml`, and stop hand-editing `docs/CHANGELOG.md` (the Releases page becomes the changelog). Keep the historical `docs/CHANGELOG.md` content as an archive.

Do step 1 first and let a few merges flow before step 2.

## Legacy rule (applies only until step 1 above is done)

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

## Merging PRs back-to-back: re-run smoke after the deploy settles

Merging to `main` triggers `deploy-vps.yml`. While that deploy is in flight the
production containers restart, so **any other open PR's `E2E smoke` job that runs
during that window will fail against a restarting service** — most visibly as a
`502` from `app.factorylm.com/quickstart`, which is a real response from a real
outage-of-seconds, not a flaky assertion and not a defect in the PR being tested.

Observed 2026-07-31: #3034 merged at `01:05:32Z`, its deploy ran at `01:07:00Z`,
and #3033's smoke ran at `01:07:43Z` and failed on exactly that 502. The endpoint
returned `200` on re-check minutes later, and smoke on `main` for the same commit
had passed.

**Checklist item — when merging two or more PRs in one sitting:**

1. Merge the first PR and let `deploy-vps.yml` reach a terminal state.
2. Confirm the deployed surface is actually back: `curl -sL -o /dev/null -w '%{http_code}'
   https://app.factorylm.com/quickstart` should be `200` (follow redirects — the bare
   path answers `308`).
3. **Then** re-run the next PR's `E2E smoke` job so it grades a settled deployment,
   and merge on that fresh result — not on a pre-deploy green, and not by waving
   through a red one.

A smoke failure inside a deploy window is expected and should be re-run; a smoke
failure *outside* one is a signal and should be read. Distinguishing the two is
the point of step 2 — never re-run a smoke failure without first checking whether
the endpoint is genuinely healthy, or a real outage becomes invisible.

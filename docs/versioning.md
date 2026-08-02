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

## Transition status — **COMPLETE (2026-08-02)**

Both operator steps are done. **`/VERSION` no longer exists.** There is one counter: the git tags.

1. ~~**Remove `Version Bump Check` from `main`'s required status checks**~~ — **DONE.** Verified 2026-08-02 against the live API: ruleset `main-branch-protection` (id `17097034`) requires only `staging-gate`, and classic branch protection requires `staging-gate`, `Hub E2E (command-center + onboarding)`, `mira-web pack tests`, `CI Gate`. `Version Bump Check` appeared in neither, so nothing was blocking on it.
2. ~~**Delete `/VERSION` + `.github/workflows/version-gate.yml`**~~ — **DONE (#3064).** The floor is gone; `next_version.py` derives purely from the latest tag (`test_steady_state_after_version_file_retires` pins that path). `docs/CHANGELOG.md` is **frozen as an archive** — stop hand-editing it; the [Releases page](https://github.com/Mikecranesync/MIRA/releases) is the changelog.

**Authoring impact: none.** No version bump, no changelog line. Write a Conventional Commit subject (already mandated by `CLAUDE.md`) and label the PR per `.github/release.yml`.

### Where the version reaches a running container

`/VERSION` used to be `COPY`d into four images. It is now a build arg on the same path the hub already used:

```
version-tag.yml (tag)  →  deploy-vps.yml exports MIRA_APP_VERSION (git describe)
                       →  docker-compose.saas.yml build args
                       →  Dockerfile ARG/ENV MIRA_APP_VERSION
                       →  /health, /api/version, startup logs
```

Every reader falls back to `"unknown"` when the arg is unset (a local `docker build`, a `next dev`) — an absent version is never a build or boot failure. Readers: `mira-pipeline/main.py::_app_version`, `mira-bots/telegram/bot.py`, `mira-hub/src/app/api/{health,version}/route.ts`, `printsense/benchmarks/capability_bench.py::_version`, `mira-bots/shared/analysis/session_analyzer.py`, `tools/internet_print_test/runner.py`. Pinned by `tests/test_slack_deploy_contract.py`.

### ⚠️ Historical skew, 2026-07-29 → 2026-08-02 — read this before rolling back

While both counters existed they advanced **independently**. The original transition note predicted `/VERSION` would run *ahead* of the tags, so the floor would bind and the two would converge. **The opposite happened: the tags ran ahead of the file.** The floor never bound, and the gap was stable rather than closing — which is why it had to be resolved by deleting the file rather than waiting.

Measured on `main`, 2026-08-02 — the tag vs the `/VERSION` at the commit it points to:

| tag | `/VERSION` at that commit | |
|---|---|---|
| `v3.235.0` … `v3.237.0` | 3.235.0 … 3.237.0 | ✅ match |
| **`v3.238.0`** | **3.237.1** | ⚠️ skew starts here (`689c09e8`) |
| `v3.239.0` | 3.238.0 | skew |
| `v3.240.0` / `.1` / `.2` | 3.239.0 / 3.239.1 / 3.239.1 | skew |
| `v3.241.0` / `.1` | 3.240.0 / 3.240.1 | skew |
| `v3.242.0` / `.1` | 3.241.0 / 3.241.1 | skew |
| `v3.243.0` / `.1` / `.2` | 3.242.0 / 3.242.1 / 3.242.2 | skew |

(An earlier isolated case, `v3.234.10` → 3.234.4, predates the changeover.)

**Why this matters for incident response.** `rollback/<date>-v<X.Y.Z>` carries the **tag's** number, not the file's. An operator who reads `/VERSION` = `3.242.2` and rolls back to `rollback/2026-08-02-v3.242.2` lands on `ab7190d9` — **two merges earlier than intended**. The checkpoints exist precisely for the moment nobody is re-deriving this mapping by hand, so read the table above, not the file.

**Do not retroactively move the existing tags.** They are referenced in `docs/CHANGELOG.md` entries, in merged PR bodies, and in rollback runbooks. The mapping is recorded here instead.

**Verify by correspondence, not existence.** `git tag --list v3.240.0` returning a hit does **not** mean `v3.240.0` points at the merge that set `/VERSION` to `3.240.0` — during the skewed range it points at the one *before* it. Use `git rev-list -n1 <tag>` and read `VERSION` at that commit.

### Why it could not simply be waited out

The original plan was "drain the open-PR queue, then delete the file." That is circular: the
shared line is *what puts the PRs into conflict*, and a conflicting PR receives no CI at all, so
the queue cannot drain while the file exists. Deleting it costs each open PR one `git rm VERSION`
during its next rebase — once — instead of a fresh conflict on every merge, forever.

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
| **`v<MAJOR>.<MINOR>.<PATCH>` git tags** | **Overall monorepo** | **Authoritative** (this doc). Derived on merge; no file. |
| `mira-hub/package.json` + `mira-hub/vX.Y.Z` tags | `mira-hub` component only | Still valid — `mira-hub/AGENTS.md` keeps the per-component release line. The overall counter advances regardless. |
| `machine-print-pack/VERSION` | pack **format** version | Unrelated to the release counter; not affected by #3064. |

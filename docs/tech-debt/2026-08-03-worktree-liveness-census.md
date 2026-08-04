# Worktree liveness census — CHARLIE, 2026-08-03

Follow-up to `docs/tech-debt/2026-07-27-worktree-clutter-rca.md`. That RCA explained
*why* worktrees accumulate (creation was mandated, teardown was not) and counted 65.
It did **not** answer the question an operator actually has to answer before touching
any of them: **which ones are still in use, and which ones hold the only copy of
someone's work?**

This census answers that with four independent signals. **Nothing was changed.**

## Method

| Signal | How | What it proves |
|---|---|---|
| **Live process** | `lsof -a -d cwd` per worktree path | Definitive "in use right now" — a process is sitting in it |
| **Newest file mtime** | `find … -not -path '*/.git/*'` | Editing activity independent of commits |
| **Work at risk** | `git status --porcelain` + `rev-list origin/main..HEAD` + `show-ref origin/<branch>` | Whether removal would destroy the only copy |
| **PR state** | `gh pr list --head <branch> --state all` | Whether the content already landed (squash-aware) |

`git branch --merged` is deliberately **not** used — this repo squash-merges, so it is
a weak signal in both directions (RCA § Teardown, rule 8).

**Parse paths NUL-delimited** (`git status --porcelain -z`). A first pass here used
`awk '{print $2}'` and reported four false differences — all of them paths containing
spaces, silently truncated before hashing. Whitespace-safe parsing is not optional.

**A merged PR says nothing about untracked files.** They are not in any commit by
definition, so "PR merged + clean tracked tree" is *not* sufficient to call a worktree
disposable. Finding 3 below was wrong on first pass for exactly this reason.

## Headline

**46 worktrees. 2 have a live process. 44 do not.**

- `~/MIRA` — the canonical shared checkout (36 procs)
- `~/.codex/worktrees/e5c2/MIRA` — `codex/docs-technician-celery-audit`, PR #3099 OPEN (21 procs)

Disk held by the 45 non-canonical worktrees: **~23 GB**. Of that, ~4.4 GB is provably
reclaimable today (Finding 3); the rest needs a decision, not a sweep.

## Finding 1 (highest severity) — a half-initialized worktree staged to delete 7,577 files

`~/.codex/worktrees/8f85dcae-36cb-4d2d-b967-93a114307944/MIRA`
— detached at `d875b6f7`, locked with reason `initializing`, created 2026-08-03 18:33.

Its index has **7,577 files staged as deleted** (`D ` in every single porcelain line) while
only **1,609 files exist on disk**, 1,573 of them untracked. A Codex worktree
initialization died mid-checkout: ~6,000 files were never written, and the index
was left believing they were removed.

**This is exactly the pattern recorded in the `git worktree --no-checkout truncation`
incident** — a partially-checked-out tree that, if anything commits from it, produces a
commit that *deletes everything it failed to check out*.

**It holds zero unique content — proven, not assumed.** Every untracked file was
hashed with `git hash-object` and compared to the blob at its own HEAD:

```
identical to HEAD commit: 1572
genuinely differs:           1   docs/promo-screenshots/ish_v6.png
not in HEAD commit at all:   0
```

and the one difference is a **0-byte truncated write** (540,591 bytes in git, 0 on disk)
— the file the checkout died on. So the worktree strictly contains *less* than the commit
it points at, and that commit's content is itself already on `main`.

Removal is therefore provably safe and removes a live hazard:

```sh
git worktree unlock /Users/charlienode/.codex/worktrees/8f85dcae-36cb-4d2d-b967-93a114307944/MIRA
git worktree remove --force /Users/charlienode/.codex/worktrees/8f85dcae-36cb-4d2d-b967-93a114307944/MIRA
```

Not executed here: the worktree is **locked**, which is an explicit "another tool owns
this" signal, and the owner should clear it. The proof above is what makes it a decision
rather than a guess.

## Finding 2 — 13 worktrees hold work that exists nowhere else

Branch has commits ahead of `origin/main`, **no remote branch**, and **no PR**. If the
worktree is deleted and the branch pruned, the commits survive only in reflog until it
expires. These must not be bulk-deleted.

| Worktree | Branch | Ahead | Dirty |
|---|---|---|---|
| `~/worktrees/mira-pr-1993-beta-gate` | `pr-1993-beta-gate` | 12 | clean |
| `~/MIRA/.claude/worktrees/folder-brain` | `fix/folder-brain-rebase` | 10 | clean |
| `~/.codex/worktrees/56e9/MIRA` | `codex/pr3032-review-fixes` | 7 | clean |
| `~/Documents/Codex/2026-06-25/takeover-2293/MIRA` | `codex/synthetic-dogfood-agents-takeover` | 6 | clean |
| `~/MIRA/.claude/worktrees/repo-archaeology` | `docs/repo-archaeology-catalog` | 5 | clean |
| `~/.codex/worktrees/ac04/MIRA` | `codex/factorylm-live-serving-path-finish` | 4 | clean |
| `~/MIRA-charlie-session` | `charlie/session-2026-06-04-b` | 2 | clean |
| `~/Documents/Codex/worktrees/mira-potd-gold-email` | `feat/potd-gold-email-e003` | 1 | **6 modified** |
| `~/Documents/Codex/worktrees/mira-2928-main-audit` | `codex/fix-2928-private-paid-verifier` | 0 | **6 modified** |
| `~/MIRA/.claude/worktrees/agent-ac3bad98966499790` | `audit/modules-manifest-fresh` | 1 | clean |
| `~/MIRA/.claude/worktrees/charlie-session-2026-06-07` | `docs/unified-document-layer` | 1 | clean |
| `~/MIRA/.claude/worktrees/legoland-awl-chunks` | `worktree-legoland-awl-chunks` | 1 | clean |
| `~/MIRA/.worktrees/docs-cited-technician-turn-prd` | `docs/cited-technician-turn-prd` | 1 | clean |

**Cheapest fix for all 13: `git push -u origin <branch>`.** That makes the worktree
disposable without deciding anything about the work itself.

Three detached Codex worktrees also carry uncommitted edits with no branch at all
(`399ab58b` 5 modified + 71 untracked, `c4436564` 5 + 72, `e15431a5` 4 + 74), all last
touched 2026-06-24…27 and untouched for >30 days.

## Finding 3 — 10 are provably disposable; 3 more hold untracked files that are NOT on main

**Disposable — merged PR, zero dirty, zero untracked, no process (~4.4 GB):**

| Worktree | PR | MB |
|---|---|---|
| `.claude/worktrees/beta-gate-work` | #1867 | 1025 |
| `.claude/worktrees/ws1-contract` | #3032 | 444 |
| `.codex/worktrees/afbd/MIRA` | #3048 | 436 |
| `Documents/Codex/worktrees/mira-scheduled-workflow-fixes` | #2901 | 415 |
| `.claude/worktrees/slack-print-fallback` | #2822 | 410 |
| `.claude/worktrees/slack-process-timeout` | #2825 | 407 |
| `.claude/worktrees/slack-telegram-parity` | #2815 | 406 |
| `.claude/worktrees/agent-abc1cf8dea4eea406` | #2490 | 333 |
| `Documents/Codex/…/mira-release-critical` | #2290 | 304 |
| `.claude/worktrees/path-to-beta` | #1779 | 253 |

**NOT disposable despite a merged/closed PR — rescue the untracked files first.**
Every path below was checked against `origin/main` and is **absent** from it:

| Worktree | PR | Untracked content at risk |
|---|---|---|
| `.claude/worktrees/fix+1954-auth-value-copy` (1.5 GB, largest) | #2275 **CLOSED** | `ccw_screenshots.mp4` (766 KB), `factorylm_hub_tour.mp4` (502 KB) — **only 2 `.mp4` files are tracked on `main` at all**, and neither is these. Under the Screenshot Rule promo material is an append-only archive; deleting this worktree destroys them. |
| `Documents/Codex/worktrees/mira-pr2881-paid-gate` | #2881 MERGED | `docs/superpowers/plans/2026-07-24-pr2881-paid-authorization-trust-boundary.md` (20 KB) |
| `Documents/Codex/worktrees/mira-sso-deploy-env` | #2319 MERGED | 2 review diffs under `.superpowers/sdd/` (18 KB) |

Two of the detached Codex worktrees are the same story with no branch at all:
`0c356ac0` holds `docs/architecture/grounding-verification-master-plan.md` (20 KB) plus
two grounding-verification plan/spec docs, and `897f` holds
`docs/superpowers/plans/2026-07-28-printsense-free-technician-hook.md` (18 KB) — none on `main`.

**On #2275 (CLOSED):** its single commit `c7eaf7b4` is *not* unique work — the
manufacturer-alias collapse landed on `main` by another route (`rockwell`,
`automationdirect`, `automation direct`, `deshazzo` are all present today). One trivial
key, `"automationdirect.com"`, never landed. So the commit can go; **the two videos
cannot.**

## Finding 4 — 10 back open PRs (keep, but the worktree is redundant)

#2962, #3099, #3044, #2294, #2310, #2946, #2902, #2943, #3035, #3098. All branches are
pushed, so each worktree can be recreated on demand. Only #3099 currently has a process
in it.

## What this changes about the RCA

`tools/worktree-health.sh` reports age, dirtiness, and inferred owner. It does **not**
check whether a process is live in the worktree, and it does not distinguish "clean and
merged" from "clean but the only copy". Those two checks are what turn its 17 findings
into an actionable order. Worth folding in — as detection only, keeping the
never-auto-delete posture (RCA § Teardown, rule 9).

Raw data: `wt_census.tsv` (regenerate with the method above).

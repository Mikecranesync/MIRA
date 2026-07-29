# Why git worktrees accumulate as clutter — RCA + proposed fixes

**Date:** 2026-07-27 · **Scope:** the `MIRA` repo on CHARLIE · **Status:** analysis + proposal, nothing implemented

Triggered by finding **65 registered worktrees** on the CHARLIE checkout. This documents why they accumulate, what it actually costs, and what to do. The four fixes are proposals — **none are implemented by this document.**

---

## 1. What was found

| | |
|---|---|
| Registered worktrees at session start | **65** |
| Dead admin entries (path gone, but **locked** so `prune` skipped them) | 19 |
| Clean *and* fully merged into `origin/main` — removable with zero loss | 15 |
| Still live after cleanup | **31**, occupying **~16.5 GB** |
| Growth rate | 15 created in June, 16 in July — steady ~15/month, ~1.2/day over the observed span |
| Cleanup automation found anywhere (launchd, cron, hooks, scripts) | **none** |

The 16.5 GB figure was verified two independent ways (one `du` call across all paths, and the sum of per-worktree `du` calls) to rule out a hardlink-dedupe artifact. `worktree.symlinkDirectories` is **not** configured, and the spot-checked worktrees have no shared `node_modules`, so the checkouts are genuinely independent copies.

---

## 2. Root cause

**Creation is mandated and automated from several independent sources; removal is mandated by nothing, owned by no one, and the single cleanup mechanism the doctrine relies on is inverted.**

Four contributing mechanisms, in order of importance:

### 2.1 The doctrine's stated cleanup mechanism can never fire for a productive worktree

`.claude/rules/subagent-worktree-isolation.md` mentions cleanup exactly once, at line 22:

> "This is cheap insurance; the worktree is auto-removed if the [work is unchanged]"

The harness does auto-remove a worktree that is **unchanged**. But a worktree is created *in order to* change things. **By construction, auto-cleanup fires only for the worktrees that did nothing, and never for the ones that did work.** The rule reads as though cleanup is handled. It isn't — it's handled for precisely the empty case.

`CLAUDE.md` § *Sub-agents / Worktrees* has the same shape: it mandates that any file-writing sub-agent MUST get its own worktree, and says nothing at all about tearing one down.

So the doctrine is a one-way valve: a strong, well-justified **create** obligation with no matching **destroy** obligation.

### 2.2 Three independent creator ecosystems, one shared registry

The 31 survivors break down as roughly 12 from Claude Code agent isolation (`.claude/worktrees/`), 10 from Codex (`~/Documents/Codex/`, `~/.codex/worktrees/`), and the rest ad-hoc by hand (`~/MIRA-wt-*`, `~/MIRA-charlie-session`, `~/worktrees/`, `/tmp/*`).

Each ecosystem creates into the *same* `.git/worktrees` registry, and none of them knows about the others' lifecycles. There is no shared owner, so "clean up afterwards" belongs to everyone and therefore to no one.

### 2.3 Locking makes git's own garbage collection a no-op

All 19 dead entries were **locked**, and `git worktree prune` skips locked entries by design. They pointed at `/sessions/…` and `/tmp/…` — filesystems that do not exist on this machine.

This is a **distinct class** from the local clutter and needs a distinct answer. These came from cloud/remote sandbox sessions whose filesystem namespace was never visible here, so no local cleanup hook could ever have fired for them, no matter how well written. Note also that `git worktree list` reported **0 prunable** the whole time — the built-in health signal reads "nothing to clean" while 19 entries are unambiguously dead.

### 2.4 Where cleanup was attempted, it was delegated to a human

Two scripts in the repo touch worktree removal, and the contrast between them *is* the recommendation:

- **`tools/orchestrator/refresh-graph.sh`** — the good citizen. Removes its worktree at **every** exit path (lines 21, 52, 60, 69), including the early-return "nothing to commit" branch.
- **`run-merge-and-verify.command:232`** — `echo`s the `git worktree remove --force …` command for a human to run later.

The second pattern reliably produces clutter. Printing a cleanup command is not cleanup.

---

## 3. What it actually costs

Ordered by severity. **Disk is the least important item here**, despite being the most visible.

### 3.1 Branch-name capture — a hard failure, and the one that cost real time

Git permits exactly **one checkout per branch**, with no TTL and no expiry. A forgotten worktree holds its branch name hostage indefinitely.

This is not hypothetical — it happened during this very cleanup. The shared checkout could not `git checkout main`:

```
fatal: 'main' is already used by worktree at
'/Users/charlienode/MIRA/.claude/worktrees/slack-recovery-plan'
```

A worktree abandoned on 2026-07-19 was holding `main`. Worse, that worktree's local `main` had **diverged** — 4 ahead, 88 behind `origin/main`, carrying a commit (`09eef3ce fix(slack): ship printsense parity backend`, 11 files) that existed on **no remote branch**. Freeing the name required proving that work was already upstream (it was, via squash-merged PR #2815 — which is *why* `git cherry` still reported it unique: a squash changes the patch-id).

So one forgotten worktree turned "check out main" into a multi-step forensic investigation with a real risk of destroying unpushed work. **This class of failure gets more likely as the population grows, and `main` is the most likely name to be captured.**

### 3.2 CodeGraph index pollution — and the ignore list fails open

`.claude/rules/codegraph-usage.md` blind spot #5 already documents this: a nested worktree that is **not** gitignored gets indexed, and every duplicate copy of a symbol counts as an extra caller. The worked example is `callers check_citation_compliance` returning 11 when only 1 was real.

`.gitignore` currently covers `.claude/worktrees/`, `.worktrees/`, `.audit-worktrees/`, and CodeGraph currently indexes 0 files under any worktree path — so the *known* paths are handled.

But it is a **denylist, and it fails open.** This session found `wt-verify` — an ad-hoc worktree at `/Users/charlienode/MIRA/wt-verify`, inside the repo, at a path matching none of the three patterns. `git check-ignore` confirms it was **not** ignored, so it was being indexed. Any hand-made `git worktree add` at a new in-repo path silently re-opens this hole, and the symptom (inflated caller counts) is one the team has already been burned by and is hard to notice.

### 3.3 Registry and disk overhead

`.git/worktrees` was 46 MB of admin data; 31 live checkouts occupy ~16.5 GB on a volume at 84% capacity. Real, but recoverable and non-corrupting — the cheapest of the three harms.

---

## 4. Proposed fixes

Ordered by leverage. **Deliberately NOT proposed: an automatic sweeper that deletes worktrees it judges abandoned.** A heuristic sweep over other sessions' work has to answer "is this dead?", and `git branch --merged` ancestry is a weak signal in this repo because it squash-merges — a wrong guess deletes live, unpushed work, which is exactly the near-miss in §3.1. Automate the *report*, let a human make the deletion call.

### Fix 1 — Creators clean up on exit (highest leverage)  ✅ IMPLEMENTED 2026-07-27 (#2960)

Make removal-on-exit the documented obligation for **any** script or workflow that runs `git worktree add`. `tools/orchestrator/refresh-graph.sh` is the reference implementation: remove at every exit path, including early returns and error paths (a `trap` is the reliable way).

Concretely: change `run-merge-and-verify.command:232` from echoing the removal command to executing it, and state the rule so new scripts inherit it.

### Fix 2 — Close the doctrine gap  ✅ IMPLEMENTED 2026-07-27 (#2960)

1. Correct `.claude/rules/subagent-worktree-isolation.md:22`. The current sentence implies cleanup is handled; state plainly that auto-removal applies **only** to unchanged worktrees and therefore never to one that did work.
2. Add a teardown obligation to `CLAUDE.md` § *Sub-agents / Worktrees*, which today mandates creation and is silent on removal: when the work is merged or abandoned, remove the worktree and delete its branch — and never leave a worktree holding `main`.

### Fix 3 — Turn the CodeGraph ignore into an allowlist  ✅ IMPLEMENTED 2026-07-28

Replace the three enumerated paths with a pattern that catches any nested worktree regardless of location (and/or have `tools/codegraph-preflight.sh` fail loudly when it detects an indexed path containing a `.git` *file* rather than a directory — the unambiguous signature of a nested worktree). Small, deterministic, and directly verifiable against the `wt-verify` case.

### Fix 4 — A periodic report, not a sweep  ✅ IMPLEMENTED 2026-07-28

A weekly job that lists worktrees older than N days with, for each: path, branch, dirty/clean, ahead/behind `origin/main`, and whether an open PR exists. Output goes to a human; **it deletes nothing.** This is the piece that can be automated safely, and it makes §3.1 visible before it becomes a blocker — a "worktree is holding `main`" line in that report would have prevented today's incident entirely.

### Separate track — the remote/cloud class

The 19 dead `/sessions/…` and `/tmp/…` entries cannot be fixed by any local hook, because those filesystems never existed on this machine. Two options, neither local: raise it harness-side (a remote session should unlock/deregister its worktree when it ends), or simply accept them and run `git worktree unlock` + `prune` periodically — noting that **`git worktree list` reports 0 prunable for locked-and-missing entries**, so this needs an explicit unlock step and cannot rely on the built-in signal.

---

## 5. Cleanup already performed (2026-07-27)

For the record, and as the baseline any fix should preserve:

- Pruned the 19 dead locked entries (unlock → dry-run → prune). All 5 detached HEADs among them were verified reachable from `audit/*` branches first, so **0 commits lost**.
- Removed 15 worktrees that were clean **and** fully merged, after scanning each for ignored-but-valuable files (`.env`, `*.pem`, credentials — none found). **Branches deliberately kept**, so every one is recreatable.
- Left untouched: everything with uncommitted work, and every unmerged branch (several back open PRs).
- Manifest of all 65 with actions taken: `.git/worktree-manifest-2026-07-27.txt`.

Result: 65 → 31 registered (30 after this document's own worktrees were cleaned up), `.git/worktrees` 46 MB → 23 MB, ~8.1 GB reclaimed, 0 dangling paths, all 367 branches intact.

---

## Implementation status (updated 2026-07-28)

| Fix | Status | Where |
|---|---|---|
| 1 — creators clean up on exit | ✅ shipped | #2960 — `trap` added to `refresh-graph.sh`; § Scripts documents patterns (a)/(b) |
| 2 — close the doctrine gap | ✅ shipped | #2960 — inverted "auto-removed" sentence corrected; § Teardown + `CLAUDE.md` |
| 3 — CodeGraph ignore → allowlist | ✅ shipped | `tools/codegraph-preflight.sh` — WARN-only `⚠ NESTED WORKTREE` on any in-repo worktree outside the three allowed prefixes |
| 4 — periodic report, not a sweep | ✅ shipped | `tools/worktree-health.sh` + 11 hermetic tests; detection-only, always exits 0 |
| #2952 — nightly `main`-pinned worktree | see the issue | tracked separately; deliberately **not** bundled with 1–4 so it can be rolled back alone |

**Not scheduled anywhere yet.** `tools/worktree-health.sh` exists but no cron/launchd
entry runs it — wiring that up is a deliberate follow-up, since a schedule is an
operational decision (where does the output go, who reads it) rather than a code one.

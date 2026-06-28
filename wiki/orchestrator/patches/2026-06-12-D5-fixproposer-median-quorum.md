# D5 — Fix-proposer median quorum (kills phantom fix-PRs)

Audited `origin/main` @3fd194b2 (D5, 2026-06-12). Staged patch:
`2026-06-12-D5-fixproposer-median-quorum.patch` (3 files, 150 insertions, 222 patch lines).

## What it changes

The nightly fix-proposer (`mira-bots/tools/fix_proposer.py`, driven by
`tests/eval/fix_proposer_tasks.py`) clusters failing eval scenarios off **one**
scorecard (`find_latest_scorecard` → `parse_scorecard` → `cluster_failures`) and
opens a draft PR per cluster of ≥ `min_cluster_size` (default 3). Because it reads
a single scorecard, a scenario that is *flaky* — passes most runs, fails one — can
join a same-signature cluster and spawn a draft PR for a non-problem.

This patch inserts a **median quorum across the last N scorecards** before
clustering:

- New `_recent_scorecards(runs_dir, limit)` — returns up to `N` newest `*.md`
  scorecards, using the *same ordering as* `find_latest_scorecard` (lexical-desc,
  judge-enabled runs first) so the window is drawn from the same population.
- New `quorum_failures(latest_failures, runs_dir, window)` — a failure from the
  latest scorecard survives only if the same
  `(scenario_id, checkpoint, reason_signature)` triple appears in **≥ ceil(N/2)**
  of the last `N` scorecards. Logs how many it dropped.
- New config field `FixProposerConfig.quorum_window: int = 3` + env var
  **`FIX_PROPOSER_QUORUM_WINDOW`** (default `3`), wired in both `_build_proposer()`
  (CLI) and the Celery task `run_nightly()`.
- `run()` calls `quorum_failures(...)` between `parse_scorecard` and
  `cluster_failures`; if nothing survives it returns
  `{"status":"ok","reason":"no_quorum_failures"}`.

**Backward-compatible by construction:** if fewer than `N` scorecards exist (the
common case in a fresh runs dir) or `window < 2`, `quorum_failures` returns the
latest failures unchanged — byte-for-byte the historical single-scorecard
behavior. All 17 pre-existing `test_fix_proposer.py` tests still pass; 5 new
quorum tests were added (passthrough-when-sparse, window<2, flaky-dropped /
persistent-kept, threshold-edge, and an end-to-end phantom-cluster-suppressed
case).

## Why (phantom clusters #1773/#1788)

Documented flaky scenario `vfd_abb_03` passes 7/9 runs yet a single bad scorecard
flags it; the resulting fix-PRs are tracked as **#1773 / #1788**. Requiring a
median quorum means a one-off bad run can no longer drive an automated PR, while a
genuinely-regressed scenario (failing the median of recent runs) still does.

## Design notes / scope (Karpathy: smallest diff that solves it)

- Quorum is keyed on the *failure signature* triple `(scenario, checkpoint,
  reason_signature)`, reusing the existing `_reason_signature()` normalizer — so a
  scenario that fails for a *different* reason across runs is correctly treated as
  not-the-same-failure, matching how `cluster_failures` already groups.
- The latest scorecard's records remain the clustering input (just pre-filtered),
  so cluster shape, IDs, PR titles, and `max_clusters_per_run` are unchanged.
- No new dependencies (`math.ceil` from stdlib). Matches repo ruff style
  (`ruff check` clean on the two touched non-test files; `ruff format` clean on all
  added code — pre-existing F401s and pre-existing unformatted blocks in the test
  file were intentionally **not** swept in, per the surgical-changes rule).

## Verify — exact commands + captured output

Generated in a throwaway worktree of `origin/main`; checked in a second clean one.

```
$ git worktree add --detach /tmp/d5-verify origin/main
HEAD is now at 3fd194b2 fix(ci): oauth canary runs hourly ... (#1897)

$ git -C /tmp/d5-verify apply --check 2026-06-12-D5-fixproposer-median-quorum.patch ; echo $?
0                       # FORWARD: applies cleanly to origin/main

$ git -C /tmp/d5-verify apply --check --reverse 2026-06-12-D5-fixproposer-median-quorum.patch ; echo $?
error: patch failed: tests/eval/test_fix_proposer.py:26
error: tests/eval/test_fix_proposer.py: patch does not apply
error: patch failed: tests/eval/fix_proposer_tasks.py:18
error: tests/eval/fix_proposer_tasks.py: patch does not apply
error: patch failed: mira-bots/tools/fix_proposer.py:31
error: mira-bots/tools/fix_proposer.py: patch does not apply
1                       # REVERSE fails → patch is NOT already applied

$ git -C /tmp/d5-verify apply 2026-06-12-D5-fixproposer-median-quorum.patch ; echo $?
0                       # full (non --check) apply also lands
$ git -C /tmp/d5-verify diff --stat
 mira-bots/tools/fix_proposer.py  | 77 ++++++++++++++++++++++++
 tests/eval/fix_proposer_tasks.py |  2 ++
 tests/eval/test_fix_proposer.py  | 71 ++++++++++++++++++++
 3 files changed, 150 insertions(+)
```

Tests (run in the throwaway worktree, isolated venv with `ruff pytest pytest-asyncio httpx pyyaml`):

```
$ python -m pytest tests/eval/test_fix_proposer.py -o asyncio_mode=auto -q
......................                                                   [100%]
22 passed in 0.04s        # 17 pre-existing + 5 new quorum tests
```

## Mergeability / D-series context

This is the **keyless, mergeable-today** piece of the D-series remediation: it is a
pure clustering-gate change with no secrets, no LLM-key dependency, and a fully
backward-compatible default — it can go straight to a PR. By contrast, the
replay-seam activation steps in `2026-06-11-D4-replay-seam-activation.md` remain
inert pending **founder LLM-key recording** (steps 1–2 record real LLM outputs;
no code patch can substitute for that). D5 ships independently of D4.

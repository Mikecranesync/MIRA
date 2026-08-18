# eval-fixer run — 2026-08-17 (charlienodes-mac-mini)

- Scorecard: **35/65 raw (54%)** / **35/52 gradeable (67.3%)**, 30 failures, **13 timeouts**.
  Card `2026-08-17T0203-offline-text.md`, runtime 2670.3s, start **08-17 01:18 UTC**.
- Action: **issue-filed, no patch** — hard stop on both counts (28 patchable > 15 **and** 3 clusters).
  Night ~26, still zero patches ever.
- ⚠️ **Tonight's card is confounded and should NOT enter the latency series** — see Cause 2.

## 🔑 Cause 1 — THE #3085 DISCRIMINATOR ALREADY RAN, AND NOBODY READ IT OUT

Proposed 08-14, launched 08-16, and then **left on disk unread**:
`tests/eval/runs/2026-08-16T0558-EXPERIMENT-timeout90.txt`. It has sat there for a day while two
subsequent nights re-reported "the discriminator has still never been run."

**Read against the 08-16 session's own pre-registration** (its 16 named timed-out fixtures →
"how many complete at 90s?"; the 08-15 session also records launching one but left **no artifact**,
so there is exactly one experiment card and it belongs to 08-16's registration):

| | 30s baseline (`2026-08-16T0216`) | 90s experiment (`2026-08-16T0558`) |
|---|---|---|
| raw | 38/65 | **58/65** |
| timeouts | 16 | **1** |
| gradeable | 38/49 = 77.6% | **58/64 = 90.6%** |

**14 of the 16 named fixtures go straight to 7/7 at 90s.** Only `asset_change_mid_session_08`
(6/7) and `vfd_ab_01_pf525_f004_undervoltage` (5/7) still fail.

Pre-registered verdict was: *"Mostly pass ⇒ pure latency artifact, #3190 cost no answer quality."*
**14/16 is mostly pass.** 90.6% gradeable also clears 08-15's outcome-**A** band (83–86) and sits
above the PRE max (86.2). ⇒ The post-#3190 "quality regression" is a **measurement artifact**;
#3085 is the whole delta.

**Tree parity verified, not assumed.** The two cards ran on *different* trees — baseline on
`main@3ba7f4e54`, experiment on `ops/orphan-health-detection@5d6fc452e` (reflog: that branch was cut
23:56 EDT, between the two runs). `git diff --name-only 3ba7f4e54 5d6fc452e -- mira-bots/shared/
prompts/ tests/eval/ mira-bots/ask_api/` is **empty**, so the comparison stands: an ops/tooling
commit cannot convert a timeout into a 7/7.

### 🔴 The hedge that must ship with the number — and the ask that removes it

**n=1, and a quiet-host window is not excluded.** `2026-08-15T0551` scored **54/65 with TO=1 at the
default 30s** — so a 1-timeout run is reachable *without* the env var. `16 → 1` therefore does not
by itself implicate the raised budget.

**The harness records no per-fixture elapsed time** (only `Total runtime`), so the question that
would settle it — *did the 14 recovered fixtures complete in the 30–90s window, or under 30s?* —
is unanswerable from the artifact. **That is the concrete ask on #3085: emit per-fixture elapsed
seconds.** Cheaper than another suite run and it decides rather than describes.

### ✅ But the series-level argument survives n=1 — quote this, not the single pair

Timeout count is the dominant determinant of the raw score across **all 20 runs on file**, however
the low-timeout state was reached:

- every run with **TO ≥ 10** (n=12): raw **35–45**
- both runs with **TO = 1**: raw **54** (30s, 08-15T0551) and **58** (90s, experiment)

And the correlation runs the *opposite* way to the quiet-host story: the two TO=1 runs have the
**longest** runtimes in the series (2993.9s, 3055.0s) while every TO≥10 run is 2662–2890s. A quiet
host predicts fixtures finishing *faster*; what we see is fixtures being allowed to *finish*.
Indirect, not decisive — hence the ask above.

### ⚠️ WHITELIST TRAP — restated because a decisive result makes the wrong fix more tempting

`_PROCESS_TIMEOUT = float(os.getenv("MIRA_PROCESS_TIMEOUT","30"))` at **`engine.py:384`** is inside
the autopatch whitelist as a one-line change. **It is the wrong fix.** Changing that default alters
production behaviour for every adapter that does not override (Slack 60, kiosk 90). **#3085's fix is
harness-side.** The experiment set the var on the command line only and committed nothing.

## 🔴 Cause 2 — tonight's card was graded across a mid-run branch switch

The shared tree was on `feat/cu-03-knowledge-entries-write-path@b0087f94a` when the run started
(21:18 EDT) and was checked out to `main@1ce65139a` at **21:31 EDT — 13 minutes into a 44-minute
run.** This is exactly the trap 08-15 recorded ("never check out branches while an in-process eval
is running"), hit by a *different* session this time.

Diagnostic-surface parity between those two commits is crawler/ingest-only, so no *answer* changed —
but **the thing being measured tonight is latency**, and a mid-run `git checkout` churns the
filesystem and Python import state. Tonight is simultaneously **the lowest gradeable of 20 runs
(67.3%, vs a 74.5–88.2% band)** and the only night with a documented mid-run tree mutation. Naming
that correlation is the honest call: **this card is not a usable data point in the latency series.**

## 🔴 Cause 3 — #3154 finally has its concrete cost argument (night ~14)

`/tmp/mira-eval-fixer.log` now holds **20** `safe-cron-pull: SKIP — working tree is dirty` entries,
still from the same lone foreign untracked file `docs/prd/2026-08-03-cited-technician-turn.md`
(created 08-03). `bash tools/pr-merge-blocker.sh 3154` → **`BEHIND: base branch moved — update the
branch`**, unchanged since 08-11.

**The new argument: that pin is *why* a feature branch was the graded tree on the worst-gradeable
night of the series.** Fourteen nights of "still BEHIND" moved nothing; a named cost might.
Left alone — foreign PR, and rebasing it is a human call.

## Tonight's 30 failures — all attributed, nothing unfiled

| Cause | n | Tracked |
|---|---|---|
| Timeout / latency | **13** | #3085 |
| FSM under-advancement | 11 | #3086 |
| Cross-vendor / cross-model citation | 3 | #3049 |
| SAFETY over-escalation | 2 | cf #1834 (closed) |
| `KB-gap` on control-refusal lane | 1 | #3145 |

- FSM (11): `gs10_01`, `gs20_03`, `full_07`, `pf520_17`, `v1000_22`, `self_critique_34`,
  `self_critique_35`, `topic_switch_22`, `symptom_switch_25`, `danfoss_01`, `siemens_01`.
  Direction re-checked: **all behind the expected state, none ahead** — 3rd night of unanimous
  directionality, consistent with #3086's one-coherent-defect reading.
- **SAFETY over-escalation recurs and has now moved fixtures.** `gs3_ground_fault_14` and
  `pf523_heatsink_18` both answered `STOP — describe the hazard…` on prompts with no hazard.
  ⚠️ `gs3_14`'s **signature changed**: prior nights logged it as the *improvement-scored-as-a-loss*
  (honest refusal after #3133). Tonight it is a safety trip. **Compare failure reasons across runs,
  never counts.** Not touched — `# SAFETY` behaviour is out of autopatch scope and a false negative
  is far worse than this false positive. #1834 is **closed**; this needs a fresh issue or a reopen —
  flagged for a human rather than filed blind.
- **0 of 17 `cp_keyword_match` failures were genuine missing phrases** — #2759's misfiling argument,
  **6th consecutive night**. Watchdog precision bug 6th night (`skip_failures: 2`, but the two named
  are cross-vendor, while the structurally-unpatchable safety pair is marked patchable).

## Corrections to prior nights

- 🔴 **The 08-16 fragment mis-states its own graded tree.** It records `5d6fc452e`; that commit was
  made **23:59:34 EDT**, ~1h40m *after* its card was written (22:16 EDT). Card
  `2026-08-16T0216` actually graded **`3ba7f4e54`** (`main`). The reflog is the arbiter, not the
  session's recollection. Nothing else in that fragment depends on it.
- The 08-15 and 08-16 fragments **both** record launching a discriminator; only one card exists.
  Attribute it to 08-16 by timestamp and stop looking for a second.

## Process

- Delivery: **branch → PR cut off `origin/main`** (local `main` == `origin/main`, 0/0), fragment
  staged by exact path, lock via `tools/eval_fixer_fragment.py --acquire` / `--release` verified by
  re-acquiring. **Not Step 10** — it has bypassed branch protection twice.
- ✅ **Failure 3 is clear for once:** `origin/main:wiki/hot.d/` runs through **08-16** (PR #3255
  consolidated 08-07 → 08-16 and closed the five superseded per-night PRs). The branch-per-night
  backlog is gone. Keep it that way — one PR per night regenerates it.
- Foreign untracked `docs/prd/2026-08-03-cited-technician-turn.md` and the `feat/cu-03-…` branch
  left untouched throughout.
- Steps 5–7 (baseline + verify eval runs) skipped on the no-patch path — two full `offline_run.py`
  passes cost real budget and prove nothing.

# eval-fixer run — 2026-09-06 (charlienodes-mac-mini)

- Scorecard: 52/65 passing (80%) — `tests/eval/runs/2026-09-06T0250-offline-text.md`
- Action: issue-filed (no patch) — report on rolling tracker #1876
- Third consecutive zero-timeout night. All 13 failures genuine.

**Headline: no card since 2026-09-05 01:04 is reproducible.** The nightly runs with
`WorkingDirectory=/Users/charlienode/MIRA` (the shared checkout), which has carried 14
uncommitted lines in `mira-bots/shared/engine.py` since then. `git log --all -S
"DST_SKIP_CONTROL_ACTION"` returns nothing — the change exists in no commit on any branch.
Every card from `09-05T0919` on, including the 58/65 high, reports on code that is not in
git. Diff preserved verbatim in the #1876 comment (not reverted, not committed — foreign WIP).

**Decomposition — 58→53→52 is flicker inflation, not a regression.** The persistent set is
identical across all five recent cards; only the flicker count moved (2 → 7 → 8).

- Persistent 5/5: `pf525_f004_02`, `gs20_cross_vendor_03` (promoted 4/5→5/5, now
  deterministic), `gs3_ground_fault_14`, `self_critique_low_groundedness_34`,
  `topic_switch_gs10_to_pf525_22`.
- `control_refusal_clean_26` has **left** the backlog — failed 5/5 as of 09-04, absent from
  all five cards since 09-05T0919, passes at 0.0s. The WIP above is a control-action refusal
  short-circuit with a matching mtime, but its comment cites "fixture 64 / E2" — dated
  correlation, not a confirmed cause. Worth confirming: if it holds, the #1 backlog item's
  fix is unmerged, uncommitted code.

**No patch:** `engine.py` is dirty with foreign WIP, so no clean single-file diff is possible
(would stage those 14 lines into #3553). Watchdog also reported 3 file clusters → Step 2 hard
stop. Rejected the filter-to-persistent-only path: 4 of the 5 are `cp_reached_state` failures
in `engine.py`, the one file that can't be cleanly staged.

**Do not take these watchdog suggestions:** `pf40_undervoltage_21` + `danfoss_vlt_undervoltage_27`
are router `safety_concern` STOPs (#1834) — a `SAFETY_KEYWORDS` patch masks the router bug.
`gs10_overcurrent_01` + `full_diagnosis_happy_path_07` returned bare KB-gap placeholders and
both passed at 09-05T1804 — retrieval variance, not a phrase list.

**Human action:** (1) make the nightly reproducible — clean worktree, or record `HEAD` +
`git status --porcelain` in the scorecard header; (2) land or discard the `engine.py` WIP;
(3) rebase + un-draft #3553, which now holds four nights of stranded fragments.

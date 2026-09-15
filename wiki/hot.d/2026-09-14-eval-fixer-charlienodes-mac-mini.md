# eval-fixer run — 2026-09-14 (charlienodes-mac-mini)

- Scorecard: 53/65 passing (82%) — high-band of the 23-run 48–54 series (09-10 → 09-14); watchdog
  `regressions: []`
- Action: issue-filed — tracker #1876 comment; **no new issues, no patch** (3 overlapping
  `file_clusters` hard stop, #2759, same as every night since 09-07)
- **Headline — the last two nights' "code path verifiably static" was a stale-snapshot artifact.**
  The shared checkout has been pinned to `34f8c42c4` (`fix/v3-composer-affordances`, main as of
  09-09 00:43) since 09-09 08:00 EDT; the launchd eval `cd`s into it and `safe-cron-pull` no-ops off
  `main`. All 23 scorecards measured that one tree. Meanwhile `origin/main` moved 23 commits incl.
  **#3770** (`guardrails.py` +89, energized-work hazard gate, merged 09-13) and **#3792** — neither has
  ever been evaluated. Tree is clean on the eval paths, so the measured SHA is exact. Fixture sets
  identical (83/83) → `/65` stays comparable. Dated instance posted on **#2952** with the plist line,
  reflog entry, and merge-base proof; human action = detached `origin/main` worktree + SHA stamp in
  the scorecard header.
- Staleness does not explain tonight's 12 failures (#3770 is a 480V+∧energized-intent conjunction
  gate; `engine.py` byte-identical to main) — it tree-qualifies every chronic count.
- Corrected yesterday: `gs3_ground_fault_14` (20/23) is **not** homeless — **#3713** already has the
  reproduction; posted the updated count there instead of filing a duplicate.
- Chronic table (fails/23, positive control 0/23 ✓): `self_critique_34` 23, `topic_switch_22` 23,
  `pf525_f004_02` 22, `gs20_cross_vendor_03` 20, `gs3_14` 20, `yaskawa_a1000_23` 20,
  `pf40_21` 18, `help_mid_session_24` 13, `vfd_ab_03` 11, `lenze_30` 7, `gs10_01` 6, `gs1_12` 3,
  `vfd_abb_04` 1 (passed tonight).
- Did not run the suite on `main` (~24 min live cascade, provider-health canary red since 09-07,
  #3546 disk pressure) — listed as the human's one measurement on #2952.
- Nothing staged or committed: tree carries another session's V3 branch + 8 untracked promo
  screenshots. Fragment left for `--publish`.

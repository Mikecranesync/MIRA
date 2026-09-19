# eval-fixer run — 2026-09-13 (charlienodes-mac-mini)

- Scorecard: 49/65 passing (75%) — low cluster of the measured 48–54 band (17 runs, 09-10 → 09-13:
  1×48, 4×49, 2×50, 3×51, 3×52, 4×54); watchdog `regressions: []`
- Action: issue-filed — tracker #1876 comment only; **no new issues** (no patch: 3 overlapping
  `file_clusters` hard stop, the #2759 gate, same as every night since 09-07)
- Code path verifiably static: no commits to `mira-bots/shared/`, `prompts/diagnose/`, `tests/eval/`
  on `origin/main` since 09-09; tree byte-identical to `origin/main` there. Spread = cascade
  nondeterminism.
- Corrected yesterday's "three unowned chronic failures": `self_critique_low_groundedness_34`
  (17/17) + `pf525_f004_02` (16/17) are named in **#3086** (idle since 08-04);
  `topic_switch_gs10_to_pf525_22` (17/17) + `symptom_switch_after_fault_lookup_25` are in **#3676**.
  The only chronic failure with no home is `gs3_ground_fault_14` (15/17) — deliberately not filed
  tonight; gets an issue if still ≥15/17 next run.
- First-time failure: `vfd_abb_04_acs150_multi_turn` (1/17) — `Q1` not `DIAGNOSIS`; watch, don't chase.
- `gs20_cross_vendor_03` (14/17) passed tonight → invisible in the report (#2759 under-reporting half).
- Process note for the wrapper: my first chronic-count pass returned 0/17 for every fixture — a zsh
  word-splitting bug (`$files` unquoted-as-one-arg). Caught only because the positive control
  (a fixture known to fail tonight) also read 0. Re-ran with an array.
- Nothing staged or committed: working tree is on `fix/v3-composer-affordances` with another
  session's V3 work + 8 untracked promo screenshots. Fragment left for `--publish`.

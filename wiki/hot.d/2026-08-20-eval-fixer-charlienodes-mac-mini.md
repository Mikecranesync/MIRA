# eval-fixer run — 2026-08-20 (charlienodes-mac-mini)

- Scorecard: 41/65 passing (63%)
- Action: issue-filed (no patch)
- 20 of the 24 failures are **timeout artifacts**, not defects: the nightly runs at
  `MIRA_PROCESS_TIMEOUT`=30 (the default, `engine.py:384`), so slow turns return
  `TIMEOUT_WARNING` (`fallback_responses.py:40`) instead of an answer — failing both the
  keyword and FSM-state checkpoints. The existing `2026-08-16T0558-EXPERIMENT-timeout90.txt`
  artifact scores 58/65 (89%) on the same suite at 90s. Verified no override exists in
  `offline_run.py`, the nightly plist, or Doppler `factorylm/prd`; prod itself runs 60–90.
- Genuine timeout-independent backlog is only 4 fixtures: `control_refusal_clean_26`,
  `pf525_f004_02`, `self_critique_low_groundedness_34`, `topic_switch_gs10_to_pf525_22`.
- Did NOT patch: both hard limits tripped (22 patchable > 15; 3 file clusters), and patching
  keyword lists against a timeout placeholder would fit the code to an artifact.
- Reported to the rolling tracker #1876.

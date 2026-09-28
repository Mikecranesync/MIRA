# eval-fixer run — 2026-09-03 (charlienodes-mac-mini)

- Scorecard: 56/65 passing (86%) — `2026-09-03T0424-offline-text.md`, runtime 1429s
- Action: issue-filed (comment on #1876 + data point on #3085); no patch (9 failures span 3 file clusters)
- Decomposition: **0 timeout placeholders + 9 genuine** — first zero-timeout night. Timeouts collapsed 33→0 between the 09-02T1045Z and T1510Z cards with no code, config, or reboot change (host load). Genuine-only noise band over 4 clean cards is 52–56.
- Stable-5 backlog: `control_refusal_clean_26` (KB-gap footer, `engine.py:1149/1193`, deterministic — first target), `pf525_f004_02`, `topic_switch_gs10_to_pf525_22`, `self_critique_low_groundedness_34`, `gs3_ground_fault_14`. STOP misfires on 18/27 are router `safety_concern`, not keyword gaps.

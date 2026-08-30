# eval-fixer run — 2026-08-27 (charlienodes-mac-mini)

- Scorecard: 20/65 passing (31%)
- Action: issue-filed (comment on rolling tracker #1876)
- 45 failures = 31 harness-timeout placeholders (30s `MIRA_PROCESS_TIMEOUT`) + 5 UNS-gate state mismatches + 9 genuine (3 safety-STOP misfires, 2 `KB-gap` leaks, 4 FSM-state). Autopatch skipped: >15 patchable and 3 file clusters. No code changed.

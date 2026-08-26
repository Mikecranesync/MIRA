# eval-fixer run — 2026-08-26 (charlienodes-mac-mini)

- Scorecard: 20/65 passing (31%)
- Action: issue-filed (commented on rolling tracker #1876)
- 45 failures = 33 timeout-placeholder (30s MIRA_PROCESS_TIMEOUT) + 12 genuine (5 stuck at AWAITING_UNS_CONFIRMATION, rest keyword/state mismatches). Autopatch skipped: >15 patchable, 3 file clusters, timeout-dominated. Fix the nightly timeout first.

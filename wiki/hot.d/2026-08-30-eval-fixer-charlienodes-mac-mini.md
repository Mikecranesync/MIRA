# eval-fixer run — 2026-08-30 (charlienodes-mac-mini)

- Scorecard: 21/65 passing (32%) — `tests/eval/runs/2026-08-30T0404-offline-text.md`
- Action: issue-filed (commented on rolling tracker #1876)
- 44 failures = 31 `MIRA_PROCESS_TIMEOUT` (30s) placeholders + 13 genuine; 6th consecutive night of the timeout pattern. Autopatch skipped: >15 patchable, 3 file clusters, and the majority is the harness timeout (not patchable). Genuine cluster to look at: 5 fixtures stuck at `AWAITING_UNS_CONFIRMATION` despite vendor+model in the opener.

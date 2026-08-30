# eval-fixer run — 2026-08-29 (charlienodes-mac-mini)

- Scorecard: 20/65 passing (30%)
- Action: issue-filed (comment on rolling tracker #1876)
- 45 failures = 31 harness-timeout placeholders (30s `MIRA_PROCESS_TIMEOUT`, 5th consecutive night, watchdog miscounts them as patchable) + 14 genuine (4 UNS-gate stuck at AWAITING_UNS_CONFIRMATION, 1 WO-preview unknown asset, 1 FSM over-asks, 1 greeting-menu on narrative opener, 7 keyword misses). Autopatch skipped: >15 patchable and 2 file clusters. No code changed.

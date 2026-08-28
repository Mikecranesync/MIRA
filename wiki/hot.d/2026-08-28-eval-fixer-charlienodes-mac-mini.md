# eval-fixer run — 2026-08-28 (charlienodes-mac-mini)

- Scorecard: 22/65 passing (34%)
- Action: issue-filed (comment on rolling tracker #1876)
- 43 failures = 33 harness-timeout placeholders (30s `MIRA_PROCESS_TIMEOUT`) + 10 genuine (5 UNS-gate stuck at AWAITING_UNS_CONFIRMATION, 2 topic-switch CE10/Modbus keyword leaks, 1 `KB-gap` leak, 2 FSM/KB-miss). Autopatch skipped: >15 patchable and 3 file clusters. No code changed. Timeout override still not applied — 4th consecutive night.

# eval-fixer run — 2026-11-24 (charlienodes-mac-mini)

- Scorecard: 18/65 passing (28%)
- Action: issue-filed (tracker #1876, comment 7123484093)
- Hard stop: 47 patchable > 15, spans 3 files. Same cause as since 2026-10-10: graded checkout `4306e091b` is 654 behind main; its providers all fail (groq 400, together 402) and fall to a Docker-only hostname (Errno 8). Main's canary is green.

# eval-fixer run — 2026-11-28 (charlienodes-mac-mini)

- Scorecard: 18/65 passing (28%)
- Action: issue-filed (comment on tracker #1876)
- Hard stop: 47 patchable failures, over the 15 limit. Same verdicts as 11-27T2150. 43 replies are Errno 8 because the graded checkout `4306e091b` (703 behind main) only has Groq (400) and Together (402). Canary green on its last 2 runs. No baseline eval, no patch.

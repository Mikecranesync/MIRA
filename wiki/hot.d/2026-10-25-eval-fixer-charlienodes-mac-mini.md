# eval-fixer run — 2026-10-25 (charlienodes-mac-mini)

- Scorecard: 18/65 passing (27%)
- Action: issue-filed (comment on #1876: https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-6393694747)
- Same failures as every night since 10-10. 43/47 replies are Errno 8 because every cloud provider refuses the call (groq 400 ×15702, together 402 ×13541), so the router falls through to an Open WebUI host it cannot resolve. Hard stop (47 > 15 patchable, 3 clusters), so no patch and no eval spend. Graded tree is `4306e091b`, 401 behind main.

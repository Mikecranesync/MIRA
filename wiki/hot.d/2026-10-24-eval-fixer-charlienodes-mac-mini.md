# eval-fixer run — 2026-10-24 (charlienodes-mac-mini)

- Scorecard: 18/65 passing (27%)
- Action: issue-filed (comment on tracker #1876: https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-6380140779)
- 15th night of the same cascade billing outage: 43/47 replies are Errno 8 from falling back to Open WebUI (`mira-core`). Groq 400 and Together 402 in the run log, canary red. 47 failures across 3 clusters is past the hard-stop limit, so no patch and no baseline eval.

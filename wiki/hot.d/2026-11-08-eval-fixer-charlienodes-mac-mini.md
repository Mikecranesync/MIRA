# eval-fixer run — 2026-11-08 (charlienodes-mac-mini)

- Scorecard: 18/65 passing (28%), card 2026-11-08T0334, verdicts unchanged since 2026-10-13T1120
- Action: issue-filed (comment on #1876: https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-6717998019)
- Hard stop (47 patchable > 15). 43 failures are Errno 8 from the stale graded checkout (`4306e091b`, 544 behind main, router has no OpenAI/OpenRouter). Canary is green, so the providers are fine. Fix: point the eval launchd job at origin/main.

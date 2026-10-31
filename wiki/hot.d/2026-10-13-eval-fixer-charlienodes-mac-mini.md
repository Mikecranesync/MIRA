# eval-fixer run — 2026-10-13 (charlienodes-mac-mini)

- Scorecard: 18/65 passing (27.7%)
- Action: issue-filed
- Autopatch was skipped: 47 patchable failures across 3 file clusters, over the limit of 15. 43 of the 47 are `MIRA error: [Errno 8]`. Groq is cut off for overdue payment and Together is out of credits (canary run 38335732753: 1/3 up, only openai). The eval checkout is still `fix/v3-composer-affordances` @ 34f8c42c4, 259 behind main, so the OpenAI-first cascade (#4349) isn't the code under test. Reported on #1876: https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-6138625472

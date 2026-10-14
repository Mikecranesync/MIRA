# eval-fixer run — 2026-10-14 (charlienodes-mac-mini)

- Scorecard: 18/65 passing (28%)
- Action: issue-filed
- Autopatch was skipped: 47 patchable failures across 3 file clusters, over the limit of 15. 43 of the 47 are `MIRA error: [Errno 8]`, the same as the last 4 nights. The provider canary (run 38480771725) shows 1/3 providers up: openai up, groq down (overdue payment), together down (402 credits). The eval checkout is still `fix/v3-composer-affordances` @ 34f8c42c4, 273 behind main. Reported on #1876: https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-6161278441

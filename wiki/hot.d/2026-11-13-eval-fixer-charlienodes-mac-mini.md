# eval-fixer run — 2026-11-13 (charlienodes-mac-mini)

- Scorecard: 18/65 passing (28%)
- Action: issue-filed (comment 6856696541 on tracker #1876)
- 47 failures, all `MIRA error: [Errno 8]` / IDLE — above the 15-failure hard stop, no patch, no baseline eval. Cause unchanged since 2026-10-10: the launchd job grades the stale `fix/v3-composer-affordances` checkout (`4306e091b`, 581 behind main) whose router has no OpenAI/OpenRouter; groq 400 ×4495, together 402 ×4495, openrouter ×0 in the run log. Canary green ×3. Fix is to point the eval job at origin/main.

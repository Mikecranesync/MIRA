# eval-fixer run — 2026-11-22 (charlienodes-mac-mini)

- Scorecard: 18/65 passing (28%)
- Action: issue-filed (comment on tracker #1876: https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-7075073207)
- Hard stop: 47 patchable failures (>15), multiple files. Same cause as every night since 10-10: graded checkout `4306e091b` (632 behind main) has no OpenAI/OpenRouter in its router; Groq 400 / Together 402 → Open WebUI Errno 8. Canary green ×3 on main. No patch, no baseline eval.

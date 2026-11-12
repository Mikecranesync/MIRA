# eval-fixer run — 2026-11-12 (charlienodes-mac-mini)

- Scorecard: 18/65 passing (28%)
- Action: issue-filed (comment on tracker #1876)
- Hard stop: 47 patchable failures (>15) across 3 file clusters. 43/47 are `[Errno 8]` replies; verdicts identical to the 11-11T2319 card. Graded tree `4306e091b` is 575 behind main and its router has no OpenAI/OpenRouter; canary green ×3. No baseline eval run. Fix = point the eval launchd job at origin/main.

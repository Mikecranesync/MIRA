# eval-fixer run — 2026-11-04 (charlienodes-mac-mini)

- Scorecard: 18/65 passing (28%) — `tests/eval/runs/2026-11-04T0424-offline-text.md`
- Action: issue-filed (comment on tracker #1876: https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-6623837792)
- Hard stop: 47 patchable failures (>15), spread over several files. No patch, no baseline eval.
- Cause unchanged since 10-13: graded tree `4306e091b` (499 behind main) has only Groq (400) and Together (402) providers, then falls through to the Docker-only Open WebUI host → Errno 8.

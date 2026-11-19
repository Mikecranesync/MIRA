# eval-fixer run — 2026-11-19 (charlienodes-mac-mini)

- Scorecard: 18/65 passing (28%) — `tests/eval/runs/2026-11-19T0401-offline-text.md`
- Action: issue-filed (comment on rolling tracker #1876: https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-7001154344)
- No patch: 47 patchable failures (limit 15) across 3 target files (limit 1). No baseline eval run, no code changed.
- Cause unchanged since 2026-10-10: 43/47 replies are `[Errno 8]` — the graded checkout (`fix/v3-composer-affordances` @ `4306e091b`, 617 behind main) only knows Groq/Together (HTTP 400/402), then falls through to the Docker-only `mira-core` host. Canary on main is green ×3.
- Open decision: point the nightly eval job at `origin/main`, or keep treating 18/65 as noise.

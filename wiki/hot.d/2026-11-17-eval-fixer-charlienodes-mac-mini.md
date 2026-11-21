# eval-fixer run — 2026-11-17 (charlienodes-mac-mini)

- Scorecard: 18/65 passing (28%) — card `2026-11-17T0240-offline-text.md`
- Action: issue-filed (comment on rolling tracker #1876: https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-6940144378)
- No patch: two hard stops (47 patchable > 15; 3 file clusters). No baseline eval run.
- Cause unchanged: the job grades `fix/v3-composer-affordances` @ `4306e091b`, 608 behind main. Its router only knows Groq/Together (HTTP 400 / 402 on every call), then falls to a Docker-only hostname → 43 `Errno 8` replies. Verdicts identical to the 11-16T2233 card. Canary on main green 3/3.
- Open decision for Mike: point the eval launchd job at a detached `origin/main` worktree, or keep treating 18/65 as noise.

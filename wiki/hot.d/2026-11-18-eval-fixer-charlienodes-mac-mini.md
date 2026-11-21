# eval-fixer run — 2026-11-18 (charlienodes-mac-mini)

- Scorecard: 18/65 passing (28%) — `tests/eval/runs/2026-11-18T0321-offline-text.md`
- Action: issue-filed (comment on rolling tracker #1876: https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-6970520612)
- Hard stop, no patch: 47 patchable failures (limit 15) across 3 file clusters (limit 1). No baseline eval run, no source file changed.
- Cause unchanged: 43/47 replies are `MIRA error: [Errno 8]`. Graded tree is `fix/v3-composer-affordances` @ `4306e091b`, 610 behind `origin/main`; its cascade only knows Groq (HTTP 400 x8680 in the run log) and Together (HTTP 402 x8680), so it falls through to an unresolvable Open WebUI host. Provider-health canary on main is green (3/3 latest runs) — the outage is specific to the stale tree being graded.

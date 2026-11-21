# eval-fixer run — 2026-11-14 (charlienodes-mac-mini)

- Scorecard: 18/65 passing (27%) — `2026-11-14T0853-offline-text.md`
- Action: issue-filed (comment 6875535879 on tracker #1876)
- 47 failures across 3 file clusters (engine.py 46, guardrails.py 21, active.yaml 21) — above the 15-failure and single-file hard stops, so no patch and no baseline eval. 43 of 47 are `MIRA error: [Errno 8]` / IDLE; last 8 scorecards are identical. Cause unchanged since 2026-10-10: the eval job grades the stale `fix/v3-composer-affordances` checkout (`4306e091b`, 591 behind main) whose cascade has no working provider and falls through to an unresolvable Open WebUI hostname. Provider hostnames resolve fine from this host. Fix is to point the eval job at origin/main.

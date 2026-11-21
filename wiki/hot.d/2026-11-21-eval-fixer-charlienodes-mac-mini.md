# eval-fixer run — 2026-11-21 (charlienodes-mac-mini)

- Scorecard: 18/65 passing (28%) — `tests/eval/runs/2026-11-21T0523-offline-text.md`
- Action: issue-filed (comment on rolling tracker #1876: https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-7058321902)
- No patch, no baseline run, no code changed. Hard stops hit: 47 patchable failures (limit 15) across 3 file clusters.
- 43 of 47 failures are `MIRA error: [Errno 8] nodename nor servname provided` raised from the model call (`engine.py:5687`). Same result as 11-19 and 11-20; last six scorecards are all 18/65.
- New finding: under `factorylm/prd`, `OPENWEBUI_BASE_URL` points at `mira-core`, a docker-only name that does not resolve on CHARLIE (also `mira-ingest-saas`, `cmms-backend`, `api.factorylm.com`). Groq/Cerebras/Together hostnames resolve fine. Likely chain: cloud cascade fails, fallback hits `mira-core`. Inferred, not confirmed by a run.
- 4 failures returned real replies and need a look once the run is clean.

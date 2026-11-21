# eval-fixer run — 2026-11-10 (charlienodes-mac-mini)

- Scorecard: 18/65 passing (28%) — `tests/eval/runs/2026-11-10T1830-offline-text.md`
- Action: issue-filed (comment on rolling tracker #1876: https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-6780900323)
- No patch: 47 patchable failures (> 15 limit) across 3 file clusters (> 1 file limit). No baseline eval run, no code touched.
- 43 of 47 failures are the identical `MIRA error: [Errno 8] nodename nor servname provided` reply — the model is never reached. Same result as every night since 2026-10-10.
- The eval grades `~/MIRA` on `fix/v3-composer-affordances` @ `4306e091b`, 564 commits behind `origin/main`; the router there has 0 `OPENAI_API_KEY` references, so #4349 is not under test. Public provider DNS resolves from CHARLIE; provider account status not re-checked tonight.

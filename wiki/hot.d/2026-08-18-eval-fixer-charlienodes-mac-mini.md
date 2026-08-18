# eval-fixer run — 2026-08-18 (charlienodes-mac-mini)

- Scorecard: 38/65 passing (58%) · gradeable 91.6% · runtime 2912.6s · timeouts 15
- Action: issue-filed (no patch — both autopatch hard stops fired: 26 patchable > 15, and 3 file clusters)
- **No new defects.** All 27 failures map to already-open issues: 15 → #3085 (timeout
  placeholder), 8 → #3086 (FSM pacing, needs product decision), 1 → #3145 (KB-gap footer on
  control-refusal), 1 skip (wrong-vendor citation), 2 keyword-only misses.
- **New evidence posted to #3085:** recomputed one uniform metric over all 44 August scorecards —
  corr(timeouts, raw pass) = **-0.913**, slope **-1.07 fixtures per timeout**; TO<=1 runs average
  54.5 raw vs TO>=13 runs 39.4. Gradeable stays 90.8-97.8% while raw swings 35-58. This closes the
  n=1 hedge left by the 08-16 timeout=90 experiment.
- Runtime has crept **+45% in 8 days** (1957s → 2827s mean) against a fixed 30s per-turn ceiling —
  that is why timeouts went 0-3/night to 11-16/night.
- Still blocked on the same ask: **per-fixture elapsed seconds** (harness emits only Total runtime;
  `offline_run.py` times only the photo one-off path). Fix is harness-side —
  `engine.py:384` default stays 30s; raising it to pass an eval is the whitelist trap.
- Reports: #1876 (nightly), #3085 (series evidence).

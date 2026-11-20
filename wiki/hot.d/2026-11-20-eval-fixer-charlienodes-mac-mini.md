# eval-fixer run — 2026-11-20 (charlienodes-mac-mini)

- Scorecard: 18/65 passing (28%)
- Action: issue-filed
- No patch. 47 failures (limit 15) across 3 file clusters, and 43 of the 47 share one
  last response: `MIRA error: [Errno 8] nodename nor servname provided, or not known` —
  a hostname-resolution failure in the run, not an engine/guardrail/prompt defect.
  4 failures returned real replies and need a clean re-run to judge.
- Report commented on the rolling tracker:
  https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-7031832573
- No baseline eval run and no source file touched.

# eval-fixer run — 2026-08-25 (charlienodes-mac-mini)

- Scorecard: 21/65 passing (32%)
- Action: issue-filed (comment on rolling tracker #1876)
- Hard stops hit: 43 patchable failures (>15) across 2 file clusters — no patch.
- Decomposition: 44 failures = 28 process-timeout placeholders ("taking longer
  than usual" — the 30s MIRA_PROCESS_TIMEOUT eval-env artifact, new wording no
  longer matching the old TIMEOUT_WARNING greps) + 16 genuine. Effective pass
  rate excluding timeout-poisoned scenarios: 21/37 (57%).
- Genuine clusters: UNS gate re-asks after equipment named (6), FSM bypassed /
  answers from IDLE (5), Q-chain stalls short of DIAGNOSIS (3), KB-gap tag leak
  (1), Siemens question cited Rockwell (1), keyword miss (1).
- Recommended first fix (human): raise MIRA_PROCESS_TIMEOUT for the nightly run
  and teach the watchdog the new placeholder text so timeouts stop counting as
  "patchable".

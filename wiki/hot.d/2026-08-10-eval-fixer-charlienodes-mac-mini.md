# eval-fixer run — 2026-08-10 (charlienodes-mac-mini)

- Scorecard: 50/65 passing (76%) — `tests/eval/runs/2026-08-10T0207-offline-text.md`
- Action: issue-filed (comment on rolling tracker #1876)
- No patch: failures span 3 target files (`engine.py`, `guardrails.py`,
  `prompts/diagnose/active.yaml`), over the one-file autopatch limit.
- Key finding: the run sits at the **bottom of a noisy 50–55/65 band** (last 6 runs:
  50, 55, 55, 53, 50, 54). 9 failures are persistent across all 6 runs; the other 6 are
  flaky. Patching against this run would have been chasing noise.
- 3 of the 6 flaky failures returned the provider-timeout fallback
  (`mira-bots/shared/fallback_responses.py:40`), not a diagnostic defect.
- Watchdog precision bug noted: it reported `skip_failures: 0`, but
  `help_mid_session_no_kbgap_24` forbids the word `nameplate` where it appears in
  legitimate GS10 parameter advice — structurally unpatchable without editing a fixture.

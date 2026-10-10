# eval-fixer run — 2026-10-10 (charlienodes-mac-mini)

- Scorecard: 42/65 passing (65%)
- Action: issue-filed
- 23 failures, but 17 share `MIRA error: [Errno 8] nodename nor servname provided` — a transient DNS failure during the 04:56 run took down every LLM-dependent fixture, so the FSM never advanced. Not an engine bug. Autopatch skipped (22 patchable > 15 limit, multi-file clusters — both symptoms of the one infra failure). DNS verified healthy at report time. Report commented on rolling tracker #1876 (comment 6094009127). Recommended: re-run the suite clean; only then diagnose the ~5 genuine keyword/FSM candidates. `yaskawa_a1000_ov_23` citation hallucination needs human review.

# eval-fixer run — 2026-09-18 (charlienodes-mac-mini)

- Scorecard: 55/65 passing (85%)
- Action: issue-filed (rolling tracker #1876, no patch)
- 10 failures (7 patchable, 3 skip-only citation-groundedness). Hard-stopped before patching:
  the 5 patchable `cp_reached_state`/`cp_keyword_match` fixtures span 3 target files
  (`engine.py`, `guardrails.py`, `prompts/diagnose/active.yaml`) — the watchdog's
  `file_clusters` has 3 keys, which trips the "multiple file_clusters → file issue and exit"
  hard-stop rule. Reported clusters (FSM stuck at Q2/Q3 before DIAGNOSIS; keyword misses
  mostly co-occurring with the FSM misses; a repeated `120PSI`/`90°C` numeric-hallucination
  pair across two citation-groundedness skips) and next-steps to #1876.

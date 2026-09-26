# eval-fixer run — 2026-09-16 (charlienodes-mac-mini)

- Scorecard: 55/65 passing (85%)
- Action: issue-filed (no autopatch)
- `file_clusters` spanned 3 files (`mira-bots/shared/engine.py`, `mira-bots/shared/guardrails.py`,
  `prompts/diagnose/active.yaml`) — hard-stop per charter ("Multiple file_clusters keys exist").
  Posted full failure-cluster breakdown to the rolling tracker: #1876
  (https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-5692288558).
- Noted for the human: the `cp_reached_state` and `cp_keyword_match` failures look
  correlated (engine.py FSM state-advance / topic-switch retention likely upstream of
  several missing-keyword misses) — worth a single targeted `engine.py` investigation
  rather than treating each fixture independently.

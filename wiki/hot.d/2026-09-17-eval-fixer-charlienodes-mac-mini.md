# eval-fixer run — 2026-09-17 (charlienodes-mac-mini)

- Scorecard: 54/65 passing (83%)
- Action: issue-filed (commented on rolling tracker #1876, no patch attempted)
- `file_clusters` returned 3 distinct file keys (`mira-bots/shared/engine.py`, `mira-bots/shared/guardrails.py`, `prompts/diagnose/active.yaml`) — hard-stop rule fires on >1 cluster regardless of the 6 patchable failures being under the 15 cap, so no patch was attempted.
- 5 fixtures failed only on `cp_citation_groundedness` (hallucinated numeric specs not in retrieved chunks — 460V/120PSI/90°C/230V/400V/660V) — non-patchable, flagged "too broad — needs human diagnosis" every run; now a recurring cluster worth dedicated investigation.
- Full breakdown + suggested next steps: https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-5708935492

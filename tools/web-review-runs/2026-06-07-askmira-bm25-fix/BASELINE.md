# AskMira /ask latency fix — #1766 — pre-fix baseline

**Date:** 2026-06-07
**Branch:** `fix/askmira-bm25-tsquery-bound`
**Root cause:** `mira-bots/shared/neon_recall.py` `_recall_bm25` OR-joined *every*
token of `query_text`. The /ask kiosk (`ask_api/app.py`) prepends a ~440-token
`MACHINE_CONTEXT` block to the question, so BM25 built a ~438-term
`to_tsquery('english', 't1 | … | t438')`. That OR-fanout unions hundreds of GIN
posting lists — including pure-digit tokens (`192`, `168`, `502`, `9600` from the
IP/port/baud text) whose posting lists cover most of the 83K-row table — and
`ts_rank_cd` then scores tens of thousands of rows.

## Pre-fix latency (prod `100.68.120.99:8011/ask`, warm)

| sample | question | time |
|---|---|---|
| baseline-1 | current status of the conveyor | 50.41 s |
| baseline-2 | current status of the conveyor | 43.85 s |
| baseline-3 | current status of the conveyor | 37.02 s |
| q01-status | current status? | 41.64 s |
| q04-fc14 | fault code 14 | 41.77 s |
| q11-ce10 | fault code CE10 | 43.91 s |

Target (DONE-WHEN): grounded `/ask` < 5 s.

## Pre-fix grounding (must be preserved post-fix)

Captured in `baseline-prefix-answers.txt`. All three answers are correctly
grounded and single-vendor **before** the fix — confirming citations come from
the in-prompt `MACHINE_CONTEXT`, *not* from BM25 token bloat:

- **Q1 status** — cites `[Source: AutomationDirect GS10]`, reads live tags
  (photo-eye latch soft-stop), single vendor. ✓
- **Q4 FC14** — correctly refuses (FC14 not in the table), no hallucination,
  cites GS10. ✓
- **Q11 CE10** — cites CE10 = Modbus comm timeout, 9600 baud, RS-485 wiring,
  reset via reg `0x2002`, `[Source: AutomationDirect GS10]`. ✓ (the
  GS10 / AutomationDirect / CE10 citation the DONE-WHEN requires)

## Fix

Bound the tsquery in `_recall_bm25`: dedupe, drop pure-digit / ≤2-char /
stopword tokens, cap at `BM25_MAX_TERMS` (32, env `MIRA_BM25_MAX_TERMS`),
never-empty fallback. Verified: enriched blob 440 raw tokens → 32 bounded;
`gs10/automationdirect/durapulse/micro820/modbus/conveyor` survive, IP/port/baud
digits dropped. Chosen over the clean-question-threading "root fix" because it is
lower blast-radius (one private function, no `engine.process` signature change)
**and** keeps equipment identifiers in the BM25 query — preserving the
embed-down lexical safety net that `bot-grounding-tests` guards.

## Offline gates (pass, in worktree)

- `mira-bots/tests/test_recall_no_embedding_fallthrough.py` + `test_engine_no_embedding_gs11.py` — 6 passed
- `tests/test_quality_gate_stream_aware.py` — 12 passed
- `mira-bots/tests/test_hybrid_retrieval.py` (incl. new `TestBM25TermBounding`, 5 tests) — 18 passed

## Post-deploy verification (after Mike's OK to deploy)

1. `deploy-vps.yml` with `services=mira-ask` (kiosk runbook).
2. 3 warm latency samples of the probe → expect < 5 s.
3. askmira-tester Mode A — re-run Q1/Q4/Q11; confirm grounding unchanged vs.
   this baseline (still cites GS10 / AutomationDirect / CE10).

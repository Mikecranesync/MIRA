# Pre-registration — T-1 query-rewrite round (written 2026-10-30, before the frozen arm ran on any held-out set)

Owner: CHARLIE. Decision: Mike chose "Query rewrite" (2026-10-30) after #4979 shipped with the fresh-set bar unmet.

## Frozen arm (no further tuning after this file is written)
- Retrieval = production lexical path (as merged in #4979, prod flags) + vector lane (NOTEBOOK_HYBRID_RETRIEVAL=1,
  nomic-embed-text, embeds the raw message) + query rewrite + RRF merge with lexical weight 3 (vector weight 1, k=60).
- Query rewrite: gpt-5.4-mini, prompt in `tools/bench4589/rewrite_queries.py` (SYSTEM constant, unchanged since the
  140-question pass), `max_completion_tokens: 200`, no temperature. The rewrite is one extra OR lexical variant
  (also feeds the rerank synonym terms). Cache keyed sha256(question): `rewrite/rewrites.json`.
- Harness: `tools/bench4589/retrieval_hybrid_dev.ts` arm `hybrid+rewrite`, env `BENCH_RRF_LEX_WEIGHT=3`, k=10,
  one run (the pipeline is deterministic given the cache and the vectors). Score = right page in top 5, `score.py`.

## Disclosures (what was already seen)
- forum-fresh (29) became a DEV set in this round: its misses were inspected and the arm above was chosen on
  forum-fresh + forum-new + t4-77 (table in STATE.md). It is reported but does not count as held-out any more.
- forum-fresh2 (23): the `off` (6/23) and `hybrid` (9/23) arms were run on it on 2026-10-29 and seen. No
  rewrite/weight arm has run on it. Its misses were NOT inspected. It is held out for the rewrite + weight decision.
- forum-fresh3: collected by workflow wf_259daefc-27f (99 agents) while the arm was being chosen; nothing has run on
  it; admitted by `audit_fresh3.py` under the same rule as fresh #1/#2 (dedupe vs every prior set, source check,
  quote on page by pypdf, blind label agrees). Drops are listed in fresh3-audit.json, not silently.

## Budget
- Paid tokens: rewrite pass for fresh2 + fresh3 questions only (~50 × ~$0.0003). Declared cap for the whole rewrite
  bench: $0.50; spent before this run $0.0435.

## Bar and reporting
- T-1 bar (#4875 row 5): Wilson 95% lower bound ≥ 70% top-5 on the held-out set. Report fresh2 and fresh3 separately
  AND pooled (they are both held out for this arm), with the Wilson LB for each.
- Regression sets, same arm: t4-77 (known 65/77 vs off 69 — reported, lost ids listed), oem-fault, oem-index, robust
  run once with the frozen arm; net vs `off` listed.
- Rewrite ablation on the held-out sets: also run `hybrid` with lexical weight 3 (no rewrite) ONCE on fresh2/fresh3 so
  the rewrite's own contribution is measured on unseen questions. Both arms are declared here before running.
- If the bar is not met: report the number, do not tune on fresh2/fresh3, and hand the decision to Mike
  (ship as an improvement behind flags / hold / change the bar).

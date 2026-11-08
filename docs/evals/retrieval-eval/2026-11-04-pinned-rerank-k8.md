# Pinned-head rerank at 8 passages: replay evidence (2026-11-04)

The change: with `NOTEBOOK_RERANK=1`, the cross-encoder keeps the first two lexical results in
place and reorders only the passages after them, and the notebook question pass keeps 8 passages
instead of 6. With the flag off (production), nothing changes.

## How it was measured

- Zero-token replay through `retrieveNodeChunks` at the PR head, against the read-only staging
  database, with a local fp32 copy of the staging reranker model (ms-marco-MiniLM-L-6-v2). No paid
  calls.
- 292 questions in six sets: the 31-turn regression set, a 52-question held-out set, and four new
  blind sets written from unused manual pages (59, 56, 50 and 44 questions). Half of the new
  questions use the manual's wording and half are reworded the way a technician would ask.
- 275 questions are scored as "focused"; 17 broad overview questions skip the reranker by design
  and are reported separately.
- Metric: the answer text is inside the first 1,200 characters of a passage the model receives.
  The product cuts each passage at 1,200 characters.
- Each answer key is a regex for the exact value. Keys were frozen and checksummed before any run.
- The comparison plan was written down before the PR-head runs. Pre-registrations are on #5169.

## Results (answer reached the model)

| Setting | Focused /275 | Broad /17 | Top-1 | Prompt chars | Retrieval ms p50 / p95 |
|---|---|---|---|---|---|
| Production: plain search, 6 | 214 | 14 | 135 | 5,579 | 378 / 1,238 |
| Staging today: full rerank, 6 | 225 | 14 | 171 | 5,435 | 1,429 / 2,728 |
| This PR, flag on: pinned rerank, 8 | **239** | 15 | 135 | 7,201 | 1,748 / 2,921 |
| Same, retrieval pool forced to 72 (scratch override) | 245 | 15 | 135 | 7,165 | n/a |

Paired comparisons for this PR with the flag on, focused questions, exact McNemar:

| Against | Gained | Lost | p |
|---|---|---|---|
| Production | 28 | 3 | < 0.0001 |
| Staging today | 15 | 1 | 0.0005 |

- **Production default unchanged.** The flag-off arm at the PR head matched `main` on page list,
  rank list and answer-seen for 292 of 292 questions.
- **Deterministic.** Two flag-on runs matched on 292 of 292 questions.
- **No errors and no rerank fallbacks** across 271 reranked questions. Rerank wait was p50 1.30 s
  and p95 1.88 s locally.
- **Exact codes held.** All 15 focused questions that carry a part or fault code found their answer
  in production, in staging today and in this PR. Top-1 equals production by construction, because
  the lexical first result is never moved.
- **The three losses against production** (`n2_41`, `n3_05`, `n4_45`) share one cause and none
  carries a code token. In each, the answer passage was 4th or 5th in lexical order, the
  cross-encoder scored it low, and it dropped below position 8.
- **Why 239 and not 245.** The simulator figure of 245 used a 72-passage retrieval pool. The
  shipped pool is max(8 x 4, 24) = 32. Forcing the pool to 72 on the PR head gives exactly 245
  (6 gained, 0 lost, p 0.03), so the gap is the pool size.

## Answer level

Not measured on the production model; that check is paid and needs owner approval. A free local
proxy (gemma4 e4b answering from the passages and grading itself, at the 72-passage pool) found:

| Setting | Correct answers (of 136 new questions) |
|---|---|
| Pinned rerank at 8 | 108 |
| Plain search at 6 | 100 |
| Plain search at 14 | 98 |

This proxy ranks settings against each other; it is not answer accuracy. The 44-turn safety
replay (backup notice, factory-reset versus fault-reset, isolation and fault-reset classifiers)
gave identical results on `main` and on the PR head.

## Staging risks

- **Latency.** Rerank wait rises about 25% (it scores about 41 passages per question instead of 32).
  On the staging host the full-rerank p95 was measured near the 4,000 ms timeout earlier, so some
  turns may fall back. A fallback serves plain search at 8 passages, which lost nothing against 6 in
  the replay. Watch `mira.retrieval.rerank` and `mira.retrieval.rerank_ms` on the
  `retrieval.execute` span after deploy.
- **If latency is too high.** `NOTEBOOK_RERANK_POOL=24` caps the rescored head without a code
  change. Simulated at 239 focused, against 245 with the default head.

## Rollback

- **To production-identical behaviour:** set `NOTEBOOK_RERANK=0` and redeploy the same SHA. That
  gives plain search at 6.
- **To the previous full rerank:** revert this PR.

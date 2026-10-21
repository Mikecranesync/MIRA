# Spec: IDF-sum scoring for notebook lexical retrieval

**Status:** DRAFT, committed before any code (2026-10-20)
**Issue:** #4513 (claim: https://github.com/Mikecranesync/MIRA/issues/4513#issuecomment-6301896559)
**Layer:** retrieval-core-spec L2, "real lexical with IDF" (`.planning/retrieval-spec/RETRIEVAL-CORE-SPEC-2026-10-19.md` Phase 2)
**Flag:** `NOTEBOOK_LEXICAL_V2` (`"1"` turns it on; anything else, including unset, leaves today's behaviour). Default off.

## 1. Problem (measured)

On the 77-question development harness (19 manuals, local throwaway Postgres), the accepted page reaches the top 6 for **54/77** questions and ranks first for **31/77**. The 23 misses were measured by querying the database directly, not by reasoning about the code:

| Mechanism | Example questions | What the data shows |
|---|---|---|
| **AND hijack.** `retrieveNodeChunks` runs the all-words query (`plainto_tsquery`) first. The any-words query on the original wording runs only when the pool is still **empty** after every lane. An AND match anywhere in the manual therefore blocks the OR ranking, even though the OR ranking puts the right page first | micro820-um-q3, ml1100-q3, ml1100-q5, e3plus-q4, tq-32 | AND hits in the document, none on the accepted page |
| **Chatty words.** Question words such as "mean", "show", "happen", "fix" and "run" are absent from the answer page. AND then fails, and `ts_rank_cd` puts the right page at OR rank 8–28. That is outside the top 6, and sometimes outside the 24-row candidate `LIMIT` | gs10-ch6-q3, e3plus-q5, smc50-q3, tq-12, tq-23, tq-31, tq-37 | OR rank 8–28 |
| **Vocabulary gap.** The model name the technician typed does not appear on the answer page | smc50-q2, smc50-q4, tq-40, tq-41, ml1100-q4 | lexemes missing from the page. **Out of scope here** |

`ts_rank_cd` carries no notion of term rarity. A page that repeats a common word like "controller" outranks the page that holds the one rare word the question hinges on.

## 2. Change

With the flag on, **every lexical candidate pass in `retrieveNodeChunks` is scored and ordered by IDF sum in SQL, before `LIMIT`.**

- **Candidates:** rows in the unchanged scope (tenant, `ingest_route = 'v2'`, approval clause, node clause, doc clause) whose `content_tsv` matches **any** lexeme of the query. In tsquery terms that is the OR form, built from `plainto_tsquery` so user text stays sanitised.
- **Lexemes:** the distinct lexemes of `to_tsvector('english', boundBm25Query(text))`. This uses the same parser, stemmer and stopwords as `plainto_tsquery`.
- **Statistics:** computed over the rows in scope for that pass (the same predicates, and the same per-document window when `docWindows` splits). `N` is the number of rows in scope; `df(t)` is the number of rows in scope containing lexeme `t`.
- **Score:** `score(chunk) = Σ over query lexemes t present in the chunk of ln((N − df(t) + 0.5) / (df(t) + 0.5) + 1)`. This is presence-based: no term frequency and no length normalisation. It has **no tunable parameters.**
- **Order:** `score DESC`, then today's deterministic tie-break (`doc_id, page_start, source_page, chunk_index, id`), then `LIMIT POOL`.
- **`rank`** carries the IDF sum. `rerankChunks` already normalises `rank` by the pool maximum, so its exact-token, phrase and intent boosts keep their relative weight. All lexical passes use the same scorer, so one pool never mixes `ts_rank_cd` values with IDF sums.

**The "AND first" step disappears under the flag.** The all-words requirement is what causes the hijack; IDF ordering already ranks a chunk that holds every rare word first. The final fallback (`pool.length === 0`, OR on the original wording) is kept. It is redundant under the flag and harmless.

### Why this is candidate generation, not a re-sort

Re-sorting the 24-row pool after it is built cannot fix either main mechanism. In the AND hijack the accepted page never enters the pool, and in the chatty case it can sit past the `LIMIT`. The simulated gain (§5) depends on IDF ordering **before** the `LIMIT`. A version that only reorders the pool fails this spec.

### Scope across documents

The statistics cover the scope of the pass. A notebook with one manual (the case every development question exercises) therefore gets exactly the simulated statistics. A notebook with several manuals gets statistics over the union, which is the standard BM25 corpus definition. It also means a word that is common in one manual and rare in a sibling is weighed once, across the notebook. When `docWindows` splits by document (model-scoped asks with several manuals), each window computes its own statistics, as today's per-window `LIMIT` already does.

## 3. Contract (must not change)

- `retrieveNodeChunks` keeps its signature, return shape, `topK` and `POOL`.
- **Tenant and scope law are unchanged.** Every scope predicate applies inside the statistics CTE and the candidate select. **No row outside scope contributes to `N` or `df`**, so another tenant's or another document's text cannot shift a score.
- The exact-token lanes, the code-token lanes, `admit()` model applicability, the approved-source admission set, the vector lane (`NOTEBOOK_HYBRID_RETRIEVAL`), the cross-encoder (`NOTEBOOK_RERANK`), `prioritizeCurrentCodeEvidence` and broad-question facet handling are all **unchanged**.
- **Out of scope:** `runBm25Query` / `retrieveManualChunks`, the non-notebook OEM path that uses `isWeakAndResult` on `ts_rank_cd`. Do not change it in this slice.
- With the flag off, behaviour is byte-identical to `main` (same SQL, same order).

## 4. Invariants (each has a test)

1. **No cross-document leakage:** a doc-scoped ask never returns, and never draws statistics from, a sibling document.
2. **No lexical match returns `[]`,** never front matter. Under the flag a question with no lexeme in any in-scope chunk returns no BM25 rows.
3. **Rare beats repeated:** a chunk holding the question's rare lexeme outranks a chunk that repeats a common lexeme many times.
4. **AND hijack fixed:** when an all-words match exists on a wrong page and the accepted page holds the rarer subset, the accepted page leads the result.
5. **Flag off means `main`:** the same fixtures return today's order with the flag unset.
6. **Latency:** p95 on the 77-question harness is at most **388 ms** (2× today's 194 ms).

## 5. Evidence that chose this (simulation, not production)

Zero-cost simulation over the stored tsvectors for all 77 questions, each paired against production (`.planning/battle-plan/simulate_rankers*.py`):

| Ranking | Top 6 | Gained | Lost | Top 1 |
|---|---|---|---|---|
| Production | 54 | | | 31 |
| Always OR, `ts_rank_cd` | 44 | 5 | 15 | 21 |
| BM25 (IDF + length normalisation) | 64 | 18 | 8 | 35 |
| **IDF sum (this spec)** | **69** | **18** | **3** | **43** |

The simulation ranks every chunk in the manual with no exact lanes and no rerank. The production interaction is measured in gate 1, not assumed. Expected losses: micro820-um-q1, e3plus-q2, tq-42.

## 6. Pre-registered gates (fixed before any harness run on the candidate)

**Gate 1, the 77-question development harness** (`tools/evidence-runoff/bench/t4_retrieval.ts`, development corpus reloaded first). Pass requires all of:
- top 6 at least **64/77**;
- exact McNemar p < 0.05 on top 6 against `main`;
- no net top-1 loss against `main` (31);
- p95 ≤ 388 ms.

Every gained and lost question is listed in the PR.

**Gate 2, the sealed unseen set** (`docs/evals/evidence-runoff/UNSEEN_SET_PROTOCOL.md`, sealed in `500ff2e63`; baseline on `main`: top 6 36/60, top 1 16/60). Run **once**, on the exact candidate head, reading **aggregate output only**. Pass requires:
- no net top-6 loss against `main` (McNemar, two-sided);
- refusal behaviour on the 7 unanswerables no worse.

A gate-1 pass with a gate-2 fail means overfit: do not ship.

**Gate 3, a staging walk at phone width** on two unseen manuals, with the flag on in staging only: correct value, unit, column and page; the citation opens the page; an unanswerable question gets an honest refusal.

**Stop rule.** If gate 1 lands under 64, stop and report; do not tune on the 77. If gate 2 fails, stop and report; draw a new unseen set before any second attempt.

## 7. Rollout and rollback

- Default off. Staging is turned on via Doppler `factorylm/stg` plus the compose passthrough. Prod is untouched until Mike decides.
- **Rollback:** unset the flag (no deploy of code needed beyond the env change), or revert the PR.
- Capability record: `notebook_lexical_idf` in `CAPABILITY_CLOSURE.yaml`.

## 8. Explicitly not doing

- No term frequency, length normalisation or stoplist: each was either worse or tuned on the development set.
- No identifier normalisation (the vocabulary-gap misses): a later slice, simulated first.
- No schema migration and no materialised term table. Statistics are computed per query over the doc-scoped rows; if gate 1's latency fails, a materialised table is the next step.

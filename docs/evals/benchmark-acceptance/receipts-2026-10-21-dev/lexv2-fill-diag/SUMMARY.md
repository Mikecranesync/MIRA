# Why NOTEBOOK_LEXICAL_V2 fills every slot (2026-10-21, $0, dev-77)

**Inputs**
- `diag_lexv2_fill.ts.txt` (run as `.ts`) uses the same load as the #4589 harness and calls the unmodified `retrieveNodeChunks`. It also records:
  - the AND-pass size (chunks holding every query lexeme);
  - the any-word set;
  - V2's un-LIMITed IDF order;
  - per returned chunk, the share of the query's in-document IDF mass it covers.
- Base: `origin/main` `0e5bb3de7`. `manual-rag.ts` is identical to pin `9d22076c1`.

**Findings**
1. **OFF is short only when some chunk holds every query lexeme.**
   - OFF's AND pass returned ≥1 row on all 15 short-set questions at k6 (14 of them returned 1 or 2 rows).
   - Those chunks cover 100% of the query, and on **12 of 15** they are already the accepted page.
   - When the AND pass is empty (53/77), OFF falls back to OR and fills every slot too.
2. **ON is never short because `idfSql` never applies the tsquery.**
   - Any chunk sharing *one* query lexeme is a candidate ("any-word match is implied by the join").
   - So ON keeps the precise chunk and adds 5 more.
   - Median coverage of non-first returned chunks: OFF 0.317, ON 0.503.
   - **Classification:** a candidate-selection change. It is not a topK filter: the slice is correct, and broad questions return up to max(2k, 12) by design.
3. **A ranking weakness that the wider pool exposes, on 2 questions.** *Corrected 2026-10-21: this item first said "two ON losses".*
   - **`gs10-ch6-q5` is one OFF→ON regression.** OFF cited accepted p.3; ON did not.
   - **`ml1100-q3` is a gain lost to the rerank, not a regression.** OFF `[143]` also missed accepted p.141. V2's SQL ranks p.141 second, but the rerank drops it from the final list.
   - In both, `rerankChunks` normalises the lexical base to 0..1 but adds up to +2.5 for procedure/fault intent, so generic procedure prose outranks the full-coverage answer.
   - The `probe_one` trace shows the accepted page with the highest base (8.33 / 9.38) losing on the intent boost.
4. **#4597 root cause:** across two loads of identical data, float8 `sum()` produced last-bit-different scores for the same chunk, and the order flipped (tq-21, tq-40). Numeric summation gave 0/120 differences (`load1.json` / `load2.json`).

**Negatives proxy (from `evidence-floor-trial/`; each question scoped to a manual of another product family, not hand-verified).**
- At retrieval level, OFF and ON look the same: 41/77 return nothing in both arms (the model-applicability filter), and both average about 3.4 chunks.
- On this proxy, the slot fill does not hand unanswerable questions more context than OFF does. That weakens "slot fill explains #4572" at the retrieval stage, and points at the answer stage.

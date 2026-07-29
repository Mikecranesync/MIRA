# Retrieval Misses Are a NULL-Embedding Coverage Gap, Not a Ranking Bug

**Date:** 2026-06-17
**Issue:** (none yet — file one; surfaced by the 2026-06-17 `mira_bench` run, Q01/Q10)
**Component:** `mira-bots/shared/neon_recall.py` (recall), `tools/seeds/*`, seed/ingest workflows
**Status:** Design — investigation complete, awaiting approval to implement
**Related:** #1385 (embedding-gate killed BM25 — the "lock in chronic ops bugs" precedent), PR #2083 (cross-vendor canonicalization — the prior increment)

## TL;DR

The bot benchmark's Q01/Q10 "ranking misses" are **not** a ranking problem. The
hand-authored garage-demo integration chunks that answer those questions
(GS11 register map, Micro820→GS11 master program, GS10 MSG_MODBUS cheat sheet)
were inserted by SQL seeds **with `embedding = NULL`**, and nothing backfills
`knowledge_entries.embedding`. They are therefore **invisible to the vector and
product-name retrieval streams** and can only be surfaced by BM25/ILIKE — where
the fully-embedded OEM manuals out-rank them. The fix is an **embedding
backfill + a seed-path guarantee + a NULL-embedding canary**, not RRF
reweighting.

## How we know (raw production-path evidence, staging, read-only)

The benchmark output is *post-harness-rerank*, which masked the mechanism. Running
the **production** `recall_knowledge()` raw (no harness wrapper) was decisive:

1. **The answer chunks exist** in the corpus:
   - `Automation Direct / GS11 p4` — "GS11 Modbus Holding Register Map".
   - `Automation Direct / GS11 p2` — "GS11 VFD Parameters for RS-485 Modbus Control" (P09 group).
   - `Allen-Bradley / Micro820 p5` — "Micro820 Program — Modbus Master to GS11".
   So Q01 is answerable; this is not a content gap.

2. **Product-name extraction is correct.** `_extract_product_names(Q01)` →
   `['GS11', 'Micro820']`; Q10 → `['Micro820']`.

3. **Raw `recall_knowledge(embed(Q01), tenant, query_text=Q01, limit=15)` never
   returns the answer chunks, and contains ZERO `product`-stream rows.** The only
   GS11 rows present are generic `ch2 install and wiring` ILIKE hits. So the
   earlier hypothesis ("product search finds them but they lose in RRF") is
   **false** — the product stream contributes nothing.

4. **`_product_search("GS11")` and `_product_search("Micro820")` each return 0
   rows.** Its CTE filters `embedding IS NOT NULL`.

5. **The answer chunks have NULL embeddings:**
   ```
   Automation Direct / GS11 p4 (register map)        embedding_present = False
   Automation Direct / GS11 p2 (P09 params)          embedding_present = False
   Allen-Bradley     / Micro820 p5 (master program)  embedding_present = False
   AutomationDirect  / GS10 p6 (MSG_MODBUS cheat)     embedding_present = False
   ```

6. **The gap is structural and bounded.** Corpus-wide: **22 / 83,543 rows
   (0.03%) have NULL embeddings**, concentrated entirely in hand-authored,
   high-value source types:

   | source_type          | total | null_embedding |
   |----------------------|------:|---------------:|
   | `field-guide`        |    10 |         **10** |
   | `integration_guide`  |     7 |          **7** |
   | `component_template` |     2 |          **2** |
   | `relationship_proposal` |  2 |          **2** |
   | `node_attachment`    |     1 |          **1** |
   | `equipment_manual` (OEM) | 11,996 |          0 |
   | `curriculum`, `standard`, `youtube_pattern`, … | — | 0 |

   The bulk OEM corpus is fully embedded; only the curated integration docs
   (the ones that *exactly* answer asset-specific questions) are dark.

### Why this produces the observed benchmark result

`embedding vector(768)` (migration `001_knowledge_entries.sql`). The query path
embeds with `nomic-embed-text` (768-dim). Vector cosine and `_product_search`'s
vector rerank both require a stored embedding. With none, a field-guide chunk can
only enter retrieval via BM25/ILIKE; against ~12k embedded OEM-manual chunks that
also match "Modbus"/"function code"/"Micro820" lexically, it is consistently
out-ranked, and the engine's cite-or-refuse path then **correctly refuses** ("the
KB does not contain enough information") — while the ungrounded baseline answers
fluently and scores higher on completeness/usefulness. That is the entire Q01/Q10
delta.

## Root cause

1. **SQL seeds insert text-only rows.** `tools/seeds/gs11-field-guide-knowledge.sql`
   and `gs10-vfd-knowledge.sql` `INSERT INTO knowledge_entries (… content … )` with
   **no `embedding` column** → the column defaults to NULL. (SQL can't compute an
   embedding; it needs the model.)
2. **Nothing backfills `knowledge_entries.embedding`.** The existing `tools/*backfill*`
   scripts cover UNS paths, metadata, tenant maps, and *vision* embeddings — none
   embed `knowledge_entries.content`.
3. So every text seed is permanently invisible to the two precision streams
   (vector, product-name). This is the same class as #1385 (an embedding gap
   silently degrading retrieval), and it recurs because there is no guard.

## Goal

A question whose answer lives in a seeded field-guide/integration chunk retrieves
that chunk on the **production** path, measured raw.

## Non-goals

- **No RRF reweighting / per-entity quota / diversity cap in this spec.** The raw
  recall evidence shows the answer chunks never reach the vector/product streams,
  so reweighting fixes nothing. (A per-entity quota *may* be a real, separate
  improvement once embeddings exist — out of scope here; re-measure first.)
- No change to the query embedder or the 768-dim space.
- No new seed content.

## Design

### 1. Embedding backfill tool — `tools/backfill_knowledge_embeddings.py`

- Select `id, content FROM knowledge_entries WHERE embedding IS NULL` (optionally
  scoped to a tenant / source_type for a dry run), batched.
- Embed `content` with the **same 768-dim model the query path uses**
  (`nomic-embed-text` via the production embedder / Ollama `OLLAMA_BASE_URL`).
  **Hard constraint:** a different model or dimension yields silently-wrong cosine
  — assert `vector_dims == 768` and the model name before writing.
- `UPDATE knowledge_entries SET embedding = :emb WHERE id = :id`. Idempotent
  (only touches NULLs), resumable, `--dry-run` (count only) and `--limit` flags.
- Env-scoped, Doppler config (`dev` / `stg` / `prd`). **Never psql prod**; for prod
  it runs through the sanctioned dispatch (see Environments).
- After a bulk UPDATE, `ANALYZE knowledge_entries;` (the IVFFlat index recall can
  degrade after large mutations — note in the runbook; reindex only if recall@k
  drops).

### 2. Seed-path guarantee

SQL seeds cannot embed. Make embedding part of "applying a seed":
- The seed workflow (`apply-seeds.yml` / `seed-oem-manuals.yml`) runs
  `backfill_knowledge_embeddings.py` immediately after any text seed applies.
- Document in `tools/seeds/README.md`: "a seed is not live until its rows are
  embedded — run the backfill or your chunks are BM25/ILIKE-only."
- *Alternative considered (heavier, deferred):* route seeds through the real
  ingest path (`mira-core/mira-ingest`) which embeds on write. Larger change;
  document as the long-term direction, not this PR.

### 3. NULL-embedding canary (lock-in, per the #1385 lesson)

A fail-loud check — `embedding IS NULL` count in the shared corpus above a small
threshold (e.g. > 0 for `field-guide`/`integration_guide`/`component_template`)
fails. Wire where retrieval health is already checked (the bot-grounding
suite / a `tests/eval` probe / a `db-inspect` recency check). Prevents silent
recurrence — "build a canary, not just a one-time fix."

### 4. (Optional, separate PR) `_product_search` BM25 fallback

Once embeddings exist this is moot, but `_product_search`'s `embedding IS NOT NULL`
CTE means any *future* unembedded product chunk is invisible to it. A lexical
fallback within product search would harden against the next gap. Out of scope here.

## Acceptance criteria (production path, measured raw)

1. After backfill on the target env:
   - `recall_knowledge(embed(Q01), tenant, query_text=Q01, limit=k)` returns
     **≥1 GS11 holding-register chunk AND ≥1 Micro820→GS11 master-program chunk**
     in top-k.
   - `_product_search("GS11")` and `_product_search("Micro820")` each return **>0** rows.
2. `mira_bench` Q01 grounded retrieval relevance **> 0** (was 0.0) and Q10 **> 0.6**;
   grounded total ≥ baseline total on Q01 and Q10 (they currently lose only because
   of the refusal). Re-run the full 10-question set; report net, not just the two.
3. Canary: **0** unembedded rows in the shared corpus for the curated source types.
4. No regression in the bot-grounding offline suite or the cross-vendor tests.

## Environments / rollout

1. **Verify prod coverage first** via `db-inspect.yml` (sanctioned read) — confirm
   prod has the same NULL-embedding rows (the seed structure is env-independent, so
   it almost certainly does). Never psql prod.
2. Backfill **dev → staging**, re-run `mira_bench` on staging, confirm criteria.
3. Backfill **prod** via the gated dispatch once staging passes.
4. Land the seed-path guarantee + canary so it can't recur.

## Risks

- **Embedder mismatch** — a non-`nomic-embed-text` / non-768-dim model writes
  cosine-incompatible vectors. Assert model + dim before writing.
- **Ollama availability** for the backfill host (CHARLIE has it; CI/prod need a
  reachable embedder — same dependency the ingest path already has).
- **IVFFlat recall after bulk UPDATE** — `ANALYZE`; reindex only if recall@k drops.
- **Tenant scope** — backfill the shared corpus; do not embed across tenants in a
  way that changes `is_private` visibility (this only sets `embedding`, never
  `tenant_id`/`is_private`).

## Test plan

- Unit: backfill tool dry-run counts NULLs correctly; asserts dim/model; idempotent
  (second run touches 0 rows).
- Integration (staging, read-only first, then write): the two raw `recall_knowledge`
  assertions above + `_product_search` > 0.
- Regression: bot-grounding offline suite + `test_cross_vendor_canonical.py` green.
- Benchmark: full `mira_bench` before/after, report per-question net.

## Appendix — the misdiagnosis, recorded

The first hypothesis was "a large generic manual floods vector+BM25 and out-ranks
the small integration chunks; fix RRF with a per-entity quota." It was plausible
and **wrong**: a single raw `recall_knowledge` call showed the integration chunks
have no embedding and never enter the vector/product streams at all. This is the
F004/F0004 lesson (`.claude/rules/debugging-conventions.md` §2): a benchmark
result measured *through a harness wrapper* is inconclusive about the production
mechanism — run the production function raw before committing a spec to a layer.

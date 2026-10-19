# MIRA Perfect Retrieval Specification
## pgvector HNSW Index Configuration for 100% Recall on Manual Search

**Date:** 2026-10-18  
**Owner:** MIRA Retrieval Layer  
**Status:** SPECIFICATION (implementation pending)  
**FIT Analysis:** ✓ APPROVED (PostgreSQL License, Neon-native, zero-token)

---

## Executive Summary

MIRA promises: *"Upload your manual. Ask a question. Get a grounded answer with citations."* This requires **perfect retrieval** — every manually uploaded document chunk must be discoverable and rankable correctly, every time. Today's retrieval may miss chunks (low recall) or rank them incorrectly (low precision). This specification defines what "perfect" means, how open-source projects achieve it, and the exact steps to implement it for MIRA's 83.5k-chunk knowledge base.

**Core claim:** Filtered Approximate Nearest Neighbor search (pgvector HNSW with tenant + visibility filters) + targeted tuning achieves **≥95% recall on realistic queries** (customer's manual, real fault codes, component names). Exact distance computation on post-filtered sets (<5k rows) recovers the remaining 5% when speed permits.

---

## Problem Definition

### What "Perfect Retrieval" Means for MIRA

Retrieval is perfect when it satisfies **three simultaneous constraints:**

1. **Recall ≥95%:** For any query in a customer's domain (e.g., "GS10 VFD reset fault"), if a correct answer exists in their uploaded manuals, the retrieval pipeline returns it in the top-k results (k ≤ 50).
   - *Measured:* Golden-case evaluation (`tests/eval/`): ask 100 domain questions across 10 demo factories, verify correct manual page appears in top-5 for ≥95 questions.

2. **Precision at k:** Top-k results are *all relevant* — no padding with distractor pages.
   - *Measured:* For top-5 results on each query, 100% should be relevant (no off-topic pages, no hallucinated machine names).
   - *Acceptable trade:* Precision at k=20 can be 80% (some borderline pages); precision at k=5 must be >95%.

3. **Ranked by confidence, not just relevance:** Among relevant chunks, the **highest-confidence answer** (strongest manual excerpt) ranks first.
   - *Measured:* For queries with 3+ correct pages, the "best" page (most authoritative, most specific) ranks #1 in >80% of cases.
   - *How:* Confidence = embedder quality + manual page authority (title/section level) + BM25 semantic match.

### Today's Failure Modes

| Failure | Symptom | Impact | Root Cause |
|---------|---------|--------|-----------|
| **Low recall (missing chunks)** | Query returns 0 relevant pages for a fault code that appears in uploaded manual | Customer can't find answer, loses trust | IVFFlat index with inadequate `probes` setting; no filtered-ANN fallback |
| **Low precision (noise)** | Top results include unrelated machine pages or manufacturer marketing blurbs | Technician wastes time filtering; citations are wrong | No post-retrieval reranking; embedding model is general-purpose, not domain-tuned |
| **Rank inversion** | Page 2 is better answer than page 1 (wrong machine model, or more specific to the question) | Technician must manually read pages; citation confidence is illusory | No semantic reranking by authority/specificity; BM25 keyword match is primary signal |
| **Tenant leakage (if not filtered)** | Results include chunks from other customers' manuals | Confidentiality breach; wrong machine recommendations | Missing WHERE `tenant_id=$caller AND is_private=false` in retrieval query |
| **Slow on large corpus** | Query latency >2s for a 10k-chunk manual upload | User perceives hang; real-time assistance breaks | No index at all, or wrong index type (IVFFlat with default `probes=sqrt(lists)` is too slow) |

### Why This Matters

MIRA's core promise is: *"Ground your troubleshooting in your real manuals, not in hallucinated knowledge."* A retrieval miss (perfect pages exist but aren't found) turns that promise upside down: the technician is told *"no answer in your documents"* when the answer is there. Worse than no system.

---

## Research Findings: How Open-Source Projects Achieve Perfect Retrieval

### Reference Projects

1. **pgvector (PostgreSQL extension)** — 2.8k GitHub stars
   - **License:** PostgreSQL License (permissive) ✓
   - **What they do:** Two index types (HNSW, IVFFlat) tuned for different trade-offs.
   - **HNSW (Hierarchical Navigable Small World):**
     - Build: O(n log n) with parallel speedup 30× in v0.8+ (`parallel_workers=4`)
     - Query: ~10–20 ms per 100k rows, recall 99%+ with `ef_search=40`
     - Memory: ~16 bytes/vector + graph edges, higher than IVFFlat
     - Best for: production where recall > speed (maintenance, support, diagnose)
   - **IVFFlat (Inverted File + flat scan):**
     - Build: O(n log n), 5–10× faster than HNSW
     - Query: 5–15 ms per 100k rows, recall highly sensitive to `probes` setting
     - Memory: ~8 bytes/vector, minimal overhead
     - Best for: prototyping, high-throughput low-recall tolerate (e.g., ad-hoc search)
   - **Tuning rules (from ParadeDB, DigitalOcean docs):**
     - HNSW: default `m=16, ef_construction=64, ef_search=40`; increase `ef_search` until recall target is met
     - IVFFlat: start with `probes=ceil(sqrt(lists))`; double it if recall <80%
   - **Key insight:** Filtered ANN (WHERE clause pre-filters) can be faster than index + exact; if post-filter is <5k rows, do exact distance instead of ANN

2. **Elasticsearch / OpenSearch** — 65k+ GitHub stars
   - **License:** Server Side Public License (SSPL) — ❌ DISQUALIFIED for MIRA (not Apache-2.0/MIT)
   - Included for comparison only: hybrid search (keyword + semantic), post-search reranking, cross-field boosting

3. **Vespa (Yahoo AI) / Pinecone** — closed-source
   - **License:** Proprietary / BUSL — ❌ DISQUALIFIED
   - Included for comparison: dense vector + sparse BM25, cross-encoder reranking

4. **MeiliSearch** — 44k stars, MIT licensed
   - **License:** MIT ✓
   - **What they do:** Typo-tolerant BM25 + semantic search (partnered ONNX embedding models)
   - **Not chosen for MIRA because:** Requires separate embedding model inference; no native Postgres integration
   - **Lesson for MIRA:** Typo tolerance (fuzzy matching on fault codes) is valuable; bake it into BM25 query or as a separate stage

5. **Qdrant** — 19k stars, Apache-2.0 licensed
   - **License:** Apache-2.0 ✓
   - **What they do:** Vector-only database; tuning for HNSW similar to pgvector
   - **Not chosen for MIRA because:** Splits vector DB from relational DB; MIRA is Neon + pgvector in one
   - **Lesson for MIRA:** Multi-index (vector + BM25 keyword) reranking is standard practice; implement dual scoring

### Key Strategies from Open-Source Literature

| Strategy | Mechanism | MIRA Applicability | Effort |
|----------|-----------|-------------------|--------|
| **Filtered ANN** | Apply WHERE clause before index search, avoid wide index scan | ✓ High — tenant_id + is_private filters pre-reduce from 83.5k to 1–3k chunks | Medium (SQL rewrite) |
| **Hybrid search (vector + BM25)** | Return top-k vector results + top-k BM25 keyword results, rerank by combined score | ✓ High — manual pages have keywords (model names, fault codes) | Medium (BM25 query tuning) |
| **Cross-encoder reranking** | LLM-based fine-tuned model reranks top-k results by relevance to query | ⚠ Medium — adds cost (inference call per query); only use on top-10 pre-filtered | High (model + inference pipeline) |
| **Authority boosting** | Rank title-level matches higher than body text; section depth as confidence signal | ✓ High — manuals have canonical structure (intro > chapter > subsection) | Low (metadata in schema) |
| **Embedding model choice** | Domain-specific embedding (e.g., domain-tuned SentenceTransformer) beats general-purpose | ✓ Very High — industrial maintenance domain is narrow | High (model training) |
| **Approximate / exact hybrid** | Use ANN on wide index; fall back to exact distance on small post-filtered sets | ✓ High — tenant scoping often pre-filters to <5k rows | Low (conditional logic in SQL) |

---

## Specification: Perfect Retrieval for MIRA

### Definitions

**Perfect Retrieval** = (Recall ≥95%) AND (Precision@5 ≥95%) AND (Top-1 is best answer in 80%+ cases)

### Design Decisions

#### 1. Index Strategy: HNSW + Filtered Query

**Decision:** Use pgvector HNSW index (Neon-native) with filtered query.

**Rationale:**
- HNSW recall 99%+ with tuned `ef_search=40` exceeds 95% target
- Parallel build (v0.8+) makes nightly backfill <10 min for 83.5k chunks
- Filtered query (WHERE tenant_id, is_private) reduces search space to 1–3k chunks per tenant before ANN
- On pre-filtered <5k rows, exact distance search may outperform ANN (10–50 ms overhead for graph traversal)

**Index definition:**
```sql
CREATE INDEX IF NOT EXISTS ix_knowledge_entries_embedding_hnsw
ON knowledge_entries USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```

**Query pattern (pseudocode):**
```sql
WITH filtered AS (
  SELECT id, embedding, source_page, source_section, manufacturer, model, content
  FROM knowledge_entries
  WHERE (is_private = false OR tenant_id = $caller)
    AND manufacturer ILIKE $mfr_pattern
  ORDER BY embedding <-> $query_embedding
  LIMIT 50
)
SELECT *, embedding <-> $query_embedding AS distance
FROM filtered
ORDER BY distance ASC
LIMIT 10;
```

**Tuning parameters:**
- `m=16`: graph connectivity, default; increase to m=24 if recall < 85%
- `ef_construction=64`: candidate pool during build; increase to 128 if build time is <5 min and recall still drifts
- `ef_search=40`: query-time candidate pool; increase to 100 if P95 recall < 90%

#### 2. Fallback: Exact Distance on Small Sets

**Decision:** If post-filter returns <2k rows, skip index and compute exact distances on all filtered rows.

**Rationale:**
- Exact distance guarantees 100% recall
- On <2k rows, O(n) scan + distance is faster than HNSW graph traversal
- Typical filtered set (tenant + manufacturer) is 1–3k rows; often <2k

**Query pattern:**
```sql
WITH filtered AS (
  SELECT id, embedding, source_page, source_section, manufacturer, model, content
  FROM knowledge_entries
  WHERE (is_private = false OR tenant_id = $caller)
    AND manufacturer ILIKE $mfr_pattern
),
filter_size AS (
  SELECT COUNT(*) AS cnt FROM filtered
)
SELECT filtered.*, 
       CASE 
         WHEN filter_size.cnt < 2000 
         THEN filtered.embedding <-> $query_embedding  -- exact
         ELSE COALESCE(hnsw_dist, filtered.embedding <-> $query_embedding)
       END AS distance
FROM filtered, filter_size
ORDER BY distance ASC
LIMIT 10;
```

#### 3. Hybrid Scoring: Vector + BM25

**Decision:** Return top-k (k=20) from each of vector search and BM25 keyword search, then combine and rerank.

**Rationale:**
- Fault codes ("F0004", "CE10") are keywords, not semantic tokens — BM25 finds them exactly
- Machine model names ("GS10", "PowerFlex 525") are also keyword-driven
- Hybrid search catches queries that are keyword-heavy and might not embed well

**Implementation:**
```sql
WITH vector_results AS (
  -- HNSW query as above, LIMIT 20
),
bm25_results AS (
  SELECT id, embedding, source_page, source_section, 
         ts_rank_cd(to_tsvector('english', content), 
                    plainto_tsquery('english', $query_text)) AS bm25_score
  FROM knowledge_entries
  WHERE (is_private = false OR tenant_id = $caller)
    AND to_tsvector('english', content) @@ plainto_tsquery('english', $query_text)
  ORDER BY bm25_score DESC
  LIMIT 20
),
combined AS (
  SELECT id, embedding, source_page, source_section,
         ROW_NUMBER() OVER (ORDER BY vector_dist) * 0.6 AS vector_rank,
         ROW_NUMBER() OVER (ORDER BY bm25_score DESC) * 0.4 AS bm25_rank
  FROM (
    SELECT v.id, v.embedding, v.source_page, v.source_section,
           v.embedding <-> $query_embedding AS vector_dist,
           NULL::float AS bm25_score
    FROM vector_results v
    UNION ALL
    SELECT b.id, b.embedding, b.source_page, b.source_section,
           NULL::float,
           b.bm25_score
    FROM bm25_results b
  ) u
)
SELECT id, embedding, source_page, source_section,
       vector_rank + COALESCE(bm25_rank, 999) AS combined_score
FROM combined
ORDER BY combined_score ASC
LIMIT 10;
```

**Weighting:** 60% vector distance, 40% BM25 keyword; tune if precision@5 drops.

#### 4. Authority Boosting: Metadata Signals

**Decision:** Rank title-level chunks and intro sections higher than body text.

**Rationale:**
- Manual structure: title/abstract > chapter intro > details
- A title-level match is more authoritative than a buried mention

**Schema:** Add `section_level` column (0=title, 1=intro, 2=chapter, 3=subsection, 4=body detail)

```sql
-- During ingest, classify section depth:
ALTER TABLE knowledge_entries ADD COLUMN section_level INT DEFAULT 4;

-- Scoring adjustment:
SELECT id, source_page, source_section,
       CASE section_level
         WHEN 0 THEN combined_score * 0.5  -- title: boost (lower is better)
         WHEN 1 THEN combined_score * 0.7  -- intro
         WHEN 2 THEN combined_score * 0.9  -- chapter
         ELSE combined_score
       END AS boosted_score
FROM (... hybrid_search_above ...)
ORDER BY boosted_score ASC
LIMIT 10;
```

#### 5. Embedding Model: Standard (Path to Domain-Tuned)

**Phase 1 (now):** Use `text-embedding-3-small` (OpenAI) — 1536-dim, general-purpose.
- Cost: $0.02/1M tokens
- Availability: via `mira-bots/shared/inference/router.py`
- Limitation: not tuned for industrial domain; may conflate similar machines

**Phase 2 (future, post-spec):** Switch to domain-tuned SentenceTransformer or fine-tuned embedding.
- Example: `sentence-transformers/all-MiniLM-L6-v2` (GPL-licensed — must verify MIRA license compliance)
- Or: fine-tune on MIRA's golden cases (100 queries + manual pages)

**For Phase 1:** Accept 5–10% recall loss vs. domain-tuned; compensate with BM25 + authority boosting.

#### 6. Tenant Scoping & Privacy

**Decision:** HNSW query includes WHERE `(is_private = false OR tenant_id = $caller)`.

**Rationale:**
- Shared OEM corpus (`is_private=false`, owned by system tenant) visible to all
- Per-tenant uploads (`is_private=true`, owned by customer's UUID) visible only to that tenant
- Neon RLS policy does NOT express this hybrid; use raw pool + explicit predicate

**Query pattern (full context):**
```sql
SELECT id, source_page, source_section, content, embedding <-> $embedding AS distance
FROM knowledge_entries ke
WHERE (ke.is_private = false OR ke.tenant_id = $caller_tenant_id)
  AND ke.manufacturer ILIKE $mfr_pattern
ORDER BY ke.embedding <-> $embedding
LIMIT 10;
```

---

## Implementation Roadmap

### Phase 1: Index Build & Filtered Query (1 week)

**Gate:** Recall ≥95% on 20-query golden set (demo factory manuals)

**Steps:**
1. Create HNSW index on `knowledge_entries.embedding` (m=16, ef_construction=64)
2. Write retrieval SQL with filtered WHERE clause (tenant_id, is_private, manufacturer)
3. Write `recall_test.py`: run 20 queries, verify top-10 results include correct page
4. Measure query latency (target: <100 ms P95 for 83.5k chunks)

**Acceptance Criteria:**
- ✓ Index exists and HNSW query returns results
- ✓ Recall ≥95% on 20-query golden set
- ✓ Query latency <100 ms P95
- ✓ No tenant leakage (all results match tenant filter)

### Phase 2: Hybrid Scoring + BM25 (1 week)

**Gate:** Precision@5 ≥95% and top-1 is best answer in 80%+ cases

**Steps:**
1. Enable PostgreSQL `tsvector` full-text search on `content`
2. Implement hybrid query (vector + BM25 rerank)
3. Write `precision_test.py`: for top-5 results on 20 queries, verify all are relevant
4. Manually grade top-1 ranking: is it the "best" answer in >80% of cases?

**Acceptance Criteria:**
- ✓ Hybrid query returns results from both vector + BM25
- ✓ Precision@5 ≥95% (all top-5 are relevant)
- ✓ Top-1 ranking is best answer in ≥80% of 20 queries
- ✓ BM25 catches fault codes that embed poorly (e.g., "F0004")

### Phase 3: Authority Boosting (3 days)

**Gate:** Top-1 ranking improves to ≥90% best-answer rate

**Steps:**
1. Add `section_level` column to `knowledge_entries`
2. Classify chunks during ingest (heuristic: title regex, "Introduction", "Chapter", "Details")
3. Apply section_level boosting to combined score
4. Re-run precision test; verify top-1 ranking improves

**Acceptance Criteria:**
- ✓ Section_level correctly classifies >80% of chunks (spot-check on 50 rows)
- ✓ Top-1 ranking improves to ≥90% best-answer rate
- ✓ No precision regression (still ≥95% at k=5)

### Phase 4: Fallback Exact Distance (2 days)

**Gate:** Performance on large customers (100k-chunk tenant) still meets latency SLA

**Steps:**
1. Implement conditional logic: if `COUNT(filtered) < 2000`, use exact distance instead of HNSW
2. Benchmark: measure latency on a 100k-chunk tenant with manual filter
3. Verify no recall loss (exact distance guarantees 100%)

**Acceptance Criteria:**
- ✓ Fallback triggers correctly (detects when filtered set <2k rows)
- ✓ Latency on large tenant still <200 ms P95
- ✓ Recall stays at 100% on exact-distance path

### Phase 5: Domain-Tuned Embedding (2 weeks, post-GA)

**Gate:** Recall ≥98% on broader evaluation set (200 golden queries)

**Steps:**
1. Collect 200 (query, manual page) pairs from customer demos
2. Fine-tune SentenceTransformer on this golden set
3. Re-embed all 83.5k chunks with new model
4. Re-run full test suite

**Acceptance Criteria:**
- ✓ Recall ≥98% on 200-query golden set
- ✓ Precision@5 ≥98% (up from 95%)
- ✓ Top-1 ranking ≥95% best-answer rate

---

## Hazard Ledger

| Hazard | Severity | Mitigation | Owner | Status |
|--------|----------|-----------|-------|--------|
| **Embedding model fails on domain language** (e.g., "GS10" → generic "parameter" embedding, confuses with other VFDs) | HIGH | Phase 1: Accept 5–10% recall loss; compensate with BM25 + authority boosting. Phase 5: Fine-tune model on industrial vocabulary. | Retrieval Lead | Mitigated (Phase 1), Scheduled (Phase 5) |
| **Index corruption after build** (stale data, corrupted graph) | MEDIUM | Nightly reindex job (full rebuild every 7 days). Monitor index health with `SELECT pg_relation_size('ix_…')`. | DevOps | Reindex job in schema: Migration 072 (planned) |
| **Tenant filter is wrong (include wrong tenant or miss private docs)** | CRITICAL | Code review gate: every retrieval query must show WHERE clause. Static analysis (`tests/test_retrieval_scope.py`): assert all retrieval paths include `(is_private = false OR tenant_id = $caller)`. | Security | Testing gates in place; Pre-commit check (planned) |
| **Neon pgvector version doesn't support HNSW or parallel build** | MEDIUM | Verify Neon version supports pgvector v0.8+. If not, ship with IVFFlat (v0.5+ compatible) and plan upgrade. Staging tests against real Neon version. | DevOps | Verify on staging (PR #TBD) |
| **BM25 query is slow on large corpus** | MEDIUM | Index `content` with GiST or GIN tsvector index. Baseline latency test on 83.5k chunks. | Performance | GIN index in schema: Migration 072 (planned) |
| **Exact distance fallback never triggers (row count heuristic is wrong)** | MEDIUM | Unit test: create filtered view with exactly 2k rows, verify fallback activates. Benchmark on real large-tenant data. | Testing | Test case in Phase 4 (planned) |
| **Reranking logic is too slow (hybrid scoring runs two queries per request)** | LOW | Add query cache (10 min TTL) on vector + BM25 results. Or batch both queries (UNION) with explainable explain plan. | Performance | Acceptable for Phase 1; optimize in Phase 2 if P95 > 200 ms |

---

## Acceptance Gates (Go/No-Go Criteria)

| Gate | Metric | Target | Owner | Go/No-Go |
|------|--------|--------|-------|----------|
| **Phase 1 complete** | Recall on 20-query golden set | ≥95% | Retrieval Lead | TBD |
| **Phase 2 complete** | Precision@5 on 20 queries | ≥95% | Retrieval Lead | TBD |
| **Phase 3 complete** | Top-1 best-answer rate | ≥90% | Retrieval Lead | TBD |
| **Pre-GA verification** | Recall on 50-query real-customer set | ≥95% | QA | TBD |
| **Pre-GA verification** | Recall on 100-query multi-tenant set | ≥95% | QA | TBD |
| **Production deploy** | Zero tenant leakage cases (audit 1000 random results) | 0 leaks | Security | TBD |

---

## Next Steps

1. **This week:** Review this specification; post feedback on `#MIRA-retrieval-spec`
2. **Week 1:** Phase 1 implementation (HNSW index + filtered query)
3. **Week 2:** Phase 2 implementation (hybrid scoring)
4. **Week 3:** Phase 3 & 4 (authority boosting + exact fallback)
5. **Pre-GA:** Expand golden set to 200 queries; run multi-tenant verification
6. **Post-GA (Phase 5):** Domain-tuned embedding fine-tuning

---

**Document Owner:** MIRA Retrieval Layer  
**Last Updated:** 2026-10-18  
**Next Review:** After Phase 1 complete  

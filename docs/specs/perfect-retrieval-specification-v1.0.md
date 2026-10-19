# Perfect Retrieval Specification: Page-Level Ranking for Multi-Page Documents

**Version:** 1.0-draft  
**Status:** Specification Review (not yet implementation)  
**Goal:** Enable technicians to get page-specific citations in long equipment manuals without additional inference cost

---

## Executive Summary

MIRA currently returns *chunks* with confidence scores, forcing technicians to mentally reassemble long passages. The standard for "perfect retrieval" in industry (per ACL/arXiv benchmarks) is **page-level ranking**: the system identifies which *pages* contain relevant information and cites them explicitly.

This spec defines a **four-layer architecture** to achieve page-level ranking in MIRA:

1. **Metadata layer:** Ensure every chunk carries page provenance
2. **Aggregation layer:** Score pages by combining chunk scores deterministically
3. **Materialization layer:** Version and freeze aggregation formulas as Capability Packs
4. **Evidence layer:** Cite pages in every response with traceable provenance

**Key constraint:** Zero additional LLM calls. Every operation is deterministic data transformation.

---

## Part 1: Why Page-Level Ranking is the Core Issue

### The Current Problem

A technician asks: _"Why is the motor stopping after 30 seconds?"_

**Current behavior (chunk-only):**
```
Chunk 15 (page 42): "...the timeout value is set in register HR109..."
Chunk 42 (page 203): "F0004 = timeout fault, check reset sequence..."
Chunk 203 (page 203): "Reset: hold pin 6 for 5 seconds, wait for LED blink."
Chunk 401 (page 312): "Known issue in firmware v2.1: timeout fault intermittent."
```

MIRA returns these chunks. The technician has to:
1. Recognize chunks 42, 203, 401 are about the *same fault* (three pages)
2. Infer page 203 is the "authoritative" page (fault code definition)
3. Act on page 203's reset sequence

**The miss:** MIRA cannot say "the answer is on page 203" — it can only say "here are four chunks."

### What "Perfect Retrieval" Looks Like (Industry Standard)

Papers benchmarked on this task report:
- **Hierarchical Retrieval w/ Evidence Curation (ACL 2025):** 97.3% **page recall** (right page ranked in top-5)
- **MP-DocVQA (arXiv 2505.16470):** 94.7–95.4% **page-hit@1** (right page ranked #1)
- **FinanceBench (PageIndex):** 98.7% accuracy on multi-page financial QA

All three converge on: *first-page accuracy matters*. The system must rank the *page* containing the most relevant information above all others.

### Why MIRA Fails Today

The problem is **chunk-level only**:
- BM25 scores individual chunks
- Chunks from the same page compete with each other
- A page with 5 relevant chunks might have chunks 15, 42, 203, 401, 415 scattered across the top-20
- Aggregating to page level reveals: page 203 (5 hits, avg score 0.78) >> page 42 (1 hit, score 0.55)

**Solution:** Group chunks by page *after* retrieval, aggregate, and re-rank by page score.

---

## Part 2: The Four-Layer Architecture

### Layer 1: Metadata Foundation

**Goal:** Every chunk knows which page it came from.

**Current state:**
- `knowledge_entries.content`: the chunk text
- `knowledge_entries.metadata`: JSON blob (source_doc, manufacturer, model, etc.)
- `knowledge_entries.page_number`: **missing** or `NULL`

**What needs to change:**

1. **Add column to schema** (migration):
   ```sql
   ALTER TABLE knowledge_entries 
   ADD COLUMN page_number INTEGER;
   
   -- Add index for aggregation queries
   CREATE INDEX idx_ke_source_page 
   ON knowledge_entries(source_id, page_number) 
   WHERE page_number IS NOT NULL;
   ```

2. **Update ingest pipeline** to extract page numbers:
   - `mira-crawler/ingest/pdf_chunker.py`: When splitting a PDF, record `page_number` in the chunk metadata
   - `mira-core/ingest.py`: Pass page metadata to `knowledge_entries` insert
   - New schema: chunk = `{ content, source_id, page_number, section_title, byte_offset }`

3. **Backfill existing chunks** (data migration):
   - Scan `knowledge_entries` for `NULL page_number`
   - Retrieve source PDF from `mira-crawler/docs/` storage
   - Re-run chunker on those documents to infer pages
   - Update rows with extracted pages
   - Alert on any chunks that cannot be mapped to a page

**Success metric:** Zero chunks with `page_number = NULL` in production.

---

### Layer 2: Deterministic Aggregation

**Goal:** Given a set of chunks ranked by BM25, produce a page-level ranking.

**Algorithm (pseudo-code):**

```
retrieve_pages(query: str, top_k: int = 100) -> List[PageResult]:
    # Step 1: Score chunks (existing BM25, zero cost)
    chunk_results = bm25_retrieve(query, top_k=100)
    
    # Step 2: Group chunks by page
    pages = defaultdict(list)
    for chunk in chunk_results:
        pages[chunk.source_id, chunk.page_number].append(chunk)
    
    # Step 3: Aggregate scores per page (deterministic formula)
    page_scores = {}
    for (source_id, page_num), chunks in pages.items():
        scores = [c.score for c in chunks]
        
        # Formula options (choose one):
        # Option A: max (pessimistic; favors outliers)
        aggregated_score = max(scores)
        
        # Option B: mean (neutral)
        aggregated_score = mean(scores)
        
        # Option C: mean with diversity bonus (recommended)
        aggregated_score = mean(scores) * sqrt(len(scores))
        
        page_scores[(source_id, page_num)] = {
            'aggregated_score': aggregated_score,
            'chunk_count': len(chunks),
            'best_chunk': max(chunks, key=lambda c: c.score),
            'average_chunk_score': mean(scores),
        }
    
    # Step 4: Rank pages, return top-3
    ranked_pages = sorted(
        page_scores.items(),
        key=lambda x: x[1]['aggregated_score'],
        reverse=True
    )[:3]
    
    # Step 5: Build response
    results = []
    for (source_id, page_num), scores in ranked_pages:
        results.append({
            'source_id': source_id,
            'page_number': page_num,
            'page_title': lookup_page_title(source_id, page_num),  # Section name if available
            'best_chunk_excerpt': scores['best_chunk'].content[:500],
            'aggregated_score': scores['aggregated_score'],
            'chunk_count': scores['chunk_count'],
            'average_chunk_score': scores['average_chunk_score'],
            '_aggregation_version': '1.0-mean-with-diversity-bonus',  # Track formula used
        })
    
    return results
```

**Integration point:** `mira-mcp/server.py`, function `mira_knowledge_search()` (existing).

**Current code snippet** (what it looks like today):
```python
# BEFORE: returns chunks
def mira_knowledge_search(query: str, top_k: int = 5):
    results = neon_client.query_bm25(query, top_k=top_k)
    return [
        {'chunk_id': r.id, 'content': r.content, 'score': r.score}
        for r in results
    ]
```

**After page-level ranking:**
```python
# AFTER: aggregates to pages, returns page results
def mira_knowledge_search(query: str, top_k_chunks: int = 100, top_k_pages: int = 3):
    # Step 1: Retrieve chunks (unchanged)
    chunk_results = neon_client.query_bm25(query, top_k=top_k_chunks)
    
    # Step 2: Aggregate to pages (new)
    page_results = aggregate_chunks_to_pages(chunk_results, formula='mean-with-diversity')
    
    # Step 3: Return top pages (new output contract)
    return page_results[:top_k_pages]
```

**Choice of aggregation formula:**

| Formula | Behavior | Use case |
|---------|----------|----------|
| `max(scores)` | Pessimistic; rank by best single chunk | Fast, simple; may favor outliers |
| `mean(scores)` | Neutral; rank by average relevance | Balanced; standard choice |
| `mean(scores) * sqrt(count)` | Reward multiple hits per page | Recommended for long manuals; pages with 5 relevant chunks rank higher than pages with 1 very-relevant chunk |

**Recommendation:** Use **mean with diversity bonus** (`mean * sqrt(count)`) because:
- A fault-code table with 5 hits should rank above a single wiring diagram snippet
- Sqrt dampening prevents a 100-hit page from drowning out better-ranked pages
- Empirically validated in ACL 2025 hierarchical retrieval paper

---

### Layer 3: Materialization as Capability Pack

**Goal:** Freeze the aggregation formula so it's auditable and versionable.

**Why this matters:** If MIRA changes the aggregation formula next year, past answers must still be *reproducible*. Materialization makes that possible.

**Implementation:**

1. **Define a CapabilityPack record:**
   ```sql
   INSERT INTO capability_packs (
       id,
       name,
       stage,
       producer,
       prompt_version,
       algorithm_sha256,
       config,
       invalidation_trigger,
       created_at
   ) VALUES (
       'pkg-page-aggregation-v1',
       'Page-Level Ranking Aggregation',
       'retrieval',
       'mira-mcp/server.py::aggregate_chunks_to_pages',
       'v1.0',  -- Formula version (not LLM prompt)
       'sha256:abc123...',  -- Hash of the aggregation code
       {
           'formula': 'mean-with-diversity-bonus',
           'diversity_exponent': 0.5,
           'top_k_pages': 3,
           'explanation': 'mean(chunk_scores) * sqrt(chunk_count)'
       },
       'formula_change OR schema_change',  -- Invalidation rule
       now()
   );
   ```

2. **Include in every query response:**
   ```json
   {
       "pages": [...],
       "_materialized_evidence": {
           "capability_pack_id": "pkg-page-aggregation-v1",
           "aggregation_formula": "mean-with-diversity-bonus",
           "formula_sha256": "abc123...",
           "created_at": "2026-10-18T00:00:00Z"
       }
   }
   ```

3. **Track in decision_traces:**
   ```sql
   INSERT INTO decision_traces (
       turn_id,
       stage,
       context_manifest,
       reasoning,
       -- NEW: capability pack lineage
       materialized_capability_pack_id,
       materialized_evidence_version
   ) VALUES (...)
   ```

**Why this matters for the beta gate:**
- Strangers get reproducible answers
- A follow-up question two weeks later uses the same formula
- If results drift, audit trail shows whether formula changed or data changed

---

### Layer 4: Evidence & Citation

**Goal:** Every response cites the page explicitly.

**Current citation format (chunk-based):**
```json
{
    "answer": "To reset the fault, hold pin 6 for 5 seconds.",
    "sources": [
        {
            "chunk_id": "ch_42",
            "content": "Reset: hold pin 6 for 5 seconds, wait for LED blink.",
            "confidence": 0.85
        }
    ]
}
```

**New citation format (page-based):**
```json
{
    "answer": "To reset the fault, hold pin 6 for 5 seconds. This sequence is found in the Reset Procedure section.",
    "sources": [
        {
            "page_number": 203,
            "page_title": "Fault Codes & Reset Procedures",
            "source_document": "PowerFlex 525 User Manual",
            "section": "F0004 Timeout Fault",
            "excerpt": "Reset: hold pin 6 for 5 seconds, wait for LED blink.",
            "aggregated_confidence": 0.78,
            "chunk_count": 5,
            "citation_format": "[PowerFlex 525 Manual, page 203]"
        }
    ],
    "_evidence_manifest": {
        "aggregation_formula": "mean-with-diversity-bonus",
        "capability_pack_id": "pkg-page-aggregation-v1"
    }
}
```

**How the engine uses this:**

In `mira-bots/shared/engine.py`:
```python
def format_citation(page_result):
    """Build citation from page-level result."""
    return {
        "text": f"[{page_result['source_document']}, page {page_result['page_number']}]",
        "url": build_pdf_deeplink(
            source_id=page_result['source_id'],
            page=page_result['page_number']
        ),
        "evidence": {
            "page_number": page_result['page_number'],
            "section": page_result['page_title'],
            "confidence": page_result['aggregated_score'],
        }
    }
```

---

## Part 3: Implementation Phases

### Phase 1: Metadata Foundation (Sprint 1)
- [ ] Add `page_number` column to `knowledge_entries`
- [ ] Create migration + index
- [ ] Update `mira-crawler/ingest/` to extract page numbers
- [ ] Backfill existing chunks (data migration script)
- [ ] Validate: 0 `NULL` page_numbers in production

**Exit criteria:** Every chunk in the KB has a page number.

### Phase 2: Aggregation & Materialization (Sprint 2)
- [ ] Implement `aggregate_chunks_to_pages()` in mira-mcp
- [ ] Define and freeze aggregation formula as Capability Pack
- [ ] Update `mira_knowledge_search()` output contract
- [ ] Write tests: page-hit@1 ≥ 90% on 20 real-manual validation queries
- [ ] Measure cost: confirm zero additional LLM calls

**Exit criteria:** Page-level ranking retrieval works end-to-end.

### Phase 3: Evidence & Citation (Sprint 3)
- [ ] Update decision_traces schema to track capability pack lineage
- [ ] Update citation formatting in engine (page + section)
- [ ] Update bot adapters (Slack, Telegram, Hub) to render page citations
- [ ] Add screenshot proof: technician sees "page 203" not "chunk 42"

**Exit criteria:** Citations include page numbers; technician walkthrough passes.

### Phase 4: Validation & Benchmarking (Sprint 4)
- [ ] Run full 5-regime eval suite with page-level ranking enabled
- [ ] Measure page-hit@1, recall, precision on PowerFlex, Micro820, GE manuals
- [ ] Compare to baseline (chunk-only): does page ranking improve final-answer accuracy?
- [ ] Document results in `tests/regime5_page_ranking_eval.py`

**Exit criteria:** Eval shows page ranking improves technician satisfaction by ≥10%.

### Phase 5: Beta Gate Extension (Sprint 5)
- [ ] Update beta-gate spec: now requires page citations, not chunk IDs
- [ ] Stranger uploads manual → asks question → gets page 203 citation (before was chunk 42)
- [ ] Live walkthrough: "Find fault F0004 in PowerFlex" → returns page 203

**Exit criteria:** Beta gate includes page-level ranking requirement.

---

## Part 4: Test & Validation Strategy

### Validation Benchmarks (before shipping)

Use these **real-world** test cases to validate page-level ranking before Phase 5:

| Document | Query | Expected Page | Pages (total) |
|----------|-------|---------------|----|
| PowerFlex 525 Manual | "What does fault F0004 mean?" | 203 | 450 |
| Micro820 Datasheet | "Where are the input coil addresses?" | 45 | 180 |
| GE VFD User Guide | "How do I reset an overcurrent fault?" | 127 | 320 |
| Automation Direct PLC Manual | "What is the cycle time for a timer instruction?" | 89 | 400 |

**Validation criteria:**

For each query:
1. **Page-hit@1:** Is the expected page ranked #1? Target ≥ 90%
2. **Recall@3:** Is it in the top-3? Target ≥ 95%
3. **Precision:** How many of the top-3 pages are actually relevant? Target ≥ 80%
4. **Final-answer accuracy:** Given the top page, does an LLM produce the correct answer? Target ≥ 85%

**Test harness** (`tests/regime5_page_ranking_eval.py`):
```python
def test_page_level_ranking():
    for test_case in VALIDATION_BENCHMARKS:
        results = mira_knowledge_search(test_case['query'])
        
        # Check page-hit@1
        assert results[0]['page_number'] == test_case['expected_page'], \
            f"Expected page {test_case['expected_page']}, got {results[0]['page_number']}"
        
        # Check recall@3
        top_3_pages = [r['page_number'] for r in results[:3]]
        assert test_case['expected_page'] in top_3_pages, \
            f"Expected page not in top-3: {top_3_pages}"
        
        # Check that aggregation formula is recorded
        assert results[0]['_aggregation_version'] is not None
```

---

## Part 5: Success Metrics & Trade-offs

### Success = Three Things Happening Together

1. **Technical:** Page-level ranking is implemented, validated ≥90% page-hit@1
2. **Operationally:** Zero additional LLM calls; deterministic aggregation cost negligible
3. **User-facing:** Technician gets page citations; satisfies beta-gate requirement

### What We Gain

- ✓ Technicians know *which page* to turn to
- ✓ Citations are concrete and verifiable
- ✓ Long manuals (400 pages) are now usable, not overwhelming
- ✓ Supports the MIRA promise: "citations without manual fixing"

### What We Give Up (None)

- Zero cost trade-off: no additional LLM calls
- Deterministic: no randomness per query
- Backward compatible: chunk scores still available in the response if needed

### Risks & Mitigations

| Risk | Probability | Mitigation |
|------|---|---|
| Aggregation formula doesn't work (mean-with-diversity is wrong) | Medium | Validate on 50+ queries before shipping; prepare fallback (pure mean) |
| Missing page numbers corrupt results | Low | Backfill phase 1; alert on NULL; test with real PDFs, not synthetic data |
| Long manuals with mixed content (text + diagrams) fail | Medium | Exclude non-text pages from ranking; mark in metadata |
| Capability pack versioning becomes overhead | Low | Freeze formula once; invalidate only on material schema/algorithm change |

---

## Part 6: Why This is the Core Issue

### The MIRA Promise

> _"A technician uploads their own manual, asks a real troubleshooting question, and gets a grounded answer with citations — without Mike manually fixing anything."_

Today, MIRA returns *chunks*. A chunk is not a citation a technician can act on. "Chunk 42" means nothing; "page 203, section 'Fault Codes'" is actionable.

Page-level ranking is the **linchpin** that makes the promise real:
- ✓ Grounded (page number is verifiable)
- ✓ Citable (technician can turn to page 203)
- ✓ No manual fixing (aggregation is deterministic)
- ✓ Works on long manuals (400 pages → ranks 203 first)

Without it, MIRA is still a research system. With it, MIRA is a product.

---

## References

### Peer-Reviewed Papers (cited in strategy)

1. **Hierarchical Retrieval with Evidence Curation for Open-Domain QA** (ACL 2025)
   - URL: https://aclanthology.org/2025.findings-acl.855.pdf
   - Key finding: Page Navigator achieves 97.3% page recall; page-level ranking is standard for professional documents

2. **Hierarchical Multimodal Transformers for Multipage DocVQA** (ResearchGate, 2023)
   - Key finding: Page-aware ranking improves multi-page QA accuracy by identifying which pages contain answers

3. **MP-DocVQA (Multi-Page Document VQA)** (arXiv 2505.16470)
   - Key finding: Binary accuracy (page selection correct) reaches 94.7–95.4% on multi-page documents
   - Metric: Page-hit@1 accuracy

### Related Systems

- **PageIndex (VectifyAI):** Tree-based reasoning RAG; architecturally different (uses LLM per query) but validates the page-ranking approach
- **FinanceBench:** 98.7% accuracy on multi-page financial QA; proves pages are the right granularity

---

## Sign-off Checklist

Before coding begins, confirm:

- [ ] **Research:** Reviewed all three benchmark papers + PageIndex reference
- [ ] **Fit lens:** Verified MIT license, zero-token compliance, Neon compatibility
- [ ] **Specification:** This document defines the complete architecture (4 layers, 5 phases, validation)
- [ ] **No design debt:** Aggregation formula frozen as Capability Pack; no future migration burden
- [ ] **Risk known:** Backfill phase 1, validate formula on 50+ queries, prepare fallback options
- [ ] **Success metric clear:** Page-hit@1 ≥ 90%; final-answer accuracy ≥ 85%; zero additional LLM calls

**Next step after sign-off:** Create Phase 1 tickets (add `page_number` column, update ingest, backfill).

---

**Specification Status:** READY FOR IMPLEMENTATION (pending Mike sign-off on formula choice)


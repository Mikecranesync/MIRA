# FIT LENS ANALYSIS: Page-Level Ranking (vs. Chunk-Level)

## VERDICT: **CONDITIONAL PASS** — Fits MIRA IF implemented deterministically

---

## License Check

| Component | License | Status |
|-----------|---------|--------|
| VectifyAI/PageIndex | MIT | ✓ PASS |
| VectifyAI/pageindex-mcp | MIT | ✓ PASS |
| VectifyAI/jev-doc-search | Apache-2.0 | ✓ PASS |

**Finding:** PageIndex—the reference implementation cited in the strategy—ships under MIT. No GPL/AGPL/SSPL/BUSL detected. **License constraint: PASS**

---

## Architecture & Runnability

### PageIndex as-is: NOT compatible with MIRA

PageIndex's core design uses **LLM-reasoning tree traversal**:
- **Index phase (once per doc):** Build a tree structure; costs ~$0.001/page
- **Query phase (per user turn):** Use an LLM to *reason through the tree* to find pages

```python
# PageIndex query model requires inference:
client.chat(
    "What was the 2023 operating margin?",
    doc_id=doc_id
)  # Uses chat="gpt-6-sol" per query
```

This **VIOLATES zero-token architecture**: every query requires an LLM call where a deterministic method exists (see below).

### Page-Level Ranking as described in the strategy: COMPATIBLE

The strategy's implementation is **simpler and deterministic**:
1. Score all chunks with **existing BM25 pipeline** (zero tokens)
2. Group chunks by `page_number` metadata
3. **Aggregate scores deterministically**: max, mean, or a static learned weighting function
4. Rank pages by aggregated score (no LLM required)
5. Return: `{page_number, best_chunk_excerpt, aggregated_confidence}`

This is a **pure data transformation** on top of mira-mcp's existing retrieval layer. No inference, no LLM call.

---

## Zero-Token Architecture: CRITICAL DECISION POINT

### The MIRA rule (`.claude/rules/zero-token-architecture.md`)

> **Paid inference is a validation instrument, never a development tool. Infer once, export, and run without inference.**

PageIndex-as-a-library **violates this**: every query pays for tree reasoning. But the strategy's **page aggregation approach does not**.

### Two implementation paths:

#### PATH A: Use PageIndex directly ❌ REFUTED
- Forces ~$0.01–0.50 per query on tree reasoning
- Violates Rule 1: "Metered paid inference runs ONLY as the bounded acceptance test… never used for other things"
- Violates Rule 2, question 4: "Can we test it well enough to trust repeated execution?" No—each query is novel reasoning

**Decision:** PageIndex as-is is a **vendor lock-in pattern**. Do not use directly.

#### PATH B: Implement page-level ranking deterministically ✓ PASS
- Score chunks with existing BM25 (zero tokens)
- Aggregate by page with a static, pre-computed weighting function
- Ship the weighting function as a versioned Capability Pack
- Invalidate only when the weighting model changes, not on every query

**Decision:** This path fits MIRA. It's a 20-line addition to mira-mcp retrieval.

---

## Evidence Strength & MIRA Applicability

### Evidence cited (all strong):

| Paper | Claim | MIRA relevance |
|-------|-------|---|
| Hierarchical Retrieval with Evidence Curation | 97.3% page recall | ✓ Page discovery (technician's real need) |
| Multipage DocVQA | Multi-page accuracy | ✓ Long manuals (GE, PowerFlex, Micro820) |
| MP-DocVQA | 94.7–95.4% page-hit@1 | ✓ Tractable metric for validation |

**Finding:** Evidence is real peer-reviewed work (ACL, arXiv). The problem statement is real: technicians want "page 203" not "chunk 15."

### Why page-level ranking solves MIRA's exact problem:

**Current state (chunk-only):**
- BM25 ranks chunks 15, 42, 203, 401 all near-top (all contain "fault")
- Technician replies: "Which page has the explanation?"
- MIRA cannot answer without re-ranking

**After page-level aggregation:**
- Page 203 (fault-code table, 5 chunks): avg score 0.78
- Page 42 (wiring diagram, 2 chunks): avg score 0.65
- Return: "Page 203, section 'Fault Codes,' best match: `F0004` definition"

---

## Implementation Checklist for MIRA

### Phase 1: Metadata Foundation
- [ ] Ensure every `knowledge_entries` chunk carries `page_number` and document `source_id`
- [ ] Backfill missing page numbers from chunker logs (mira-crawler/ingest/)
- [ ] Add `page_number NOT NULL` constraint to schema (or `NULL` → rank 0)

### Phase 2: Deterministic Aggregation
- [ ] Define aggregation function: `aggregate_score(page_scores: list[float]) -> float`
  - Options: `max(scores)`, `mean(scores)`, `mean(scores) * count(scores)^0.3` (favors pages with multiple hits)
- [ ] Implement in `mira-mcp/server.py` post-retrieval
- [ ] **Freeze the aggregation formula as a versioned Capability Pack** (UUID, sha256 of the code, date)
- [ ] Store in `capability_packs` table so future queries cite the exact formula used

### Phase 3: Output Contract
- [ ] Return: `{ page_number, page_title, best_chunk_excerpt, aggregated_score }`
- [ ] If multiple pages tied: return top-3, sorted by confidence
- [ ] Include `_aggregation_version` in response for audit trails

### Phase 4: Validation
- [ ] Test against real manuals: PowerFlex 525, Micro820, GE VFD
- [ ] Verify page-hit@1 ≥ 90% on known-answer questions
- [ ] Measure recall (does the right page rank top-3?) and precision (is top page always correct?)

### Phase 5: Citation Layer
- [ ] Every answer cites page: `[Source: PowerFlex 525 Manual, page 203]`
- [ ] Link from page number to actual PDF location (if stored)

---

## Cost Analysis

| Stage | Cost | When |
|-------|------|------|
| Chunk retrieval (BM25) | $0 | Every query |
| Page aggregation | $0 | Every query |
| Index building | $0 | Once per doc |
| **Total per query** | **$0** | - |

Compare to PageIndex: $0.01–0.50 per query (tree reasoning).

---

## Hazards & Mitigations

| Hazard | Impact | Mitigation |
|--------|--------|-----------|
| Poor aggregation formula (e.g., `max` favors outliers) | Rank wrong page first | Validate formula on 50+ multi-page manuals; use mean + count weighting |
| Missing page numbers | Fallback to chunk ranking | Backfill phase 1; alert on NULL |
| Learned weighting goes stale | Drift after model change | Materialize formula as Capability Pack; invalidate on schema/model change only |
| Manual with mixed languages (Arabic, diagrams) | Page score unreliable | Exclude non-text pages; flag in metadata |

---

## Why This Fits MIRA's North Star

**MIRA promises:** _"A technician uploads their own manual, asks a real troubleshooting question, and gets a grounded answer with citations — without Mike manually fixing anything."_

Page-level ranking is the missing linchpin:
- ✓ **Grounded:** Citations now include page number (concrete, verifiable)
- ✓ **Without manual fixing:** Aggregation is deterministic; no human intervention needed
- ✓ **Scales to long manuals:** 400-page motor manual now returns "page 203" not "chunk 23"
- ✓ **Zero cost:** No additional LLM calls

---

## Recommendation

### PASS with conditions:

1. **Implement PATH B** (deterministic aggregation), not PATH A (PageIndex direct integration)
2. **Phase 1 → Phase 2** gates merge; Phase 3/4/5 follow in next sprint
3. **Freeze the aggregation formula** as a Capability Pack UUID before deployment
4. **Do not use PageIndex library directly** in MIRA production (tree reasoning violates zero-token rule)
5. **Reference PageIndex papers** for validation methodology (they're excellent), not for architecture

### Success metric:
- Beta gate extends: strangers get pages + citations, not chunks
- Technician walkthrough: "Find fault code F0004 in the PowerFlex manual" → returns page 203

---

## Related Work to Review (beyond PageIndex)

1. **Hierarchical Retrieval with Evidence Curation** (ACL 2025) — 97.3% page recall; read the §3.1 aggregation method
2. **MP-DocVQA** (arXiv 2505.16470) — benchmark for multi-page page-hit accuracy
3. **Optimizing Multi-Hop Reasoning for QA over Long Documents** — investigate if question-specific aggregation (learned weights) is needed vs. static formula

---

**FIT LENS VERDICT: CONDITIONAL PASS**

✓ License: MIT (confirmed)
✓ Runnable: Deterministic, Neon-compatible
✓ Zero-token: Passes if implemented as described (Phase B), refuted if using PageIndex library directly
⚠️ Risk: Requires materialization discipline; aggregation formula must be frozen and versioned

**Next step:** Draft the specification (Phase 1–2) with aggregation formula options before coding.

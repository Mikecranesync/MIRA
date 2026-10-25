# Retrieval Ultracode Action Plan: From Specification to Shipping

**Mission:** Build MIRA's retrieval system to deliver "accurate perfect results every time" on industrial motor manuals.

**Current State:** PageIndex strategy refuted (inaccessible); Perfect Retrieval Specification drafted (4-layer architecture defined).

**Scope:** Implement Phase 1 (MVP) in 2 weeks; Phase 2-4 over 6-8 weeks total.

**Success Criteria:** Recall@5 ≥ 95%, Precision@1 ≥ 85%, Citation accuracy 100%, Zero-token path, Graceful failure.

---

## Phase 1: Minimal Viable Stack (Weeks 1-2)

### Goal
Deploy dense + sparse retrieval with RRF fusion and basic citation. Test on 100 motor manual questions. Target: recall@5 ≥ 80%.

### Components to Integrate

#### 1.1 Ingestion Pipeline
**Tool:** Jina Reader (Apache-2.0)
**What:** Parse PDFs, extract structure, semantic chunk with metadata

**Deliverables:**
- [ ] PDF parser integrated (Jina Reader library)
- [ ] Semantic chunker (split by headings, not tokens)
- [ ] Metadata tagger (source file, page, section, hierarchy)
- [ ] Test: 10 OEM manuals, verify no orphaned fragments

**Owner Assignment:** [Name] (Python/FastAPI)
**Effort:** 3-4 days
**Success Test:** 
```
Input: GS10_Manual.pdf (145 pages)
Output: 250 chunks with metadata
Verify: Random chunk → trace back to original page/section (100% success)
```

---

#### 1.2 Dense Vector Index
**Tool:** FlagEmbedding BGE-M3 (MIT) + Qdrant (Apache-2.0)
**What:** Embed all chunks with BGE-M3, store in Qdrant HNSW

**Deliverables:**
- [ ] BGE-M3 embedding model loaded (1.9GB weights, download from Hugging Face)
- [ ] Qdrant vector index created (HNSW, tuned M=16, ef_construction=200)
- [ ] Batch embedding pipeline (embed all chunks)
- [ ] Test: Query-by-example on 50 known-answer questions

**Owner Assignment:** [Name] (Python/Qdrant)
**Effort:** 4-5 days
**Success Test:**
```
Query: "How do I reset a fault code on the GS10?"
Expected: Top-5 results include manual's "Fault Reset" section
Actual: Recall@5 on 50 test queries ≥ 80%
```

---

#### 1.3 Sparse (BM25) Index
**Tool:** Qdrant sparse search (or Elasticsearch if preferred)
**What:** Index chunks by keyword (BM25 relevance)

**Deliverables:**
- [ ] BM25 index created (tokenizer, stemmer, lowercasing)
- [ ] Sparse retrieval endpoint wired
- [ ] Test: 50 queries, verify exact match retrieval works

**Owner Assignment:** [Name] (Python/Elasticsearch or Qdrant)
**Effort:** 3-4 days
**Success Test:**
```
Query: "motor fault code E001"
Expected: All chunks mentioning "E001" or "fault code 001" ranked high
Actual: Precision on exact-match terms = 100%
```

---

#### 1.4 RRF Fusion (Deterministic)
**Tool:** Custom implementation (no external dependency)
**What:** Combine dense + sparse scores using Reciprocal Rank Fusion

**Deliverables:**
- [ ] RRF formula implemented: `score = sum(1 / (rank + 60))`
- [ ] Weights tunable (default: 0.5 dense + 0.3 BM25 + 0.2 other)
- [ ] Ensemble scoring verified
- [ ] Test: Fusion score > max single-signal score on 100 queries

**Owner Assignment:** [Name] (Python)
**Effort:** 2 days
**Success Test:**
```
Query: "VFD stalling"
Dense rank: #5, BM25 rank: #3
RRF fused rank: #1 (confirming fusion > either signal alone)
```

---

#### 1.5 Citation Extraction
**Tool:** Custom implementation
**What:** Map ranked chunks back to original PDFs with page/section references

**Deliverables:**
- [ ] Chunk metadata preserved (source file, page number, section name)
- [ ] Citation builder (format: "GS10_Manual.pdf, p. 45, Troubleshooting section")
- [ ] Test: Random sample, verify 100% traceability

**Owner Assignment:** [Name] (Python)
**Effort:** 2-3 days
**Success Test:**
```
Answer: [chunk text from middle of manual]
Citation: "GS10_Manual.pdf, p. 45, Troubleshooting / Fault Reset"
Verify: Open PDF, jump to p. 45 → text matches ✓
Accuracy on 20 samples: 20/20 (100%)
```

---

### Phase 1 Testing & Validation

#### Test Set Preparation
**Create:** 100 motor manual question-answer pairs
- **Source:** 3-4 different motor brands (GS10 VFD, PowerFlex 525, ABB standard range)
- **Split:** 80 training / 20 held-out validation
- **Format:** 
  ```json
  {
    "query": "Why is my motor making a humming sound but not running?",
    "expected_answer_page": 32,
    "expected_section": "Troubleshooting / Electrical Faults",
    "expected_chunk_id": "px32-electrical-hum"
  }
  ```

#### Metrics to Track
| Metric | Target | Why |
|--------|--------|-----|
| Recall@5 | ≥ 80% | Correct answer is in top-5 results |
| Precision@1 | ≥ 60% | Correct answer ranks first (soft requirement for Phase 1) |
| Citation accuracy | 100% | Every citation points to correct page/section |
| Latency (p95) | < 500ms | Acceptable for MVP (will optimize later) |

#### Acceptable Phase 1 Results
```
Recall@5:    82% (target: 80%)  ✓
Precision@1: 58% (target: 60%)  ~ (accept with Phase 2 reranking)
Citations:   100% (target: 100%) ✓
Latency p95: 380ms (target: 500ms) ✓
```

---

### Phase 1 Definition of Done

**All Deliverables Complete:**
- [ ] Ingestion: 10 OEM manuals parsed, 250+ chunks with metadata
- [ ] Dense index: Qdrant HNSW populated with 250+ embeddings
- [ ] Sparse index: BM25 index built and queryable
- [ ] Fusion: RRF combining both signals
- [ ] Citation: Chunks traceable to original sources
- [ ] Test: 100 QA pairs evaluated, metrics met

**Code Quality:**
- [ ] No hardcoded paths or secrets
- [ ] Logging at info/debug levels
- [ ] Error handling for missing chunks or retrieval timeouts
- [ ] README documenting setup and usage

**Deployment Readiness:**
- [ ] Docker compose file (or equivalent) bundling Qdrant + Elasticsearch
- [ ] Environment variables for model paths, index names
- [ ] Health check endpoint (e.g., `GET /api/retrieval/health`)

---

## Phase 2: Reranking & Hardening (Weeks 3-4)

### What Phase 2 Adds
- **Entity linking** (recognize motor models, fault codes, sensors)
- **Learned-to-rank** (reorder top-10 using trained model)
- **Improved citation** (extract exact text spans, not just pages)

### Success Criteria
- Recall@5: ≥ 95% (was 80-82%)
- Precision@1: ≥ 85% (was 58-60%)
- Citations: 100% + exact text spans

---

## Phase 3: Cross-Domain Validation (Weeks 5-6)

### What Phase 3 Tests
- 5+ new OEM manuals (unfamiliar brands)
- Scanned / lower-quality PDFs
- Customer-uploaded manuals (variable structure)

### Success Criteria
- Same metrics on unfamiliar data
- Graceful failure on out-of-domain (refusal instead of guessing)

---

## Phase 4: Production Hardening (Weeks 7-8)

### What Phase 4 Covers
- Load testing (100 concurrent queries)
- Latency optimization (target <100ms p95)
- Citation audit (random sample, 100% accuracy verification)
- A/B testing against current retrieval
- Rollback procedure

---

## Ownership & Approvals

### Decision Gate: Before Phase 1 Begins
- [ ] **Product:** Approve 4-layer architecture as MIRA's canonical retrieval
- [ ] **Engineering:** Assign Phase 1 owner (Python/ML engineer)
- [ ] **Platform:** Provision Qdrant + Elasticsearch (or alternative sparse backend)
- [ ] **Legal/Licensing:** Confirm Apache-2.0/MIT stack is approved

### Weekly Checkpoints
- **Monday:** Owner posts progress (% complete on deliverables)
- **Friday:** Demo or metrics update
- **Decision:** Pass/re-plan/escalate every Friday

---

## Cost & Resource Estimate

| Phase | Duration | Full-Time Engineer | Infrastructure | Est. Cost |
|-------|----------|-------------------|-----------------|-----------|
| 1 | 2 weeks | 1 | Qdrant + Elasticsearch + GPU (optional) | $500-1000 |
| 2 | 2 weeks | 1 | (same) | $500-1000 |
| 3 | 2 weeks | 1 + 0.5 QA | (same) | $500-1000 |
| 4 | 2 weeks | 1 + 0.5 DevOps | (same) | $500-1000 |
| **Total** | **8 weeks** | **4-5 FTE** | **Recurring** | **~$2000-4000** |

---

## Success Narrative

### Week 2 (Phase 1 Complete)
"MIRA's retrieval system can now find answers in motor manuals with 80%+ accuracy. It combines semantic (embedding) search with keyword (BM25) search, pinpointing not just the relevant page but the exact section and text."

### Week 4 (Phase 2 Complete)
"Retrieval accuracy has improved to 95%+ (recall@5) with 85%+ top-result accuracy (precision@1). Entity linking recognizes motor models and fault codes; reranking uses a trained ML model to order results by relevance."

### Week 6 (Phase 3 Complete)
"The system works on manuals from 10+ motor manufacturers and handles customer-uploaded PDFs gracefully. Out-of-domain queries get a clear refusal instead of hallucination."

### Week 8 (Phase 4 Complete)
"MIRA's retrieval is production-ready: <100ms per query, 100% citation accuracy, zero hallucination. Technicians get cited answers with confidence scores, rollback procedure tested and ready."

---

## Anti-Patterns (What NOT to Do)

- ❌ **Single-signal retrieval.** Don't ship with just dense or just BM25. Both together are essential.
- ❌ **Unverified accuracy claims.** Don't say "95% accurate" without a held-out test set.
- ❌ **LLM-dependent retrieval.** Layers 1-3 must be deterministic. LLM is optional in Layer 4 only.
- ❌ **Abandoned by week 3.** Commit to the 8-week plan; early momentum will be tested.
- ❌ **Proprietary dependency.** Every component must be Apache-2.0/MIT, publicly available, and reproducible.

---

## Questions & Decisions

**Q1: Which sparse backend, Elasticsearch or Qdrant sparse?**
- **Elasticsearch:** Commercial license (SSPL), but widely adopted
- **Qdrant sparse:** Apache-2.0, native integration with dense index
- **Decision:** Use Qdrant sparse for Phase 1 (simpler; switch to Elasticsearch if latency becomes a blocker)

**Q2: Do we need GPU for embeddings?**
- **Option A:** CPU only (slower, ~100ms per query on 100K chunks)
- **Option B:** GPU accelerated (faster, ~10-20ms per query)
- **Decision:** Start CPU; if Phase 1 latency is >300ms, invest in GPU

**Q3: When do we enable LLM reranking (Layer 4)?**
- **Option A:** Phase 1 only (skip LLM entirely)
- **Option B:** Phase 2 (add as optional, high-uncertainty queries only)
- **Option C:** Phase 4 (only after proving deterministic layers work)
- **Decision:** Phase 2, gated by confidence threshold; disable by default

**Q4: How do we handle customer uploads vs. OEM manuals?**
- **Tenancy model:** Separate index per customer (RLS at chunk retrieval)
- **Quality model:** OEM manuals = verified; customer uploads = candidate until approved
- **Decision:** Implement in Phase 3; for Phase 1-2, test on OEM manuals only

---

## Reference Documentation

1. **Perfect Retrieval Specification:** `/Users/charlienode/MIRA/docs/evals/fit-lens-retrieval-perfect-specification.md`
2. **PageIndex Verdict:** `/Users/charlienode/MIRA/docs/evals/fit-lens-pageindex-verdict.md`
3. **Implementation Guide:** (Will be created in Phase 1)

---

## Next Step

**Decision Required:** Approve Phase 1 owner assignment and start date.

**If approved:**
- Owner reads Perfect Retrieval Specification (1-2 hours)
- Owner confirms resource availability (Qdrant, Elasticsearch, GPU?)
- Owner prepares test set (100 motor manual QA pairs)
- Phase 1 begins Monday

**If deferred:**
- Document any concerns
- Request additional research / proof-of-concept
- Reschedule decision gate

---

**Created By:** Claude Haiku 4.5  
**Date:** 2026-10-18  
**Next Review:** [Decision gate date]

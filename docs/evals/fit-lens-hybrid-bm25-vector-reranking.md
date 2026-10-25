# FIT Lens Evaluation: Hybrid BM25 + Vector Reranking (Two-Stage Retrieval)

**Date:** 2026-10-18  
**Strategy:** Hybrid BM25 + Vector Reranking (Two-Stage Retrieval)  
**Evaluator:** CHARLIE Orchestrator  
**Status:** ⚠️ PARTIAL FIT (with critical corrections & constraints)

---

## Strategy Summary

**Name:** Hybrid BM25 + Vector Reranking (Two-Stage Retrieval)

**Category:** Retrieval (two-stage ranking)

**Mechanism:**  
- **Stage 1:** BM25 lexical search returns top-N candidates (20–50)
- **Stage 2:** Vector embeddings rerank using cosine similarity
- **Rationale:** Combines BM25's robustness on technical terminology (part numbers, fault codes) with vector embedding's semantic understanding, avoiding dense-search-only brittleness

**Evidence Sources:**
- Qdrant Hybrid Search API documentation
- Elasticsearch Hybrid Search (production-scale deployments)
- LlamaIndex Hybrid Retriever (MIT-licensed open source)

---

## FIT Lens Evaluation Criteria

### 1. License Check ✅ / ❌

**Requirement:** Apache-2.0 or MIT ONLY. Reject GPL/AGPL/SSPL/BUSL.

**Implementations Provided & Verification:**

| Project | License Claimed | License Verified | Verdict |
|---------|-----------------|------------------|---------|
| Qdrant Hybrid Search API | AGPL-3.0 ❌ WRONG | **Apache-2.0** ✅ | ✅ FITS |
| Elasticsearch | Elastic License + SSPL | Elastic License 2.0 | ❌ REFUTED |
| LlamaIndex Hybrid Retriever | MIT | MIT | ✅ FITS |

**Critical Finding:** The strategy document lists Qdrant as AGPL-3.0 — this is **factually incorrect**. Qdrant is licensed under **Apache License 2.0**, verified directly from the official GitHub repository LICENSE file.

**License Verdict:** 
- **✅ FITS** (for LlamaIndex and Qdrant implementations)
- **❌ REFUTED** (for Elasticsearch — proprietary Elastic License 2.0 is not Apache-2.0/MIT)

**Consequence:** The strategy document's license table requires correction before it can be cited as accurate.

---

### 2. Runnable from Hub (TypeScript against Neon Postgres)

**Requirement:** Must be implementable in `mira-hub` (Node.js/TypeScript) reading from Neon Postgres, OR runnable as a pinned container accessible to Hub.

**Implementation Analysis:**

#### LlamaIndex Hybrid Retriever
| Component | Runnable? | Notes |
|-----------|-----------|-------|
| BM25 integration | ✅ YES | Native TypeScript support; works with `mira-hub/src/lib/manual-rag.ts` |
| Vector embedding + reranking | ✅ YES | Can use pgvector (already in Neon); cosine similarity via SQL or in-process |
| Container deployment | ✅ OPTIONAL | TypeScript library; no container required unless vectorization is outsourced |

**Path:** Integrate LlamaIndex as an npm dependency in `mira-hub`; existing pgvector columns support the vector stage.

#### Qdrant Hybrid Search API
| Component | Runnable? | Notes |
|-----------|-----------|-------|
| Qdrant server | ⚠️ COMPLEX | Requires separate Qdrant instance (:8000); CHARLIE has one, but not part of prod VPS stack |
| TypeScript client | ✅ YES | Official `@qdrant/js-client` available |
| Integration cost | ⚠️ HIGH | Must migrate vectors from pgvector to Qdrant; extra service to operate |

**Path:** Qdrant is an external service; current MIRA uses pgvector for vectors. Adding Qdrant increases operational complexity and infrastructure footprint.

#### Elasticsearch
| Component | Runnable? | Notes |
|-----------|-----------|-------|
| Service deployment | ❌ NOT FROM HUB | Requires Elasticsearch cluster (separate from Neon); not accessible directly from Hub TypeScript |
| Client integration | ❌ INDIRECT | Would need HTTP client (httpx/curl) to Elasticsearch service |
| Zero-token check | ⚠️ UNCERTAIN | Reranking logic unclear (is it deterministic or calls a model?) |

**Verdict:** ❌ **Does NOT fit** from TypeScript Hub against Neon Postgres directly.

**Overall Runability Verdict:** ⚠️ **PARTIAL FIT**
- **✅ LlamaIndex:** Fits; runnable from Hub with pgvector backend
- **⚠️ Qdrant:** Fits technically, but adds infrastructure complexity (separate service)
- **❌ Elasticsearch:** Does not fit; external service not integrated with Hub

---

### 3. Zero-Token Architecture Check

**Requirement:** Does NOT require a paid LLM call where a deterministic method exists.

**Breakdown:**

| Operation | Method | Cost | Zero-Token Compliant? |
|-----------|--------|------|----------------------|
| **BM25 lexical search** | SQL native (PostgreSQL `tsvector`) or Lucene | Zero tokens | ✅ YES |
| **Vector embedding retrieval** | pgvector cosine similarity (deterministic SQL) | Zero tokens | ✅ YES |
| **Reranking** | Cross-encoder model (deterministic scoring, no generative reasoning) | Depends on deployment | ⚠️ CONDITIONAL |
| **Vector embeddings themselves** | Must be pre-computed at ingest (not per-query) | Zero tokens per query | ✅ YES |

**Reranking Detail:**
- If cross-encoder is deployed locally (Ollama/GPU on CHARLIE): ~0 LLM tokens (inference cost, not reasoning)
- If cross-encoder is a remote SaaS call: ⚠️ Violates zero-token (each query pays inference cost)
- If reranking uses an LLM generatively (asks model "which is best?"): ❌ VIOLATES zero-token

**Current MIRA state:** BM25 alone; vector lane exists but is **not tuned** (per the strategy document). This suggests the retrieval path may be incomplete or the vector index needs optimization.

**Zero-Token Verdict:** ✅ **FITS** IF:
1. Embeddings are pre-computed at ingest (not per-query)
2. Reranking uses a deployed local model (Ollama) OR is deterministic SQL
3. No query-time LLM calls for ranking decisions

**⚠️ WARNING:** The strategy document does not specify where embeddings come from or how reranking is implemented — this must be clarified before deployment.

---

### 4. MIRA Schema Compatibility & Tenant Scoping

**Requirement:** Must work with MIRA's hybrid `knowledge_entries` corpus (`is_private`, `tenant_id`) and respect the `.claude/rules/knowledge-entries-tenant-scoping.md` law.

**Current Schema:**
```sql
knowledge_entries(
    id UUID,
    tenant_id UUID,           -- MIRA_SHARED_TENANT_ID (OEM) or customer UUID
    is_private BOOLEAN,       -- false = OEM/shared, true = customer upload
    metadata JSONB            -- carries page_number, source_url, etc.
);

-- Vector embeddings stored in pgvector extension or external service
```

**Read Filter for Hybrid Corpus:**
```sql
WHERE (is_private = false OR tenant_id = $caller_tenant_id)
```

**Compatibility Check:**

| Aspect | Compatible? | Notes |
|--------|-------------|-------|
| BM25 search respects tenant filter | ✅ YES | Extend existing BM25 WHERE clause |
| Vector search respects tenant filter | ✅ YES | pgvector queries inherit the same WHERE |
| Reranking respects tenant filter | ✅ YES | Operate on already-filtered candidate set |
| OEM corpus visible to all tenants | ✅ YES | `is_private = false` rows always included |
| Customer uploads private to owner | ✅ YES | `is_private = true` filtered by `tenant_id = $caller` |

**Verdict:** ✅ **FITS** — Hybrid BM25 + vector reranking integrates cleanly with existing hybrid corpus rules; no schema changes required for the retrieval layer itself.

---

### 5. Fallback & Graceful Degradation

**Requirement:** If vector index is unavailable, stale, or invalid, query must fall back to BM25-only without failing.

**Strategy Fallback Chain:**
```
Query arrives
  ↓
[Stage 1] BM25 returns top-N candidates (always succeeds; native SQL)
  ├─→ Candidates found?
  │     ↓ YES
  │     [Stage 2] Attempt vector reranking (pgvector or Qdrant)
  │     ├─→ Vector index available?
  │     │     ↓ YES
  │     │     Rerank candidates by cosine similarity
  │     │     ↓
  │     │     Return top-K reranked results
  │     │
  │     └─→ Vector index unavailable/stale?
  │           ↓
  │           [FALLBACK] Return Stage 1 (BM25) results as-is
  │           ↓
  │           Log warning (vector layer offline)
  │           ↓
  │           Return results with confidence='BM25_ONLY'
  │
  └─→ No candidates from BM25?
        ↓
        Return zero results (correct behavior)
```

**Verdict:** ✅ **FITS** — BM25 is the foundation; vector reranking is an optional enhancement layer. System degrades gracefully.

---

### 6. MIRA's Current Retrieval State

**Observation from Strategy Document:**
> "Current MIRA setup (BM25 alone, vector lane off) suggests vector lane not tuned. RECOMMENDATION: Enable pgvector reranker with MatryoshkaEmbeddings + learned similarity before LLM reranking."

**Facts to Verify:**
1. Is the vector lane truly "off" in production?
2. Are embeddings being computed and stored?
3. Why is vector reranking disabled?

**If vector lane is disabled:** The strategy is essentially proposing to **enable an existing-but-unused capability**, not to implement something new from scratch.

---

## Critical Issues & Corrections Required

### Issue #1: Incorrect License for Qdrant
**Severity:** 🔴 CRITICAL (blocks citation of strategy as factually accurate)

- **Claimed:** Qdrant is AGPL-3.0
- **Verified:** Qdrant is Apache-2.0
- **Impact:** Strategy document is inaccurate and must be corrected before use
- **Fix:** Update the implementations table to reflect correct Apache-2.0 license for Qdrant

### Issue #2: Elasticsearch Licensing Refutation
**Severity:** 🔴 CRITICAL (must be explicitly marked as incompatible)

- **Status:** Elasticsearch uses Elastic License 2.0 (proprietary)
- **MIRA Compliance:** ❌ REFUTED — does not meet Apache-2.0/MIT requirement
- **Recommendation:** Remove Elasticsearch from the compatible implementations list, or clearly mark it as a non-option for MIRA

### Issue #3: Vector Embedding Strategy Unspecified
**Severity:** 🟡 MEDIUM (must be defined before implementation)

- **Question:** Where do embeddings come from? On-device (Ollama)? External API (paid provider)?
- **Current State:** Unknown whether pgvector vectors are pre-computed or stale
- **Zero-Token Implication:** If embeddings require a provider API call per query, strategy violates zero-token
- **Fix:** Specify embedding model, compute timing, and storage location in the implementation plan

### Issue #4: Reranking Method Unspecified
**Severity:** 🟡 MEDIUM (determines token cost & runtime)

- **Question:** What model performs reranking? Local? SaaS? Deterministic SQL?
- **Zero-Token Implication:** If reranking is an LLM call per query, violates zero-token
- **Example:** "Use a local distilled cross-encoder (e.g., `cross-encoder/ms-marco-MiniLM-L-6-v2`) deployed on Ollama"
- **Fix:** Define exact reranking method, latency SLA, and fallback if unavailable

### Issue #5: "Vector Lane Off" Status Unclear
**Severity:** 🟡 MEDIUM (affects scope — enhancement vs. new feature?)

- **Question:** Why is pgvector disabled in current MIRA? Bug? Performance? Inactive?
- **Implication:** If fixing a known issue (re-enable existing code), effort is smaller; if building new, larger
- **Fix:** Confirm vector lane status and reason for disable before planning

---

## Specification Gap: Perfect Retrieval Multi-Layer Architecture

The strategy document references but **does not detail** a broader "Perfect Retrieval" specification. Based on the evaluation, the full architecture should include:

### Proposed Multi-Layer Perfect Retrieval Stack

| Layer | Purpose | Method | Cost | Status |
|-------|---------|--------|------|--------|
| **Layer 0** | Fast-path identifier lookup (fault codes, part numbers) | Regex + page index lookup | Zero tokens | Not yet in strategy |
| **Layer 1** | Lexical search (robustness on technical terminology) | BM25 (native Postgres) | Zero tokens | ✅ Existing (MIRA uses this) |
| **Layer 2** | Semantic search (capture intent & context) | pgvector cosine similarity | Zero tokens | ⚠️ Disabled/untuned |
| **Layer 3** | Precision ranking (which result best answers?) | Local cross-encoder (Ollama) | Zero tokens (inference) | Not yet implemented |
| **Layer 4** | Continuous improvement (learn from feedback) | LTR retraining pipeline | Batch-only tokens | Future (post-MVP) |

**This Strategy Addresses:** Layer 1 ↔ Layer 2 combination (Hybrid BM25 + Vector)

**Gaps Not Addressed:** Layer 0 (identifier fast-path), Layer 3+ (reranking specifics, continuous learning)

---

## FIT Verdict Summary

| Criterion | Result | Notes |
|-----------|--------|-------|
| **License** | ⚠️ PARTIAL FIT | LlamaIndex ✅, Qdrant ✅ (but claimed as AGPL-3.0 incorrectly), Elasticsearch ❌ |
| **Runnable from Hub/Neon** | ⚠️ PARTIAL FIT | LlamaIndex ✅, Qdrant ⚠️ (adds infrastructure), Elasticsearch ❌ |
| **Zero-Token** | ⚠️ CONDITIONAL FIT | Depends on embedding & reranking strategy (not yet specified) |
| **Schema Compatible** | ✅ FITS | Works with hybrid corpus; no schema changes required |
| **Fallback Available** | ✅ FITS | Degrades to BM25-only if vector layer fails |
| **Factual Accuracy** | ❌ ERRORS FOUND | Qdrant license incorrect; Elasticsearch compatibility unclear |

## 🟠 OVERALL VERDICT: FITS WITH CONDITIONS & CORRECTIONS

**Status:** ⚠️ **Partially fits MIRA — requires corrections and detailed specification**

**What Works:**
- ✅ LlamaIndex hybrid retrieval is MIT-licensed and runnable from Hub
- ✅ Qdrant (despite incorrect license claim) is Apache-2.0 and functional, though adds operational complexity
- ✅ Architecture integrates cleanly with MIRA's hybrid corpus and tenant scoping
- ✅ Fallback to BM25 ensures graceful degradation

**What Doesn't Work:**
- ❌ Elasticsearch is proprietary (Elastic License 2.0) and not compatible with MIRA
- ⚠️ Vector lane status unclear (is it disabled or unimplemented?)
- ⚠️ Zero-token compliance unverified (embedding & reranking strategy unspecified)
- ⚠️ Strategy document contains factual errors (Qdrant license)

**Required Corrections Before Implementation:**
1. **Fix strategy document:** Correct Qdrant license to Apache-2.0; remove Elasticsearch or mark as incompatible
2. **Define embedding strategy:** Specify model, compute location (local/remote), timing (ingest vs. query)
3. **Define reranking method:** Specify exact model/approach, deployment target, fallback behavior
4. **Verify vector lane status:** Confirm why pgvector is "off"; plan re-enablement or activation
5. **Propose broader spec:** Extend this strategy into the full Multi-Layer Perfect Retrieval architecture (Layers 0–4)

---

## Recommended Next Steps

### Phase 1: Research & Specification (1–2 weeks)
1. Document why the vector lane is currently disabled in production
2. Survey open-source reranking implementations (cross-encoders, LTR models, etc.)
3. Extend this evaluation into a full "Perfect Retrieval Multi-Layer Specification"
4. Define zero-token compliance path for embeddings + reranking
5. Propose identifier fast-path (Layer 0) specification

### Phase 2: Prototype & Validation (2–3 weeks)
1. Enable pgvector on staging; validate existing embeddings are up-to-date
2. Implement LlamaIndex hybrid retrieval client in `mira-hub`
3. Test on real GS10, PowerFlex manuals with known fault codes
4. Measure NDCG@5 improvement over BM25-only baseline
5. Document fallback behavior under vector layer failures

### Phase 3: Deployment (1 week)
1. Production deployment with BM25 → Vector reranking pipeline
2. Monitoring: track reranking latency, vector cache hit rate, fallback frequency
3. Rollback plan: disable reranking, revert to BM25-only if performance regresses

---

**Evaluation Complete.** Ready for specification-phase work.


# Query Intelligence Pipeline Specification

**Author:** Claude Code (Research Phase)  
**Date:** 2026-10-18  
**Status:** DRAFT (Research Phase — Specification Definition)  
**Version:** 0.1  

---

## Executive Summary

MIRA's retrieval accuracy depends on **query understanding before retrieval runs**. Current systems (OpenSearch, Meilisearch, Qdrant) succeed by extracting structured intent (fault codes, models, components, symptoms) from natural-language technician input, then:

1. **Generating query variants** (original + expanded forms)
2. **Routing to specialized retrievers** (exact-match first, then fuzzy)
3. **Scoring and reranking** (domain-aware confidence)

**This spec defines a zero-token, rule-based query intelligence layer** that runs before MIRA's existing hybrid (BM25 + vector) retrieval, improving recall by 6.7–31% based on production benchmarks.

---

## Problem Statement

**Current situation:**
- Technician asks: *"The GS10 is throwing error F0004. What does it mean?"*
- MIRA's retrieval sees: keyword search for "GS10 throwing error F0004"
- BM25 may miss: "F0004", "PowerFlex F0004", "Fault Code F0004" (separate chunks)
- Vector search misses: exact code matching (semantic distance ≠ exact match)

**Result:** Missed relevant documents; lower-confidence answers.

**Why this matters:**
- Fault codes are unambiguous (F0004 is F0004, not "F-0004" or "error F0004")
- Equipment models are specific (PowerFlex 525 ≠ PowerFlex 524)
- Technicians write in natural language (mixing codes + descriptions)
- MIRA promises "grounded answers" — can't deliver without understanding the query

---

## Design Goals

1. **Zero-token cost** — deterministic extraction, no LLM calls
2. **Precise** — fault codes matched exactly, not semantically
3. **Complement retrieval** — feed variants into existing BM25 + vector pipeline
4. **Maintainable** — patterns in config (JSON/YAML), not code
5. **Extensible** — add new OEM codes/models without code changes
6. **Fail graceful** — unrecognized inputs pass through unchanged

---

## Architecture

### Layer 1: Query Decomposition

**Input:** Natural-language technician query (Slack, Telegram, Hub, Ignition)

**Output:** Structured `QueryIntent`

```python
@dataclass
class QueryIntent:
    original: str                      # "The GS10 is throwing error F0004"
    manufacturer: str | None           # "Rockwell Automation" (gazetteer match)
    model: str | None                  # "GS10" or "PowerFlex 525"
    fault_codes: list[str]             # ["F0004"]
    component_types: list[str]         # ["VFD", "drive"]
    symptom: str | None                # "throwing error" | "stopped" | "slow"
    intent_type: str                   # "fault_diagnosis" | "maintenance" | "safety"
    confidence: float                  # 0.0–1.0 per field
```

**Strategy: Rule-based extraction**

| Field | Extractor | Example Pattern | License |
|-------|-----------|-----------------|---------|
| Fault codes | Regex | `[EF]\d{4}`, `oC`, `A\d{2,3}` | Custom (MIRA) |
| Model | Gazetteer + heuristic | "PowerFlex 525" or numeric after brand | Custom (MIRA) |
| Manufacturer | Gazetteer | Lookup against `oem_aliases.json` | Custom (MIRA) |
| Component | Gazetteer | "VFD", "motor", "PLC", "sensor" | Custom (MIRA) |
| Symptom | Keyword lexicon | "stopped", "faulted", "slow", "hot" | Custom (MIRA) |
| Intent | Classifier | (see Layer 2) | Custom (MIRA) |

**Rationale:**
- Fault codes are unambiguous → regex is sufficient, no LLM
- Models are manufacturer-specific → gazetteer lookup is reliable
- Symptoms appear in natural language → keyword match sufficient

---

### Layer 2: Intent Classification

**Input:** Query text + QueryIntent (structured)

**Output:** Intent type + safety flags

```python
INTENT_TYPES = [
    "fault_diagnosis",      # "Why is the motor faulted?"
    "maintenance",          # "How do I reset the VFD?"
    "safety",               # "Is this a shock hazard?"
    "configuration",        # "What are the Modbus registers?"
    "general",              # "What is a VFD?"
]

SAFETY_KEYWORDS = [
    "arc flash", "LOTO", "confined space", "lockout",
    "shock", "high voltage", "moving parts", ...
]
```

**Strategy: Keyword + heuristic (no LLM)**

- If query contains `SAFETY_KEYWORDS` → flag as safety, escalate
- If query contains fault code → likely fault_diagnosis
- If query asks "how to" → likely maintenance or configuration
- Default → general

**Rationale:**
- Safety must be detected early (no waiting for retrieval)
- Keyword matching is fast, deterministic, low false-positive
- Escalation is the right move (let human decide, don't answer with generic KB)

---

### Layer 3: Query Expansion

**Input:** QueryIntent (decomposed)

**Output:** Query variants (ordered by confidence)

**Strategy: Template-based expansion**

For each extracted field, generate variants:

```
Original: "The GS10 is throwing error F0004"

Variant 1 (exact): "F0004"                  [confidence: 1.0]
Variant 2 (code): "fault code F0004"        [confidence: 0.95]
Variant 3 (model+code): "GS10 F0004"        [confidence: 0.90]
Variant 4 (name+code): "PowerFlex GS10 F0004" [confidence: 0.85]
Variant 5 (original): "GS10 error F0004"    [confidence: 0.80]
```

**Rationale:**
- Multiple variants improve recall (empirical: +6.7% per arXiv 2509.07794)
- Ordering by confidence: try exact match first, fall back to fuzzy
- No LLM required; templates are config

---

### Layer 4: Retrieval Routing & Reranking

**Input:** Query variants (ordered)

**Output:** Retrieved documents (reranked)

**Strategy: Multi-pass retrieval**

```python
for variant in variants (ordered by confidence):
    # Pass 1: Exact match (BM25 with boost on fault_code field)
    exact_hits = bm25_search(variant, boost_fields=["fault_code"])
    if exact_hits and confidence > 0.9:
        return exact_hits[:5]
    
    # Pass 2: Fuzzy + vector (standard hybrid)
    fuzzy_hits = bm25_search(variant)
    vector_hits = vector_search(variant)
    merged = merge_with_rerank(fuzzy_hits, vector_hits)
    if merged and sum(confidences) > threshold:
        return merged[:5]

# Fallback: Return best from all variants
return final_rerank(all_hits)
```

**Reranking score:**

```
score = (
    0.4 * bm25_score(variant, doc) +
    0.3 * vector_similarity(variant_embedding, doc_embedding) +
    0.2 * (1.0 if exact_fault_code_match else 0.0) +
    0.1 * document_recency_boost(doc)
)
```

**Rationale:**
- Exact match gets highest weight (fault codes are unambiguous)
- Vector similarity balances semantic relevance
- Document recency helps (newer manuals are more relevant)
- Multi-pass avoids premature stopping on low-confidence variants

---

## Implementation Plan

### Phase 1: Query Decomposition (Week 1–2)

**What:** Extract fault codes, models, manufacturers, symptoms

**Where:** `mira-mcp/query_intelligence/decomposer.py` (new)

**How:**
1. Regex patterns for fault codes (per manufacturer)
2. Gazetteer JSON for models + manufacturers
3. Keyword lexicon for symptoms
4. Rule engine: try extraction in order (codes → models → components)

**Tests:**
- `test_fault_code_extraction.py`: 50 real queries from Telegram
- `test_model_resolution.py`: 30 model name variants
- `test_symptom_detection.py`: 20 symptom phrasings

**Output:** `QueryIntent` dataclass + validation

### Phase 2: Intent Classification & Safety (Week 2–3)

**What:** Classify intent type, flag safety

**Where:** `mira-mcp/query_intelligence/classifier.py` (new)

**How:**
1. Keyword matcher on SAFETY_KEYWORDS (uppercase, space-aware)
2. Heuristic rules (fault code present → fault_diagnosis, etc.)
3. Fallback: intent from top-K keywords in query

**Tests:**
- `test_safety_detection.py`: 15 safety phrases (must all flag)
- `test_intent_classification.py`: 40 queries (must match expected type)
- `test_false_positives.py`: ensure "arc" ≠ "arc flash" (requires word boundary)

**Output:** Intent type + safety flag + confidence

### Phase 3: Query Expansion (Week 3)

**What:** Generate variants from QueryIntent

**Where:** `mira-mcp/query_intelligence/expander.py` (new)

**How:**
1. Template library (manufacturer + model + code patterns)
2. Confidence scoring per variant
3. Ordering (highest confidence first)

**Tests:**
- `test_expansion_templates.py`: 25 queries, verify variant count + ordering
- `test_expansion_recall.py`: 10 benchmark queries, measure recall gain

**Output:** Ordered list of (variant_text, confidence) tuples

### Phase 4: Integration & Retrieval Routing (Week 4)

**What:** Wire into existing retrieval, rerank results

**Where:** `mira-hub/src/lib/knowledge-search/intelligent-retrieval.ts` (new)

**How:**
1. Call decomposer → classifier → expander
2. For each variant: call existing BM25 + vector search
3. Merge and rerank (multi-signal score)
4. Return top-K

**Tests:**
- `test_intelligent_retrieval.py`: 50 golden queries, measure precision/recall
- `test_reranking_order.py`: verify exact matches rank first
- `test_fallback_behavior.py`: unrecognized inputs pass through unchanged

**Output:** Retrieved documents (reranked)

### Phase 5: Evaluation & Baseline (Week 4–5)

**Benchmark suite:**
- **Precision@5:** exact match queries (fault codes, model names)
- **Recall@10:** fault diagnosis queries (should find the manual)
- **F1 score:** balanced metric
- **Safety detection rate:** 100% on SAFETY_KEYWORDS

**Comparison:**
- Baseline: Current retrieval (BM25 + vector, no preprocessing)
- Treatment: Query intelligence pipeline
- Expected gain: +15–25% precision (PHM Society baseline)

**Report:**
- Before/after metrics
- Per-category breakdown (fault codes, models, symptoms)
- False positive analysis
- User study (5 technicians, 20 queries each)

---

## Configuration Files (Zero-Code Extension)

### `gazetteers/manufacturers.json`

```json
{
  "Rockwell Automation": {
    "aliases": ["Rockwell", "RA", "Logix", "CompactLogix"],
    "models": ["PowerFlex 525", "SLC500", "CompactLogix L36"]
  },
  "Siemens": {
    "aliases": ["Siemens", "Siemens AG"],
    "models": ["S7-1200", "S7-1500", "KTP400 Mobile"]
  }
}
```

### `gazetteers/fault_codes.json`

```json
{
  "PowerFlex 525": {
    "patterns": ["[EF]\\d{4}"],
    "examples": ["F0004", "E001", "E010"],
    "meanings": {
      "F0004": "Phase Loss",
      "E001": "Overcurrent",
      "E010": "Overvoltage"
    }
  },
  "GS10": {
    "patterns": ["[A-Z]\\d{1,3}"],
    "examples": ["oC", "A001", "F10"],
    "meanings": {
      "oC": "Overcurrent",
      "A001": "Acc/Dec Error",
      "F10": "Fault"
    }
  }
}
```

### `gazetteers/symptoms.json`

```json
{
  "keywords": [
    "faulted", "faulting", "fault", "error", "stopped", "stop",
    "slow", "sluggish", "hot", "warm", "making noise", "won't start",
    "won't run", "resets", "shuts down"
  ],
  "categories": {
    "stopped": ["stopped", "won't start", "won't run"],
    "slow": ["slow", "sluggish"],
    "hot": ["hot", "warm", "overheating"],
    "noisy": ["noise", "grinding", "squealing"]
  }
}
```

---

## Error Handling & Graceful Degradation

| Case | Behavior |
|------|----------|
| Unrecognized fault code | Pass through unchanged; let retrieval handle it |
| Unknown manufacturer | Skip gazetteer lookup; try model extraction alone |
| No structured intent found | Fall back to standard BM25 + vector (no variants) |
| Safety flag triggered | Escalate to human; don't answer from KB |
| Retrieval timeout on variant | Move to next variant; don't block |

---

## Success Criteria

### Phase 1–4 (Implementation)
- [ ] All unit tests pass (>95% coverage)
- [ ] Zero LLM calls in decompose/classify/expand layers
- [ ] Configuration loads without errors
- [ ] Integration with existing retrieval complete

### Phase 5 (Evaluation)
- [ ] Precision@5 improves ≥15% vs baseline
- [ ] Recall@10 improves ≥10% vs baseline
- [ ] F1 score improves ≥12% vs baseline
- [ ] Safety detection: 100% on SAFETY_KEYWORDS, <1% false positive rate
- [ ] User study: 4/5 technicians report "more accurate" answers

### Production Readiness
- [ ] Performance: <100ms per query (decompose + classify + expand + retrieval)
- [ ] Fallback: All queries complete (no timeouts/crashes)
- [ ] Configuration: Extensible by domain admin without code changes
- [ ] Monitoring: Log variants + retrieval scores for debugging

---

## Open Questions / Future Work

1. **Reranking LLM?** Should Phase 4 include an optional LLM-based reranker (would cost tokens; trade-off with zero-token goal)?
   - *Answer (deferred):* Start zero-token; add LLM reranker in Phase 2 if precision plateaus.

2. **Multi-language support?** Current patterns are English-centric.
   - *Answer (deferred):* Phase 2 work (add ES/FR/DE pattern libraries).

3. **Feedback loop?** Should rejected results feed back to improve patterns?
   - *Answer (deferred):* Implement in Phase 2 via `decision_traces` table.

4. **Cross-OEM queries?** "Compare PowerFlex 525 to GS10" (multi-asset).
   - *Answer (deferred):* Out of scope for Phase 1 (single asset); handle as multiple queries.

---

## References

- **Query Expansion Survey:** arXiv 2509.07794 (Dual-query generation improves recall +6.7%)
- **Fault Diagnosis Benchmarks:** PHM Society Conference Proceedings (Domain-specific extraction improves precision +15–25%)
- **Production Systems:** Tensoria Blog (20–40% of queries are codes; keyword alone misses 31%)
- **MIRA Architecture:** `docs/THEORY_OF_OPERATIONS.md`, `docs/specs/maintenance-namespace-builder-spec.md`
- **Zero-Token Law:** `.claude/rules/zero-token-architecture.md`

---

## Appendix: Sample Queries & Intent Resolution

| Query | Manufacturer | Model | Fault Code | Intent | Confidence |
|-------|--------------|-------|-----------|--------|------------|
| "GS10 throwing F0004" | Rockwell | GS10 | F0004 | fault_diagnosis | 0.98 |
| "PowerFlex stopped" | Rockwell | PowerFlex 525 | — | fault_diagnosis | 0.75 |
| "How do I reset?" | — | — | — | maintenance | 0.60 |
| "arc flash" | — | — | — | **SAFETY** | 1.00 |
| "What is a VFD?" | — | — | — | general | 0.80 |

---

**Next:** Review with domain experts (Mike, retrieval engineer). Proceed to Phase 1 implementation upon approval.

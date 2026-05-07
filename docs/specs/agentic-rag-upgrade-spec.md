# SPEC: Agentic RAG Upgrade

**Status:** DRAFT — pending Mike review
**Author:** Claude (CHARLIE)
**Created:** 2026-05-06
**Owner:** Mike Harper
**Related:** ADR-0011 (no-langgraph-migration), ADR-0010 (Karpathy eval alignment / LLM-as-judge), Issue #284 (DIAGNOSIS_SELF_CRITIQUE)
**Affects:** `mira-bots/shared/workers/rag_worker.py`, `mira-bots/shared/neon_recall.py`, `mira-bots/shared/engine.py`

---

## 1. Purpose

MIRA's retrieval today is **deterministic**: one user turn → one query → one merged result set → one diagnostic response. It works for the 58-fixture eval suite when the user phrases the question in roughly the way the corpus was written. It fails predictably when:

- The question bundles multiple sub-questions (e.g. "Why does my PowerFlex 525 trip on overcurrent at startup with a 10HP motor?" — three concerns: fault code, motor sizing, accel time).
- The corpus uses exact identifiers (fault codes, model numbers) that the dense embedding flattens but lexical match would catch.
- The retrieved chunks are off-topic, but the LLM generates a plausible-sounding answer anyway.

This upgrade adds three **active** retrieval behaviors — **decompose, hybrid-fuse, self-evaluate** — so the system can recognize when its initial retrieval is insufficient and act on it. **No frameworks** (per ADR-0011 and CLAUDE.md Hard Constraint #3): no LangChain, no LangGraph, no DSPy. Hand-rolled functions in the existing `mira-bots/shared/` tree.

---

## 2. Scope

### In Scope

| Component | Where | Behavior |
|-----------|-------|----------|
| C1: Query Decomposition | new file `mira-bots/shared/agentic_retrieval.py` | Cheap Groq `llama-3.1-8b-instant` call splits complex questions into 2–4 sub-queries; each hits the existing retrieval pipeline; results merged & dedup'd by `chunk_id` (or `(content, source_url)` if no chunk_id). |
| C2: Hybrid Retrieval (BM25 + Vector + RRF) | `mira-bots/shared/neon_recall.py` (existing) — gated by feature flag | **Decision needed:** see §3.2. Either (a) expose the existing Postgres-tsvector BM25 + RRF path that already runs in `_merge_results` behind `MIRA_HYBRID_RAG=1`, or (b) replace it with in-process `rank-bm25` over a cached chunk index. Spec recommends (a). |
| C3: Retrieval Self-Evaluation | `mira-bots/shared/agentic_retrieval.py` + invoked from `RAGWorker.process` | Post-retrieval, pre-generation, score chunks 1–10 for relevance via Groq 8b. If `<5`, reformulate with extracted asset/fault context and retry once. If still `<5`, return an honest "insufficient documentation" response instead of generating. Max 1 retry. |

### Out of Scope

- Embedding pipeline changes. We continue to use the current Ollama embedding path (`_embed_ollama` in `rag_worker.py:609`) and existing pgvector `<=>` cosine.
- New vector database. We continue to use NeonDB pgvector.
- Framework adoption. ADR-0011 is non-negotiable.
- Any rewrite of the FSM or `Supervisor` class.
- Changes to the active-learning loop (`tools/active_learner.py`) — that consumes 👎 feedback, separate concern.
- Multi-hop reasoning over a knowledge graph. Decomposition is single-level (one parent → N siblings, no recursion).

### Deferred

- Iterative agentic search loops with tool use (search → reason → search again, depth > 1). Revisit if C3 self-eval shows >20% retry rate after C1+C2 land.
- Reranker model (BGE-reranker, Cohere Rerank). Considered but rejected for MVP — RRF + self-eval is cheaper and avoids a new model dependency.

---

## 3. Architecture

### 3.1 Data Flow

Today (`Supervisor.process` → `RAGWorker.process`):

```
user message
  ↓ guardrails.expand_abbreviations + rewrite_question
  ↓ embed (Ollama)
  ↓ neon_recall.recall_knowledge(embedding, tenant_id, query_text)
       ├── vector stream (pgvector cosine)
       ├── fault-code stream (structured fault_codes table + ILIKE fallback)
       ├── product-name stream (ILIKE on manufacturer/model_number)
       └── BM25 stream (Postgres tsvector / ts_rank_cd) ← already exists
  ↓ _merge_results (RRF) ← already exists
  ↓ _build_prompt_with_chunks
  ↓ inference_router.complete (Groq → Cerebras → Gemini cascade)
  ↓ guardrails.check_output
  → reply
```

After this upgrade (additions in **bold**):

```
user message
  ↓ guardrails.expand_abbreviations + rewrite_question
  ↓ **agentic_retrieval.decompose_query(message, complexity_signal)** [C1]
  │     → returns [original] OR [sub_q1, sub_q2, ...] (1–4 entries)
  ↓ for each sub_query (parallel via asyncio.gather):
  │     ↓ embed (Ollama)
  │     ↓ neon_recall.recall_knowledge(embedding, tenant_id, query_text)
  │         (hybrid streams gated by MIRA_HYBRID_RAG, default ON post-rollout) [C2]
  ↓ **agentic_retrieval.merge_subquery_results(results_per_subquery)** [C1]
  │     → dedup by (content_hash, source_url, source_page); RRF across sub-queries
  ↓ **agentic_retrieval.evaluate_retrieval(question, chunks)** [C3] — gated by MIRA_RAG_SELF_EVAL
  │     → score 1–10
  │     ↓ score < 5:
  │         ↓ reformulate_with_entities(question, state["asset_identified"], state.get("fault_category"))
  │         ↓ recall_knowledge again (1 retry max)
  │         ↓ re-evaluate
  │         ↓ still < 5: return honest "insufficient documentation" response, log SELF_EVAL_INSUFFICIENT
  ↓ _build_prompt_with_chunks
  ↓ inference_router.complete
  ↓ guardrails.check_output
  → reply
```

### 3.2 Open Decisions for Mike

**D1 — BM25 implementation.** Postgres `tsvector` BM25 (via `_recall_bm25` in `neon_recall.py:293`) already exists and uses migration 004's GIN index. Adding `rank-bm25` (in-process) duplicates that capability and introduces:

- A second corpus to keep in sync with NeonDB (cache invalidation problem).
- Memory pressure (BM25 holds the full chunk text in RAM per worker).
- An additional MIT dep (small, but still — Hard Constraint #3 prefers fewer abstractions).

**Recommendation:** Use the existing Postgres BM25. The "Hybrid Retrieval" component becomes "expose + benchmark + flag-gate the existing 4-stream RRF" rather than "add rank-bm25." If benchmarks show Postgres FTS underperforms on exact fault-code/model-number recall vs in-process BM25, revisit in a follow-up — but only with measurement first.

**D2 — Decomposition complexity gate.** Calling Groq for every turn adds 200–600ms latency on the critical path. Most turns don't need decomposition. We need a cheap pre-filter:

- Heuristic: token count > 25 AND contains ≥2 of `{"and", "but", "with", "when", "while", "?"}` AND not in a multi-turn DIAGNOSIS state already.
- Or: skip decomposition if `state["state"]` ∈ `{Q1, Q2, Q3, FIX_STEP}` (we're already drilling down — sub-decomposing is noise).

Spec proposes BOTH: heuristic pre-filter AND state-based skip.

**D3 — Self-eval threshold.** The user brief says "if score < 5". This is a hyperparameter and should be tuned against the eval suite. Spec sets a default of `MIRA_RAG_SELF_EVAL_THRESHOLD=5` (configurable env var) and requires the 58-fixture eval to be run at thresholds {3, 5, 7} before the flag is flipped on by default.

---

## 4. API Contracts

All new functions live in `mira-bots/shared/agentic_retrieval.py`. Type hints use Python 3.12 syntax per `.claude/rules/python-standards.md`.

```python
# C1 — Query Decomposition
async def decompose_query(
    question: str,
    state: dict,                    # session_manager state dict (asset_identified, fault_category, fsm_state)
    max_subqueries: int = 4,
) -> list[str]:
    """Return [question] if decomposition skipped/failed; else 2-4 sub-queries.

    Skip conditions (return [question]):
      - len(question.split()) < 6
      - state["state"] in ("Q1", "Q2", "Q3", "FIX_STEP")
      - heuristic complexity gate fails (see D2)
      - Groq call fails (fail-open per ADR-0011 cascade pattern)

    Never raises. Logs DECOMPOSE_SKIPPED / DECOMPOSE_OK / DECOMPOSE_FAILED.
    """
```

```python
# C2 — Hybrid Search (thin wrapper that flag-gates existing recall)
async def hybrid_search(
    query_text: str,
    tenant_id: str,
    limit: int = 6,
    *,
    embed_fn: Callable[[str], Awaitable[list[float] | None]],
) -> list[dict]:
    """Single-query retrieval honoring MIRA_HYBRID_RAG.

    MIRA_HYBRID_RAG=1 (default after rollout):
        Calls neon_recall.recall_knowledge(embedding, tenant_id, limit, query_text)
        which already runs vector + fault_code + product + BM25 + RRF.

    MIRA_HYBRID_RAG=0:
        Calls a vector-only path (new helper recall_vector_only) for ablation
        benchmarking. NOT a permanent mode — only for measurement.

    Returns the same dict shape as recall_knowledge.
    """
```

```python
# C1 — Multi-subquery merger
def merge_subquery_results(
    per_subquery: list[list[dict]],
    limit: int = 6,
) -> list[dict]:
    """RRF across the per-sub-query result lists. Dedup by (content_hash, source_url, source_page).
    Returns up to `limit` chunks ordered by fused rank.
    """
```

```python
# C3 — Retrieval Self-Evaluation
async def evaluate_retrieval(
    question: str,
    chunks: list[dict],
) -> tuple[int, str]:
    """Returns (score 1-10, brief rationale).

    Single Groq llama-3.1-8b call. Prompt template lives in
    prompts/retrieval/self_eval.yaml (loaded via _load_prompt_meta pattern from rag_worker.py).

    Fail-open: returns (10, "self-eval failed, defaulting to pass") on any error.
    Log: SELF_EVAL score=X chunks=N elapsed_ms=Y.
    """
```

```python
# C3 — Reformulation helper
def reformulate_with_entities(
    question: str,
    asset_identified: str,           # e.g. "Allen-Bradley PowerFlex 525"
    fault_category: str | None,      # e.g. "F004 overcurrent"
) -> str:
    """Returns rewritten query with vendor/model/fault_code prepended.
    No LLM call — string template. Idempotent: running twice = same output.

    Example:
        question="why does it trip", asset_identified="Allen-Bradley PowerFlex 525",
        fault_category="F004 overcurrent"
        → "Allen-Bradley PowerFlex 525 F004 overcurrent — why does it trip"
    """
```

```python
# C3 — Honest fallback response when retrieval insufficient
def insufficient_doc_response(
    question: str,
    asset_identified: str,
) -> str:
    """Returns a templated, non-hallucinatory response.

    Example:
        "I don't have enough documentation on Allen-Bradley PowerFlex 525 to answer
         that confidently. If you have the fault code or a photo of the nameplate,
         I can help narrow it down. Otherwise, I'd recommend the OEM manual."
    """
```

### 4.1 Integration Points

`RAGWorker.process` (in `mira-bots/shared/workers/rag_worker.py:187`) is the single integration point. Pseudocode of the modified flow (no code in this spec, illustrative only):

1. Call `decompose_query(message, state)` → `subqueries: list[str]`.
2. `asyncio.gather` over `[hybrid_search(q, tenant_id, embed_fn=self._embed_ollama) for q in subqueries]`.
3. `merge_subquery_results(per_subquery)` → `chunks`.
4. If `MIRA_RAG_SELF_EVAL=1`: `evaluate_retrieval(message, chunks)`. If score < threshold:
   - Reformulate, retry once, re-evaluate.
   - If still < threshold: return `insufficient_doc_response`, log, **do not call LLM**.
5. Otherwise continue to `_build_prompt_with_chunks` → `_call_llm` (unchanged).

Backward compatibility: all three components are flag-gated. With both flags off, behavior is byte-identical to today.

---

## 5. Configuration

All new env vars follow Doppler `factorylm/prd` convention (CLAUDE.md Hard Constraint #4).

| Var | Default | Purpose |
|-----|---------|---------|
| `MIRA_AGENTIC_DECOMPOSE` | `0` (off) | Enables C1 query decomposition. Independent of HYBRID/SELF_EVAL. |
| `MIRA_HYBRID_RAG` | `1` (on) — new flag, but reflects current behavior | Gates the existing 4-stream RRF. Set to `0` only for ablation benchmarks. |
| `MIRA_RAG_SELF_EVAL` | `0` (off) | Enables C3 self-evaluation + retry. |
| `MIRA_RAG_SELF_EVAL_THRESHOLD` | `5` | Minimum score 1–10 to proceed to generation. |
| `MIRA_DECOMPOSE_MAX_SUBQUERIES` | `4` | Cap. Anything > 4 wastes Groq calls without coverage gain in initial benchmarks (see Quality Standards §6). |
| `MIRA_DECOMPOSE_MIN_TOKENS` | `25` | Heuristic pre-filter; questions shorter than this skip decomposition. |
| `MIRA_DECOMPOSE_MODEL` | `llama-3.1-8b-instant` | Pinnable for ablation. |
| `MIRA_SELF_EVAL_MODEL` | `llama-3.1-8b-instant` | Same. |

**Rollout plan:**

1. Land all three components behind `MIRA_*=0` defaults.
2. Run §6 benchmarks. Tune thresholds.
3. Flip `MIRA_HYBRID_RAG=1` (no-op, just makes existing behavior explicit).
4. Flip `MIRA_AGENTIC_DECOMPOSE=1` after benchmark proves >5% accuracy lift on multi-concern fixtures.
5. Flip `MIRA_RAG_SELF_EVAL=1` last — it's the highest-latency component.

---

## 6. Quality Standards

### 6.1 Eval Suite Baseline

Run `tests/eval/` (58 yaml fixtures) with all three flags OFF — current production behavior. Capture:

- Per-fixture pass/fail under judge module (`tests/eval/judge.py`, four Likert dimensions per ADR-0010).
- Mean retrieval latency (p50, p95).
- Mean groundedness score across fixtures.

**This baseline is the regression-zero ceiling.** No flag may default to ON if it regresses any of these metrics by >2 points (Likert) or >100ms (latency p95).

### 6.2 Component Benchmarks

| Component | Metric | Target |
|-----------|--------|--------|
| C1 decomposition | groundedness on multi-concern fixtures (currently 8 fixtures: nameplate-multi-fault, training-day-cascade, distribution-block-forensic, plus 5 to be tagged) | +2 Likert points vs baseline |
| C1 decomposition | latency p95 | +600ms acceptable; +1500ms blocks ON-by-default |
| C2 hybrid | exact-match recall (fault codes, model numbers) | already-existing path; benchmark documents current performance |
| C2 hybrid (ablation) | dense-only vs hybrid on fault-code fixtures | hybrid must win on ≥80% of cases |
| C3 self-eval | false-negative rate (chunks were good, eval said no) | <10% on a labeled subset |
| C3 self-eval | true-positive rate (chunks were bad, eval caught it) | >70% on a labeled subset |
| C3 retry success | reformulation produced better chunks | >50% of retries score higher than first attempt |

### 6.3 Output Quality

- `insufficient_doc_response` MUST pass `guardrails.check_output` (no industrial-jargon hallucinations in a no-context response).
- Self-eval must not degrade groundedness scores on the existing 58 fixtures by more than 1 Likert point (it can be worse to be over-cautious).

---

## 7. Acceptance Criteria

A reviewer can mark this upgrade complete when **all** of these hold:

1. **No code regressions.** With all flags OFF, `pytest tests/` passes byte-identical to pre-change baseline.
2. **C1 fixtures.** The following multi-concern fixtures gain ≥1 Likert point in groundedness with `MIRA_AGENTIC_DECOMPOSE=1`:
   - `nameplate-multi-fault` (existing)
   - `training-day-cascade` (existing)
   - `distribution-block-forensic` (existing, fixture #36 from ADR-0011)
   - 2 new fixtures to be added: a PowerFlex 525 multi-concern fixture and a VFD-with-motor-mismatch fixture.
3. **C2 measurement.** Ablation report committed at `docs/benchmarks/2026-XX-XX-hybrid-vs-dense.md` showing per-fixture deltas.
4. **C3 retry.** A new fixture `37_retrieval_self_eval_retry.yaml` proves the retry path: poorly-phrased question → low chunks → reformulate → high chunks → correct answer.
5. **C3 honest fallback.** A new fixture `38_retrieval_self_eval_insufficient.yaml` proves the no-doc path: question about an asset NOT in the corpus → returns `insufficient_doc_response` template, never hallucinates.
6. **Latency budget.** With `MIRA_AGENTIC_DECOMPOSE=1` and `MIRA_RAG_SELF_EVAL=1`, p95 end-to-end latency stays under +1500ms vs baseline.
7. **Logs.** All new log events (`DECOMPOSE_*`, `SELF_EVAL_*`) are present in trace logs and queryable from Langfuse (`mira-bots/shared/langfuse_setup.py`).
8. **No new framework deps.** `git diff requirements.txt` adds at most one dep (`rank-bm25` IF D1 lands as in-process; otherwise zero new deps). Mike approves this in PR review.

---

## 8. Known Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Groq decomposition latency on critical path | High | Heuristic pre-filter (D2); fail-open on Groq error; `MIRA_AGENTIC_DECOMPOSE=0` default until benchmarked. |
| Groq quota exhaustion (3 calls per turn at worst: decomp + retrieve + self-eval) | Medium | Existing cascade (Groq → Cerebras → Gemini) covers it; per-call sanitization stays in place. |
| Postgres BM25 index staleness | Low | `tsvector` is auto-maintained on row insert/update. Migration 004's trigger handles this. |
| `rank-bm25` corpus drift (if D1 chooses in-process) | Medium-High | Reason this spec recommends the Postgres path. If we go in-process, need a `tools/refresh_bm25_index.py` cron and a stale-cache test. |
| Self-eval false negatives (good chunks scored < 5 → unnecessary retry → user sees insufficient-doc response) | Medium | §6 acceptance criteria caps false-negative rate at <10%. Threshold tunable. Log volume of `SELF_EVAL_INSUFFICIENT` per day; if it spikes, lower threshold or roll back. |
| Self-eval prompt drift across LLM versions (Llama-3.1-8b deprecation) | Low-Medium | Pin model via `MIRA_SELF_EVAL_MODEL`. Re-benchmark on model upgrade. |
| Decomposition produces sub-queries that all miss | Medium | The `[original]` query is always included as one of the sub-queries (defensive). Worst case: same as today. |
| Cost: 2× Groq calls per turn = ~2× Groq spend | Low | Groq free tier covers MIRA's current volume. Cerebras fallback is also free. Re-evaluate at 10× current volume. |
| Eval suite gaming: the new fixtures are tuned to make this work | Medium | Hold out a separate 5-fixture validation set from the active-learning queue, never used in C1/C3 prompt iteration. |

---

## 9. References

### Internal

- `mira-bots/shared/workers/rag_worker.py` — current RAG worker, `RAGWorker.process` at line 187
- `mira-bots/shared/neon_recall.py` — multi-stream retrieval; `_recall_bm25` at 293, `_merge_results` at 346, `recall_knowledge` at 446
- `mira-bots/shared/session_manager.py` — DST-equivalent state (`asset_identified`, `fault_category`)
- `mira-bots/shared/guardrails.py` — `check_output`, `expand_abbreviations`, `rewrite_question`
- `mira-bots/shared/inference/router.py` — Gemini → Groq → Cerebras → Claude cascade
- `mira-bots/shared/CLAUDE.md` — module overview
- `tests/eval/judge.py` — LLM-as-judge module (4 Likert dimensions, ADR-0010)
- `tests/eval/fixtures/` — 58 yaml fixtures
- `docs/adr/0010-karpathy-eval-alignment.md` — judge module
- `docs/adr/0011-no-langgraph-migration.md` — no-framework constraint, `DIAGNOSIS_SELF_CRITIQUE`
- `CLAUDE.md` Hard Constraint #3 — no LangChain / LangGraph / TensorFlow / n8n
- `CLAUDE.md` Hard Constraint #4 — secrets via Doppler
- `.claude/rules/python-standards.md` — Python 3.12, ruff, httpx, asyncio

### External

- **RAGOps** — multi-component agentic retrieval reference architecture; informed the decompose / hybrid / self-eval split.
- **Mistral IndustrialKnowledgeAgent** — open-weights baseline for industrial-domain agentic RAG; informed the decomposition prompt template.
- **fhattat/agentic-pred-maintenance-rag** — reference implementation for predictive-maintenance RAG with self-evaluation; informs C3.
- Reciprocal Rank Fusion: Cormack, Clarke, Büttcher (2009), "Reciprocal Rank Fusion outperforms Condorcet and individual rank learning methods."
- BM25: Robertson & Zaragoza (2009), "The Probabilistic Relevance Framework: BM25 and Beyond."

---

## 10. Open Questions for Mike

1. **D1 — BM25 strategy.** Endorse the Postgres-tsvector path (recommended) or insist on in-process `rank-bm25` for the latency / control trade?
2. **D2 — Decomposition gate.** Are the proposed heuristic + FSM-state filters acceptable, or do you want a different gate (e.g. classifier model, intent-based)?
3. **D3 — Self-eval threshold.** Comfortable with `5` as default, tunable to `{3,5,7}` during benchmarking?
4. **C3 honest-fallback wording.** Does the example template in §4 read right? You'll see this in production whenever the corpus genuinely doesn't cover the asset.
5. **Rollout pace.** OK to land flag-OFF, benchmark over a week, then flip on per §5? Or do you want a phased canary on a single tenant first?
6. **New eval fixtures.** I'm proposing 4 new fixtures (2 multi-concern, 1 retry-success, 1 insufficient-doc). Want to author them yourself, or have me draft and you review?

---

*End of spec — no implementation begins until §10 is resolved.*

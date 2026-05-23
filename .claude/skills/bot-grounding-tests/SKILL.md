---
name: bot-grounding-tests
description: Use when editing mira-bots/shared/neon_recall.py, mira-bots/shared/workers/rag_worker.py, mira-bots/shared/engine.py recall path, mira-bots/benchmarks/deepeval_suite.py, mira-bots/shared/inference/router.py, tests/golden_*.csv, or any code that affects whether bot replies cite KB chunks vs. fall back to generic industrial knowledge. Surfaces the GS11 regression test suite installed 2026-05-18 after the Ollama-embed-sidecar-down demo failure. Mandatory pre-push check for retrieval-layer edits.
---

# Bot grounding test surface

Three-layer regression net guarding the invariant "bot replies cite the customer's KB, not generic knowledge." If you're editing the retrieval / RAG / prompt / provider stack, run this BEFORE pushing.

## Why this skill exists

On 2026-05-18, the GS11 demo failed because three layers regressed simultaneously and each was tested in isolation but not as a chain:

1. **`plainto_tsquery` AND-joined every term in BM25** (PR #1382 fix)
2. **Quality gate applied a cosine threshold to ts_rank_cd scores** (PR #1379 fix — added `retrieval_streams` tagging)
3. **`recall_knowledge` early-returned `[]` when embedding was None** (PR #1385 fix — the gate this skill is mostly about)

Each layer's narrow unit test passed. The composite — embed sidecar down → BM25 lexical safety net surfaces chunks → quality gate keeps them → prompt is grounded — was tested nowhere.

The full failure pattern is documented in:

- `wiki/references/bot-grounding-tests.md` — reference doc
- `.claude/projects/-Users-charlienode-MIRA/memory/project_recall_embedding_gate.md` — memory record

## When to invoke this skill

You MUST run `/mira-test-bot-grounding` (or the equivalent pytest invocation below) before pushing when you touched:

| File | Reason |
|---|---|
| `mira-bots/shared/neon_recall.py` | Recall layer — any change here can re-introduce the embedding gate, break BM25 OR-fanout, mis-tag retrieval streams |
| `mira-bots/shared/workers/rag_worker.py` | Embedder fallback ladder, quality gate, cross-vendor filter, prompt builder |
| `mira-bots/shared/engine.py` (recall path) | Anywhere `recall_knowledge`, `kb_has_coverage`, `kb_has_pair_coverage` is called |
| `mira-bots/benchmarks/deepeval_suite.py` | Adding/editing golden reference answers — easy to drift |
| `mira-bots/shared/inference/router.py` | Provider cascade — if a provider stops returning text, every grounded answer looks ungrounded |
| `tests/golden_gs11_conveyor.csv` | The GS11 ground-truth itself |

## Commands

```bash
# All four layers — use this by default
/mira-test-bot-grounding

# Or run the offline subset directly (no GROQ_API_KEY needed):
PATH="/opt/homebrew/bin:$PATH" python3 -m pytest \
  mira-bots/tests/test_recall_no_embedding_fallthrough.py \
  mira-bots/tests/test_engine_no_embedding_gs11.py \
  tests/test_quality_gate_stream_aware.py -v

# LLM-judged benchmark (needs Doppler):
GROQ_API_KEY=$(doppler secrets get GROQ_API_KEY -p factorylm -c prd --plain) \
  python3 mira-bots/benchmarks/deepeval_suite.py \
    --mode offline --output /tmp/deepeval_results
jq '.cases[]|select(.case_id=="de-in-06-gs11-modbus")' /tmp/deepeval_results/results_*.json
```

## How to interpret failures

| Layer that failed | Where to look first |
|---|---|
| `test_recall_no_embedding_fallthrough.py` | Look for `if not embedding: return []` anywhere in `neon_recall.py`. The recall layer must accept `Optional[list[float]]` and run BM25/structured/ILIKE even when embedding is None. |
| `test_quality_gate_stream_aware.py` | Look for a cosine threshold being applied to merged chunks without checking `retrieval_streams`. The gate must only suppress vector-only chunks below the threshold. |
| `test_engine_no_embedding_gs11.py` | Chunks reached recall but didn't survive to the prompt. Most likely the quality gate or cross-vendor filter dropped them. Inspect `worker._last_neon_chunks` between recall and prompt-build. |
| `de-in-06-gs11-modbus` in deepeval | Either golden reference drifted (sometimes correct — update it), or the LLM judge thinks the reference answer no longer matches the context block (regression). |

## Extending coverage

Worked example — add a PowerFlex 525 case:

```python
# In mira-bots/benchmarks/deepeval_suite.py, INSTRUCTIONAL_CASES list:
DeepEvalCase(
    id="de-in-07-pf525-fault-codes",
    category="instructional",
    turns=[
        {"user": "What does fault code F004 mean on a PowerFlex 525?",
         "reference": "F004 is the UnderVoltage fault. The DC bus voltage dropped below the trip threshold (≈ 250V on a 480V drive)..."},
    ],
    context=[
        "PowerFlex 525 fault code F004: UnderVoltage — DC bus voltage below trip threshold.",
        "Common causes: input line voltage low, single-phase loss on 3-phase input, ...",
        "...",
    ],
),
```

Then run `/mira-test-bot-grounding` to confirm the new case is exercised + the existing GS11 case still passes.

Add CSV row to `tests/golden_gs11_conveyor.csv` only if you also want to drive it through the RAGAS pipeline (advisory until `evals/query_stub.py` live mode is fixed).

## What NOT to do (anti-patterns)

- **Don't** delete the BM25 stream "to simplify retrieval". It's the lexical safety net for embed-sidecar-down. Removal = Florida-demo-grade regression.
- **Don't** apply cosine thresholds to merged chunks without inspecting `retrieval_streams`. ts_rank_cd / hardcoded ILIKE / structured-fault scores are not cosine-comparable.
- **Don't** bypass the quality gate by injecting chunks straight into `_build_prompt_with_chunks` from outside `recall_knowledge`. The gate is the cross-vendor protection.
- **Don't** promote `golden_gs11_conveyor.csv` to a hard CI gate before fixing `evals/query_stub.py:108` (uses removed Anthropic) and the hardcoded `nomic-embed-text:latest` (not on VPS).
- **Don't** silence failures by lowering the deepeval pass-rate gate (currently 85%). If pass rate drops, fix the failure or update the golden, don't reduce the threshold.

## Cross-references

- Slash command — `.claude/commands/mira-test-bot-grounding.md`
- Reference doc — `wiki/references/bot-grounding-tests.md`
- Hot cache — `wiki/hot.md` 2026-05-19 entry
- Memory — `feedback_lock_in_chronic_ops_bugs.md`, `project_recall_embedding_gate.md`
- Complementary skill — `.claude/skills/kb-benchmark.md` (broader 100-MCQ exam — domain coverage, not grounding gate)
- Related command — `/mira-run-hallucination-audit` (static grep for risk patterns — complementary, not a substitute)

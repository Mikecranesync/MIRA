# /mira-test-bot-grounding

Run the full three-layer regression test surface for "does the bot ground answers in the KB, or fall back to generic industrial knowledge?" — installed 2026-05-18 after the GS11 demo failure when the Ollama embedding sidecar went down and PR #1382's BM25 fix turned out to be moot because the gate above it short-circuited everything.

## When to run

**Mandatory before pushing** when you touched any of:

- `mira-bots/shared/neon_recall.py` — recall layer (`recall_knowledge`, `_recall_bm25`, `kb_has_coverage`, `_merge_results`)
- `mira-bots/shared/workers/rag_worker.py` — embedder, retrieval gate, quality gate, prompt builder, the rerank stage
- `mira-bots/shared/engine.py` — anywhere `recall_knowledge` / `kb_has_coverage` / `kb_has_pair_coverage` is called
- `mira-bots/benchmarks/deepeval_suite.py` — golden reference answers used by the LLM judge
- `tests/golden_gs11_conveyor.csv` — the GS11 golden questions
- `mira-bots/shared/inference/router.py` — provider cascade (if a provider stops returning text the whole grounding gate looks like it failed)

Also run when you suspect the bot has started answering "I don't have specific information…" / "general industrial knowledge" / similar disclaimers for questions the KB should cover.

## What this command does

Runs the regression layers in order, each catching a different failure mode:

| Layer | File | What it would catch |
|---|---|---|
| DB | `mira-bots/tests/test_recall_no_embedding_fallthrough.py` | Recall gate re-introduced (embedding=None early-returns []). PR #1385 regression. |
| Gate | `tests/test_quality_gate_stream_aware.py` | Quality gate suppresses BM25/product chunks because cosine threshold reapplied. PR #1379 regression. |
| Engine | `mira-bots/tests/test_engine_no_embedding_gs11.py` | Anything between recall → quality-gate → prompt builder drops GS11 chunks even when retrieval succeeded. |
| Judge | `mira-bots/benchmarks/deepeval_suite.py` case `de-in-06-gs11-modbus` | Reference answer for the exact failing demo query lost its grounding signal. |

## Commands

```bash
# Layer 1-3: offline unit + engine tests (≈ 2 seconds, no network).
# Two invocations because `tests/` and `mira-bots/tests/` each define their
# own conftest.py with the same module name and pytest refuses to mix them.
PATH="/opt/homebrew/bin:$PATH" python3 -m pytest \
  mira-bots/tests/test_recall_no_embedding_fallthrough.py \
  mira-bots/tests/test_engine_no_embedding_gs11.py \
  -v

PATH="/opt/homebrew/bin:$PATH" python3 -m pytest \
  tests/test_quality_gate_stream_aware.py \
  -v

# Layer 4: LLM-judged benchmark including the GS11 case (needs GROQ_API_KEY)
GROQ_API_KEY=$(doppler secrets get GROQ_API_KEY -p factorylm -c prd --plain) \
  python3 mira-bots/benchmarks/deepeval_suite.py \
    --mode offline \
    --output /tmp/deepeval_results

# Inspect the GS11 case specifically
jq '.cases[]|select(.case_id=="de-in-06-gs11-modbus")' \
  /tmp/deepeval_results/results_*.json
```

## Interpretation

- **All four green** — bot grounding is intact. Safe to push.
- **Layer 1 red** — recall layer regressed. Look for an `if not embedding: return []` somewhere in `neon_recall.py`. Cross-reference [`memory/project_recall_embedding_gate.md`](../../.claude/projects/-Users-charlienode-MIRA/memory/project_recall_embedding_gate.md).
- **Layer 2 red** — quality gate started suppressing non-vector streams. Look for cosine threshold being applied to ts_rank_cd or ILIKE similarities. The exact fix is in `rag_worker.py` ~line 442; do not re-flatten that branch.
- **Layer 3 red** — chunks reached recall but never landed in the prompt. Most likely the quality gate at `rag_worker.py:451` or the cross-vendor filter at `rag_worker.py:480` dropped them; check `worker._last_neon_chunks` between recall and prompt-build.
- **Layer 4 red on GS11 case only** — the reference answer drifted (probably good), or the model started hallucinating a different register layout. Compare against `tests/golden_gs11_conveyor.csv` row 2.

## Cross-references

- Wiki — `wiki/references/bot-grounding-tests.md` (longer form)
- Skill — `.claude/skills/bot-grounding-tests/SKILL.md` (auto-loads on retrieval-layer edits)
- Hot cache — `wiki/hot.md` 2026-05-18 entry
- Related — `/mira-run-hallucination-audit` (static grep for risk patterns; complementary, not a substitute)
- Memory — `feedback_lock_in_chronic_ops_bugs.md`, `project_recall_embedding_gate.md`

## Extending coverage

To add a new equipment-specific grounding test:

1. Add a `DeepEvalCase` to the appropriate category list in `mira-bots/benchmarks/deepeval_suite.py` (see `de-in-06-gs11-modbus` as the template).
2. Optional: add a CSV row to `tests/golden_gs11_conveyor.csv` (or a new `tests/golden_<equipment>.csv` if it's a different model).
3. If the failure mode involves a *new* layer (not embedding-down → BM25), write an engine test mirroring `test_engine_no_embedding_gs11.py`.

Do NOT just bump golden CSVs without adding the deepeval case — the CSV isn't gated yet (`continue-on-error: true` in the workflow until `evals/query_stub.py` is fixed to use the Groq cascade).

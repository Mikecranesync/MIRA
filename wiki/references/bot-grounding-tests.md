# Bot grounding test surface

Reference for the three-layer regression net guarding "MIRA replies are grounded in the customer's KB, not generic industrial knowledge."

Installed 2026-05-18 after the GS11 demo failure. **Read this before touching `neon_recall.py`, `rag_worker.py`, or the engine retrieval path.** For execution, use the slash command `/mira-test-bot-grounding`.

## Why this exists

On 2026-05-18 Mike asked the Telegram bot "What parameters do I need to write the word to the GS11 drive?". Expected: bot cites AutomationDirect GS11 manual, registers 8192/8193/8194. Actual: "general industrial knowledge" disclaimer despite 83K+ KB rows including GS10/GS11 field guides.

Eight hours of debugging revealed a chain of three regressions, each masking the next:

1. `plainto_tsquery` AND-joined every query term in BM25 — fixed in **PR #1382**.
2. Quality gate applied a 0.70 cosine threshold to ts_rank_cd scores from BM25 — fixed in **PR #1379** (`rag_worker.py:451` introduces `retrieval_streams` tagging so the gate only suppresses vector-only chunks).
3. `recall_knowledge` early-returned `[]` whenever Ollama embedding was None — fixed in **PR #1385** (the whole hybrid retrieval was gated on a successful embed even though BM25 doesn't need one).

Each layer would have passed its own narrow unit test. The composite failure mode — embed down → BM25 still works → chunks survive gate → prompt is grounded — was tested nowhere. This document and the tests below close that gap.

## The three layers

| # | Layer | File | Pass criterion |
|---|---|---|---|
| 1 | DB / recall | `mira-bots/tests/test_recall_no_embedding_fallthrough.py` | `recall_knowledge(None, tenant, query)` returns non-empty when BM25 has hits |
| 2 | Quality gate | `tests/test_quality_gate_stream_aware.py` | Merged chunks carry `retrieval_streams`; gate only suppresses vector-only chunks below the cosine threshold |
| 3 | Engine | `mira-bots/tests/test_engine_no_embedding_gs11.py` | `RAGWorker.process()` with `_embed_ollama` mocked to None produces a prompt containing `8192` and sets `_last_no_kb = False` |
| 4 | LLM judge | `mira-bots/benchmarks/deepeval_suite.py` case `de-in-06-gs11-modbus` | Groq llama-3.3-70b-versatile judge gives the reference answer ≥ 0.85 across the 5 metrics |

Layers 1-3 run offline (~2 seconds total). Layer 4 needs `GROQ_API_KEY` (Doppler `factorylm/prd`).

## How they compose

```
user query
   │
   ▼
RAGWorker.process()                                  ← layer 3 (engine)
   │
   ├─ _embed_ollama() ──► None on VPS              (Bravo Tailscale dead)
   │
   ├─ neon_recall.recall_knowledge(None, …)         ← layer 1 (DB)
   │     ├─ vector stage SKIPPED  (has_embedding=False)
   │     ├─ structured fault code stage runs
   │     └─ BM25 stage runs ◄── lexical safety net
   │
   ├─ quality gate (rag_worker.py:451)               ← layer 2 (gate)
   │     ├─ retrieval_streams=["bm25"] → exempt from cosine threshold
   │     └─ chunks SURVIVE
   │
   ├─ cross-vendor filter (uns_context.manufacturer match)
   │
   ├─ build prompt with chunks → call LLM            ← layer 4 (judge)
   │
   ▼
grounded reply: "Write 18 to register 8192…"
```

Each layer's test mocks the layer below it. Together they cover the full chain.

## Running

One line:

```bash
/mira-test-bot-grounding
```

Or manually:

```bash
PATH="/opt/homebrew/bin:$PATH" python3 -m pytest \
  mira-bots/tests/test_recall_no_embedding_fallthrough.py \
  mira-bots/tests/test_engine_no_embedding_gs11.py \
  tests/test_quality_gate_stream_aware.py -v

GROQ_API_KEY=$(doppler secrets get GROQ_API_KEY -p factorylm -c prd --plain) \
  python3 mira-bots/benchmarks/deepeval_suite.py --mode offline
```

CI: `.github/workflows/deepeval-ci.yml` runs all four layers on every PR touching `mira-bots/**`, `evals/**`, or `tests/golden_*.csv`.

## Extending

### Add a new grounded-question case (single equipment, single question)

Append a `DeepEvalCase` to `mira-bots/benchmarks/deepeval_suite.py` in the right category list. Use `de-in-06-gs11-modbus` as the template — it has the canonical shape:

- `id`: `de-{category-prefix}-{NN}-{slug}`
- `turns`: list of `{"user": ..., "reference": ...}` dicts
- `context`: list of 2-4 chunk-shaped strings (what the judge expects the bot to have retrieved)

That gates layer 4 automatically. Run `/mira-test-bot-grounding` locally before pushing.

### Add a new failure mode (not embedding-down → BM25)

Write a sibling test to `test_engine_no_embedding_gs11.py`. Reuse `_make_worker()` and the patching pattern; change what's mocked.

If the failure mode is at the recall layer (different stream), extend `test_recall_no_embedding_fallthrough.py` instead.

### Add a new piece of equipment

1. Add 3-5 golden CSV rows to `tests/golden_gs11_conveyor.csv` (or a new `tests/golden_<equipment>.csv`).
2. Add one representative case to `deepeval_suite.py` so layer 4 has a real gate.
3. Optional: add an engine test if the equipment has a distinctive failure mode.

## What NOT to do

- **Do not delete the BM25 stream "to simplify retrieval"** — it's the lexical safety net for when the embedding sidecar is unreachable. Production VPS depends on this. Deletion = full Florida-demo regression.
- **Do not apply a cosine threshold to merged chunks without checking `retrieval_streams`.** ts_rank_cd / hardcoded ILIKE / structured-fault similarities are not cosine-comparable. PR #1379 fixed this; resist re-flattening.
- **Do not bypass the quality gate by passing `chunks` directly to `_build_prompt_with_chunks`** when the chunks came from somewhere other than `recall_knowledge`. The gate is the only thing protecting the prompt from spurious cross-vendor matches.
- **Do not promote `golden_gs11_conveyor.csv` to a hard CI gate** until `evals/query_stub.py:108` is migrated off Anthropic (removed PR #610) and the hardcoded `nomic-embed-text:latest` (not present on VPS localhost). Until then it's advisory only.

## Cross-references

- Slash command: `.claude/commands/mira-test-bot-grounding.md`
- Skill (auto-loads on retrieval edits): `.claude/skills/bot-grounding-tests/SKILL.md`
- Memory: `project_recall_embedding_gate.md`, `feedback_lock_in_chronic_ops_bugs.md`
- Related: `wiki/references/dev-loop.md`, `.claude/skills/kb-benchmark.md` (broader 100-MCQ exam)
- Spec layer: `docs/specs/uns-message-resolver-spec.md`, `docs/specs/maintenance-namespace-builder-spec.md`

## Open follow-ups

- **Fix `evals/query_stub.py` live mode** — replace Anthropic call with `InferenceRouter` Groq-first cascade; replace hardcoded `nomic-embed-text` with the same VPS embed-fallback ladder. Once done, lift `continue-on-error: true` from the RAGAS step in `deepeval-ci.yml`.
- **Add nightly Routine** — run `python evals/run_eval.py --use-ragas --use-deepeval --csv tests/golden_gs11_conveyor.csv --live` against the VPS bot path at 03:00 UTC; open a GitHub issue if RAGAS Faithfulness < 0.85 on any case.
- **Ops fix** — restore Bravo Tailscale route from VPS, or pull a real embed model (`nomic-embed-text`) onto VPS localhost Ollama so the fallback candidate is meaningful (currently localhost has only `qwen2.5vl:7b` vision).
- **Extend to non-GS11 equipment** — PowerFlex 525, Yaskawa GA500, Siemens 3RT2 are next priorities based on customer onboarding pipeline.

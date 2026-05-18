# MIRA Conversation Testing Suite

Engine-direct, adapter-agnostic test harness for MIRA's diagnostic bot.
Spec: `docs/specs/mira-conversation-testing-spec.md`.

## TL;DR

```bash
# Fast deterministic run (mock LLM, no API quota, ~5s)
python -m tests.conversation_suite.harness --mode=mock --report=md

# Full live run against Groq cascade (~3 min, needs Doppler)
doppler run -p factorylm -c prd -- \
  python -m tests.conversation_suite.harness --mode=live --report=html

# Single fixture
python -m tests.conversation_suite.harness --mode=mock --filter=id:gs10_wiring_01 -v

# Just one category
python -m tests.conversation_suite.harness --mode=mock --filter=category:safety
```

Pytest entry points:

```bash
pytest tests/conversation_suite/test_smoke.py            # 3 fastest cases
pytest tests/conversation_suite/ -m "not live"           # full mock suite
pytest tests/conversation_suite/ -m "live"               # full live suite

# Demo-May21 quality benchmark (10 questions, real Groq, opt-in via env)
RUN_LIVE_BENCHMARK=1 doppler run -p factorylm -c prd -- \
  pytest tests/conversation_suite/test_demo_benchmark.py -m live_benchmark -v
```

## Demo-May21 Benchmark

The `demo_may21` fixture set + `tools/answer_quality_benchmark.py` implement
the May 21 demo quality gate (spec: `docs/specs/mira-answer-quality-standard.md`).

```bash
# Run the benchmark directly (writes report to docs/benchmarks/)
doppler run -p factorylm -c prd -- \
  python tools/answer_quality_benchmark.py --filter tag:demo_may21
```

Pass bar: suite-wide average of 5 Likert dimensions ≥ 3.5, 0 safety
violations. Per-fixture variance is significant (~0.5–1.5 points at
temperature 0.2); aggregate is the trustworthy signal.

## Layout

```
tests/conversation_suite/
├── harness.py         # CLI entry point
├── runner.py          # async loop — drives Supervisor.process()
├── evaluator.py       # checkpoint definitions (extends tests/eval/grader.py)
├── report.py          # markdown + HTML output
├── mock_router.py     # FakeInferenceRouter, FakeRAGWorker
├── conftest.py        # pytest fixtures
├── test_smoke.py      # 3-case smoke for pre-commit
└── fixtures/
    ├── cases/<category>/NN_*.yaml      # one fixture per file
    ├── kb_chunks/<topic>.json          # canned KB chunks for mock RAG
    └── mock_responses/<topic>.yaml     # canned LLM replies for mock router
```

## Adding a fixture

Copy any `tests/conversation_suite/fixtures/cases/<category>/NN_*.yaml`, edit the
`turns` and ground-truth fields, save with a new `id`. It runs automatically.

Required fields:

```yaml
id: gs10_wiring_01
category: grounded_troubleshooting
description: "..."
expected_keywords: [...]
turns:
  - role: user
    content: "..."
```

Optional fields (see spec §6.1 for full schema):

- `expected_final_state` — FSM state at end of last turn
- `asset_required` — string that must land in `state["asset_identified"]`
- `citation_required: true` — technical reply must have `[Source:]` tag
- `hard_fail_on: [plc_write_approved, safety_violation]`
- `mock_kb_chunks: garage/gs10_modbus` — which canned chunks to feed RAG
- `mock_responses: garage/wiring_question` — which canned replies to use

## Two modes

| | mock | live |
|---|---|---|
| LLM | `FakeInferenceRouter` returns canned replies | Real `InferenceRouter` → Groq → Cerebras → Gemini |
| RAG | `FakeRAGWorker` returns canned chunks | Real `RAGWorker` → Open WebUI test collection |
| Speed | ~0.1s/turn | ~3-8s/turn |
| Cost | Free | Burns Groq quota |
| Use | Pre-commit, CI mock gate | PR live gate, nightly |

## Relationship to `tests/eval/`

`tests/eval/` hits **mira-pipeline over HTTP** for VPS smoke + nightly LLM-judge.
This suite hits `Supervisor.process()` **in-process** and adds categories
(`uns_gate`, `safety`, `adapter_parity`) that the existing fixtures don't cover.

We **reuse**:
- Fixture YAML schema (with optional new fields)
- `tests/eval/grader.py` checkpoints (imported, not reimplemented)
- `tests/eval/judge.py` for live-mode Likert scoring

We **add**:
- Engine-direct call path (no docker, no pipeline)
- Mock mode (deterministic, no quota)
- Garage-specific fixtures (Micro820 + GS10)
- New checkpoints: `cp_asset_confirmed`, `cp_hard_fail_safety`, `cp_adapter_parity`

## Output

- Markdown report: `runs/YYYY-MM-DDTHHMM-<mode>.md`
- HTML report: `runs/YYYY-MM-DDTHHMM-<mode>.html`
- JSONL (for active-learning ingester): `runs/YYYY-MM-DDTHHMM-<mode>.jsonl`

The JSONL schema matches `tests/eval/runs/*.jsonl` so
`tests/eval/learning_ingester_tasks.py` can consume both suites.

## What "100% pass" in mock mode actually means

Mock mode pass rate measures **wiring correctness, not engine quality**.
The canned LLM replies are authored alongside the fixture's
`expected_keywords` — it's a closed loop that proves the harness executes
end-to-end and the engine plumbing (FSM, state, citation gate, safety
guardrail) integrates with our fakes.

Two exceptions where mock mode does measure real engine behavior:

- **Safety category** — engine's `guardrails.py` matches safety phrases and
  returns its own canned reply *before* the fake router is ever called.
  Those scenarios test the engine's safety classifier, not our mock.
- **UNS gate clarification** — engine's intent router + `dialogue_state`
  drive whether asset confirmation is required. The fake router only
  supplies the clarifying reply; the gating decision is real engine logic.

For genuine quality scoring, run `--mode=live` against the Groq cascade.

## Deferred to follow-up PR (phase 4)

- **Live-mode LLM judge.** Spec §5.1 commits to reusing `tests/eval/judge.py`
  for the 5 Likert dimensions in live mode. Not wired in this PR. The
  evaluator returns binary checkpoints only; judge scores land when live
  mode does.
- **Active-learning auto-ingest.** JSONL schema is parity-compatible with
  `tests/eval/runs/*.jsonl` but the Celery ingester is not yet pointed at
  `tests/conversation_suite/runs/`.

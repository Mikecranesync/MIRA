# Evaluation tooling: runoff (v0.1)

Rule: prefer what the repo already has, then the smallest stack. Nothing new was added to any repo dependency
file. The one third-party check (`ir_measures`) runs in a throwaway `uv run --with` environment.

## Already in the repo

- **#4589 harness** (`retrieval_rank.ts`, `scorecard.py`, `independent_recompute.py`): reused, pinned at
  `c095b54c1`.
- **RAGAS and DeepEval:** `evals/requirements.txt`. Their judge metrics call an LLM.
- **5-regime eval and the golden CSVs:** `tests/eval/`, `tests/golden_*.csv`.
- **Agent trace:** `mira-bots/shared/agent_trace.py`.
- **Decision record:** `docs/observability/mira-agent-eval-audit.md` (2026-06-11) keeps RAGAS/DeepEval, skips
  LangSmith, and makes Phoenix optional.

## Candidates

| Tool | License | Maintained | Fit for IMIB | Determinism / transparency | Cost | Decision |
|---|---|---|---|---|---|---|
| **BEIR** (metric methodology; pytrec_eval backend) | Apache-2.0 | yes | Retrieval metrics are exactly BEIR's (Success@k, RR, nDCG). The datasets aren't relevant. | Fully deterministic | $0 | **Use the method.** Metrics are cross-checked with `ir_measures` / pytrec_eval: 0 mismatches on 8 arm/depth combinations. No runtime dependency. |
| **Ragas** | Apache-2.0 | yes | Faithfulness and context precision for the future `grounded_answer` capability | Judge-model scores are nondeterministic and opaque | metered tokens | **Defer** until answers are generated. If used, only as a secondary signal beside deterministic fact and citation checks, never as ground truth. Already in the repo. |
| **DeepEval** | Apache-2.0 | yes | CI regression assertions | Same judge caveat; deterministic metrics are thin | metered for G-Eval | **Keep existing usage.** No benefit over pytest for deterministic retrieval scoring. |
| **Inspect AI** (UK AISI) | MIT | yes | The best fit for the planned **interactive diagnostic simulations** (multi-turn, tool use, sandboxed tools, logged transcripts) | Solvers and scorers are explicit code; full eval logs | free framework; model calls metered | **Adopt in Phase C, for simulations only.** Pilot one simulation before committing. Overlaps nothing in the repo. |
| **NIST AI RMF** (+ Generative AI Profile) | public guidance | yes | Risk framing for the safety capability; TEVV (test, evaluation, verification and validation) practice | n/a | $0 | **Use as the checklist** for the validation roadmap (Measure 2.x: validity, reliability, safety, documented limits). |
| **LangSmith** | proprietary SaaS | yes | Tracing | n/a | paid; SaaS | **Skip.** The existing traces are adequate, and the 2026-06-11 decision stands. |

**Net:** v0.1 needs no new framework. Phase C adds at most one (Inspect AI), and only for simulations.

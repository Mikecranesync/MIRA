# Eval truth baseline — 2026-09-19 (BRAVO-A)

First honest offline-eval baseline since the eval-fixer nights.

- **Result:** 54/65 (83%) PASS
- **Engine SHA:** main `90437a30a` (ran from BRAVO pin-branch worktree; requirements/tests-only pin does not touch the engine — engine code == main)
- **Python:** 3.12.13 (prod-matching, `python:3.12.13-slim`)
- **pydantic:** 2.11.10 (`<2.12`)
- **Command:** `doppler run --project factorylm --config stg -- env MIRA_PROCESS_TIMEOUT=90 python tests/eval/offline_run.py --suite text`
- **Judge:** disabled · **Runtime:** 1664s
- **Scorecard:** `tests/eval/runs/2026-09-19T2129-offline-text.md`

## Why the earlier 18/65 was env-skewed (not a regression)
An earlier run reported 18/65. That run used BRAVO's **system Python 3.14 + pydantic 2.12.5**. pydantic ≥2.12 breaks the RAG worker's runtime structured-output model build (`unable to infer type for attribute "description"`, surfaced at `engine.py:5686`), so nearly every grounded fixture fell through (`GENERAL_QUESTION_RAG_FAILURE`). It was a **dependency-version artifact, not an engine regression**. Pinning `pydantic<2.12` (PR #3869, merged `90437a30a`) + running on py3.12 restores the RAG worker → 54/65. Run evals on py3.12 + pydantic <2.12.

## 11 failing fixtures (diagnostic-quality, engine-lane)
Mostly KeyKW / FSM misses, not infra:
`gs10_overcurrent_01`, `gs20_cross_vendor_03`, `gs3_ground_fault_14`, `pf520_hw_overcurrent_17`, `pf523_heatsink_18`, `pf527_phase_loss_20`, `yaskawa_a1000_ov_23`, `self_critique_low_groundedness_34`, `topic_switch_gs10_to_pf525_22`, `symptom_switch_after_fault_lookup_25`, `vfd_siemens_04_v20_startup`

## Two infra flags (engine-lane follow-up, non-fatal — both fall back)
1. **Nemotron rewrite endpoint dead:** `NEMOTRON_REWRITE_FALLBACK` — `https://integrate.api.nvidia.com/v1/chat/completions` returns **410 Gone** (query-rewrite retry at `engine.py:5783` → `NemotronClient.rewrite_query`, base URL `nemotron.py:19`). Falls back to the un-rewritten query; the rewrite step is effectively offline.
2. **REASONING_BURN token caps:** groq `openai/gpt-oss-120b` hitting output caps (2048/256), retrying once at `max_tokens=8192`.

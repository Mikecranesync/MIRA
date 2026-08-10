# TRH v2 campaign report — `trh-bootstrap`

**Generated:** 2026-08-09 22:06

## 1. Overall

- turns graded: **3**
- ✅ pass: **1**
- ❌ fail: **2**
- · undecided (no layer could be judged): **0**

> A pass is not a proof of correctness — a defect can survive by hiding from every guard at once (c6/c7). Undecided turns say nothing about MIRA; they say the run lacked telemetry or an oracle.

## 2. Failures by root cause

| class | failures | subsystem to repair |
|---|---|---|
| **RETRIEVAL** | 1 | mira-bots/shared/neon_recall.py — streams, ranking and fusion. Measure the verbatim-quote cosine ceiling BEFORE attempting a query-side fix. |
| **INGEST** | 1 | mira-crawler/ingest/ + the corpus itself — source and ingest the missing document, and fix model_number tagging. NOT a retrieval change. |

## 3. Stage-by-stage grades

| stage | ✅ pass | ❌ fail | · inconclusive | – not observed |
|---|---|---|---|---|
| **INGEST** | 2 | 1 | 0 | 0 |
| **SCOPE** | 3 | 0 | 0 | 0 |
| **DIALOGUE** | 3 | 0 | 0 | 0 |
| **RETRIEVAL** | 0 | 2 | 0 | 1 |
| **EVIDENCE** | 0 | 0 | 2 | 1 |
| **GENERATION** | 0 | 0 | 3 | 0 |
| **GROUNDING** | 2 | 1 | 0 | 0 |
| **POLICY** | 0 | 0 | 3 | 0 |

## 4. Ingest coverage problems

**These are NOT retrieval defects.** The content is absent from the corpus for that vendor; no ranking change can surface it.

- `reset_procedure_gs10` turn 0 — missing: ['clear the fault by one of these methods']

## 5. Retrieval misses and expected-evidence ranks

| conv | turn | expected found at | missing | wrong-sense hits |
|---|---|---|---|---|
| `reset_procedure` | 1 | — | 3 | [0, 1, 2] |

> Before proposing a query-side fix, measure the **verbatim-quote cosine ceiling**: embed a query that quotes the target chunk and rank it. If that ceiling is itself poor, the chunk is semantically far and no rewrite can reach it (measured for PF525: ceiling rank 5, realistic queries rank 119+).

## 6. Unsupported / hallucinated claims

_None detected as a PRIMARY cause._

> A fabricated specific downstream of a retrieval miss is classified RETRIEVAL, not GROUNDING — fixing the guard there suppresses correct answers (measured 1 TP / 2 FP, #3168).

## 7. Dialogue failures

_None detected._

## 8. Mutation-test status

| mutation | protects | status |
|---|---|---|
| `model_scope_dropped` | the fault-clear stream is scoped to the resolved model | **STALE** |
| `fault_clear_intent_gate_removed` | the fault-clear stream fires only on a fault-clear question | **STALE** |
| `competing_reset_object_suppression_removed` | 'reset to factory defaults' does NOT arm the fault-clear stream | **STALE** |
| `fault_clear_never_injected` | retrieved fault-clear rows actually reach the result set | **STALE** |
| `ingest_scope_dropped` | INGEST coverage is checked WITHIN the oracle's vendor scope | **SKIPPED** |
| `upstream_first_precedence_reversed` | the root cause is the UPSTREAM failing layer, not the loudest symptom | **PROVEN** |
| `not_observed_folded_into_pass` | missing telemetry is never reported as a pass | **PROVEN** |
| `policy_override_removed` | a safety failure outranks every other layer | **PROVEN** |

**3/8 protections proven to have teeth.**

⏳ Not applicable on this branch (target code is unmerged):
- `model_scope_dropped` — needs PR #3176 (fix/retrieval-reset-sense)
- `fault_clear_intent_gate_removed` — needs PR #3176 (fix/retrieval-reset-sense)
- `competing_reset_object_suppression_removed` — needs PR #3176 (fix/retrieval-reset-sense)
- `fault_clear_never_injected` — needs PR #3176 (fix/retrieval-reset-sense)

⚠️ SKIPPED (dirty working tree — commit first, then re-run):
- `ingest_scope_dropped`: tests/regime1_telethon/campaign/trh/oracles.py

## 9. Recommended subsystem to repair

### → RETRIEVAL (1 failure(s))

**mira-bots/shared/neon_recall.py — streams, ranking and fusion. Measure the verbatim-quote cosine ceiling BEFORE attempting a query-side fix.**

Worked example from this run:

> RETRIEVAL failed: none of the 3 expected passage(s) entered the 3 retrieved chunk(s). Instead the top of the list holds known WRONG-SENSE content (rank 0: 'position reset — a different sense; ranks 0 today').. Evidence — missing: ['clear the fault by one of these methods', 'Press Stop if P045', 'Resets a fault and clears the fault queue']; wrong-sense content at ranks [0, 1, 2] ('Home Reset'). GROUNDING also failed, but downstream of RETRIEVAL — expect them to clear once RETRIEVAL is repaired, and do not fix them separately. (This is the #3165 shape: the fabricated parameter was GROUNDING's symptom of a RETRIEVAL cause.)

Then, in order: INGEST (1).

## Coverage limits (read before trusting the numbers above)

- built from 2 captured fixture(s), not a live run

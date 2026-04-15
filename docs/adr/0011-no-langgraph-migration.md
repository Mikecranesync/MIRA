# ADR-0011: No LangGraph Migration — Self-Critique via Hand-Rolled Judge Subroutine

## Status
Accepted

**Related:** Issue #284 (DIAGNOSIS_SELF_CRITIQUE implementation), ADR-0010 (Karpathy eval alignment / LLM-as-judge).

---

## Context

A framework comparison write-up was forwarded in April 2026 positioning LangGraph as the
natural next step for MIRA's agentic loop. The write-up cited AutoGen's "constant nudging"
pattern (a proxy agent forwards quality failures back as feedback, forcing the main agent to
iterate) as a capability gap in MIRA's current architecture.

Two factual corrections were required before the decision could be made:

**1. LangGraph is not in the MIRA stack.**
The write-up described LangGraph primitives as things MIRA "would gain." MIRA uses a
hand-rolled FSM (`engine.py` / `Supervisor` class) with explicit state transitions persisted
to SQLite per `chat_id`. LangGraph is not imported anywhere in the codebase. A migration
would be a from-scratch rewrite of the orchestration layer, not an incremental addition.

**2. Four self-correcting loops already ship today.**

| Loop | Location | When it fires |
|------|----------|---------------|
| Multi-provider LLM cascade | `inference/router.py` | Provider failure or timeout |
| Crawl route fallback | `mira-ingest/route_fallback.py` + `crawl_routes.yaml` | `LOW_QUALITY` / `SHELL_ONLY` / `EMPTY` crawl outcomes |
| Active-learning loop | `mira-bots/tools/active_learner.py` | Nightly scan of 👎 feedback → draft eval fixtures |
| Fix-proposal retry | `workers/rag_worker.py` | Low-confidence fix step |

MIRA already implements the AutoGen nudging pattern in four concrete domains. The question
was never "do we adopt the pattern" but "do we adopt the framework."

---

## Decision

**No LangGraph migration. No framework adoption.**

Instead, extend the existing self-correcting pattern with a fifth instance:
**`DIAGNOSIS_SELF_CRITIQUE`** — a post-diagnosis quality gate that calls the existing
LLM-as-judge module (shipped in v2.6.0 / #217) and loops back into the FSM if quality
falls below threshold. This is issue #284.

---

## Rationale

| Criterion | LangGraph migration | Self-critique via judge |
|-----------|--------------------|-----------------------|
| Scope | Full orchestration rewrite | ~200 lines in `engine.py` |
| Risk to existing 33+ eval fixtures | High (rewrite FSM transitions) | Isolated; existing fixtures unchanged |
| New capability gained | Graph-level parallelism, branching | AutoGen nudging pattern, same result |
| Aligns with Hard Constraint #3 | ✗ LangGraph abstracts Claude API | ✓ direct judge call via Groq/Anthropic API |
| Config 1 MVP timeline | Blocks | Unblocks |
| Revisit point | Applicable at multi-agent scale (Config 4+) | — |

Hard Constraint #3 (CLAUDE.md) prohibits frameworks that abstract the Claude API call.
LangGraph's executor wraps LLM calls inside graph nodes — this directly violates the
constraint without a formal constraint revision.

The judge module (`tests/eval/judge.py`) already implements cross-model Likert scoring with
four dimensions (groundedness, helpfulness, tone, instruction_following). Reusing it
inside the engine as a runtime quality gate requires no new API contracts.

---

## Self-Critique Implementation (issue #284)

The fifth self-correcting loop will work as follows:

```
DIAGNOSIS response generated
    → _self_critique_diagnosis(response, context) → 4-dim scores
    → any dim < 3?
        yes → DIAGNOSIS_REVISION (cap: 2 attempts)
              groundedness < 3 → clarifying question → Q1/Q2
              helpfulness/instruction < 3 → regenerate with critique prefix
        no  → return response as-is (normal path, ~0 overhead for good responses)
```

Log event: `SELF_CRITIQUE_TRIGGERED dim=X score=Y attempt=N`

New eval fixtures: `34_self_critique_low_groundedness.yaml`,
`35_self_critique_low_instruction.yaml`, plus the 2026-04-14 distribution-block
forensic as a third fixture (`36_distribution_block_forensic.yaml`).

---

## Consequences

**Positive:**
- AutoGen nudging pattern delivered without framework migration risk.
- Zero new dependencies.
- Judge module gets a second consumer, validating its reusability.
- Existing eval fixtures continue unchanged.

**Negative / risks:**
- Judge call adds ~500–1500 ms latency on `DIAGNOSIS` responses (mitigated: only fires
  when ALL providers return a response; fires async on the judge-to-provider cascade
  away from the response provider per ADR-0010 routing rules).
- Judge models can themselves be wrong. Cap at 2 revision attempts; never loop infinitely.

**Deferred:**
- Multi-agent parallelism (e.g., simultaneous PLC + documentation agent) — remains a
  Config 4 item. LangGraph remains a candidate framework at that point, pending a
  Constraint #3 revision.

---

## References

- Issue #284 — DIAGNOSIS_SELF_CRITIQUE implementation
- ADR-0010 — LLM-as-judge (v2.6.0 / #217), cross-model routing
- ADR-0009 — Crawl route fallback (v2.5.1 / #211)
- `tests/eval/judge.py` — judge module (4 Likert dimensions)
- `mira-bots/shared/engine.py` — hand-rolled FSM (`Supervisor` class)
- CLAUDE.md Hard Constraint #3: no frameworks that abstract the Claude API call

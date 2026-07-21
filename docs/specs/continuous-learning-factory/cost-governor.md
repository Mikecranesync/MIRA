# CLF Cost Governor (budget fails safe)

Policy for ADR-0030 principle 7. PR 0 defines the **policy**; the enforcing runtime lands in PR 6. No code here.

## The one rule

> **Budget exhaustion PAUSES or DEFERS work. It never silently switches to an unapproved model, and it never exceeds the budget.**

This mirrors the spend law already in force for this project (`feedback_paid_inference_validation_only`): metered inference is a **budget-declared** act, never an ambient background cost. The governor makes that law mechanical for the continuous loop.

## Budgets

Budgets are declared, not discovered, at three scopes. The **most restrictive** wins.

| Scope | Example | Exhaustion behavior |
|---|---|---|
| per-run | one interpret ≤ declared `max_cost_usd` | drop the single unit to `queued`, log, continue others |
| per-cycle | one scheduler tick ≤ cycle budget | stop admitting new units this cycle; finish in-flight |
| per-day / per-source | daily cap; per-`document_lineage_key` cap | pause the loop / skip that source until the window resets |

A unit is admitted to `queued` (state machine) **only if** its estimated cost fits every applicable budget. Estimation is conservative — unknown cost is treated as the ceiling, not zero (fail closed, same posture as rights).

## Deterministic-first

The governor always prefers the **$0 deterministic path** before spending:

1. **Recall hit is free.** If `materialized_evidence` / `print_recall` already holds a result for this `work_key`, return it — no interpret. The merged recall gate is the primary cost lever.
2. **Deterministic grade is free.** `printsense/grade_case.py` runs with no model call; it owns the import verdict regardless of budget.
3. **Only then** does an interpret consume budget, and only if admitted.

So a tightened budget degrades *coverage of new work*, never the correctness of the deterministic layer.

## Provider fallback preserves capability + independence metadata

When the primary provider is unavailable (the real, recurring case — both paid lanes were credit-exhausted on 2026-07-19, and only `MiniMaxAI/MiniMax-M3` was serverless on Together), fallback is allowed **only** to a provider/model on the **approved list**, and the fallback is **recorded**:

- The resulting `eval-result.v1` records the *actual* `interpreter.provider`/`interpreter.model`.
- The `judge-independence.v1` `independence_class` is recomputed for the pair that actually ran. If interpreter and judge collapse to the same model (the MiniMax-M3 reality), the class is `SELF_CONSISTENCY_ONLY` and `gold_eligible=false` — the loop keeps producing candidates, but none auto-promote. Capability is preserved; **the independence downgrade is never hidden.**
- Fallback to an **unapproved** model is forbidden. If no approved provider is available within budget, the unit **pauses** (`queued`), it does not run on a wildcard model.

## What the governor must never do

- ❌ Exceed a declared budget to "finish the batch".
- ❌ Switch to a cheaper unapproved model to stay under budget.
- ❌ Re-interpret an input that already has a recall hit.
- ❌ Treat unknown per-call cost as $0 (must treat as the ceiling).
- ❌ Silently drop a paused unit — a pause is logged and resumable, an `error` needs an operator.

## Observability

Every spend decision emits: `work_key`, estimated vs actual cost, budget scope that gated it, provider chosen, and resulting independence class. This is the audit trail that proves the loop honored the declared budget — evidence before assertion.

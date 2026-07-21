# PrintSense Continuous Learning Factory — specs (PR 0)

**Status:** Proposed. PR 0 is **docs/schema-only** — contracts + policies, no runtime, **no production behavior change** (ADR-0030 § "Production behavior change").
**Decision record:** [`docs/adr/0030-continuous-learning-factory.md`](../../adr/0030-continuous-learning-factory.md).
**Date:** 2026-07-21 (`main` @ `1feaf906e`, v3.184.1).

This directory holds the **contracts every later PR must honor**: seven versioned JSON Schemas, worked examples grounded in the AN-GS-021 case, and six policy documents. It contains no executable runtime — the only code PR 0 adds is one offline schema-validation test (`tests/continuous_learning/test_clf_schemas.py`).

## What the Continuous Learning Factory is

A loop that turns electrical prints into durable assets, and lowers inference cost over time without ever letting a model silently train on its own guesses:

```
corpus source (rights-cleared)
   → page render (resumable, per-page)
      → evaluation run (interpreter + deterministic grade + judge)
         → human correction (immutable, region-linked)
            → gold record (approved, full lineage, leakage-partitioned)
               → deterministic rule candidate (mined from ≥3 lineages)
                  → frozen regression + rights-cleared training export
```

Each arrow is gated. Nothing advances on provenance alone; **evidence status is separate from approval status** (ADR principle 5).

## Reconciled scope — reuse map (ADR principle: don't fork what exists)

Recon found **~70% already exists or is in flight.** CLF is **two layers**: reuse/finish the CORE, build only the net-new FLYWHEEL. Do **not** introduce parallel region, evidence, grading, or approval abstractions.

| Concern | Canonical owner (reuse) | CLF action |
|---|---|---|
| Evaluation execution | `tools/internet_print_test/runner.py` | reuse + finish (gold-std PR4) |
| Deterministic grading / import verdict | `printsense/grade_case.py` (`grade_case()`) | reuse + extend with mined validators |
| Model judging | `tools/internet_print_test/judge.py` (`judge()`) | reuse + add independence class |
| Visual regions / bounding boxes | **`factorylm.visual-region.v1`** (`mira-bots/shared/visual/`, #2843/#2846) | **reference only — never redefine geometry** |
| Evidence + content addressing | `printsense/cas.py` + `materialized_evidence/` (registry, resolver, recall) | reuse |
| Recall gate (prod print path) | `mira-bots/shared/print_recall.py` (merged v3.184.1) | reuse — already the cost-saving seam |
| Typed approvals | `ai_suggestions` / `relationship_proposals` (mira-hub, ADR-0017) | reuse + add two typed classes |
| Corpus + source rights | **NEW: corpus registry** | net-new (PR 1) |
| Scheduling + budgets | **NEW: scheduler** on MIRA Routines / Celery | net-new (PR 6) |
| Gold + frozen benchmarks | **NEW: gold manager + leakage guard** | net-new (PR 7) |
| Rule mining | **NEW: rule miner** | net-new (PR 8) |
| Training exports | **NEW: training exporter** | net-new (PR 9) |

## Schemas (this PR)

All are draft-2020-12, `additionalProperties` controlled, and pin instance identity with a `schema` const equal to their `$id`.

| Schema | Purpose |
|---|---|
| [`corpus-source.v1`](schemas/corpus-source.v1.schema.json) | Registered source + **fail-closed rights** manifest; carries the `document_lineage_key` split key. |
| [`page-render.v1`](schemas/page-render.v1.schema.json) | Page identity (distinct from document identity); resumable per-page ingest. |
| [`judge-independence.v1`](schemas/judge-independence.v1.schema.json) | Controlled independence enum; `gold_eligible` is derived, not asserted. |
| [`eval-result.v1`](schemas/eval-result.v1.schema.json) | One run of one page; **superset** of the current runner output; separate status fields. |
| [`correction-event.v1`](schemas/correction-event.v1.schema.json) | Immutable, append-only human review action; regions by `region_ref`. |
| [`gold-record.v1`](schemas/gold-record.v1.schema.json) | Approved gold example; full backward lineage; leakage-partitioned split. |
| [`rule-candidate.v1`](schemas/rule-candidate.v1.schema.json) | Deterministic rule mined from ≥3 lineages; separately-typed proposal class. |

Examples in [`examples/`](examples/) are grounded in the AN-GS-021 GS-series VFD control-terminal sheet (the internet-print case scored 82/100 by a `SELF_CONSISTENCY_ONLY` judge, with three flagged "sketchy areas" that appear here as `error_labels`). Every example validates against its schema (enforced by the test).

## Policies (this PR)

| Policy | What it fixes |
|---|---|
| [`state-machine.md`](state-machine.md) | Idempotent, replayable transitions; stale-input invalidation. |
| [`cost-governor.md`](cost-governor.md) | Budget fails safe — pauses, never silently downgrades the model. |
| [`promotion-policy.md`](promotion-policy.md) | Which independence class may promote to gold; typed proposals. |
| [`data-rights-and-leakage.md`](data-rights-and-leakage.md) | Rights fail closed; document-level leakage partitioning. |
| [`threat-privacy.md`](threat-privacy.md) | Threat model, tenant isolation, PII, poisoning, self-training. |

## PR ladder

PR 0 (this) → 1 corpus registry → 2 finish gold-std PR4 + commit Together judge + independence field → 3 extend `grade_case` validators + freeze AN-GS-021 p4 regression → 4 judge independence + disagreement engine → 5 review queue on `visual-region.v1` → 6 scheduler + budgets (staging-first) → 7 gold + frozen benchmarks + leakage guard → 8 rule miner → 9 training export → 10 first narrow LoRA. **Merge nothing without explicit approval.**

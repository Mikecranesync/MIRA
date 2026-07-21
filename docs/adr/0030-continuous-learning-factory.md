# ADR 0030 — PrintSense Continuous Learning Factory (reconciled scope)

**Status:** Proposed (PR 0 — ADR + schemas only; **no production behavior change**)
**Date:** 2026-07-21
**Supersedes:** nothing. **Extends:** the existing print-eval program (`docs/plans/2026-07-13-print-eval-gold-standard.md`), the Materialized Evidence layer (ADR-0029), and the Visual Focus Workspace region contract (`factorylm.visual-region.v1`, PRs #2843/#2846).
**Deciders:** Mike (owner).

Full specs: [`docs/specs/continuous-learning-factory/`](../specs/continuous-learning-factory/README.md).

**First delivery surface:** [Print of the Day](../specs/continuous-learning-factory/surfaces/print-of-day.md) — a private daily email learning flywheel on top of the factory (reconciled 2026-07-21; docs-only, no production behavior change). It reuses the CORE + FLYWHEEL and adds only a daily selector, an email package, a YouTube script generator, the `factorylm.print-of-day.v1` case manifest, a per-case review lifecycle, and a public-video clearance. See § "Delivery surfaces".

---

## Context

We want PrintSense to continuously turn electrical prints into (1) reproducible evaluation cases, (2) reviewed corrections, (3) deterministic rules + materialized evidence, (4) frozen regression tests, and (5) rights-cleared, task-specific training datasets — while lowering inference cost over time and never letting a model silently train on its own guesses.

Reconnaissance (2026-07-21, `main` @ `1feaf906e`, v3.184.1) found **~70% of the requested program already exists or is in flight** across the print-eval gold-standard program, `printsense/grade_case.py`, the internet-print runner/judge, the Materialized Evidence layer, and open PRs (#2843/#2846 region contract, #2709 corpus/promotion, #2665 test-harness, #2856 generalization/safety). Building a fresh parallel program would duplicate and collide with in-flight work.

## Decision

Build the continuous-learning system as **two layers**, and **do not introduce parallel region, evidence, grading, or approval abstractions**:

1. **CORE — reuse / finish / extend** the existing components (canonical owners below).
2. **FLYWHEEL — build only the missing layers**: rights-aware corpus registry, continuous scheduler + cost governor, gold management + leakage control, rule miner, training export, LoRA gates.

### Canonical ownership boundaries (requirement 10)

Exactly one owner per concern. New concerns are the only greenfield surfaces.

| Concern | Canonical owner | Status |
|---|---|---|
| Evaluation execution | `tools/internet_print_test/runner.py` (single versioned runner) | reuse + finish (gold-std PR4) |
| Deterministic grading | `printsense/grade_case.py` (`grade_case()`, owns import verdict) | reuse + extend (validators) |
| Model judging | `tools/internet_print_test/judge.py` (`judge()`) | reuse + extend (independence class) |
| Visual regions / bounding boxes | **`factorylm.visual-region.v1`** (`mira-bots/shared/visual/`, #2843/#2846) | reuse by reference only — never redefine |
| Evidence + content addressing | `printsense/cas.py` (CAS) + `materialized_evidence/` (registry, resolver, recall) | reuse |
| Approvals (typed proposals) | `ai_suggestions` / `relationship_proposals` propose→approve (mira-hub; ADR-0017) | reuse + add typed classes |
| **Corpus + source rights** | **NEW: corpus registry** (PR 1) | net-new |
| **Scheduling + budgets** | **NEW: continuous scheduler** on MIRA Routines / Celery (PR 6) | net-new |
| **Gold + frozen benchmarks** | **NEW: gold manager + leakage guard** (PR 7) | net-new |
| **Training exports** | **NEW: training exporter** (PR 9) | net-new |

## Design principles carried into every PR

1. **Additive, versioned schemas.** New records are new versioned types (`*.v1`). Existing evidence and `factorylm.visual-region.v1` are **never mutated in place** — we reference their ids and extend through **linked records** (`region_ref`, `evidence_id`, `source_sha256`, `page_sha256`).
2. **Rights fail closed.** Missing/unknown rights ⇒ `training_allowed=false`, no public export, no cross-tenant reuse, evaluation only when source policy explicitly permits. See [`data-rights-and-leakage.md`](../specs/continuous-learning-factory/data-rights-and-leakage.md).
3. **Document identity ≠ page identity.** A stable `document_lineage_key` groups all revisions, renders, crops, and augmentations so they cannot leak across train/val/test.
4. **Judge independence is a controlled enum.** `INDEPENDENT_PROVIDER_MODEL | DIFFERENT_MODEL_SAME_PROVIDER | SAME_MODEL_DIFFERENT_RUN | SELF_CONSISTENCY_ONLY | HUMAN_REVIEW | DETERMINISTIC_PROOF`. Only policy-authorized classes may promote to gold. The AN-GS-021 case is `SELF_CONSISTENCY_ONLY`.
5. **Evidence status ≠ approval status.** Distinct fields for evidence completeness, deterministic validation, judge outcome, human review, gold status, and training eligibility. Great provenance never implies correctness.
6. **State machine idempotent + replayable.** Explicit transitions, retry, terminal states, and stale-input invalidation on any change to prompt / preprocessing / source revision / rule / model version. See [`state-machine.md`](../specs/continuous-learning-factory/state-machine.md).
7. **Cost control fails safe.** Budget exhaustion pauses/defers; it never silently switches to an unapproved model or exceeds budget. Provider fallback preserves capability + independence metadata. See [`cost-governor.md`](../specs/continuous-learning-factory/cost-governor.md).
8. **Full backward lineage.** Every promoted artifact links to source document → page/render → region → raw interpreter result → validator findings → judge result → correction event → approving actor/mechanism.
9. **No blurred proposal objects.** `relationship_proposal`, `gold_answer_approval`, and `deterministic_rule_approval` are **separately typed** proposal classes with their own validation policies. See [`promotion-policy.md`](../specs/continuous-learning-factory/promotion-policy.md).
10. **Deterministic-first, model-fallback; nothing merges without approval; staging before prod.**

## Encoded decisions (review round, 2026-07-21)

These resolve the "remaining decisions" from the PR 0 review. They are **approved policy**, recorded here and in the linked docs; **no runtime code is added for them in PR 0**.

1. **Gold authorization caps (conservative).** `INDEPENDENT_PROVIDER_MODEL` ≤ 0.90; `DIFFERENT_MODEL_SAME_PROVIDER` candidate-only ≤ 0.80; `SAME_MODEL_DIFFERENT_RUN` and `SELF_CONSISTENCY_ONLY` ≤ 0.60 and **never auto-gold**; only `HUMAN_REVIEW` / `DETERMINISTIC_PROOF` may authorize gold once all other gates pass. **Model agreement with itself is supporting evidence, not independent proof.** ([`promotion-policy.md`](../specs/continuous-learning-factory/promotion-policy.md))
2. **Dataset partitions (target policy).** Partition by `document_lineage_key`: `train` 70% / `validation` 15% / `test` 10% / permanent `held_out` benchmark 5%. The held-out benchmark is quarantined — never used for prompt tuning, rule development, model selection, training, or threshold calibration. Ratio enforcement is PR 7. ([`data-rights-and-leakage.md`](../specs/continuous-learning-factory/data-rights-and-leakage.md))
3. **Lineage key format.** Public: `<manufacturer>:<document-number>` (`automationdirect:an-gs-021`). Tenant-private: registry-assigned `tenant:<tenant-id>:document:<uuid>`, minted once; source/revision hashes are stored *under* the stable key. Never use a bare content hash as the lineage id (it forks on every revision). ([`data-rights-and-leakage.md`](../specs/continuous-learning-factory/data-rights-and-leakage.md))
4. **Approved-provider allowlist (fail closed).** A checked-in, repo-controlled allowlist with columns `provider · model · allowed_data_classification · allowed_purposes · approval_owner · effective_date`. Unlisted/expired ⇒ deny. Runtime allowlist + loader are PR 6. ([`approved-providers.md`](../specs/continuous-learning-factory/approved-providers.md))
5. **Corpus registry home.** **Neon Postgres with tenant-level RLS** owns registry *metadata* — rights, lineage, state, split assignments, and queries. **CAS / durable object storage** (`printsense/cas.py` + `materialized_evidence/`) owns the *bytes* — original documents, page renders, crops, evidence bundles, and large result payloads. PR 1 implements this boundary; the registry stores content-addresses/pointers, not blobs.
6. **Evaluation-result integration is adapter-first.** `runner output → eval-result.v1 adapter → schema validation → registry`. The existing `tools/internet_print_test/runner.py` is **not** rewritten to emit `eval-result.v1` directly in the first runtime PR; an adapter maps its current output and validates before persistence.

## Migration & compatibility notes

- **No migrations in PR 0.** All artifacts are new JSON documents under content-addressed / durable paths; no existing table or file is altered. Future runtime PRs (registry, gold store) will introduce their own additive migrations dev→staging→prod via `apply-migrations.yml` (`.claude/rules/mira-hub-migrations.md`).
- **Backward compatible with the current runner.** The `eval-result.v1` schema is a **superset** of the fields `tools/internet_print_test/runner.py` already emits (`row`/`grade`/judge). Existing runs validate as `eval-result.v1` once the additive fields default to `null`/`unreviewed`/`candidate`. No consumer is required to read the new fields until its PR lands.
- **`factorylm.visual-region.v1` is consumed unchanged.** If Visual Focus advances the contract to v2, the linked records reference the id they were created against; no rewrite.

## Production behavior change

**None.** PR 0 adds `docs/` (ADR + specs), `docs/specs/continuous-learning-factory/schemas/*.json` (contracts), example instances, and one offline schema-validation test under `tests/continuous_learning/`. No runtime path imports them; no service, bot, engine, migration, workflow, or CI-required gate changes behavior. The validation test is offline, hermetic, and $0.

## Consequences / non-goals (PR 0)

- **In:** the contracts + policies every later PR must honor.
- **Out (later PRs, not now):** scheduler runtime, registry runtime, validator code, review UI, training exporter, any model call, any training run. LoRA is the final, deferred PR.

## PR ladder

PR 0 (this) → PR 1 corpus registry → PR 2 finish gold-std PR4 + commit Together judge + independence field → PR 3 extend `grade_case` validators + freeze AN-GS-021 p4 regression → PR 4 judge independence + disagreement engine → PR 5 review queue on `visual-region.v1` → PR 6 scheduler + budgets (staging-first) → PR 7 gold + frozen benchmarks + leakage guard → PR 8 rule miner → PR 9 training export → PR 10 first narrow LoRA. **Merge nothing without explicit approval.**

## Delivery surfaces

The PR ladder builds the **factory**. **Delivery surfaces** consume it and ship as additive PRs *layered on* the ladder — each reuses the CORE + FLYWHEEL and never forks a factory stage (region, evidence, grading, approval).

- **Print of the Day** (first surface) — [`docs/specs/continuous-learning-factory/surfaces/print-of-day.md`](../specs/continuous-learning-factory/surfaces/print-of-day.md) (reconciliation) + [`surfaces/print-of-day-prd.md`](../specs/continuous-learning-factory/surfaces/print-of-day-prd.md) (verbatim PRD). A private daily email learning flywheel: one hard, verifiable print/day → **blind** PrintSense run → deterministic grade + independent judge → verify → claim ledger + corrected explanation + full YouTube script → **one email to Mike** → promote into gold/rule/test/public-candidate **only on his approval**. Reuses `runner.py` / `grade_case()` / `judge()` / `factorylm.visual-region.v1` / CAS + `materialized_evidence` / `print_recall` / the corpus registry (PR 1) / the scheduler (PR 6) / gold + leakage (PR 7) / the `ai_suggestions` approval rail. **Net-new (the only greenfield):** a controlled-random selector + diversity memory, an email package, a YouTube script generator, the `factorylm.print-of-day.v1` case-aggregate manifest, a per-case review lifecycle (**wraps** the per-(page,config) state machine; promotes via the promotion-policy matrix), and a public-video clearance. Four schema decisions are recorded (review-event = `correction-event.v1`; claim-ledger extends `eval-result.v1`; case machine wraps, not replaces; selector consumes the registry) and resolved at the POTD build PRs — **docs-only until then** (PRD §25 Phase 0–7).

# FactoryLM Technician-Grounding LoRA — Phase 0 reconciliation

**Plan of record:** `factorylm_industrial_technician_intelligence_phased_prd.md` (uploaded 2026-07-22).
**Reconciled against:** `origin/main` @ `a4a4bdf2`. **Read-only Phase 0 — no runtime change, no paid calls.**
**Spend law (hard):** ≤ **$8** total — one LoRA SFT job ≤ **$5**, one optional temporary benchmark endpoint ≤ **$3**. No second training job, no DPO, no full FT, no standing endpoint. **No merges without Mike.**

This is the mandated Phase-0 output (reuse map + gap list + PR ladder + do-not-touch + spend law), so later phases build against **live repo truth**, not the PRD's assumptions. Two read-only recon agents mapped the two halves (dataset governance; Together/budget/artifact). Every canonical owner the PRD names **exists** — this is a *reconcile-and-extend* program, not greenfield.

## 1. Repo truth (verified)

`factorylm_ai/` is a substantial, unit-tested package (the "ZTA model lab", PR #2816 lineage): `flywheel/{splits,records,redact,export}.py`, `budget.py`, `pricing.py`, `promotion.py`, `registry.py`, `provider_registry.py`, `network_gate.py`, `readiness.py`, `telemetry.py`, `providers/{together,base,local_liquid,mock}.py`, `proofpack/{run,experiments,scoring,report}.py`. CLF specs are present under `docs/specs/continuous-learning-factory/` (data-rights-and-leakage, promotion-policy, cost-governor, state-machine, threat-privacy, schemas) — **approved policy, but explicitly PR-0 docs-only, no runtime consumer yet.**

## 2. Reuse map (canonical owner → what it does today)

**Dataset governance**
- `flywheel/splits.py` — deterministic split by **sha256 of record-id**, **70/10/10/10**, buckets `train/dev/test/holdout`; one near-dup guard (train↔holdout, holdout wins).
- `flywheel/records.py` + `schemas/training_record.schema.json` — 4 builders; `new_training_record` enforces the provenance law (non-empty `source_interaction_ids`); `additionalProperties:false`. Fields today: `record_id, source_interaction_ids, messages, tools, split, tags, sensitive, tenant_id, approved_by, created_at`.
- `flywheel/redact.py` — IPv4/MAC/serial redaction only (hand-mirrored from the bots router; no cross-import).
- `flywheel/export.py` — the terminal write gate: fail-closed on missing `approved_by`; skips `holdout` (never written + assert), skips `sensitive`/`tenant` unless opted in; redacts. `_EXPORTABLE_SPLITS=(train,dev,test)`.
- `promotion.py` — the **model** promotion gate (7 benchmark-before-assist checks, `GateResult`); **not** a dataset-eligibility gate.

**Together / budget / artifact**
- `providers/together.py` — `upload_file` (✓), `create_finetune_job` (✓, **budget precheck runs before the network gate** — test-verified), `get_finetune_job` (✓), `download_finetune_note` (**doc-stub, no HTTP**).
- `budget.py` — `BudgetGuard.precheck/record`, `cap_usd` (default $1), `BudgetExceeded`; hard-raises before spend.
- `pricing.py` — inference $/Mtok table + FT constants (`FT_LORA_SFT_USD_PER_MTOK_LE16B=0.48`, `FT_MIN_JOB_USD=4.00`, `DEDICATED_H100_USD_PER_HOUR=5.49`). Training math is **inline** in `create_finetune_job`, not a standalone fn.
- `registry.py` — `ArtifactRegistry` (append-only JSONL, human-only `allow_runtime`), `ZtaArtifact`.
- `network_gate.py` / `provider_registry.py` — `FACTORYLM_NETWORK_MODE` gate + Together host/key (`TOGETHERAI_API_KEY`), **byte-pinned to CI**.
- `proofpack/` — budget-guarded eval harness + markdown report (reuse for base-vs-adapter benchmarking).

## 3. Gap list (what PR 1–4 must add)

**PR 1 — dataset governance (greenfield core; approved-but-unimplemented policy):**
1. **Corpus registry + rights** — the approved `corpus-source.v1` rights schema has **no consumer code**. Add a registry that resolves rights (fail-closed) and emits `document_lineage_key`.
2. **Full training-eligibility gate** (the central gap) — a new `flywheel/eligibility.py` invoked **before** export where `approved_by` alone is **insufficient**: require `gold_status=="gold"` AND `rights.training_allowed==true` AND train-side lineage AND validation-passed AND safety-clear AND provenance present AND tenant policy. Machine-readable rejection codes (reuse the `GateResult` shape): `RIGHTS_UNRESOLVED, TRAINING_NOT_ALLOWED, NOT_GOLD, LINEAGE_ON_EVAL_SIDE, HELD_OUT, SENSITIVE_TENANT, VALIDATION_FAILED, PROVENANCE_MISSING`.
3. **Lineage-safe splits** — partition on `document_lineage_key` (not record-id); keep every revision/page/crop/rotation/paraphrase of a lineage **together**; **70/15/10/5** with a **permanent, quarantined 5% held-out** (unusable for tuning *or* selection, not merely "unexported").
4. **Naming reconciliation** — `dev→validation`, `holdout→held_out` across `splits.py` + `records.py` + `export.py` + `training_record.schema.json` **in lockstep** (coordinated schema+code+test change — a single owner, not inside a corpus-adapter PR).
5. **Schema-field additions** to `training_record` (+ builder, coordinated): `document_lineage_key`, `rights`/`license_class`, `gold_status`, `training_eligibility`, `evidence/validation` result, `correction lineage`, confidentiality class.
6. **Reproducible manifest hashes** — an export/corpus digest (none today).

**PR 4 — Together orchestration (extend `together.py` via new params/helpers only):**
- `create_finetune_job` new params: `validation_file`, `n_evals`, `n_checkpoints`, `seed`, `train_on_inputs`, `packing`, `learning_rate`, `lora_r/alpha/dropout`.
- New helpers: `get_finetune_events`, `list_finetune_checkpoints`, a **real** `download_finetune_checkpoint` (`.tar.zst`), and a `try/finally` **temporary-endpoint lifecycle** (create → poll-ready → benchmark → *finally*-delete) — absent today.
- `pricing.estimate_finetune_cost(tokens, epochs, usd_per_mtok, method)` + a **token counter** over `train.jsonl` so the ≤$5 gate is turnkey (today `est_training_tokens` is hand-passed).
- Job-metadata persistence into `registry.py` (extend `zta_artifact` schema with `job_id/base_model/dataset_version/hyperparams`, or an `artifact_type="adapter"` convention).
- **STALE-until-verified:** the exact Together fine-tune request/response field names + LoRA/DPO wire shapes must be re-checked against live Together docs (the Together Integration Agent's Phase-0/4 duty) **before any metered job**. A live API result overrides repo docs.

## 4. Do-not-touch / shared seams (extend, never rewrite in a lane PR)

`flywheel/export.py` (terminal gate, ~15 tests) · `flywheel/splits.py` (ratio/enum/determinism tests) · `flywheel/records.py` + `training_record.schema.json` (`additionalProperties:false` — schema+builder move together) · `schemas/validate.py` · `promotion.py`/`registry.py` (human-only gate — never automate `allow_runtime`) · `providers/together.py` signatures · `provider_registry.py` (byte-pinned to CI) · `budget.py`/`network_gate.py`/`pricing.py` constants · `providers/base.py` shapes. The naming reconciliation (item 4) is a **coordinated** change owned by PR 1 only.

## 5. Corrected PR ladder

| PR | Purpose | Paid | Prod |
|---|---|---:|---:|
| **PR 0** (this doc) | Phase-0 reconciliation + plan | $0 | none |
| **PR 1** | `feat(clf): lineage-safe splits + corpus registry + training eligibility` (items 1–6) | $0 | none |
| **PR 2A/2B/2C** | PrintSense / Drive Commander / MIRA+SimLab corpus adapters (parallel, isolated) | $0 | none |
| **PR 3** | `feat(clf): technician grounding dataset v0` + manifests/reports + paid-gate evidence | $0 | none |
| **PR 4** | `feat(factorylm-ai): governed Together training orchestration` + dry-run preflight | $0 until live | none |
| **paid event** | exactly one LoRA SFT job, `Qwen/Qwen3.5-9B`, ≤$5, after Mike's explicit go | ≤$5 | none |
| **optional eval** | temporary endpoint only if unavoidable, ≤$3, deleted immediately | ≤$3 | none |
| **PR 5** | `docs(model-lab): technician grounding v0 training + evaluation evidence` + artifact registry + shadow plan (inactive) | $0 | none |

Exit gates: no corpus build until PR 1 green; no upload until Phase-3 paid-minimum gate (≥100 eligible records, ≥15 lineages, ≥20 uncertainty/refusal/correction, all rights `training_allowed`, no held-out contamination, est ≤$5, model support live-confirmed) passes; no paid job until the full Phase-4 dry-run package is presented and Mike confirms.

## 6. Acceptance (Phase 0)

✓ No duplicate subsystem proposed — every change maps to one canonical owner or a named new module. ✓ No paid calls, no production change. ✓ All assumptions classified VERIFIED / STALE / GAP (Together API field names flagged STALE-until-verified). ✓ File-ownership + do-not-touch declared. ✓ Spend law confirmed.

**Next:** PR 1 (the governance foundation). Nothing merges, deploys, or spends without Mike.

## 7. Addendum — Autonomous Synthetic Interaction Flywheel (reconciled)

Second PRD (uploaded 2026-07-22): a scheduled system that generates evidence-grounded synthetic technician interactions to exercise the learning stack when organic traffic is low. **A deterministic orchestrator owns scheduling/state/rights/cost/promotion; bounded schema-constrained agents run only where language judgment is needed.** The system may autonomously select sources, generate questions, run targets blind, grade, propose corrections, and build review reports — but **never** declares gold, approves safety-sensitive advice, starts a paid job, promotes/deploys a model, or trains on unresolved-rights/confidential material. Mike is the sole gold/paid/promotion/deploy authority.

**Reconciliation with the parent ladder + live main:**
- **Reuses the same canonical owners** as PR 1 (flywheel records/eligibility/export/splits/rights/registry/budget/promotion) — the synthetic flywheel is a *producer* of candidate records into the PR-1 governance substrate, not a second corpus schema, benchmark framework, or visual-region contract (all explicitly non-goals §4).
- **Shared vocabularies, defined once.** The addendum's §19 rejection codes are a **superset** of PR 1's (`RIGHTS_UNRESOLVED, TRAINING_NOT_ALLOWED, NOT_GOLD, LINEAGE_MISSING, LINEAGE_ON_EVAL_SIDE, HELD_OUT, FROZEN_EVAL, SENSITIVE_TENANT, VALIDATION_FAILED, PROVENANCE_MISSING, AGENT_DISAGREEMENT, SAFETY_REVIEW_REQUIRED, ANSWER_KEY_WEAK, DUPLICATE, NEAR_DUPLICATE, SCHEMA_INVALID`). Define the enum **once** (a shared module) and have both PR 1 export-eligibility and the synthetic critic consume it.
- **Durable job state machine ← existing CLF spec.** The addendum §11 states + §23 reliability requirements map onto `docs/specs/continuous-learning-factory/state-machine.md` (idempotent-by-content-address, single-writer-per-`work_key`, replayable) — which is **spec-only, unimplemented** today. PR A implements it, reusing the proven `mira-bots/shared/print_recall.py` lock pattern (in-process + cross-process file lock spanning compute+persist) and `printsense/cas.py` content addressing rather than inventing a queue.
- **Answer-key independence (§15) = the ground-truth law.** A synthetic training candidate's answer key must be independent of the target response (deterministic pack / SimLab / frozen benchmark / human correction / verified evidence) — never the same model, a second prompt to it, or an agent's intuition. This is the anti-self-training rule the parent PRD §4 already forbids; the critic fails closed on missing answer-key evidence.
- **Separate budget.** The synthetic-flywheel agent budget is **separate** from the one-job ≤$5 fine-tune budget; it reuses `budget.py` (`BudgetGuard`, pre-network precheck) with its own daily/monthly cap and per-agent token caps.

**Addendum PR ladder (PR A–G), stacked on the parent PR 1 governance foundation:**

| PR | Purpose | Paid | Prod |
|---|---|---:|---:|
| **PR A** | Synthetic contracts + durable job state machine + queue (source enum, job schema, state machine, idempotency, lineage, answer-key contract, synthetic labeling, shared rejection codes). **No agents/network/scheduling.** | $0 | none |
| **PR B** | Source adapters → one common source-candidate shape (PrintSense/PotD, Drive Commander packs, SimLab/RCA, frozen benchmark, real-interaction ingestion). No agent execution. | $0 | none |
| **PR C** | Bounded technician-question generator (strict JSON, prompt versioning) + blind target runner + answer-key-isolation tests + per-case cost controls + dry-run fixtures. | metered agent (capped) | none |
| **PR D** | Evidence Critic + claim ledger + safety flags + rejection codes + ≤1 reconciliation pass + agent-disagreement handling; hermetic tests with mocked providers. | metered agent (capped) | none |
| **PR E** | Nightly scheduled workflow (≤4 cases, ≤1/lineage, ≤1 retry/stage) + daily one-case review package + weekly corpus/benchmark job + retry/dead-letter reporting + no-duplicate-email. No paid training. | metered (capped) | none |
| **PR F** | Gold-export integration — approved synthetic records flow through the PR-1 eligibility + lineage-safe split + manifest + leakage/held-out gates; synthetic origin preserved. | $0 | none |
| **PR G** | Training-readiness proof (corpus report, real-vs-synthetic composition, independent-lineage count, rights report, cost estimate, frozen-benchmark baseline, base-vs-tools) + explicit manual authorization gate. **No paid job.** | $0 | none |

**Sequencing:** PR 1 (parent governance) provides the shared eligibility/split/lineage/rejection-code substrate → PR A builds the synthetic state/queue on it → PR B–E produce candidates → PR F routes approved candidates into export → PR G proves readiness. The parent PR 4 (Together orchestration) + the single ≤$5 paid job remain milestone-triggered on Mike's explicit go. **Initial content target (Phase-3 gate, tightened by the addendum §26):** ≥100 eligible approved records, ≥20 independent lineages, ≥5 held-out lineages, ≥20 uncertainty/refusal/correction, ≥15 safety-sensitive, PrintSense+Drive Commander+SimLab/MIRA represented, no unresolved rights / held-out / frozen-eval contamination, synthetic composition disclosed, base-vs-tools benchmark complete, est cost ≤$5.

Non-goals honored throughout: no autonomous paid training/promotion/deploy/publish, no second schema/benchmark/visual-region contract, no open-ended agent loops, no near-duplicate volume inflation (optimize for *independent lineages*, not record count).

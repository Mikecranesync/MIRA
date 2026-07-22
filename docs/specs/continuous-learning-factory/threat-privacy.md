# CLF Threat & Privacy Analysis

Deliverable for ADR-0030 (threat/privacy analysis). PR 0 is a **paper analysis** — no runtime, no data movement. It names the threats every later PR must mitigate and points at the existing controls CLF reuses rather than reinvents.

## Assets to protect

1. Customer-private prints and any structured facts derived from them.
2. Tenant isolation — one tenant's corpus, gold, and training data must never reach another.
3. The gold set's integrity — a poisoned or leaked gold row corrupts every downstream regression and training run.
4. Source rights — evaluating or training beyond what a source's license permits.
5. Spend — a runaway loop that burns budget or is coerced into paid calls.

## Threats & mitigations

### T1 — Model trains on its own guesses (self-training collapse)
**Mitigation (structural).** The only paths to `gold` are `HUMAN_REVIEW`, `DETERMINISTIC_PROOF`, or a genuinely independent provider+model (`promotion-policy.md`). `SELF_CONSISTENCY_ONLY` and `SAME_MODEL_DIFFERENT_RUN` are `gold_eligible=false`. Training requires `gold` **and** `training_allowed` **and** the train split — three gates. A model cannot manufacture its own training data.

### T2 — Train/test leakage inflates scores
**Mitigation.** Splits partition on `document_lineage_key`, never page/render (`data-rights-and-leakage.md`). The leakage guard (PR 7) fails the export if any lineage spans splits. Frozen `held_out` benchmarks are never training-eligible.

### T3 — Cross-tenant data exposure
**Mitigation.** `cross_tenant_reuse_allowed=false` by default; customer-private sources never enter a shared corpus or cross-tenant export. Rides the existing tenant-scoping law (`.claude/rules/knowledge-entries-tenant-scoping.md`, `withTenantContext`/RLS) — CLF adds an auditable rights flag, not a parallel tenancy model. Any new CLF table follows `.claude/rules/mira-hub-migrations.md` (RLS + grant + tenant-type match).

### T4 — Rights violation (eval/train/export beyond license)
**Mitigation.** Rights fail closed: unknown ⇒ deny. `evaluation_allowed`, `training_allowed`, `public_export_allowed` are checked at each use, and `training_allowed` is re-checked at export. Ingest stays inside the robots/allowlist safety layer already enforced by `tools/internet_print_test/safety.py`.

### T5 — Corpus poisoning (adversarial source or correction)
**Mitigation.** Sources are content-addressed (`source_sha256`, `page_sha256`) — a changed byte is a new record, not a silent mutation. Corrections are **immutable** and attributed (`correction-event.v1.actor`, append-only chain). A deterministic `rule-candidate.v1` needs ≥3 independent lineages + passing tests + human approval before it can influence grading, so one bad case cannot move the bar. Gold promotion needs an authorized approver.

### T6 — PII / secrets in prints or logs
**Mitigation.** The existing PII sanitizer (`InferenceRouter.sanitize_context()`, default-on) and secret-redaction in the print-eval reporting path continue to apply — CLF adds no new egress. Structured facts stored on `correction-event.v1`/`gold-record.v1` are print-technical (terminals, DIP settings), not personal data; reviewers are recorded by role id (`reviewer:mike`), not personal detail. Secrets remain Doppler-managed (`.claude/rules/security-boundaries.md`); no rights/threat data embeds a credential.

### T7 — Runaway spend / coerced paid calls
**Mitigation.** The cost governor fails safe (`cost-governor.md`): budget exhaustion pauses, never downgrades to an unapproved model, never exceeds budget; deterministic + recall paths are free and always tried first. This encodes the project spend law (`feedback_paid_inference_validation_only`): metered inference is budget-declared, never ambient.

### T8 — Prompt injection via print content
**Mitigation.** Interpreter output is **evidence to be graded**, never an instruction. `grade_case()` owns the import verdict deterministically; a print that says "ignore prior instructions" changes nothing about grading, promotion, or spend, because those gates never read model output as control.

## Privacy posture

- **Data minimization.** CLF stores hashes, technical structured facts, region references (by id, into `factorylm.visual-region.v1` — geometry is never re-inlined), and lineage — not raw personal data.
- **Right to delete.** Content-addressing + full backward lineage (`gold-record.v1.lineage`) make a source's derived artifacts enumerable, so a delete request can find every downstream record. (Mechanism lands with the registry, PR 1/7.)
- **Auditability.** Every promotion and spend decision is attributable (approver/mechanism, budget scope, provider, independence class) — evidence before assertion.

## Out of scope for PR 0

No data is ingested, moved, evaluated, or trained by this PR. These mitigations are **requirements on later PRs**; PR 0 only fixes the contracts (schemas) and policies that make them enforceable. **Production behavior change: none.**

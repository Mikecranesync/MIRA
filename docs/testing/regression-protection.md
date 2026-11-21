# MIRA regression protection: research and implementation plan

Status: **proposal**. Researched 2026-11-13 against main
`95b8a7907fb5a071e733b7fc0ef3eb761a6bcf18`. This addition changes documentation;
the implementation and acceptance work below remain pending. Track delivery and
accepted owners in [#5232](https://github.com/Mikecranesync/MIRA/issues/5232).

## Objective and existing authority

Preserve previously established behavior while improving the supported technician
journey. A higher aggregate score cannot compensate for a new wrong-machine value,
unsupported safety claim, lost record, or tenant-boundary failure. Keep the current
capability benchmark's unresolved failures visible while establishing a separate
bank of independently verified, previously passing regression cases.

This extends the [QA regression routine](../specs/mira-qa-regression-routine-spec.md)
across current Hub and persistence surfaces. Existing
[retrieval release gates](../evals/retrieval-eval/release-gates.md),
[DELIVERY.md](../../DELIVERY.md), exact-review requirements and technician acceptance
remain authoritative. Proposed additions require the relevant owner's acceptance;
this document grants no spending, gate-setting, merge, deployment or equipment authority.

## What the repository already provides

These are source/configuration observations at the pinned revision, not claims that
every workflow ran or is required by branch protection.

| Existing surface | Reuse | Gap or boundary to preserve |
| --- | --- | --- |
| [Synthetic Release Gate](../../.github/workflows/synthetic-release-gate.yml) and [orchestrator](../../evals/scripts/release_gate.py) | Existing verdict/report pipeline and exact-SHA handling | Its configured run uses an archived baseline in offline mode; PR path filters cover evaluation files. That does not establish current deployed Hub behavior. |
| [Keyless replay workflow](../../.github/workflows/eval-replay-gate.yml) and [Python replay seam](../../tests/eval/llm_replay.py) | Strict replay for the Python engine | The tracked `tests/eval/fixtures/llm_replay/cascade.json` store is absent at this revision. The workflow warns and skips its eval when absent; its path filters target the Python engine/eval, not Hub chat. |
| [Stranger Walk unit workflow](../../.github/workflows/stranger-walk-unit.yml) | Positive collected-test count, scorer and budget assertions | These validate the runner; they do not certify production retrieval or generation. |
| [Local UI replay](../../mira-hub/tests/stranger-walk/playwright.replay.config.ts), [replay spec](../../mira-hub/tests/stranger-walk/replay.spec.ts) and [mutations](../../mira-hub/tests/stranger-walk/mutations.mjs) | Existing isolated rendering/replay and mutation instruments | Replayed model output proves the tested replay/rendering contract, not a live provider's current answer quality. |
| [Baseline comparator](../../scripts/check_benchmark_regression.py) and [retrieval policy](../evals/retrieval-eval/release-gates.md) | Per-case deltas, paired comparison, corpus/config validity and refusal guardrails | Keep those policies' thresholds and sealed-set rules; add cross-context cases without inventing a second scoring system. |
| [Hub applicability tests](../../mira-hub/src/capabilities/__tests__/manual-applicability.test.ts), [conversation-subject tests](../../mira-hub/src/capabilities/__tests__/conversation-subject.test.ts), [table tests](../../mira-hub/src/capabilities/__tests__/manual-rag-table-exclusion.test.ts) and [real-store recall fixture](../../mira-hub/src/capabilities/__tests__/cv101-photo-recall.integration.test.ts) | Existing production-code seams and opposite controls | Extend the owning tests; disposable database and owner handoffs still apply. |
| [Staging gate](../../.github/workflows/staging-gate.yml) | Existing integration/release machinery | It retries the graded evaluation. Preserve each attempt's outcome so a later pass cannot erase an earlier semantic failure. |

The private complete-machine benchmark already contains single-document/multiple-document
comparisons. Reuse its approved identifiers and acceptance evidence in their private
location. Do not copy its questions, answers, keys, account details or sealed material
into this public plan or public CI artifacts.

## Research translated into concrete work

### 1. Test meaning-preserving changes and their opposite controls

[CheckList](https://aclanthology.org/2020.acl-main.442/) describes behavioral tests,
including invariance and expected directional changes. For MIRA, the invariant is
the supported technical claim and its evidence, not identical generated prose.

| Controlled change | Required behavior | Control that must change the outcome |
| --- | --- | --- |
| Rename an identical PDF to another neutral or publication-style name | Preserve applicability, supported values, units and source evidence | A genuinely conflicting model declaration must still be handled under the applicability policy. |
| Add a document independently verified irrelevant to the fact | Preserve the answer's supported claim and mandatory warning | A relevant conflicting revision must trigger the defined conflict/revision behavior, not unconditional invariance. |
| Permute document order with identical authority and revision | Preserve the admissible evidence and technical meaning | Changing source approval or authority is a different input and must take effect. |
| Rephrase a request or an explicit return to the recorded machine | Preserve the correctly selected subject | Negated, deferred or cancelled returns must not silently switch equipment. |
| Reload a saved conversation with unchanged approved context | Preserve recorded identity, review state and source provenance | Rebinding the project must not rewrite historical turns as if they used the new machine. |

The public failure classes in [#5465](https://github.com/Mikecranesync/MIRA/issues/5465),
[#5464](https://github.com/Mikecranesync/MIRA/pull/5464) and
[#5335](https://github.com/Mikecranesync/MIRA/issues/5335) identify owning seams;
their owners keep the implementation claims. A failure should produce the smallest
pair of inputs and the violated assertion, with private material retained privately.

### 2. Check technical claims against an independent evidence oracle

For a numeric claim, check the equipment/model, document revision, PDF page, table
row, column meaning, unit, operating condition and associated caution. A correct
page link alone is insufficient: [#5466](https://github.com/Mikecranesync/MIRA/issues/5466)
demonstrates a correctly cited table with the wrong rating column selected.

Have an independent verifier compare selected facts to the rendered source page.
The parser and grader must not merely agree on the same extracted cell. Use code
for exact identity/value/unit checks and calibrated rubric/human review for meaning.
Sample apparent passes as well as failures. Record disagreements and adjudication;
do not silently edit answer keys to match the candidate.

Related numeric-support work is still an open proposal in
[#4981](https://github.com/Mikecranesync/MIRA/pull/4981) at the audit time. Do not
count an open PR's intended guard as protection already enforced on main. Coordinate
with the existing applicability and rating-column repair owners before changing
their production paths or duplicating their real-source regression fixtures.

[Anthropic's evaluation guidance](https://www.anthropic.com/research/demystifying-evals-for-ai-agents)
separates capability improvement from regression protection and combines code,
model and human graders. Apply that separation here: a model-graded pass is one
evidence stage, not technician acceptance or permission to waive a critical failure.

### 3. Exercise sequences, interrupted work and races

[Model-based testing](https://fast-check.dev/docs/advanced/model-based-testing/)
compares actions against a simpler state model and can reduce a failure to a short
sequence. Start with explicit, seeded Vitest/Playwright sequences using current
fixtures; adopting a new property-testing dependency is optional and separately reviewed.

Cover upload → approval → ask → citation → save note/photo → review → reload →
reuse, with interruptions at each boundary. Include disconnect/retry, cancellation,
duplicate submission, process restart, delayed responses and switching between two
projects while a save or answer is outstanding. Assert durable records, idempotency,
source OFF/revision behavior, preserved review status, tenant isolation and absence
of stale responses overwriting another project's UI. Use disposable test stores;
an offline replay does not establish real reboot/service recovery.

### 4. Make replay and evaluation coverage inspectable

Capture an approved failure as a sanitized, versioned fixture with a minimal input,
ordered evidence, expected outcome and explicit replay boundary. Keep original
captures private. A public fixture must be genuinely synthetic or approved for
publication; the older replay activation notes do not authorize publishing private
questions or keys. A separately reviewed private artifact path is another option.

For each mandatory check record expected and executed case identifiers/counts,
fixture availability, network policy, attempt history and exit classification.
Missing fixtures, zero collection, unexecuted required cases and runtime drift
produce NOT TESTED, INVALID or HOLD under the owning gate's existing semantics;
they are never evidence of an executed pass. Distinguish an irrelevant path-filtered
skip from missing mandatory coverage. Before requiring a previously inert gate,
provide its fixtures and prove a deliberately bad input fails the named check.

Reuse the Python replay seam only for its engine boundary. Hub behavior belongs
in the Hub's existing capability/integration/replay tests. Replaying an archived
LLM response cannot detect a regression in current model behavior or establish
improvement from a new provider. No live calls are needed for the first local slice.

### 5. Test the tests and preserve flaky outcomes

Require a meaningful failing test before the repair, a passing test after it and
one named mutation that reintroduces the same behavior. Execute mutations in an
isolated copy and restore it byte-for-byte. A syntax error, failed install or
unrelated infrastructure failure is not proof that the behavioral assertion works.

[Stryker's mutation states](https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/)
distinguish detected faults from surviving or uncovered mutations. Reuse MIRA's
existing mutation instruments first; a global mutation-score target is unnecessary.

[Playwright](https://playwright.dev/docs/test-retries) distinguishes first-pass,
flaky and failed tests. Preserve that distinction in MIRA reports. Retries must
retain every attempt's inputs, version and failure; a safety or identity failure
requires adjudication. Track quarantine with an owner and expiry, and never count
a quarantined critical case as executed acceptance. Compare normalized typecheck
diagnostic identities, not only the total error count, when assessing a legacy baseline.

### 6. Bind promotion and recovery evidence to the whole tested configuration

Record the candidate and base SHA, runtime/image identity, model/provider identity
(and revision when available), prompt/config hashes, PDF hashes, approval state,
index/ingest version and readiness, ordered retrieval evidence, fixture/grader
versions, device and run/attempt identifiers. Missing provider-version visibility
must be disclosed. Check ingest readiness before and after a comparison; a corpus
still embedding is a confound, not an interchangeable baseline.

Audit workflow triggers, required-check names and app bindings with maintainers.
At the audit time, branch protection named six required checks, did not name the
keyless replay workflow, and reported `strict=false`. This is a settings snapshot,
not an authorization to change protection. Verify which production-code changes
actually execute the proposed assertions before describing a gate as enforced.

[Google SRE's canary guidance](https://sre.google/workbook/canarying-releases/)
supports bounded exposure, evaluation and rollback. For MIRA, begin with an isolated
staging cohort and synthetic data. An eventual authorized production rollout needs
explicit success/abort criteria and a tested compatible rollback. Do not experiment
on technician safety decisions. Monitor provider/config/corpus drift and resource
behavior as well as code changes; retain large-manual page fidelity under repeated,
concurrent and cancelled work. Physical-device and representative-human gates remain
separate, including the existing offline/reboot requirements when offered.

## Small implementation sequence

Roles below are proposed handoffs, not new assignments or authority to start other sessions.

| Order | Existing owner/surface | Concrete next outcome | Acceptance evidence |
| --- | --- | --- | --- |
| 1 | CI/release maintainer; existing workflows above | Map each supported capability to a real check, triggering paths, fixtures and required execution. Resolve replay-store activation without exposing private data. | Coverage table; deliberate missing-fixture/zero-collection failures; no required capability represented solely by an inert or unrelated green check. |
| 2 | Applicability/retrieval owners; existing Hub tests | Three independently verified development facts, each under baseline, neutral rename, unrelated-document addition and order permutation; add one wrong-model control per fact: 15 cases. | Expected IDs and count, no provider calls, real production-code assertions, meaningful RED → GREEN and targeted mutation results. This checks the tested seams, not live generation. |
| 3 | Persistence/journey owner; existing real-store and UI fixtures | Add short interruption/race sequences and reload assertions, including a historical-machine negative control. | Database and UI receipts; no duplicate records or cross-project overwrite; cleanup proof. Physical reboot remains separately measured. |
| 4 | Evaluation owner; existing private benchmark and paired scorer | Run approved paired live variants on one qualified build/config/corpus; retain repetitions and all attempts within an explicitly approved cap. | Validity checks, per-case losses/gains, technical/safety dimensions, grader disagreements and calibrated pass samples. Preserve the existing retrieval thresholds. |
| 5 | Release/device owners | Bind the selected evidence manifest to staging, physical device checks, supported scope and rollback; promote only under existing authorization. | Actual deployed SHA/config, citation-page/UI/reload proof, remaining failures and independent technician acceptance. |

The initial 15 cases are an engineering starting point, not a statistical reliability
claim. Grow development cases from adjudicated incidents and successful capability
cases; keep a separately controlled holdout and never tune against the sealed set.
For every accepted bug repair, retain its reproducer, opposite control, owner and
evidence link so that closing an issue also preserves protection against recurrence.

## Research sources and adoption boundary

The six linked primary sources inform the approaches above. MIRA-specific priorities,
the first 15-case slice and promotion recommendations are this proposal's synthesis.
No external test framework, new scheduled run or runtime guard is installed by this
documentation change. Implementation acceptance must report local, CI, staging,
device, human and production evidence independently through the existing delivery contract.

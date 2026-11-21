# FactoryLM Benchmark Factory — Vision, Implementation, and Build Guide

**Status:** Directional implementation contract  
**Date:** 2026-10-26  
**Primary repo:** `Mikecranesync/MIRA`  
**Applies to:** IMIB, Answer Radar, expert review, retrieval evaluation, safety evaluation, answer-quality evaluation  
**Execution mode:** converge existing eval work; do not create a parallel benchmark stack

## 1. Direction

FactoryLM should treat benchmarking as a continuously operating **Benchmark Factory**, not a collection of one-off eval scripts.

The purpose is to answer one question with evidence:

> Can MIRA reliably help a real industrial technician, using real technician wording, the correct source material, safe guidance, calibrated uncertainty, and reproducible evidence?

The Benchmark Factory must continuously discover realistic questions, freeze them before testing, resolve authoritative evidence, obtain expert labels where needed, run MIRA, score retrieval and answer behavior independently, and convert real failures into permanent regression cases.

The benchmark is part of the product-development loop:

```
public / field question
        ↓
discover + normalize + dedupe
        ↓
freeze before expected-answer inspection
        ↓
resolve OEM / authoritative evidence
        ↓
independent provisional labeling
        ↓
expert disagreement queue
        ↓
gold key
        ↓
MIRA retrieval evaluation
        ↓
MIRA answer evaluation
        ↓
safety / grounding / calibration review
        ↓
failure → IMIB-Red regression
        ↓
product repair → rerun
```

This direction preserves the strongest ideas already present in:

- **PR #4793** — IMIB v0.1, scorer integrity, frozen inputs, run manifests, human rescore path, retrieval/safety separation.
- **PR #4801** — expert-review workflow and mobile review surface.
- **PR #3589** — Answer Radar's Discover → Normalize → Qualify → Freeze → Test → Review → Score mission model.

Do not restart these projects from scratch. Reuse their contracts and salvage their useful components.

## 2. Why this is needed

Current benchmark evidence shows a material distribution gap.

PR #4793 reports:

- AI-written retrieval questions can show large gains that do **not** transfer to fresh technician/forum wording.
- On the fresh real-forum answerable set, the correct page was in top-5 only **8/19 (42%)**.
- 31/34 forum questions came from one forum, so source diversity is weak.
- AI labelers only reached moderate agreement (κ 0.52), which makes expert labeling important.
- Safety cases partly reflected knowledge of the existing gate rules, so they are not fully independent adversarial evidence.
- Multi-device and real-language coverage remain thin.

The implication is not "stop synthetic evals." Synthetic cases are valuable for regression and controlled perturbation. They must not be treated as independent evidence of real technician performance.

## 3. Benchmark portfolio

Maintain five distinct pools.

### IMIB-Core

Purpose: stable expert-reviewed anchor benchmark.

Characteristics:
- 150–300 high-value cases.
- Expert-reviewed gold evidence.
- Versioned slowly.
- Used for release comparison and regression.
- Cases are never silently relabeled.

### IMIB-Live

Purpose: fresh, contamination-resistant technician-language benchmark.

Characteristics:
- Newly harvested questions on a recurring cadence.
- Frozen before MIRA runs and before expected answers are exposed to implementation agents.
- Recent cases remain hidden from developers until scoring completes.
- Older Live cases may graduate into Core or Red.

### IMIB-Red

Purpose: permanent record of real MIRA failures.

Sources:
- production failures;
- staging failures;
- Pixel acceptance failures;
- customer/pilot failures;
- expert-review discoveries;
- planted-defect discoveries.

Every confirmed failure should be converted into a minimal reproducible benchmark case before or with the repair.

### IMIB-Safety

Purpose: measure both missed hazards and over-refusal.

Must contain paired controls:
- unsafe action → block / safe alternative;
- safe observation → serve;
- destructive maintenance action → never misapply;
- explicit destructive-maintenance question → retrieve correct documentation without treating it as normal fault recovery.

Safety cases should increasingly come from independent incident records rather than prompts written after inspecting MIRA's safety rules.

### IMIB-Challenge

Purpose: stress realistic failure modes that static retrieval tests miss.

Include:
- multiple devices in one question;
- wrong or distractor manuals;
- sibling-model confusion;
- ambiguous model names;
- slang and shorthand;
- voice-transcription style;
- OCR errors;
- misspellings;
- photo + manual reasoning;
- follow-up turns;
- contradictory evidence;
- missing evidence;
- wrong-revision manuals;
- deliberately irrelevant retrieved chunks.

## 4. Public-data strategy

Public sources have different roles. Do not treat all public text as gold truth.

### A. Technician-language discovery

Use real public questions primarily to learn **how technicians actually ask**.

Candidate sources:
- Control.com automation forums: https://control.com/forums/
- Engineering / Electrical Engineering Stack Exchange and related sites.
- Other industrial forums after source-specific terms/licensing review.
- Public YouTube comments, issue discussions, RSS feeds, and similar sources only when access/terms allow.

Rules:
- freeze the question text before reading downstream replies when possible;
- preserve source URL, capture date, author-independent identifier, and text hash;
- do not assume community replies are correct;
- use forum replies as discovery/context, never automatically as the gold answer.

Stack Exchange public contributions are CC BY-SA with the applicable version determined by contribution date. Preserve attribution and license metadata.

### B. OEM and authoritative documentation

Use OEM manuals, fault tables, alarm tables, wiring references, operating instructions, and authoritative technical documentation as the primary evidence source for product-specific claims.

The Benchmark Factory should automatically attempt:

```
question
  → manufacturer/model/family extraction
  → document-family resolution
  → candidate manual set
  → independent candidate-page retrieval
  → expert/AI page labeling
```

Store document identity, revision, sha256, page, and evidence spans where permitted. Public availability does not automatically grant redistribution rights; source registry rules must distinguish "usable internally for evaluation" from "redistributable."

### C. Safety and incident sources

Use independent incident records to generate realistic safety scenarios.

Priority sources:
- OSHA fatality/inspection data: https://www.osha.gov/fatalities
- NIOSH FACE reports: https://www.cdc.gov/niosh/face/about/
- U.S. Chemical Safety Board investigations: https://www.csb.gov/investigation-details/

These are especially valuable because they let us derive prompts from real hazardous situations without first reading MIRA's phrase rules.

Each derived safety case should record:
- source incident;
- actual hazard;
- action that should be stopped;
- safe next action or escalation;
- concepts the response must contain;
- concepts the response must not contain.

### D. Machine-state datasets

Use open machine datasets to expand beyond manual lookup into condition reasoning.

Candidate sources:
- UCI MetroPT-3: https://archive.ics.uci.edu/dataset/791/metropt%2B3%2Bdataset
- UCI APS Failure at Scania Trucks: https://archive.ics.uci.edu/dataset/421/aps%2Bfailure%2Bat%2Bscania%2Btrucks
- UCI AI4I predictive maintenance: https://archive.ics.uci.edu/dataset/601/ai4i%2B2020%2B
- NASA diagnostics/prognostics data resources: https://www.nasa.gov/intelligent-systems-division/discovery-and-systems-health/diagnostics-and-prognostics-group/

UCI currently labels the listed datasets for reuse on their dataset pages; preserve dataset-specific attribution and upstream terms.

These datasets are not substitutes for technician Q&A. Use them for:
- state interpretation;
- anomaly detection;
- failure classification;
- trend questions;
- "what changed?" reasoning;
- calibration under incomplete telemetry.

## 5. Source registry

Before automating collection, create one source registry.

Minimum fields:

```yaml
source_id:
name:
source_type: forum | q_and_a | oem | government | dataset | field
base_url:
license_or_terms:
attribution_required:
automated_collection_allowed:
store_full_text:
store_derived_case:
redistribution_allowed:
ground_truth_role: discovery | supporting | authoritative
reviewed_at:
notes:
```

No crawler should run against a new source until its registry entry exists.

## 6. Case contract

Extend the current IMIB case schema rather than inventing another format.

Every benchmark case should be able to represent:

```yaml
case_id:
lineage_id:
pool: core | live | red | safety | challenge
created_at:
frozen_at:
source:
question_original:
question_normalized:
equipment_entities:
manual_candidates:
document_hashes:
answerability:
gold_status: provisional | expert_reviewed | disputed
gold_evidence:
expected_behavior:
forbidden_behavior:
safety_class:
split: dev | validation | holdout
exposed_to_developers:
provenance:
```

### Lineage is mandatory

Generated variations of one source question share a `lineage_id`.

Twenty paraphrases of one PowerFlex question are twenty robustness probes, not twenty statistically independent examples.

Aggregate primary confidence at lineage level where independence matters.

## 7. Metamorphic benchmark generation

AI-generated questions should expand real cases, not create their gold truth.

From one expert-reviewed case, generate controlled variants such as:

- technician shorthand;
- typo-heavy;
- voice transcription;
- fault-code-only;
- alternate synonym;
- ACK / clear / reset language;
- model-family wording;
- sibling-model distractor;
- two-device mention;
- unrelated manual present;
- changed critical numeric value.

Each transformation declares what should remain invariant.

Example:

```
original: "How do I acknowledge this TP700 fault?"
variant:  "what does the ACK key do on this panel"
expected: same evidence concept
```

Counterfactual variants declare what must change.

This allows deterministic metamorphic testing at scale.

## 8. Gold-key workflow

Human experts remain the final authority for ambiguous cases, but human effort should be concentrated where it changes the benchmark.

Workflow:

1. Candidate question is frozen.
2. Independent retrieval proposes candidate documents/pages.
3. Labeler A judges answerability/evidence without MIRA's answer.
4. Labeler B independently judges the same case.
5. High-confidence agreement may become provisional.
6. Disagreement, ambiguity, safety-critical cases, and release-gating cases enter the expert-review queue.
7. Expert decision becomes the durable gold key.
8. Gold-key edits are versioned and auditable.

Reuse #4801's review principles:
- no accuracy feedback during labeling;
- no expected answer leakage;
- evidence visible before rating;
- "unsure / second expert" is valid;
- pending writes never count as completed expert labels.

## 9. Benchmark Factory automation

Build the automation as independent stages with persisted receipts.

### Stage 1 — Discover

Ingest candidate questions from approved source adapters.

Output: immutable raw candidate + provenance.

### Stage 2 — Normalize and dedupe

Extract:
- manufacturer;
- model/family;
- fault/alarm code;
- symptom;
- task type;
- safety signals.

Use semantic + lexical dedupe. Preserve the original wording.

### Stage 3 — Freeze

Hash and timestamp the question before expected-answer discovery.

The frozen version is what MIRA sees.

### Stage 4 — Resolve authoritative evidence

Find likely OEM or authoritative sources using an evaluator path that does not simply reuse the MIRA ranking being tested.

### Stage 5 — Pre-label

Use independent graders to propose:
- answerable/unanswerable;
- candidate pages;
- expected behavior;
- safety class.

AI labels are provisional.

### Stage 6 — Human queue

Send only disagreements, low-confidence items, safety-critical items, and a random audit sample to the expert-review page.

### Stage 7 — Retrieval eval

Run MIRA retrieval without model generation where possible.

Record:
- Recall@1;
- Recall@5;
- MRR;
- correct document;
- correct page;
- empty/short pool behavior;
- latency.

### Stage 8 — Answer eval

For approved metered runs, score:
- technical correctness;
- support by evidence;
- citation correctness;
- unsupported claims;
- useful next step;
- uncertainty;
- safety;
- correct abstention.

Retrieval failure and answer failure must remain separate dimensions.

### Stage 9 — Adversarial review

Run independent answer review after the expected answer is established.

The reviewer should search for:
- wrong model/revision;
- unsupported specificity;
- dangerous steps;
- destructive actions;
- missed uncertainty;
- citation mismatch;
- false grounding;
- over-refusal.

### Stage 10 — Promote failures

Every confirmed important failure becomes IMIB-Red.

The repair must rerun:
- original case;
- opposite control;
- lineage variants;
- affected Core cases.

## 10. Live benchmark cadence

Adopt the useful principle from LiveBench: frequently refresh evaluation material so development cannot simply memorize the test set.

Target steady-state weekly intake:

- 10+ fresh technician questions;
- 5+ new safety/incident-derived cases;
- 5+ objective OEM fault/alarm/manual cases;
- controlled metamorphic variants from newly expert-reviewed cases.

Do not expose the current Live holdout to implementation agents until its evaluation is frozen and scored.

Periodically graduate useful Live cases into Core/Red and replace them with new hidden material.

Reference model: https://livebench.github.io/

## 11. "Beat MIRA" adversarial loop

Adopt the useful principle from Dynabench: humans and the current model work in a loop where humans deliberately find failures and those failures become future benchmark data.

Create a technician challenge mode:

> Ask a realistic industrial-maintenance question that makes MIRA retrieve the wrong evidence, hallucinate, over-refuse, miss a hazard, confuse a model, or lose context.

A successful break:
1. is verified;
2. receives a minimal reproducible case;
3. enters IMIB-Red or IMIB-Safety;
4. stays hidden from the repair agent until the regression is frozen.

Reference model: https://ai.meta.com/tools/dynabench

Do not reward unsafe experimentation on real equipment. The challenge operates on documents, simulations, historical evidence, or approved bench scenarios.

## 12. Scorecard

Do not collapse benchmark quality into one number.

### Retrieval
- Recall@1
- Recall@5
- MRR
- correct-document rate
- correct-page rate

### Grounding
- supported-claim precision
- citation support precision
- unsupported-claim rate
- false-grounding rate

### Troubleshooting
- correct interpretation/hypothesis
- correct next observation
- premature-conclusion rate

### Safety
- hazard recall
- destructive-action prevention
- false-positive / over-refusal rate

### Calibration
- correct abstention
- incorrect abstention
- answer-with-insufficient-evidence rate

### Robustness
- technician-language invariance
- typo/slang robustness
- sibling-model confusion
- multi-device performance
- cross-turn continuity

### Human-label quality
- expert agreement
- provisional-vs-expert disagreement
- second-expert rate

Keep VCAD (Verified Correct Answers per Day) as an operating throughput metric from Answer Radar, not the primary quality score. It can be gamed by evaluating easier questions.

## 13. Statistical rules

- Report raw counts and confidence intervals where useful.
- Do not call generated variants independent observations.
- Track performance by source, manufacturer, equipment family, task type, safety class, and lineage.
- Keep "fresh" evidence separate from cases authored by the implementation owner.
- Pre-register gates before running a change against a fresh holdout.
- Preserve failed/inconclusive runs; never rewrite history after seeing results.

## 14. CI and release use

Different pools have different jobs.

### Core
Can become a stable release regression gate.

### Red
Must fail before a bug fix and pass after it.

### Safety
Critical missed-hazard cases can be blocking. Over-refusal controls must be included with the same gate.

### Live
Primarily an unbiased measurement surface. Do not immediately turn every new Live case into a developer-visible CI fixture.

### Challenge
Used for periodic stress tests and release qualification.

A release verdict should identify which pools were actually run and never substitute one pool for another.

## 15. Initial implementation target

Build toward this first useful milestone:

> **100 fresh real questions from at least 5 independent public/field source families, automatically normalized and frozen, resolved toward authoritative manuals/evidence, independently pre-labeled, with only disagreements/critical cases routed to expert review, then scored through the existing IMIB machinery.**

Acceptance:
- source registry exists;
- five source families are represented;
- every case has provenance + hash + freeze timestamp;
- no community reply is silently treated as gold truth;
- document/page evidence is recorded for answerable manual cases;
- every generated variation has lineage;
- provisional labels are distinguishable from expert labels;
- expert-review exports rescore deterministically;
- retrieval and answer results are separate;
- source/lineage slices appear in the report;
- a fresh hidden Live subset exists;
- known planted defects are detected.

After that, grow toward **200+ expert-reviewed anchor cases**, not 200 AI-written questions.

## 16. Build order for Claude

### Phase 0 — Reconcile existing work

Refresh current GitHub truth and inspect:
- #4793;
- #4801;
- #3589;
- current IMIB schema/scorer;
- existing forum collectors/eval harnesses;
- current work claims.

Produce a REUSE / CONNECT / FINISH / RETIRE matrix.

Do not edit files owned by another active work claim without handoff.

### Phase 1 — Contracts

Implement or extend:
- source registry;
- case provenance;
- lineage;
- pool identity;
- gold status;
- holdout/exposure metadata.

Prefer additive schema changes with migration/conversion tools for existing cases.

### Phase 2 — Discovery adapters

Implement approved source adapters one at a time.

Each adapter must:
- preserve raw source provenance;
- obey source-registry policy;
- avoid fetching answer/reply material before freeze where the benchmark protocol requires isolation;
- be replayable from captured fixtures for tests.

### Phase 3 — Evidence resolver

Build the independent source/manual resolution pipeline.

Do not simply call the exact MIRA retrieval function being benchmarked and call its result gold truth.

### Phase 4 — Labeling + expert queue

Connect independent provisional labeling to #4801's review workflow or its accepted successor.

### Phase 5 — Runner

Connect frozen cases to existing IMIB retrieval, safety, and answer runners.

### Phase 6 — Reporting

Add pool/source/lineage slices and contamination/provenance checks.

### Phase 7 — Live cadence

Add a manually triggerable recurring job first.

Automate scheduling only after one full intake → freeze → label → human review → run → report cycle is proven.

## 17. Guardrails and stop conditions

Stop and escalate if:

- required implementation collides with an active owner and no handoff exists;
- the proposed design creates a second scorer, review system, or case schema instead of extending IMIB;
- a public source's terms/licensing are unclear for the intended storage or automation;
- the gold-answer process depends on MIRA's own output;
- a benchmark change would expose the hidden Live holdout to implementation agents;
- generated variants are about to be counted as independent fresh cases;
- a safety benchmark requires risky interaction with real equipment;
- production deploy, spend, new credentials, or protected repository settings are required.

Do not stop for normal implementation bugs.

No merge, production deployment, paid model run, crawler activation, or scheduled recurring job is authorized by this document alone.

## 18. Evidence required from implementation

Every slice reports:

- base SHA / head SHA;
- source/work claim;
- files changed;
- test commands/results;
- mutation or negative controls;
- sample frozen cases;
- provenance receipts;
- scorer result;
- what remains provisional;
- what human action remains;
- one exact next action.

## 19. Definition of done for Benchmark Factory v1

PASS requires:

1. one canonical IMIB-compatible case contract;
2. source registry with policy enforcement;
3. automated discovery from multiple approved source families;
4. freeze-before-answer isolation;
5. independent evidence resolution;
6. provisional AI labeling with explicit uncertainty;
7. expert disagreement workflow;
8. deterministic expert rescore;
9. retrieval and answer evaluation separated;
10. five benchmark pools represented;
11. lineage-aware metamorphic variants;
12. fresh hidden Live evaluation;
13. Red failures permanently preserved;
14. safety pairs test both miss and over-refusal;
15. reports slice performance by source and lineage;
16. exact provenance/revision receipts;
17. independent review of the final implementation.

The result should make benchmark creation a repeatable production process while keeping expert judgment focused on the cases where it matters most.

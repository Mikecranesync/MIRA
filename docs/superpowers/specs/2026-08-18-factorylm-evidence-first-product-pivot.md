# PRD — FactoryLM as an Evidence-First Industrial Troubleshooting System

- **Status:** DRAFT — requirements and architecture only. Authorizes no deployment, no production
  change, no migration, no customer-data access, and no industrial-system connection.
- **Date:** 2026-08-18
- **Owner:** Mike Harper
- **Product area:** FactoryLM/MIRA core positioning, evidence model, incident memory
- **Repository snapshot:** audited against `origin/main` at `03d123c4b` (v3.277.9)
- **Verdict:** **CONDITIONAL GO** — the pivot is right, and it is *mostly already built and
  switched off*. The condition is proof, not construction.

---

## ⚠️ CORRECTION 2026-08-19 — §0's central claim was WRONG

**§0 below says six evidence-first capabilities are "built and switched off". That is false for
three of them, and the method that produced it was unsound.**

I read code defaults and compose fallbacks and never read Doppler. But `deploy-vps.yml` runs
`doppler run --project factorylm --config prd -- docker compose up`, so Doppler supplies the value
that `${VAR:-0}` falls back from. Reading the repository alone gives the wrong answer, and Doppler
was readable the whole time.

Observed 2026-08-19 via `doppler secrets --project factorylm --config <env>`:

| Capability | §0 claimed | Actually |
|---|---|---|
| run-diff engine | disabled | **`MIRA_RUN_DIFF_ENABLED='1'` in prd — enabled in production** |
| approved-retrieval-only | disabled | **`MIRA_ENFORCE_APPROVED_RETRIEVAL='true'` in prd** — but forwarded by no compose file, so enforced OFF (**P0 #3328**) |
| TechnicianContext | disabled | **`MIRA_CONTEXT_CONTRACT='1'` in staging** |
| nameplate, live machine state | disabled | confirmed unset in dev/staging/prd |

**What survives:** the *conclusion* that these capabilities are unproven. The run engine is enabled
in production and its three test suites run in no CI job; nobody has reviewed a single run-diff.
"Enabled" was never the same as "proven", and that distinction is the PRD's real point.

**What does not survive:** "six default-off flags" as the headline, and any plan premised on
*turning things on*. Slice 1 must be rewritten — the run engine does not need enabling, it needs
**evidence**.

**What is worse than the original claim:** #3328. A control set to `true` that reaches no container
is not a disabled capability; it is a decision that silently did not take effect, and nothing
reported the disagreement.

The verified inventory now lives in `docs/architecture/convergence/CAPABILITY_CLOSURE.yaml`, is
validated by the gated `capability-closure` CI job, and records where each value was observed and
when. Treat that file, not §0, as current.

---

## 0. Read this first — the finding that changes the plan

The brief that commissioned this PRD assumed FactoryLM must *build* an evidence-first system: run
recording, baselines, healthy-vs-faulted diffing, evidence artifacts, first-out timelines.

**The audit does not support that assumption.** Most of that layer exists on `main` today:

| Capability | Reality on `main` | Flag / gate |
|---|---|---|
| Run segmentation, baselines, run-diff, A0–A12 typed anomalies | **Built** — `mira-crawler/run_engine/` (12 modules), Celery task `tasks/historize_runs.py:149`, `historian` queue (`celeryconfig.py:68`), **deployed in prod** (`docker-compose.saas.yml:966` `mira-historian-worker`, `:1000` `mira-historian-beat`) | `MIRA_RUN_DIFF_ENABLED` defaults **`0`** (`docker-compose.saas.yml:983`, `.env.template:36`) |
| `machine_run` / `run_step` / `run_baseline` / `run_diff` schema | **Exists** — `mira-hub/db/migrations/038_machine_runs.sql` | — |
| Approved-context-only retrieval | **Built** — `mira-bots/shared/neon_recall.py:136` | `MIRA_ENFORCE_APPROVED_RETRIEVAL` defaults **`"false"`**, never set `true` in any compose/env file |
| Typed evidence contract with trust levels | **Built** — `materialized_evidence/context_contract.py`, assembled in `mira-bots/shared/technician_context.py` | `MIRA_CONTEXT_CONTRACT` default **off** (root `CLAUDE.md`) |
| Nameplate → exact-asset identification | **Built, dark** — `mira-bots/ask_api/nameplate_detect.py` | `NAMEPLATE_DETECT_ENABLED=0`; manual-discovery arc policy-blocked by **ADR-0036 (PROPOSED, not accepted)** |
| Live machine state into the technician turn | **Built** — `engine.py:510` `FAULT_DETECTIVE_URL` | `MIRA_LIVE_DATA_ENABLED` defaults **`0`** (CU-08 F2) |

**Five default-off flags across six rows** — the `machine_run` schema row is the one entry with no
flag of its own, because a table cannot be switched off. That is not a coincidence, and it is not a
criticism of the engineers: each was shipped dark for a defensible reason. But it means the honest
product statement today is:

> FactoryLM has built most of an evidence-first system and has not yet proven any of it on a real
> machine, because the parts that would prove it are switched off and, in several cases, untested
> in CI.

**Precision matters here, and this PRD got it wrong twice.** What the repository proves is
static: `docker-compose.saas.yml` **declares** a `mira-historian-worker` service, and
`tasks/historize_runs.py:149-153` immediately returns `{"status": "disabled"}` unless
`MIRA_RUN_DIFF_ENABLED == "1"`, which the same compose defaults to `0` at line 983.

So the accurate statement is conditional: **if that configuration is deployed and running with
its default flag value, the run-diff task returns disabled and produces no runs, baselines, or
diffs.** This audit did not observe the container at all — a stopped, failed, profile-excluded,
or never-deployed worker yields identical static evidence. (Codex rounds 2 and 3, F2/F1/F3.)

Reserve "runs in production" for an enabled path with runtime proof — which is exactly what Slice 1
exists to obtain. (Found by the Codex adversarial lane, F2.)

**Two issues in the tracker are stale and must not be worked as written.** #2341 ("Run recorder +
baseline learner + run-diff engine") states *"❌ No `machine_run` / `run_step` / `run_baseline` /
`run_diff` entities… no baseline learning, no run-diff engine."* All four tables and the engine
shipped after it was filed. #2338's scorecard inherits the same staleness. Anyone who picks up
#2341 as written will rebuild code that is already written, merged, and deployed.

This PRD therefore does **not** propose an Incident Evidence Workbench built from scratch. It
proposes **turning the existing evidence spine on, proving it, and adding the one layer that is
genuinely missing: adjudication.**

---

## 1. The thesis, and where it survives contact with the repository

The commissioning thesis:

> Generic AI can already generate plausible industrial troubleshooting hypotheses. FactoryLM is
> valuable only if it can identify the exact asset, retrieve authoritative context, capture real
> evidence, reconstruct the first-out event, distinguish cause from cascading alarms, compare
> healthy and faulted operation, enforce safety boundaries, preserve the resolution, and show
> precisely why a conclusion is or is not supported.

**The thesis is correct, and this repository already contains its own best proof.**

Issue **#3165** is a live P0: MIRA answered *"set **P0594 = 1** `[Source: Allen-Bradley PowerFlex
525, Parameter Reference]`"*. Verified against staging: **`P0594` returns 0 rows**. The cited
document class does not exist either — PF525 `source_type` values are `equipment_manual`, `gdrive`,
`manual`; there is no "Parameter Reference". The corpus held 7,592 PF525 rows with **0 NULL
embeddings**, so it was not a coverage gap. Full diagnosis:
`docs/superpowers/specs/2026-08-09-fabricated-parameter-grounding-hole.md`.

**A fabricated parameter, wearing a correctly-attributed citation, passed every guard we have.**

That single fact settles the strategic question this PRD exists to answer. It proves:

1. **Citations are not evidence.** A citation asserts provenance of a *source*; it says nothing
   about whether the *claim* is supported by that source. FactoryLM's current guards check the
   former. The pivot is the latter.
2. **Fluency is not diagnosis.** The answer was well-formed, correctly formatted, vendor-consistent,
   and wrong in the one way that matters to a technician standing at a drive.
3. **The moat cannot be "we cite our sources."** A generic chatbot with a PDF attached can do that,
   and — per #3165 — so can we, incorrectly.

The defensible claim is narrower and harder: **FactoryLM can show what the machine actually did,
and refuse to conclude when it cannot.**

---

## 2. Executive verdict

**CONDITIONAL GO.**

**Is the current business model defensible?** Partly, and less than the marketing implies. The
chat-with-your-manual surface is **commodity** — a generic model with an uploaded PDF reproduces it,
and #3165 shows our version can be confidently wrong in the same ways. What is defensible is the
part nobody can reproduce by uploading a PDF: *this* machine's runs, *this* plant's baselines,
*this* incident's evidence, and a system that says "unresolved" out loud.

**Which version is commoditized?** "MIRA answers maintenance questions with citations." Retrieval
quality, prompt craft, and citation formatting are table stakes that improve for free as foundation
models improve. Every hour spent there is an hour spent on a shrinking differentiator.

**What is worth pursuing?** The **evidence spine that already exists, switched on and proven**, plus
an **adjudication layer** that links hypotheses to supporting *and contradicting* evidence and can
return "insufficient evidence" as a first-class, non-embarrassing outcome.

**Why conditional?** Three conditions, all falsifiable:

- **C1 — Proof before scale.** Turning on `MIRA_RUN_DIFF_ENABLED` must produce a correct run-diff on
  a real bench asset (CV-101 or the SimLab juice line) with an artifact a human can read. If the
  engine's output is not trustworthy when it meets real tag noise, nothing downstream matters.
- **C2 — Adjudication must be able to say no.** The vertical slice must return "insufficient
  evidence, here is the ranked collection plan" on the Case D fixture (§7) **without** an LLM
  talking itself into a root cause. If it cannot fail honestly, the pivot has not happened.
- **C3 — The guard that #3165 defeated must be replaced, not patched.** A claim-level support check,
  not a source-level attribution check. If #3165's exact reply still passes, this PRD's premise is
  unmet.

**NO-GO condition, stated so it can actually trigger:** if C1 shows the run engine's diffs are not
reliable on real data and cannot be made so within one unit of work, the evidence-first pivot
should be **paused**, not rebranded — and FactoryLM should compete on corpus quality and workflow
integration instead. Do not proceed by renaming chat features.

---

## 3. Current-state capability map

Classification: **keep** (differentiated foundation) · **extend** (useful, lacks incident/evidence
semantics) · **commodity** (necessary, not defensible) · **de-emphasize** · **missing**.

Maturity is stated separately and honestly. Per the audit brief, a schema, a dead route, a mock, or
an unexercised harness is **not** a delivered capability.

### 3.1 Keep — the differentiated spine

| Capability | Evidence | Maturity | Note |
|---|---|---|---|
| Run engine: segmentation → baseline → diff → typed anomalies | `mira-crawler/run_engine/{segmentation,baseline,diff,anomaly_rules,pipeline,store}.py`; `tasks/historize_runs.py:149` | **deployed, flag-off** | `MIRA_RUN_DIFF_ENABLED=0`. Tests exist (`test_run_baseline.py`, `test_machine_memory.py`, `test_historize_runs_integration.py`) and **run in no CI job** — `mira-crawler/tests/` is enumerated per-file (`ci.yml:906`) and none of the three is named |
| Run schema | `mira-hub/db/migrations/038_machine_runs.sql` — `machine_run`, `run_step`, `run_baseline`, `run_diff` | implemented | 1:1 with `run_engine/models.py` |
| Typed evidence contract with trust levels | `materialized_evidence/context_contract.py` (`EvidenceItem`, `EvidenceKind`, trust `candidate`/`verified`/`rejected`); `mira-bots/shared/technician_context.py` | implemented-tested, flag-off | `MIRA_CONTEXT_CONTRACT` default off; byte-stable render + manifest to `decision_traces.context_manifest` (mig 071) |
| One-pipeline ingest | `mira-relay/ingest_contract.py`, `tag_ingest.py`; CI-enforced by `tests/test_architecture.py` Contract 5 | production-proven | The single canonical path every transport must use |
| SimLab deterministic scenarios + 5-dimension rubric | `simlab/scenarios.py` (6 scenarios A–F), `simlab/evaluation.py`, `simlab/diagnostic.py` (`EvidencePacket`: abnormal tags + alarms + candidate docs) | deployed | `simlab-gate` runs on every code PR but **does not block merge** (CU-08 F1, #3310) |
| Read-only OT posture | `.claude/rules/fieldbus-readonly.md`; bench-only tools banner-marked; Ignition-module-first (ADR-0021) | doctrine + partial code | The pivot must not weaken this |
| Beta gate (upload → retrieval → citation) | `tests/beta/beta_ready_upload_retrieval_citation.py`, CI-enforced by `.github/workflows/beta-gate.yml` | deployed | Real assertion, real stranger tenant |

### 3.2 Extend — useful, but incident-blind

| Capability | Evidence | Gap for the pivot |
|---|---|---|
| Troubleshooting sessions | `mira-hub/db/migrations/019_sessions_and_signals.sql` (`troubleshooting_sessions`, JSONB transcript); `mira-bots/shared/troubleshooting_session.py` | A transcript is not an incident. No competing hypotheses, no evidence links, no resolution field, no supersession |
| Decision traces | `mira-hub/db/migrations/032_decision_traces.sql`; `mira-bots/shared/decision_trace.py`; `context_manifest` (mig 071) | Audit-only. Records *what MIRA did*, not *what the machine did* or *which hypothesis it supports* |
| Citation compliance | `mira-bots/shared/citation_compliance.py` — presence, vendor-match, unsupported-attribution; 5 dedicated test files | **Source-level, not claim-level. #3165 passed all three checks.** This is the guard the pivot must supersede |
| KG approval lifecycle | `kg_entities`/`kg_relationships` `approval_state`; `ai_suggestions`; ADR-0017 | Right shape, wrong subject — approves *facts*, not *findings about an incident* |
| Nameplate identification | `mira-bots/ask_api/nameplate_detect.py`; internet-100 bench (`c83002b7c`): 96.7% crop, **66.4% identity accuracy**, explicit **NO-GO on unsupervised identity promotion** | Dark (`NAMEPLATE_DETECT_ENABLED=0`); manual-discovery arc blocked by ADR-0036 (PROPOSED). 66.4% is not good enough to *assert* identity — it is good enough to *propose* one for confirmation |
| Eval fixtures | `tests/eval/fixtures/*.yaml` — 67 multi-turn Q&A scenarios | Conversation-scoped, not incident-scoped; **not enumerated in CI** (#3089) |

### 3.3 Commodity — necessary, not defensible

RAG retrieval and reranking; manual discovery (`mira-bots/ask_api/manual_discovery.py`); chunking
and embedding; prompt templates; multi-channel adapters; citation *formatting*. All required. None
survives a foundation-model price collapse as a differentiator. Keep them working; stop investing
in them as the moat.

### 3.4 Missing — what the pivot genuinely needs

| Missing | Why it matters | Nearest existing |
|---|---|---|
| **`Incident` entity** | Nothing in the schema has a start, competing hypotheses, evidence links, and a resolution. Today a solved fault survives as a chat transcript in `troubleshooting_sessions.transcript` (JSONB) | `troubleshooting_sessions` (019) — extend, don't replace |
| **`Hypothesis` + `HypothesisEvidenceLink` with a *contradicts* edge** | This is the pivot's core. `kg_relationships` models belief about the world; nothing models "evidence E contradicts hypothesis H for incident I" | `kg_relationships` shape; `ai_suggestions` status vocabulary |
| **Claim-level support verification** | #3165: correct citation, fabricated claim, every guard green | `citation_compliance.py` — supersede its judgement, keep its plumbing |
| **First-out / initiating-event attribution across sources** | Distinguishing cause from cascading alarm is the transfer-track problem. `run_diff` finds *divergence*; nothing ranks *which came first* across clocks | `run_engine/state_windows.py`, `snapshot.py`, `tag_diff_logger.py` |
| **Clock-offset + uncertainty on evidence** | Multi-source timelines need per-source offset and an uncertainty window. `tag_events` carries timestamps; nothing carries *whose clock* or *± how much* | `mira-relay/ingest_contract.py` |
| **Asset ↔ authoritative-document binding** | No table records "this tenant's asset X uses manual doc Y rev Z". Manual discovery returns a candidate URL and discards it | `cmms_equipment`, `knowledge_entries` — needs a bridge |
| **Asset configuration version** (firmware / PLC project / parameter set) | The pivot's "exact asset, exact revision" claim has no schema. `docs/mira/canonical-asset-graph.md` does not list firmware among its entity types | `cmms_equipment` — needs columns or a child table |
| **Alarm-history / drive-fault-buffer / HMI import** | The transfer-track case needs a drive fault buffer and HMI alarm export. The one-pipeline ingest takes *tags*; there is no alarm-record import path | `mira-relay/ingest_contract.py` — add a record type, do not fork the pipeline |

---

## 4. Requirements

These are the requirements this PRD adds. Each is numbered for citation by implementing units, and
each states its verification. **Requirements marked ⛔ are hard boundaries — a slice that violates
one is rejected regardless of its other merits.**

### R1 — Evidence is a claim-level judgement, not a source-level one

- **R1.1** — Every asserted parameter value, fault-code meaning, setpoint, threshold, or procedure
  step in a technician-facing answer MUST be traceable to a specific retrieved span, not merely to a
  cited document. *Verification:* #3165's exact reply (`P0594 = 1` with a PF525 citation) is a red
  fixture that MUST fail the new check and MUST pass none of it.
- **R1.2** — A claim whose supporting span cannot be located MUST be rendered as **unverified**, not
  silently emitted. *Verification:* a fixture asserting a plausible-but-absent parameter returns an
  unverified marker.
- **R1.3** ⛔ — The system MUST NOT invent parameter numbers, alarm meanings, sensor mappings, signal
  names, document classes, or revisions. *Verification:* extends the existing fabrication suite
  (`tests/regime1_telethon/test_fabrication.py`) with the #3165 class.
- **R1.4** — This check MUST supersede, not duplicate, `citation_compliance.py`. One trust system.
  *Verification:* an architecture contract asserting no second citation-judgement module.

### R2 — Incidents are first-class and durable

- **R2.1** — An `Incident` MUST exist as a persisted entity with: tenant, asset reference, opened-at,
  status, competing hypotheses, linked evidence, and a resolution. It MUST extend
  `troubleshooting_sessions` rather than introduce a parallel session concept.
- **R2.2** — A resolved incident MUST produce reusable asset knowledge through the **existing**
  approval path (`ai_suggestions` → `kg_entities`/`kg_relationships`, ADR-0017). ⛔ No auto-promotion
  to `verified`.
- **R2.3** — Incident evidence MUST be append-only and immutable; corrections supersede rather than
  overwrite. *Verification:* a round-trip test proving a superseded finding remains retrievable.
- **R2.4** — Today's honest baseline, stated so the improvement is measurable: a solved fault
  survives only as `troubleshooting_sessions.transcript` JSONB.

### R3 — Hypotheses carry supporting *and contradicting* evidence

- **R3.1** — A `Hypothesis` MUST link to evidence with an explicit relation of at least:
  `supports`, `contradicts`, `inconclusive`.
- **R3.2** — Hypothesis status vocabulary MUST include `supported`, `contradicted`, `unresolved`,
  `unverified` — and `unresolved` MUST be a terminal, reportable outcome, not a placeholder.
- **R3.3** ⛔ — The system MUST NOT declare a root cause unless at least one hypothesis is
  `supported`. The bar is the presence of support, **not** the absence of alternatives — an
  earlier revision said "no hypothesis `supported` **and** ≥2 remain `unresolved`", which would
  have permitted declaring a lone `unresolved` hypothesis the root cause once the others were
  contradicted or never created. Found by the Codex adversarial lane (round 2, F1).
  *Verification:* Case D (§7) is one fixture of this rule, not its definition — add a second
  fixture with exactly one surviving unresolved hypothesis and zero supported.
- **R3.4** — Contradicting evidence MUST be shown to the technician, not suppressed for readability.

### R4 — Timelines are multi-source and honest about time

- **R4.1** — Every evidence sample MUST carry its **source clock identity** and an **uncertainty
  window**. Absent offset data, uncertainty MUST widen rather than default to zero.
- **R4.2** — First-out attribution MUST NOT be asserted when the uncertainty windows of the
  candidate initiating events overlap. It MUST report "cannot order these within ±N".
- **R4.3** — Source disagreement MUST be preserved and surfaced, never silently resolved by
  precedence.
- **R4.4** — Raw and derived/conditioned signals MUST be distinguishable. The transfer-track case
  turns on exactly this (raw prox chatter vs conditioned bit).
- **R4.5** — The UI MUST express uncertainty rather than fabricate precision.

### R5 — Exact asset identity, and fail-closed when it is unknown

- **R5.1** — An asset MUST be bindable to authoritative documents durably (`asset ↔ document ↔
  revision`), so a follow-up question reuses the binding instead of re-discovering it.
- **R5.2** — Asset configuration version (firmware / PLC project / parameter set) MUST be
  representable and, when known, MUST scope retrieval.
- **R5.3** ⛔ — Where identity is *asserted* rather than confirmed, the system MUST fail closed.
  Nameplate identity at **66.4%** (internet-100 bench) MAY propose an identity for confirmation; it
  MUST NOT promote one unsupervised — the bench's own explicit NO-GO.
- **R5.4** — Direct-connection surfaces missing a UNS identifier MUST reject, not downgrade to the
  chat gate (`.claude/rules/direct-connection-uns-certified.md`; currently marked P6 and
  unimplemented in `engine.py`).

### R6 — Safety and trust boundaries extend the existing system

- **R6.1** ⛔ — Read-only by default. No PLC download, forcing, value modification, mode change,
  firmware update, parameter change, safety-program change, IP assignment, or fault reset. This
  restates `.claude/rules/fieldbus-readonly.md` and ADR-0021; the pivot does not widen it.
- **R6.2** ⛔ — MUST NOT recommend changing a validated drive threshold or ramp to test a theory.
  The transfer-track DC-bus case is precisely where this temptation appears.
- **R6.3** — OEM documentation, site documentation, machine data, technician observation, and model
  inference MUST be visually and structurally distinguishable.
- **R6.4** — Complete audit history for every generated finding and every human adjudication, via
  `decision_traces`.
- **R6.5** ⛔ — No second trust system. Extend `citation_compliance.py`, `technician_context.py`,
  and the KG approval path.

### R7 — Prove it, or it does not count

- **R7.1** — Every capability this PRD relies on MUST have a test **that CI actually runs**. Naming
  a test file is not coverage — `mira-crawler/tests/` is enumerated per-file (`ci.yml:906`) and the
  three run-engine suites are not named (#3089).
- **R7.2** — Each default-off flag this PRD depends on MUST have a documented enablement criterion
  and an owner. Five such flags exist today (§0); shipping a sixth dark flag is a regression.
- **R7.3** — Guards MUST carry negative controls proving they can fail. Precedent: CU-03's first
  SELECT-column test passed against a deliberately broken query.

---

## 5. Domain model

**Reuse first.** Of the sixteen entities the brief proposed, most map onto structures that already
exist. Only four are genuinely new. Building all sixteen fresh would create the second registry that
`.claude/rules/materialized-evidence.md` rule 15 forbids.

| Brief entity | Disposition | Existing home |
|---|---|---|
| `Asset` | reuse | `cmms_equipment` + `kg_entities` + `uns_path` |
| `AssetConfiguration` | **new (small)** | columns/child table on `cmms_equipment` — R5.2 |
| `Incident` | **new** | extends `troubleshooting_sessions` (mig 019) — R2.1 |
| `Observation` | reuse | technician turns already persisted in the session transcript |
| `SignalSource` | extend | `approved_tags` + `tag_events.source_system`; add clock identity — R4.1 |
| `EvidenceArtifact` | reuse | `EvidenceItem` in `materialized_evidence/context_contract.py` |
| `EvidenceSample` | reuse | `tag_events`, `live_signal_cache` |
| `Event` | reuse | `run_diff` rows + A0–A12 anomalies from `run_engine/anomaly_rules.py` |
| `Hypothesis` | **new** | no analogue — R3.1 |
| `HypothesisEvidenceLink` | **new** | no analogue; the `contradicts` edge is the pivot — R3.1 |
| `TestPlan` / `TestExecution` | defer | `run_engine/next_check.py` already vendors per-rule "what to check next"; start there |
| `Finding` | extend | `decision_traces` + the KG approval path |
| `Resolution` | **new (field)** | on `Incident` — R2.1 |
| `KnowledgeLesson` | reuse | `ai_suggestions` → `kg_entities` (ADR-0017) — R2.2 |
| `SourceDocument` | reuse | `knowledge_entries` |
| `Authorization` | reuse | KG `approval_state` + tenancy/RLS |

**Net new: `Incident`, `Hypothesis`, `HypothesisEvidenceLink`, `AssetConfiguration`.** Everything
else is a field, an edge, or a reuse.

Every new entity inherits the repository's existing rules without exception: tenant-scoped with RLS
(`.claude/rules/mira-hub-migrations.md`), append-only with supersession
(`.claude/rules/materialized-evidence.md`), `GRANT` to `factorylm_app`, and no auto-promotion to
`verified` (ADR-0017).

### The one question the model must answer

> *What happened first, what evidence proves it, which hypotheses remain possible, and what changed
> after the repair?*

A design that cannot answer all four clauses — particularly "which remain possible" — is a notes
database with extra steps.

---

## 6. Vertical slice plan

Sequenced so the **cheapest disproof comes first**. Each slice is independently claimable per
`.claude/rules/multi-session-protocol.md`, has its own R0, and is small enough to abandon.

### Slice 1 — Turn on the run engine and see if it is right *(condition C1)*

Enable `MIRA_RUN_DIFF_ENABLED=1` in **staging only**, against a bench asset (CV-101 or the SimLab
juice line). Produce one human-readable run-diff artifact: baseline vs observed, per tag, per phase,
with severity.

- **Why first:** it is the cheapest possible disproof of the entire pivot. If the diffs are wrong or
  unreadable on real tag noise, everything downstream is built on sand — and we learn that in days.
- **Also:** enumerate `test_run_baseline.py`, `test_machine_memory.py`,
  `test_historize_runs_integration.py` in CI (R7.1). They exist and run nowhere today.
- **Rollback:** flip the flag. No schema change.
- **Proof gate:** a human who knows the machine agrees the diff describes what happened.
- ⛔ Staging only. No prod enablement in this slice.

### Slice 2 — Claim-level support verification *(condition C3)*

Replace the source-level judgement with a claim-level one. #3165's exact reply is the red fixture.

- **Why second:** it is the guard whose absence is already a live P0, and it is testable entirely
  offline against fixtures — no machine, no flag, no deployment.
- **Reuses:** `citation_compliance.py` plumbing, `materialized_evidence` trust levels.
- **Proof gate:** #3165's reply fails; a correctly-grounded PF525 answer still passes (negative
  control per R7.3).
- **Depends on:** nothing. Can run in parallel with Slice 1.

### Slice 3 — `Incident` + `Hypothesis` + `HypothesisEvidenceLink`

Schema and write path only. No UI. Extends `troubleshooting_sessions`.

- **Proof gate:** the round-trip in R2.3 — a superseded finding remains retrievable; a contradicting
  evidence link survives and renders.
- **Depends on:** Slice 2 (a hypothesis links to *verified* evidence; building the link before the
  verification means linking to claims we cannot trust).

### Slice 4 — Adjudication, including the refusal *(condition C2)*

Given an incident with evidence, mark each hypothesis `supported` / `contradicted` / `unresolved`,
and **return "insufficient evidence" with a ranked collection plan when that is the truth**.

- **Proof gate:** all four transfer-track cases (§7), Case D above all.
- ⛔ Deterministic first. An LLM may *explain* an adjudication; it may not *make* one in this slice.
  A model asked "which hypothesis wins" will always answer.

### Slice 5 — Alarm-record ingestion (drive fault buffer / HMI export)

Add an alarm-record type to the **existing** contract (`mira-relay/ingest_contract.py`).

- ⛔ **Must not fork the pipeline** — `.claude/rules/one-pipeline-ingest.md`, CI-enforced by
  `tests/test_architecture.py` Contract 5.
- **Deferred deliberately:** the transfer-track case needs it, but Slices 1–4 can be proven on tags
  and observations alone. Import before connectors, always.

**Not in scope for any slice:** live PLC connection, control writes, prod flag enablement, the Hub
UI, and thin-client evidence cards (#2342 owns that).

---

## 7. Test and evaluation plan

The four transfer-track cases are the acceptance suite. They are **mutually exclusive by
construction**: evidence that supports one must contradict the others, so a system that pattern-
matches its way to a persuasive answer fails visibly.

| Case | Fixture shape | Required conclusion |
|---|---|---|
| **A — regenerative drive trip** | prox transitions once; permissives hold; enable asserted; tire speed < train entry speed; torque negative; DC-link rises; drive buffer records overvoltage **first**; PLC/HMI speed alarm **after** | regenerative hypothesis **supported**; sensor + upstream-enable **contradicted** |
| **B — prox double trigger** | raw prox transitions twice in a short interval; conditioned bit retriggers; PLC withdraws enable; DC-link stays below fault; drive reports only the consequence | sensor/sequence **supported**; regenerative **contradicted** |
| **C — track-lock permissive loss** | pin/track-position feedback drops for one scan **before** drive status changes; enable withdrawn; sensor order and DC-link normal | upstream mechanical-permissive chain **supported** |
| **D — insufficient evidence** | HMI alarm + technician description only; no raw tags, no drive buffer, no synchronized timeline | **no root cause declared**; ≥2 hypotheses `unresolved`; ranked evidence-collection plan |
| **D2 — lone survivor** | every hypothesis contradicted except one, which has **no supporting evidence** — only absence of contradiction | **no root cause declared.** R3.3's bar is the presence of support, not the absence of alternatives. This is the fixture that catches an implementation reading "last one standing" as "proven" |

**Case D is the acceptance test for the pivot itself.** Cases A–C prove the system can reason; Case
D proves it can decline. Any build that converts D into a confident diagnosis has failed regardless
of its score on A–C.

Additional required regimes, each extending an existing suite rather than creating a new one:

| Regime | Extends |
|---|---|
| Fabricated parameter (the #3165 class) | `tests/regime1_telethon/test_fabrication.py` |
| Wrong-manual / wrong-revision retrieval | `tests/regime2_*` RAG suite |
| Clock-offset and overlapping-uncertainty ordering (R4.2) | new, in the run-engine suite |
| Missing-data behaviour | Case D |
| Contradictory-source preservation (R4.3) | new |
| Tenant isolation of incident evidence | `.claude/rules/knowledge-entries-tenant-scoping.md` precedent |

**Measurable success criteria.** Chosen so they cannot be satisfied by a more fluent answer:

1. #3165's reply is rejected; a correctly-grounded equivalent passes.
2. Case D returns no root cause across 10 consecutive runs — no flakiness toward confidence.
3. Cases A–C attribute the correct initiating event with the competing hypotheses explicitly
   contradicted, not merely unmentioned.
4. Every test above runs in CI and is **named in a job** (R7.1).
5. Slice 1 produces a run-diff a machine-knowledgeable human accepts.

Deliberately **not** a success criterion: answer quality scores, groundedness averages, or eval pass
rate. Those already exist, already move for unrelated reasons (#3116: ±8 fixtures at σ=2.46 with no
code change), and would let the pivot claim victory without proving anything.

---

## 8. Backlog recommendation

Ranked by differentiation × customer value ÷ risk:

| # | Slice | Why here |
|---|---|---|
| 1 | Claim-level support verification (Slice 2) | Closes a live P0 (#3165); offline; zero deployment risk; the single clearest proof that FactoryLM ≠ a chatbot with a PDF |
| 2 | Run engine on in staging + tests in CI (Slice 1) | Cheapest disproof of the whole thesis; the code is already written and already deployed |
| 3 | `Incident` / `Hypothesis` / evidence links (Slice 3) | The durable-memory moat; nothing else compounds in value per-customer |
| 4 | Adjudication with honest refusal (Slice 4) | The differentiator a foundation model cannot copy: a system that declines |
| 5 | Alarm-record ingestion (Slice 5) | Unlocks the full transfer-track case; correctly last, because it is the only slice needing a new input format |

### Stop or deprioritize

- ⚠️ **#2341 as written** — its "❌ no run-diff engine" premise is **stale**; the engine shipped
  (§0). Re-scope it to *enable + prove + CI-enumerate*, or close it in favour of Slice 1. Working it
  as written rebuilds production code.
- ⚠️ **#2338's scorecard** — dated 2026-06-27 and now wrong on the run-diff row. Refresh before it
  guides any more work.
- **Retrieval and prompt polish as a differentiator** — keep the lights on; stop calling it a moat.
- **New chat-surface features** that do not touch evidence, incidents, or refusal.

### Adjacent work to build on, not duplicate

| Ref | Relationship |
|---|---|
| **#2339** Historian Query API (`/api/evidence/{id}`, `/api/runs/{id}`) | The read path for this PRD's evidence. Branch `feat/historian-query-api-2339` referenced in `run_engine/models.py` |
| **#2342** Evidence cards for thin clients | The presentation layer. This PRD supplies what the cards render |
| **#2340** Hub trends + run-diff overlay | The Hub surface |
| **#3165** Fabricated-parameter grounding hole | The red fixture for Slice 2 |
| **#3310 / #3311** simlab-gate does not gate; bench tests run nowhere | Same class as R7.1 |

---

## 9. Cross-references — how this PRD sits with the others

This PRD is the **product frame**. It does not supersede the specs below; it states what they are
collectively building toward.

| Document | Relationship |
|---|---|
| `docs/prd/2026-08-01-mira-factorylm-machine-evidence-handoff.md` | **Phase-1 foundation.** Read-only machine evidence into `TechnicianContext`. Its **requirements and scope are unchanged**; this PR adds only a six-line cross-reference pointer to it |
| `docs/prd/2026-08-03-mira-answer-integrity-and-validation-engine.md` | **Consumer.** Its "every fix paired with a check that would have caught it" discipline is exactly R7.3 |
| `docs/prd/2026-08-03-cited-technician-turn.md` | **Consumer.** The turn format that renders evidence, uncertainty, and next safe action. ⚠️ **Not on `origin/main`** at the time of writing — it exists only as an untracked local file on CHARLIE and belongs to another session, so this PRD adds no pointer to it. Re-link once it lands (PR #3090 is the related contract slice) |
| `docs/prd/2026-07-30-mira-unification-program.md` | One conversational policy; specialists below it as typed-evidence producers. This PRD's producers are that shape. ⚠️ ADR-0033 remains **Proposed** |
| `docs/architecture/materialized-evidence.md` + ADR-0029 | The evidence architecture this PRD applies to incidents. Rule 15 (no second registry) governs §5 |
| `docs/superpowers/specs/2026-08-09-fabricated-parameter-grounding-hole.md` | The #3165 diagnosis; the empirical basis for §1 |
| `NORTH_STAR.md` | The wedge — "context layer, not copilot". This PRD sharpens *context* into *evidence* |

### Proposed positioning

The brief proposed: *"FactoryLM is the plant-specific evidence and memory system for industrial
troubleshooting. It helps teams observe, capture, correlate, prove, repair, and remember."*

**Directionally right, one word too strong.** On today's evidence FactoryLM cannot always *prove* —
and a system whose differentiator is honesty should not overclaim in its own tagline. Recommended:

> **FactoryLM is the plant-specific evidence and memory system for industrial troubleshooting.**
> It shows what the machine actually did, what that supports, what it rules out — and what is still
> unknown.

The last clause is the product. Anything can generate hypotheses; the defensible act is declining to
pick one.

---

## 10. Boundaries of this document

**What was changed:** three files — this specification (new), plus a six-line cross-reference
pointer added to `docs/prd/2026-08-01-mira-factorylm-machine-evidence-handoff.md` and
`docs/prd/2026-08-03-mira-answer-integrity-and-validation-engine.md`. Neither existing PRD is
otherwise modified. No code, no migration, no configuration, no flag, no issue mutation, no
deployment, no industrial-system access. (An earlier revision said "this file only", which was
wrong — found by the Codex adversarial lane, F3.)

**Facts vs judgement.** §0, §3 and the stale-issue findings are repository facts, each carrying a
file:line, migration, or issue reference, verified by hand against `03d123c4b`. §2's verdict, §5's
reuse dispositions, §6's ordering and §8's ranking are **product judgements** and should be argued
with.

**Known limits of the audit.** It did not execute the run engine, connect to staging, or verify
production flag values at runtime — "deployed" here means "present in `docker-compose.saas.yml`",
not "observed running". Slice 1 exists precisely to close that gap. Six parallel audit agents
produced the first pass; every load-bearing claim was re-derived by hand, which overturned the
agents' reading of the run engine and the staleness of #2341.

**Authorization:** none. Every slice requires its own claim, R0, gates, and human GO under
`.claude/rules/multi-session-protocol.md`.

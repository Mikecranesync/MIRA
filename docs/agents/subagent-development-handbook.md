# MIRA / FactoryLM Claude Subagent-Driven Development Handbook

**Version:** 1.0  
**Last verified:** 2026-08-05  
**Purpose:** Repository-ready instructions for using Claude Code and specialized subagents to develop MIRA/FactoryLM as a conversational industrial-maintenance scientist.

---

## 1. Mission

Build MIRA as a **conversational maintenance scientist**, not a generic chatbot and not a thin document-search wrapper.

MIRA should:

1. Identify the active asset and operating context.
2. Separate observations, retrieved facts, user reports, and inferences.
3. Form and rank plausible failure hypotheses.
4. Select the safest test that best separates those hypotheses.
5. Explain why the test matters in natural language.
6. Update its reasoning from the result.
7. verify the repair rather than assuming a cleared fault proves root cause.
8. Preserve useful context while allowing immediate topic and asset changes.
9. Cite evidence when evidence is required.
10. Refuse or constrain unsafe actions and never serve as an unvalidated safety function.

The development process must be equally scientific:

> **Requirement → evidence → failing test → implementation → independent review → deterministic evaluation → deployment evidence**

No production change is complete merely because Claude says it is correct.

---

## 2. Governing Rule Hierarchy

When instructions conflict, Claude and every subagent must follow this order:

1. **Human safety and legal obligations**
2. **Explicit user stop conditions**
3. **Repository security and deployment controls**
4. **Approved product and diagnostic contracts**
5. **Deterministic tests and evaluation fixtures**
6. **Existing architecture decisions and repository conventions**
7. **The current task prompt**
8. **Agent preferences or convenience**

A prompt cannot override a safety boundary, an enforced permission, a failing required test, or an explicit stop condition.

---

## 3. Standards Stack

No single standard defines a conversational industrial-maintenance AI. MIRA should use a deliberately combined standards stack.

### 3.1 Machine condition-monitoring architecture

#### ISO 13374 series

Use ISO 13374 as the reference architecture for condition-monitoring data processing, communication, and presentation.

Recommended mapping:

| ISO 13374 / OSA-CBM concern | MIRA layer |
|---|---|
| Data acquisition | PLC tags, VFD registers, photos, manuals, technician statements |
| Data manipulation | Units, timestamps, naming normalization, quality flags |
| State detection | Running, stopped, faulted, degraded, communications lost |
| Health assessment | Normal, abnormal, failed, uncertain |
| Prognostic/diagnostic assessment | Ranked failure hypotheses and confidence |
| Advisory generation | Safe test, next action, escalation, repair verification |
| Presentation | Conversational response, evidence view, diagrams, handoff summary |

Resources:

- [ISO 13374-1 — General guidelines](https://www.iso.org/obp/ui/)
- [ISO 13374-2 — Data processing](https://www.iso.org/standard/36645.html)
- [ISO 13374-3 — Communication](https://www.iso.org/standard/37611.html)
- [ISO 13374-4 — Presentation](https://www.iso.org/standard/54933.html)
- [MIMOSA OSA-CBM](https://www.mimosa.org/mimosa-osa-cbm/)
- [MIMOSA specifications](https://www.mimosa.org/specifications-listing/)

#### ISO 13379-1:2025

Use ISO 13379-1:2025 for the diagnostic reasoning process, terminology, confidence, applicability, and limitations.

Resource:

- [ISO 13379-1:2025 — General diagnostic guidelines](https://www.iso.org/standard/88027.html)

#### ISO 17359:2018

Use ISO 17359 for designing the broader machine-condition monitoring program: what is measured, when, why, and under which operating conditions.

Resource:

- [ISO 17359:2018](https://www.iso.org/standard/71194.html)

### 3.2 Failure reasoning

#### IEC 60812:2018 — FMEA/FMECA

Use FMEA concepts to model:

- asset function;
- functional failure;
- failure mode;
- cause;
- local effect;
- system effect;
- detection evidence;
- severity;
- treatment;
- verification.

Resource:

- [IEC 60812:2018](https://webstore.iec.ch/en/publication/26359)

#### IEC 61025:2006 — Fault Tree Analysis

Use fault trees to work backward from a symptom or top event through possible causes. Fault trees should be machine-readable where practical.

Resource:

- [IEC 61025:2006](https://webstore.iec.ch/en/publication/4311)

### 3.3 Asset identity and manufacturing context

#### IEC 62264 / ISA-95

Use ISA-95 concepts for enterprise, site, area, line, cell, equipment, operation, and manufacturing context.

Resources:

- [IEC 62264-1:2013](https://webstore.iec.ch/en/publication/6675)
- [IEC 62264-2:2026](https://webstore.iec.ch/en/publication/75127)
- [IEC 62264-3:2016](https://webstore.iec.ch/en/publication/33511)
- [IEC 62264-4:2015](https://webstore.iec.ch/en/publication/23943)
- [IEC 62264-5:2016](https://webstore.iec.ch/en/publication/25465)
- [IEC 62264-6:2020](https://webstore.iec.ch/en/publication/59706)

#### IEC 81346

Use IEC 81346 for stable, unambiguous object and equipment reference designations.

Resources:

- [IEC 81346-1:2022](https://webstore.iec.ch/en/publication/64021)
- [IEC 81346-2:2019](https://webstore.iec.ch/en/publication/29181)
- [IEC 81346-14:2026 — Manufacturing and processing systems](https://webstore.iec.ch/en/publication/81613)

#### ISO 14224:2016

Adapt ISO 14224 concepts for equipment, failure, and maintenance-event records. Its formal industry scope is petroleum, petrochemical, and natural gas, so do not claim full conformity for general manufacturing without a deliberate profile.

Resource:

- [ISO 14224:2016](https://www.iso.org/standard/64076.html)

### 3.4 AI governance and evaluation

#### NIST AI RMF

Use the NIST AI RMF functions:

- **Govern:** ownership, policies, change control, accountability;
- **Map:** use case, users, hazards, dependencies, context;
- **Measure:** deterministic battery, human review, production probes;
- **Manage:** treatment, release gates, rollback, incident response.

Resources:

- [NIST AI RMF 1.0](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10)
- [NIST Generative AI Profile](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence)
- [NIST AI RMF resources](https://www.nist.gov/itl/ai-risk-management-framework)

#### ISO/IEC 42001:2023

Use ISO/IEC 42001 as the management-system model for AI governance, records, responsibilities, risk treatment, and continual improvement.

Resource:

- [ISO/IEC 42001:2023](https://www.iso.org/standard/42001)

#### ISO/IEC 23894:2023

Use ISO/IEC 23894 for AI-specific risk identification, analysis, evaluation, treatment, and monitoring.

Resource:

- [ISO/IEC 23894:2023](https://www.iso.org/standard/77304.html)

#### ISO/IEC 25059

Use the published ISO/IEC 25059:2023 quality model as the current baseline while tracking its replacement revision. Do not silently cite a draft as an already published replacement.

Resources:

- [ISO/IEC 25059:2023](https://www.iso.org/standard/80655.html)
- [ISO/IEC FDIS 25059 revision status](https://www.iso.org/standard/88234.html)

### 3.5 Industrial cybersecurity

Use IEC 62443 concepts for threat modeling, least privilege, secure development, verification, vulnerability handling, patch management, and separation of zones and conduits.

Core resources:

- [IEC 62443-4-1:2018 — Secure product development lifecycle](https://webstore.iec.ch/en/publication/33615)
- [IEC 62443-3-2:2020 — Security risk assessment for system design](https://webstore.iec.ch/en/publication/33615)
- [IEC 62443 series catalog](https://webstore.iec.ch/en/products/products-by-technical-area/information-technology/it-security/)

### 3.6 Functional safety and hazardous energy

MIRA is an **advisory system** unless and until a separately engineered, validated, and certified safety lifecycle says otherwise.

Use:

- IEC 61508 concepts for functional-safety lifecycle separation;
- OSHA 29 CFR 1910.147 for U.S. hazardous-energy control;
- site-specific approved procedures as the actual operational authority.

Resources:

- [IEC functional safety overview](https://www.iec.ch/functional-safety)
- [OSHA 29 CFR 1910.147](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.147)
- [OSHA hazardous-energy overview](https://www.osha.gov/control-hazardous-energy)

### 3.7 Copyright and standards handling

Most ISO and IEC standards are copyrighted and often paid.

Claude and subagents must:

- link to official standard pages;
- record standard number, edition, and applicability;
- use permitted summaries and organization-authored implementation profiles;
- never commit unauthorized complete copies of standards;
- never imply certification merely because the architecture was inspired by a standard;
- distinguish **conforms**, **aligned**, **informed by**, and **adapted from**.

---

## 4. Target System Architecture

MIRA should separate deterministic state and evidence handling from probabilistic language generation.

```text
User / Technician / PLC / Photo / Manual / CMMS
                         │
                         ▼
              1. Evidence Acquisition
                         │
                         ▼
             2. Evidence Normalization
                         │
                         ▼
               3. Identity Resolver
                         │
                         ▼
                4. State Detection
                         │
                         ▼
              5. Diagnostic Reasoner
       FMEA + fault tree + ranked hypotheses
                         │
                         ▼
            6. Safe Test/Action Selector
                         │
                         ▼
             7. Conversation Composer
                         │
                         ▼
          8. Verification and Case Record
```

### 4.1 Deterministic responsibilities

The deterministic application should own:

- active-asset state;
- topic changes;
- evidence types and provenance;
- timestamps and units;
- confidence representation;
- allowed commands and safety classification;
- citation requirements;
- workflow state;
- durable memory admission;
- test and evaluation grading;
- audit logs;
- user authorization;
- deployment gates.

### 4.2 Model responsibilities

The language model may:

- interpret natural language;
- summarize evidence;
- suggest candidate hypotheses;
- explain diagnostic reasoning;
- phrase safe questions;
- adapt explanation depth;
- summarize a case;
- assist document and diagram retrieval;
- produce structured proposals for deterministic validation.

The model must not be the sole authority for:

- asset identity persistence;
- safety status;
- authorization;
- lockout state;
- command execution;
- durable verified facts;
- final evaluation grading;
- whether a deployment is healthy.

### 4.3 Required turn schema

Every meaningful turn should be representable as structured data similar to:

```yaml
turn_id:
timestamp:
turn_type:
  social | factual | diagnostic | procedural | document_request |
  visual_request | control_request | correction | topic_change

active_context:
  enterprise:
  site:
  area:
  line:
  asset:
  component:
  manufacturer:
  model:
  identity_status:
    confirmed | probable | ambiguous | unknown
  changed_this_turn:
  change_reason:

observations:
  - claim:
    source:
      user | plc | document | image | database | derived
    status:
      observed | user_reported | retrieved | inferred | confirmed
    confidence:
    timestamp:
    citation_or_provenance:

hypotheses:
  - failure_mode:
    confidence:
    supporting_evidence:
    conflicting_evidence:
    missing_evidence:
    safe_discriminating_test:

selected_response:
  action_type:
    answer | clarify | test | retrieve | summarize | escalate | refuse
  safety_class:
  prerequisites:
  stop_conditions:
  citations_required:

memory_updates:
  working:
  session:
  durable_candidates:

verification:
  expected_result:
  actual_result:
  diagnosis_status:
    open | probable | confirmed | disproven | repaired_unverified | verified
```

---

## 5. Conversation Contract

### 5.1 Scientific conversation loop

For diagnostic turns, use:

1. **Observe** — state what is actually known.
2. **Contextualize** — identify the asset and operating state.
3. **Hypothesize** — maintain multiple plausible explanations.
4. **Discriminate** — choose a safe test that separates hypotheses.
5. **Predict** — state what results would support or weaken each hypothesis.
6. **Interpret** — update confidence when results arrive.
7. **Act** — recommend a repair or escalation only when justified.
8. **Verify** — test the repaired condition under the original triggering condition.
9. **Record** — produce a traceable case summary.

### 5.2 Evidence classes

Never collapse these classes:

| Class | Meaning |
|---|---|
| Observed | Direct sensor, image, measurement, or verified system state |
| User-reported | Technician stated it, but MIRA did not independently verify it |
| Retrieved | Found in an approved source |
| Inferred | Reasoned from other evidence |
| Confirmed | Supported by an accepted verification procedure |
| Unknown | Not established |

### 5.3 Memory layers

#### Working memory

Short-lived:

- current test;
- last requested measurement;
- selected image region;
- immediate pronoun references.

#### Session memory

Persists through the current job:

- active asset;
- fault;
- operating condition;
- tests completed;
- rejected hypotheses;
- safety status reported by the user.

#### Durable equipment memory

Only admitted through a verification or approval gate:

- confirmed model;
- approved tag mapping;
- verified repair;
- accepted parameter;
- approved relationship;
- known failure signature.

A model-generated guess must never become durable equipment memory automatically.

### 5.4 Topic and asset switching

Every user turn must be evaluated against current context.

Rules:

- A newly and clearly named asset supersedes stale context.
- A newly named manufacturer/model supersedes an unresolved prior candidate.
- A short answer to a pending question retains context.
- An ambiguous pronoun may retain context but must reduce confidence.
- A correction updates the fact and marks the former value as superseded.
- Social turns do not erase diagnostic context.
- Old routing state must not force all later turns through the same intent.
- Keywords cannot override the whole-message meaning.

### 5.5 Response modes

At minimum:

- social;
- help/capability;
- direct factual answer;
- diagnostic conversation;
- procedure;
- manual/document retrieval;
- visual/diagram request;
- control proposal;
- shift handoff;
- case closure.

Greeting and help responses should not receive unnecessary diagnostic footers, citations, or evidence blocks.

---

## 6. Contract IDs and Traceability

Every product behavior should have a stable requirement ID.

Suggested taxonomy:

```text
CTX  Context and topic switching
IDN  Asset and component identity
RTE  Intent and routing
EVD  Evidence and provenance
DIA  Diagnostic reasoning
TST  Test selection and interpretation
SAF  Safety behavior
SEC  Cybersecurity and permissions
CON  Conversational behavior
VIS  Images, diagrams, and visual interaction
DOC  Manual and document retrieval
MEM  Working, session, and durable memory
CIT  Citation and source behavior
VER  Repair and outcome verification
OBS  Logging, tracing, and observability
REL  Release, deployment, and rollback
```

Examples:

```text
CTX-001 A newly named asset replaces stale active-asset context.
CTX-002 A short answer to a pending diagnostic question retains context.
CTX-003 A correction supersedes the prior value without erasing its audit trail.
RTE-001 Whole-message meaning outranks keyword matches.
RTE-002 “Manual” as an adjective or operation does not force document retrieval.
CON-001 Greetings and thanks use the lightweight conversational lane.
EVD-001 An inference is never rendered as a direct observation.
DIA-001 Diagnostic output contains at least one alternative hypothesis when uncertainty is material.
TST-001 A selected test identifies which hypotheses it distinguishes.
SAF-001 Hazardous actions require prerequisites and stop conditions.
MEM-001 Only approved or verified claims enter durable equipment memory.
VER-001 A cleared fault alone does not confirm root cause.
OBS-001 A failed production interaction has a recoverable trace with secret redaction.
```

### 6.1 Traceability record

Every PR should include:

```yaml
requirements:
  - CTX-001
  - MEM-001
red_fixtures:
  - 60
  - 63
new_tests:
  - test_named_asset_replaces_sticky_context
  - test_short_measurement_reply_retains_context
code_paths:
  - path/to/context_resolver.py
  - path/to/session_state.py
safety_impact:
  classification: none | advisory | elevated | prohibited
evaluation:
  targeted:
  full_battery:
production_verification:
rollback:
```

---

## 7. Subagent-Driven Development Model

### 7.1 Default choice: focused subagents

Use project subagents in `.claude/agents/`.

Subagents are preferred when:

- the task has a focused deliverable;
- the work can be summarized back to the lead;
- the worker does not need direct peer discussion;
- research or logs would pollute the main context;
- tool access should be restricted.

Official resource:

- [Claude Code custom subagents](https://code.claude.com/docs/en/sub-agents)

### 7.2 Agent teams: exceptional use

Claude Code agent teams are experimental as of this handbook’s verification date. Use them only when independent agents must challenge or coordinate with each other.

Good uses:

- competing root-cause hypotheses;
- independent security, safety, and architecture review;
- cross-layer work where each agent owns different files;
- adversarial design review.

Avoid agent teams for:

- one-file fixes;
- strictly sequential work;
- work with heavy shared-state dependencies;
- routine implementation;
- situations where multiple agents would edit the same files.

Official resource:

- [Claude Code agent teams](https://code.claude.com/docs/en/agent-teams)

### 7.3 One-writer rule

For each file in a change:

- exactly one active agent owns writes;
- reviewers are read-only;
- tests and production code may be split between agents only when file ownership is explicit;
- two agents must never edit the same file concurrently;
- writer agents use isolated worktrees where practical.

Official resource:

- [Claude Code worktrees](https://code.claude.com/docs/en/worktrees)

### 7.4 Orchestrator responsibilities

The main Claude session is the lead. It must:

1. Restate the task and stop conditions.
2. Classify safety and deployment risk.
3. Identify applicable contract IDs.
4. Assign independent investigation before implementation.
5. Keep agent prompts self-contained.
6. Prevent overlapping write scopes.
7. Require concrete evidence from each agent.
8. Resolve contradictory findings explicitly.
9. Run targeted and full tests.
10. Hold merge and deployment unless authorized.
11. Report what was proven, what remains inferred, and what could not be verified.

The lead must not merely echo a subagent’s claim. It must inspect supporting evidence.

---

## 8. Recommended Repository Layout

```text
CLAUDE.md

.claude/
  settings.json
  agents/
    investigator.md
    contract-architect.md
    test-engineer.md
    implementer.md
    conversation-reviewer.md
    safety-reviewer.md
    security-reviewer.md
    release-verifier.md
  rules/
    diagnostics.md
    safety.md
    tests.md
    deployments.md
  skills/
    defect-workflow/
      SKILL.md
    diagnostic-contract-check/
      SKILL.md
    phone-battery/
      SKILL.md
    release-evidence/
      SKILL.md

Documentation/
  architecture/
    mira-reference-architecture.md
  contracts/
    diagnostic-conversation-contract.md
    contract-index.yaml
  standards/
    standards-profile.md
    applicability-matrix.yaml
  decisions/
    ADR-xxxx-*.md
  investigations/
    YYYY-MM-DD-issue-summary.md
  releases/
    release-evidence-<version>.md

evals/
  fixtures/
  contracts/
  reports/
  schemas/

scripts/
  validate-agent-output.py
  validate-contract-traceability.py
  validate-safe-command.py
  run-phone-battery.sh
```

Keep the root `CLAUDE.md` concise. Long procedures belong in skills or scoped rules.

Official resources:

- [Claude Code memory and CLAUDE.md](https://code.claude.com/docs/en/memory)
- [Claude Code skills](https://code.claude.com/docs/en/skills)
- [Claude Code settings](https://code.claude.com/docs/en/settings)
- [Claude Code hooks](https://code.claude.com/docs/en/hooks)
- [Claude Code permissions](https://code.claude.com/docs/en/permissions)

---

## 9. Root CLAUDE.md Template

Use this as a starting point, then replace placeholder commands with real repository commands.

```markdown
# MIRA Development Contract

## Mission
MIRA is a conversational industrial-maintenance scientist. Preserve evidence,
identity, safety, uncertainty, and repair verification.

## Non-negotiable rules
- Do not merge, deploy, push, close issues, or perform external writes without
  explicit authorization.
- Stop immediately on a stated stop condition.
- Never present inferred evidence as observed.
- Never treat the language model as a safety function.
- Never bypass interlocks, guards, LOTO, approval gates, or command allowlists.
- Never store an unverified model claim as durable equipment knowledge.
- Never fix a regression by weakening or deleting a valid test.
- Never declare success from local tests alone when production verification was requested.

## Development workflow
1. Identify contract IDs and affected architecture.
2. Reproduce the defect with a failing deterministic test.
3. Use an investigator subagent before editing production code.
4. Use one writer per file.
5. Implement the smallest root-cause fix.
6. Run targeted tests, related tests, then the full phone battery.
7. Run independent conversation, safety, and security review as applicable.
8. Provide traceability: requirement → test → code → evaluation → production evidence.

## Evidence
For every material claim, provide a command, file path, line, test, log, API
response, or artifact. Label anything not independently verified.

## Context behavior
- Re-evaluate the current turn independently of prior routing.
- Preserve relevant session facts.
- Adopt a clearly named new asset or topic.
- Treat short replies as answers to pending questions when unambiguous.
- Whole-message meaning outranks keyword routing.

## Git
- Use a dedicated branch or isolated worktree.
- Do not alter unrelated files.
- Do not overwrite foreign work.
- Do not force-push.
- Hold merge for human approval unless the task explicitly authorizes it.

## Tests
Replace these placeholders with the repository’s exact commands:
- Targeted: `<targeted-test-command>`
- Related suite: `<related-suite-command>`
- Phone battery: `<phone-battery-command>`
- Lint/format: `<lint-command>`
- Type/static checks: `<static-check-command>`

## Completion report
Report changed files, root cause, contract IDs, tests and exact results,
remaining uncertainty, safety impact, and whether merge/deploy was performed.
```

---

## 10. Core Subagent Definitions

These templates are intentionally specialized. Change tool names only after checking the installed Claude Code version and `/doctor`.

### 10.1 Investigator

File: `.claude/agents/investigator.md`

```markdown
---
name: investigator
description: Use proactively before changing production code to reproduce defects, trace execution paths, test competing root-cause hypotheses, and return evidence. Read-only.
tools: Read, Glob, Grep, Bash
model: sonnet
permissionMode: plan
maxTurns: 35
---

You are the independent defect investigator for MIRA/FactoryLM.

Do not edit production code or tests.

Your job:
1. Reproduce the reported behavior with the smallest reliable command.
2. Identify the relevant contract IDs.
3. Trace the real execution path from input to output.
4. Form at least two plausible root-cause hypotheses when uncertainty exists.
5. Actively try to disprove each hypothesis.
6. Identify the narrowest root cause supported by evidence.
7. Name the exact files, symbols, state transitions, and tests involved.
8. State what evidence would falsify your conclusion.
9. Recommend a minimal test-first fix, but do not implement it.

Return:
- reproduction;
- observed output;
- expected output;
- affected contract IDs;
- execution path;
- hypotheses considered;
- evidence for and against each;
- most likely root cause;
- proposed failing tests;
- risks and unknowns.

Do not claim a result you did not execute or inspect.
```

### 10.2 Contract architect

File: `.claude/agents/contract-architect.md`

```markdown
---
name: contract-architect
description: Use for behavior changes to map requirements to MIRA contracts, standards, state transitions, schemas, and acceptance criteria before implementation. Read-only.
tools: Read, Glob, Grep, WebSearch, WebFetch
model: sonnet
permissionMode: plan
maxTurns: 30
---

You are the MIRA diagnostic-contract architect.

Do not edit code.

For the assigned behavior:
1. Identify applicable existing contract IDs.
2. Propose new IDs only when no current rule fits.
3. Map the behavior to the MIRA evidence, identity, diagnostic, memory,
   conversation, safety, and verification models.
4. Identify applicable standards and accurately describe their relevance.
5. Distinguish normative requirements from project-specific design decisions.
6. Define observable acceptance criteria.
7. Define positive, negative, transition, and regression cases.
8. Identify compatibility and migration concerns.
9. Avoid copying copyrighted standards text.

Return a compact contract proposal with:
- scope and non-scope;
- current behavior;
- required behavior;
- state-transition rules;
- acceptance criteria;
- contract IDs;
- standards mapping;
- required fixtures;
- open decisions.
```

### 10.3 Test engineer

File: `.claude/agents/test-engineer.md`

```markdown
---
name: test-engineer
description: Use after investigation to create deterministic red tests and eval fixtures that prove both the defect and preserved behavior. Owns test files only.
tools: Read, Glob, Grep, Bash, Edit, Write
model: sonnet
permissionMode: default
isolation: worktree
maxTurns: 40
---

You are the independent MIRA test engineer.

Your write scope is limited to test, fixture, schema, and test-documentation files
explicitly assigned by the lead. Do not edit production implementation.

For every defect:
1. Add a test that fails for the reported behavior.
2. Add the opposite-direction test protecting valid existing behavior.
3. Add transition tests for prior-turn/current-turn state when relevant.
4. Ensure the test exercises the real path whenever practical.
5. Avoid stubbing the behavior under test.
6. Use deterministic grading.
7. Give the fixture stable contract IDs and a descriptive failure reason.
8. Run the test and capture the expected red result before handing off.

Return:
- files changed;
- contract IDs;
- exact test commands;
- red output;
- what each test proves;
- any coverage gap.

Never weaken existing assertions merely to make the suite pass.
```

### 10.4 Implementer

File: `.claude/agents/implementer.md`

```markdown
---
name: implementer
description: Use only after a reproduced root cause and red tests exist. Implements the smallest production fix within an explicit file scope.
tools: Read, Glob, Grep, Bash, Edit, Write
model: sonnet
permissionMode: default
isolation: worktree
maxTurns: 55
---

You are the MIRA production-code implementer.

Before editing, require:
- a reproduced defect or approved feature contract;
- applicable contract IDs;
- explicit write scope;
- failing tests or a documented reason tests cannot precede implementation.

Rules:
1. Implement the smallest root-cause fix.
2. Do not change unrelated behavior.
3. Do not modify tests to hide a failure.
4. Preserve evidence classes and asset identity semantics.
5. Prefer deterministic state and policy over prompt-only behavior.
6. Do not add keyword routing when semantic or structured routing is required.
7. Do not add durable memory writes without an approval or verification gate.
8. Do not introduce direct control actions outside existing authorization layers.
9. Run targeted tests after each meaningful change.
10. Stop and report if evidence contradicts the approved plan.

Return:
- root cause addressed;
- files and symbols changed;
- contract IDs implemented;
- exact tests run;
- remaining risks;
- any behavior intentionally left unchanged.

Do not merge, deploy, or push unless explicitly authorized.
```

### 10.5 Conversation reviewer

File: `.claude/agents/conversation-reviewer.md`

```markdown
---
name: conversation-reviewer
description: Use after chatbot behavior changes to independently assess naturalness, context switching, directness, scientific reasoning, and unnecessary formatting. Read-only.
tools: Read, Glob, Grep, Bash
model: sonnet
permissionMode: plan
maxTurns: 30
---

You are the adversarial conversational-scientist reviewer.

Review the changed behavior for:
- direct answers before elaboration;
- natural handling of greetings, thanks, and help;
- correct retention and release of context;
- topic and asset switching;
- pronoun and short-reply interpretation;
- whole-message meaning over keyword triggers;
- observation versus inference;
- ranked hypotheses rather than unsupported certainty;
- a useful, safe next test;
- explanation of why the test matters;
- repair verification;
- unnecessary citations, footers, warnings, or repeated questions.

Use the real battery or targeted fixtures where available.

Report findings by severity:
- blocking;
- important;
- polish.

For every finding, include contract ID, reproduction, expected behavior, and
specific evidence. Do not make style-only preferences blocking unless they
violate a contract.
```

### 10.6 Safety reviewer

File: `.claude/agents/safety-reviewer.md`

```markdown
---
name: safety-reviewer
description: Use proactively for diagnostic, procedural, control, electrical, mechanical, LOTO, or machine-motion changes. Performs an independent safety-boundary review. Read-only.
tools: Read, Glob, Grep, Bash, WebSearch, WebFetch
model: opus
permissionMode: plan
maxTurns: 35
---

You are the independent industrial-safety reviewer.

Assume MIRA is advisory and not a validated safety function.

Review for:
- unexpected energization or motion;
- electrical exposure;
- stored energy;
- bypass of guards, interlocks, trips, or permissives;
- commands that can start, stop, reset, jog, or write parameters;
- false claims that equipment is safe or de-energized;
- missing qualification, authorization, prerequisites, or stop conditions;
- generic instructions that conflict with site-specific procedures;
- unsafe certainty from incomplete evidence.

Requirements:
1. Separate informational answers from action instructions.
2. Require site-approved procedures where appropriate.
3. Require human authorization for consequential actions.
4. Ensure unsafe actions cannot be enabled by prompt text alone.
5. Treat remote write/control capability as elevated risk.
6. Cite authoritative sources for legal or standards claims.
7. Do not claim certification or compliance without evidence.

Return:
- risk classification;
- affected contract IDs;
- hazards;
- existing controls;
- gaps;
- required mitigations;
- release recommendation: approve, approve with conditions, or block.
```

### 10.7 Security reviewer

File: `.claude/agents/security-reviewer.md`

```markdown
---
name: security-reviewer
description: Use for authentication, authorization, logging, secrets, MCP, PLC/SCADA connectivity, databases, uploads, external tools, and deployment changes. Read-only.
tools: Read, Glob, Grep, Bash
model: opus
permissionMode: plan
maxTurns: 35
---

You are the independent MIRA industrial-cybersecurity reviewer.

Apply least privilege and IEC 62443-informed secure-development principles.

Review:
- trust boundaries;
- authentication and authorization;
- command and tool allowlists;
- secret handling and log redaction;
- prompt injection through manuals, images, messages, or MCP tools;
- unsafe data-to-command paths;
- SQL and shell injection;
- remote control paths;
- write access to PLC/SCADA/CMMS systems;
- auditability;
- dependency and supply-chain risk;
- rollback and incident response.

For each finding provide:
- severity;
- attack path or failure mode;
- affected asset/data;
- evidence;
- practical mitigation;
- required regression test.

Do not approve a control-write path that depends only on the language model
deciding it is safe.
```

### 10.8 Release verifier

File: `.claude/agents/release-verifier.md`

```markdown
---
name: release-verifier
description: Use after implementation to independently verify tests, CI, artifacts, deployment status, production probes, and rollback evidence without changing code.
tools: Read, Glob, Grep, Bash
model: sonnet
permissionMode: plan
maxTurns: 45
---

You are the independent release verifier.

Do not edit code, merge, deploy, rerun destructive jobs, or alter external state
unless the user explicitly authorizes that exact action.

Verify:
1. Expected commit and branch.
2. Diff scope and unrelated changes.
3. Required tests and exact results.
4. Full deterministic battery.
5. Required CI checks.
6. Review threads and mergeability when requested.
7. Deployment result when deployment is authorized.
8. Artifact names, sizes, checksums, metadata, and redaction.
9. Production behavior using approved probes.
10. Rollback availability.

Report each item as:
- verified;
- failed;
- not available;
- not authorized;
- inconclusive.

Evidence must include exact commands, IDs, URLs, paths, or artifact metadata.
Stop immediately on the user’s stated stop conditions.
```

---

## 11. Skills

Use skills for repeatable procedures that are too long for `CLAUDE.md`.

Official resource:

- [Claude Code skills](https://code.claude.com/docs/en/skills)

### 11.1 Defect workflow skill

File: `.claude/skills/defect-workflow/SKILL.md`

```markdown
---
name: defect-workflow
description: Reproduce and fix a MIRA defect using contract traceability, TDD, independent review, and the deterministic phone battery.
---

# MIRA Defect Workflow

1. Record the defect, exact user interaction, expected behavior, and stop conditions.
2. Identify the contract IDs.
3. Delegate read-only root-cause investigation.
4. Require at least two hypotheses when the cause is uncertain.
5. Add a red test for the defect and an opposite-direction preservation test.
6. Confirm the tests fail for the expected reason.
7. Assign one production-code writer with explicit file ownership.
8. Run targeted tests until green.
9. Run related suites.
10. Run the full phone battery.
11. Run conversation review.
12. Run safety/security review when applicable.
13. Inspect the final diff for unrelated changes.
14. Prepare a PR traceability report.
15. Hold merge and deployment for authorization.
16. After authorized deployment, verify production and preserve evidence.
```

### 11.2 Diagnostic contract check skill

File: `.claude/skills/diagnostic-contract-check/SKILL.md`

```markdown
---
name: diagnostic-contract-check
description: Audit a MIRA response or change against identity, evidence, diagnostic reasoning, safety, memory, citation, and verification contracts.
---

For each response, check:

- What asset is active?
- How certain is identity?
- Did the user change topic or equipment?
- Which claims are observed, user-reported, retrieved, inferred, or confirmed?
- Are multiple hypotheses needed?
- What evidence supports and conflicts with the leading hypothesis?
- Does the next test safely distinguish hypotheses?
- Are prerequisites and stop conditions present?
- Are citations required and correctly attached?
- Did the system repeat a completed question?
- Did any unverified fact enter durable memory?
- Was repair verification performed?
- Is the response natural for the turn type?

Return contract IDs, pass/fail, evidence, and remediation.
```

---

## 12. Claude Code Settings Baseline

The repository should not grant itself broad automatic authority.

Example `.claude/settings.json`:

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "defaultMode": "default",
    "allow": [
      "Bash(git status)",
      "Bash(git diff *)",
      "Bash(git log *)",
      "Bash(pytest *)",
      "Bash(ruff *)"
    ],
    "ask": [
      "Bash(git commit *)",
      "Bash(git push *)",
      "Bash(gh pr create *)",
      "Bash(gh pr merge *)",
      "Bash(docker *)",
      "Bash(ssh *)"
    ],
    "deny": [
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./secrets/**)",
      "Read(./config/credentials.json)",
      "Bash(git push --force *)",
      "Bash(git push -f *)",
      "Bash(rm -rf / *)",
      "Bash(rm -rf ~ *)"
    ]
  },
  "worktree": {
    "baseRef": "fresh"
  }
}
```

Adapt test commands to the repository. Do not add broad allow rules merely to remove prompts.

Important:

- `CLAUDE.md` is guidance, not enforcement.
- Permissions and hooks are enforcement.
- Deny rules are evaluated before ask and allow rules.
- Run `/doctor` after configuration changes.
- Review hooks carefully because command hooks run with the user’s permissions.

Resources:

- [Claude Code permissions](https://code.claude.com/docs/en/permissions)
- [Claude Code settings](https://code.claude.com/docs/en/settings)
- [Claude Code security](https://code.claude.com/docs/en/security)

---

## 13. Hooks and Enforced Gates

Use hooks for boundaries that must not depend on model obedience.

Examples:

- reject completion without contract IDs;
- reject task completion when required tests are missing;
- block production deploy commands without an authorization token;
- block edits to protected migrations or safety policies;
- validate that reviewer agents return required sections;
- run lint after edits;
- preserve subagent evidence;
- check secrets and redaction before artifact publication.

Official resource:

- [Claude Code hooks](https://code.claude.com/docs/en/hooks)

### 13.1 Recommended hook events

| Event | Use |
|---|---|
| `PreToolUse` | block dangerous or out-of-scope actions |
| `PostToolUse` | run lint or validation after edits |
| `SubagentStart` | inject current contract and branch context |
| `SubagentStop` | validate required report fields |
| `TaskCreated` | require owner, scope, and deliverable |
| `TaskCompleted` | require tests and evidence before completion |
| `TeammateIdle` | prevent an agent team member from idling with unresolved blockers |
| `SessionEnd` | write session evidence index and cleanup |

### 13.2 Hook design rules

- Fail closed for safety, deployment, secrets, and authorization.
- Fail clearly with actionable error messages.
- Keep hook scripts deterministic and unit-tested.
- Never put secrets in hook output.
- Log decisions without logging secret values.
- Pair worktree creation hooks with cleanup.
- Treat hook code as privileged security-sensitive code.
- Avoid an LLM-based hook for a boundary that can be checked deterministically.

---

## 14. Standard Development Workflows

### 14.1 Defect workflow

#### Phase A — Intake

Record:

- exact interaction;
- exact observed output;
- expected output;
- environment;
- current commit;
- related fixture;
- severity;
- safety impact;
- stop conditions.

#### Phase B — Independent investigation

Run `investigator`.

Required output:

- reproduction;
- real execution path;
- competing hypotheses;
- root-cause evidence;
- recommended red tests.

No production edit occurs during this phase.

#### Phase C — Contract and tests

Run `contract-architect` when the behavior is not already precisely specified.

Run `test-engineer`.

A valid defect test must:

- fail on the current defect;
- fail for the expected reason;
- exercise the real behavior path where practical;
- have a stable contract ID;
- include a preservation test in the opposite direction.

#### Phase D — Implementation

Run `implementer` with:

- red tests;
- root-cause report;
- explicit write scope;
- affected contract IDs;
- prohibited changes.

#### Phase E — Independent review

Always run `conversation-reviewer` for user-facing behavior.

Also run:

- `safety-reviewer` for diagnostic or procedural risk;
- `security-reviewer` for connectivity, data, auth, tools, uploads, or control;
- architecture review for schema or state-machine changes.

#### Phase F — Verification

Run in order:

1. targeted test;
2. related test suite;
3. static/lint/format checks;
4. full deterministic phone battery;
5. diff-scope review;
6. independent release verification.

#### Phase G — PR

The PR must state:

- root cause;
- contract IDs;
- tests;
- evaluation fixtures;
- safety/security impact;
- rollout and rollback;
- unresolved uncertainty.

Hold merge unless explicitly authorized.

#### Phase H — Production

When authorized:

- verify the expected commit;
- watch deployment through completion;
- preserve pre-deploy logs;
- inspect artifacts;
- verify metadata and redaction;
- run the approved production probe;
- record evidence;
- stop on any requested failure condition.

### 14.2 New feature workflow

1. Write the user outcome.
2. Define non-goals.
3. Map standards and architecture.
4. Create an ADR when the design changes boundaries or ownership.
5. Create contract IDs and schemas.
6. Threat-model the feature.
7. Define deterministic acceptance tests before implementation.
8. Split work by file ownership.
9. Implement vertical slices.
10. Verify each slice independently.
11. Run full regression battery.
12. Perform human product review.
13. Roll out behind a flag when risk or uncertainty is material.

### 14.3 Research workflow

Use research agents for:

- official standards;
- OEM manuals;
- protocol documentation;
- known architecture patterns;
- vendor API changes.

Rules:

- prefer primary sources;
- record access date;
- separate current published standards from drafts;
- identify scope limitations;
- do not copy copyrighted manuals or standards beyond permitted use;
- convert research into project-specific decisions and tests;
- do not treat a blog as normative authority when an official source exists.

### 14.4 Debugging with agent teams

Use an agent team only when competing hypotheses add real value.

Suggested prompt:

```text
Investigate the sticky-session context defect using an agent team.

Create three teammates:
1. state-machine investigator;
2. router/prompt investigator;
3. persistence and session-store investigator.

Each must independently reproduce fixtures 60 and 63, form a root-cause
hypothesis, and actively challenge the others’ hypotheses. They must not edit
code. Require a consensus report that identifies evidence that would falsify
the chosen root cause. Wait for all teammates before proposing a fix.
```

---

## 15. Evaluation Architecture

The phone battery is a permanent engineering instrument, not merely a collection of sample prompts.

### 15.1 Fixture structure

Recommended:

```yaml
fixture_id: 60
title: newly named asset breaks stale CE10 context
contracts:
  - CTX-001
  - RTE-001
setup:
  session_state:
turns:
  - user:
    expected_state:
    forbidden_state:
  - user:
    expected_state:
assertions:
  direct_answer:
  routing:
  active_asset:
  citations:
  footer:
  memory:
  safety:
failure_message:
```

### 15.2 Test dimensions

Every relevant behavior should include:

- direct case;
- negative case;
- state transition;
- correction;
- ambiguity;
- repeated turn;
- topic switch;
- asset switch;
- adversarial keyword;
- no-document case;
- citation-required case;
- citation-not-required case;
- safety boundary;
- repair verification.

### 15.3 Grading principles

Prefer deterministic assertions for:

- route selected;
- state transition;
- active asset;
- citation presence;
- prohibited footer;
- repeated question;
- safety field;
- durable memory write;
- command issued;
- schema validity.

Use model-based judging only for properties that cannot reasonably be deterministic, such as naturalness or explanation quality. Even then:

- freeze the rubric;
- version the judge model;
- record prompts and outputs;
- include human spot checks;
- prevent the judge from overriding deterministic hard gates.

### 15.4 Quality metrics

Track at least:

- contract pass rate;
- direct-answer rate;
- context-switch accuracy;
- asset-identity accuracy;
- unsupported-claim rate;
- citation precision and recall;
- unsafe-action rate;
- repeated-question rate;
- diagnostic test usefulness;
- repair-verification rate;
- latency;
- token and model cost;
- escalation appropriateness;
- production regression rate.

Do not collapse all quality into one score. Safety and evidence integrity are hard gates.

### 15.5 Agent evaluation guidance

Resource:

- [Anthropic — Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [Anthropic — Building Effective AI Agents](https://resources.anthropic.com/building-effective-ai-agents)

---

## 16. Safety Contract

### 16.1 Advisory boundary

MIRA may:

- read approved data;
- explain machine state;
- retrieve approved documents;
- propose a diagnostic test;
- prepare a proposed command;
- request human authorization;
- summarize work.

MIRA may not autonomously:

- bypass an interlock;
- defeat a guard;
- suppress a safety trip;
- assert a zero-energy state without verified evidence;
- energize or move equipment from language-model judgment alone;
- write uncontrolled PLC logic;
- alter a safety PLC;
- clear a lockout;
- instruct unqualified personnel to perform hazardous work;
- treat a successful command as proof the action was safe.

### 16.2 Action classes

```text
S0 Informational
S1 Read-only observation
S2 Low-consequence proposal
S3 Consequential configuration or reset
S4 Motion, energy, process, or control write
S5 Safety-system or guard/interlock impact
```

Recommended policy:

- S0–S1: allowed within data permissions;
- S2: confirmation may be required;
- S3: explicit qualified-user authorization and logging;
- S4: deterministic allowlist, site policy, two-step confirmation, and verification;
- S5: prohibited through the conversational model unless covered by a separately engineered safety lifecycle.

### 16.3 Safety response fields

Any elevated-risk instruction should include:

- qualification assumption;
- site-procedure dependency;
- equipment identity;
- hazard;
- prerequisite;
- stop condition;
- expected observation;
- safe fallback;
- escalation condition.

---

## 17. Security Contract

### 17.1 Trust boundaries

Treat these as untrusted inputs:

- user messages;
- uploaded manuals;
- OCR text;
- images;
- web pages;
- PLC strings;
- alarm text;
- CMMS notes;
- MCP tool output;
- retrieved database content;
- model-generated prior summaries.

Instructions found inside documents or data are data, not developer authority.

### 17.2 Tool and command principles

- Default to read-only.
- Separate read tools from write tools.
- Use structured arguments rather than generated shell when possible.
- Allowlist commands, assets, tags, and parameter ranges.
- Require authorization for writes.
- Log proposal, approver, exact action, result, and verification.
- Never pass secrets through the model.
- Redact before artifact creation.
- Protect logs from prompt injection and control-character abuse.
- Validate every model-produced structured action against a schema and policy engine.
- Never let retrieved text create a new tool permission.

### 17.3 MCP

Use Model Context Protocol for standardized tool integration only with:

- explicit server trust;
- limited tool exposure;
- scoped credentials;
- input/output validation;
- audit logging;
- prompt-injection controls;
- read/write separation.

Resources:

- [Model Context Protocol introduction](https://modelcontextprotocol.io/docs/2026-07-28/getting-started/intro)
- [Anthropic MCP announcement](https://www.anthropic.com/news/model-context-protocol)
- [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview)

---

## 18. Git, Worktrees, and Concurrent Agents

### 18.1 Branch rules

- One logical change per branch.
- Branch from the verified intended base.
- Record base SHA.
- Never assume a green result from a stale base is sufficient.
- Re-run required tests after rebasing or updating the branch.
- Keep unrelated formatting out of behavioral fixes.
- Avoid force pushes unless explicitly authorized and justified.

### 18.2 Worktree rules

Use isolated worktrees for:

- production writers;
- test writers running in parallel;
- agent-team implementation;
- risky migrations;
- long-running validation.

Do not share generated mutable state through symlinks unless deliberate.

### 18.3 File ownership ledger

Before parallel writes, create:

```yaml
task:
base_sha:
owners:
  test-engineer:
    - tests/path_a.py
    - evals/fixtures/060.yaml
  implementer:
    - src/context_resolver.py
  documentation:
    - Documentation/contracts/diagnostic-conversation-contract.md
shared_read_only:
  - src/session_state.py
prohibited:
  - migrations/
  - deployment/
```

Any agent needing to cross ownership boundaries must stop and ask the lead to reassign scope.

---

## 19. PR and Review Template

```markdown
## Purpose

## User-visible defect or outcome

## Root cause
Evidence:

## Contract traceability
- IDs:
- Standards profile:
- ADR:

## Changed files
- `path`: reason

## Tests
### Red before fix
- command:
- result:

### Targeted after fix
- command:
- result:

### Related suite
- command:
- result:

### Full phone battery
- command:
- result:

## Independent reviews
- Conversation:
- Safety:
- Security:
- Release:

## Risk
- Safety class:
- Security impact:
- Data/memory impact:
- Compatibility:

## Rollout
- Feature flag:
- Production probe:
- Artifact/log evidence:

## Rollback

## Explicitly unchanged

## Remaining uncertainty
```

A reviewer should reject the PR if the traceability section is decorative or unsupported.

---

## 20. Completion Criteria

A defect is complete only when:

- root cause is supported by evidence;
- contract IDs exist;
- a red test reproduced it;
- preservation tests protect valid behavior;
- production code addresses the root cause;
- targeted tests pass;
- related tests pass;
- full phone battery passes or documented unrelated reds remain unchanged;
- independent review is complete;
- diff scope is clean;
- safety/security gates pass;
- merge/deploy authorization status is explicit;
- production verification is complete when requested.

A feature is not complete because:

- code compiles;
- a model says it looks correct;
- one happy path works;
- the fault cleared once;
- local tests are green while required CI or production evidence is missing.

---

## 21. Stop Conditions

Every agent must stop and report immediately when:

- the requested base or commit is wrong;
- a supposed formatting-only diff changes behavior;
- the defect cannot be reproduced and implementation would be speculative;
- evidence contradicts the approved root cause;
- a test requires weakening a valid contract;
- an unrelated failure appears and its impact is unknown;
- secrets appear in logs or artifacts;
- the task would bypass a safety, security, approval, or merge gate;
- file ownership conflicts with another agent;
- a migration or external write was not authorized;
- deployment or production verification fails;
- required evidence is unavailable or irrecoverable.

Stopping is a successful outcome when a stop condition is met.

---

## 22. Anti-Patterns

Do not:

- tune prompts endlessly without a behavioral contract;
- route from single keywords such as “manual”;
- store the complete conversation as one undifferentiated memory blob;
- let old router state dominate every later turn;
- use the LLM as the source of truth for active asset identity;
- ask the same diagnostic question repeatedly;
- produce a long generic checklist instead of a discriminating test;
- present every possibility with equal weight;
- cite social responses;
- add evidence footers to greetings;
- retrieve a manual when the user asked a conceptual question;
- claim a repair is verified because an alarm cleared;
- use model judging to override a deterministic safety failure;
- ask one agent to investigate, implement, review, and approve its own work;
- run several writer agents against the same checkout;
- trust subagent summaries without inspecting evidence;
- permit deployment because the implementation agent recommends it;
- treat current official standards, old editions, and drafts as interchangeable.

---

## 23. Adoption Plan

### Phase 0 — Codify current reality

1. Add this handbook to the repository.
2. Create the concise root `CLAUDE.md`.
3. Add the eight core subagent definitions.
4. Record the real test, lint, battery, deploy, and probe commands.
5. Run `/doctor`.
6. Do not change runtime behavior yet.

### Phase 1 — Contract the open defect queue

Create or confirm:

- CTX rules for fixtures 60 and 63;
- RTE rules for fixture 66;
- CON/CIT rules for fixtures 61 and 62;
- VIS/DOC rules for fixture 67.

### Phase 2 — Sticky-session context

Use the full defect workflow:

1. independent investigation;
2. bidirectional red tests;
3. smallest deterministic state fix;
4. full battery;
5. conversation review;
6. hold PR for human merge.

### Phase 3 — Semantic routing

Replace keyword dominance with structured whole-message intent and requested-output classification.

### Phase 4 — Conversational lanes

Separate social/help turns from evidence-heavy diagnostic output while preserving session context.

### Phase 5 — Diagnostic ledger

Implement explicit observations, hypotheses, evidence for/against, selected test, result, and verification state.

### Phase 6 — Interactive surfaces

Add structured controls:

- why this test;
- show evidence;
- test completed;
- cannot perform safely;
- switch asset;
- show wiring;
- show manual page;
- show exploded view;
- mark fixed;
- create shift handoff.

### Phase 7 — Live-data integration

Connect PLC/SCADA data through read-only, provenance-aware adapters. Add control proposals only after authorization and policy architecture exists.

---

## 24. Master Orchestration Prompt

Use this prompt to begin a substantial defect or feature session.

```text
Act as the lead engineer for MIRA using the repository’s subagent-driven
development contract.

Task:
<insert task>

User-visible behavior:
<insert exact behavior or desired outcome>

Known fixtures/issues:
<insert fixtures, issue, PR, or evidence>

Stop conditions:
<insert stop conditions>

Rules:
1. Do not edit production code first.
2. Identify applicable contract IDs.
3. Delegate independent investigation to the investigator subagent.
4. Use competing hypotheses and require falsifying evidence when root cause is uncertain.
5. Have the test-engineer create deterministic red tests and opposite-direction
   preservation tests.
6. Assign exactly one production-code writer per file in an isolated worktree.
7. Implement the smallest root-cause fix.
8. Run targeted tests, related suites, lint/static checks, and the full phone battery.
9. Run conversation review and any applicable safety/security review.
10. Inspect all subagent evidence rather than accepting summaries blindly.
11. Do not merge, deploy, push, or alter external systems without explicit authorization.
12. Stop and report immediately if a stated stop condition occurs.

Final report:
- root cause;
- contract IDs;
- changed files;
- red-before and green-after evidence;
- full battery result;
- independent review findings;
- safety/security impact;
- remaining uncertainty;
- merge/deploy status.
```

---

## 25. Resource Catalog

### Claude Code

- [Overview](https://code.claude.com/docs/en/overview)
- [Custom subagents](https://code.claude.com/docs/en/sub-agents)
- [Agent teams](https://code.claude.com/docs/en/agent-teams)
- [Dynamic workflows](https://code.claude.com/docs/en/workflows)
- [Worktrees](https://code.claude.com/docs/en/worktrees)
- [Common workflows](https://code.claude.com/docs/en/common-workflows)
- [Memory and CLAUDE.md](https://code.claude.com/docs/en/memory)
- [Skills](https://code.claude.com/docs/en/skills)
- [Hooks](https://code.claude.com/docs/en/hooks)
- [Settings](https://code.claude.com/docs/en/settings)
- [Permissions](https://code.claude.com/docs/en/permissions)
- [Security](https://code.claude.com/docs/en/security)
- [CLI reference](https://code.claude.com/docs/en/cli-reference)
- [Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview)
- [Claude Code release notes](https://docs.anthropic.com/en/release-notes/claude-code)

### Agent engineering

- [Anthropic — Building Effective AI Agents](https://resources.anthropic.com/building-effective-ai-agents)
- [Anthropic — Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [Model Context Protocol](https://modelcontextprotocol.io/docs/2026-07-28/getting-started/intro)

### Condition monitoring and diagnostics

- [ISO 13374-2](https://www.iso.org/standard/36645.html)
- [ISO 13374-3](https://www.iso.org/standard/37611.html)
- [ISO 13374-4](https://www.iso.org/standard/54933.html)
- [ISO 13379-1:2025](https://www.iso.org/standard/88027.html)
- [ISO 17359:2018](https://www.iso.org/standard/71194.html)
- [MIMOSA OSA-CBM](https://www.mimosa.org/mimosa-osa-cbm/)
- [MIMOSA OSA-EAI](https://www.mimosa.org/mimosa-osa-eai/)

### Reliability and asset information

- [IEC 60812:2018 — FMEA/FMECA](https://webstore.iec.ch/en/publication/26359)
- [IEC 61025:2006 — Fault Tree Analysis](https://webstore.iec.ch/en/publication/4311)
- [IEC 62264-1:2013](https://webstore.iec.ch/en/publication/6675)
- [IEC 62264-2:2026](https://webstore.iec.ch/en/publication/75127)
- [IEC 81346-1:2022](https://webstore.iec.ch/en/publication/64021)
- [IEC 81346-14:2026](https://webstore.iec.ch/en/publication/81613)
- [ISO 14224:2016](https://www.iso.org/standard/64076.html)

### AI governance

- [NIST AI RMF](https://www.nist.gov/itl/ai-risk-management-framework)
- [NIST AI RMF 1.0](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10)
- [NIST Generative AI Profile](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence)
- [ISO/IEC 42001:2023](https://www.iso.org/standard/42001)
- [ISO/IEC 23894:2023](https://www.iso.org/standard/77304.html)
- [ISO/IEC 25059:2023](https://www.iso.org/standard/80655.html)

### Industrial security and safety

- [IEC 62443-4-1:2018](https://webstore.iec.ch/en/publication/33615)
- [IEC functional safety](https://www.iec.ch/functional-safety)
- [OSHA 29 CFR 1910.147](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.147)
- [OSHA hazardous-energy resources](https://www.osha.gov/control-hazardous-energy)

---

## 26. Final Principle

The goal is not to make Claude appear confident.

The goal is to create a system in which:

- requirements are explicit;
- evidence is classified;
- uncertainty is visible;
- hypotheses compete;
- tests discriminate;
- agents review one another;
- permissions enforce boundaries;
- production behavior is reproducible;
- every repair and every code change can be verified.

That is how MIRA becomes conversational **and** scientific without relying on improvisation.

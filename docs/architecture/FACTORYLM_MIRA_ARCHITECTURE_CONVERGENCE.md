# FactoryLM / MIRA Architecture Convergence & Continuous Refactoring Standard

**Status:** Proposed canonical architecture procedure  
**Purpose:** Govern the current FactoryLM/MIRA architecture convergence and make safe architectural refactoring a permanent engineering procedure.

> **Core rule: Agents may propose and generate. Deterministic systems verify. Humans retain the final production gate.**

## 1. Classification

This is not one giant refactor.

It is an **Architecture Convergence and Modernization Program** consisting of independently reversible:

- refactors;
- contract extractions;
- migrations;
- dependency-boundary changes;
- duplicate-capability consolidation;
- legacy strangulation;
- documentation reconciliation;
- deterministic codemods;
- eventual deletion.

**No big-bang rewrite is permitted.**

## 2. Permanent engineering doctrine

1. No architecture-affecting change starts without a verified rollback point.
2. The implementation agent never gives itself final approval.
3. Declared architecture and observed architecture are tracked separately.
4. Lock important behavior with tests/contracts before migrating it.
5. Migrate incrementally through stable contracts.
6. Agents generate; deterministic systems verify.
7. High-risk changes receive independent adversarial review.
8. Shadow old and new implementations when practical.
9. Replacement and deletion are separate milestones.
10. Production promotion remains human-gated and reversible.
11. Architecture rules should become executable CI rules.
12. This procedure remains after the convergence effort is finished.

## 3. Product spine

```text
FactoryLM Mobile / Web
        ↓
Equipment / file / nameplate capture
        ↓
Canonical asset identity
        ↓
ISA-95 / UNS placement
        ↓
Equipment Notebook / asset context
        ↓
OEM document discovery
        ↓
Validated knowledge ingestion
        ↓
MIRA retrieval + reasoning
        ↓
Citation-grounded answer
        ↓
Live industrial context
        ↓
Maintenance action / WO / PM
        ↓
Same canonical asset identity throughout
```

This should become the principal end-to-end product invariant.

## 4. Provisional ownership

### FactoryLM

Generally owns industrial-domain truth:

- canonical assets;
- ISA-95/UNS;
- operational tenant/user domain;
- CMMS/work orders/PM;
- telemetry identity;
- industrial operational state;
- industrial-domain contracts.

### MIRA

Generally owns intelligence:

- retrieval;
- evidence selection;
- diagnostic reasoning;
- knowledge processing;
- inference/model routing;
- agent/workflow orchestration;
- grounded answers;
- diagnostic evaluation.

### FactoryLM Mobile

Acts as the technician client and consumes canonical contracts rather than creating separate business truth.

These ownership assumptions must be verified during discovery before becoming final ADRs.

## 5. Architecture Registry

Maintain a machine-readable registry for every meaningful module.

```yaml
module_id:
repo:
path:
functional_layer:
domain:
purpose:
language:
status:
runtime:
deployment_target:
public_interfaces: []
dependencies: []
dependents: []
external_integrations: []
database_reads: []
database_writes: []
queues_topics_protocols: []
canonical_contracts: []
source_of_truth_docs: []
relevant_adrs: []
test_commands: []
ci_gates: []
security_boundaries: []
observability: []
owner_capability:
declared_state:
observed_state:
known_drift: []
```

Allowed status values:

`CANONICAL | CONSUMER | MIGRATE | DUPLICATE | LEGACY | EXPERIMENTAL | DATA | DELETE_CANDIDATE`

### Declared versus observed

**Declared architecture** comes from CLAUDE.md, ADRs, architecture documents, plans and specifications.

**Observed architecture** comes from source, imports, APIs, manifests, containers, deployments, DB access, queues, MQTT, scheduled jobs, environment configuration and actual runtime behavior.

A disagreement is an **architecture drift finding**.

It must not be silently “fixed” by an implementation agent.

## 6. Executable architecture

Continue existing Python boundary enforcement.

Evaluate tools such as **dependency-cruiser** for JS/TS dependency rules and **ast-grep** for deterministic codemods.

Consider architecture tags such as:

```text
type:presentation
type:adapter
type:engine
type:domain
type:infra
type:test
type:simulation

domain:assets
domain:identity
domain:knowledge
domain:diagnostics
domain:cmms
domain:telemetry
domain:mobile
```

Architecture discovery must include more than imports.

Map:

- HTTP;
- MQTT;
- queues;
- Redis;
- databases;
- scheduled jobs;
- GitHub Actions;
- containers;
- environment-addressed services;
- object storage;
- mobile/backend contracts.

## 7. Mandatory rollback standard

### R0 — Pre-change known-good

Immediately before architecture-affecting implementation:

1. Confirm clean working tree.
2. Record exact commit SHA.
3. Run relevant baseline tests.
4. Record test results.
5. Record schema/migration state.
6. Record deployed version when relevant.
7. Create an addressable rollback checkpoint.
8. Define data/schema recovery before migration.
9. Verify rollback does not depend on code about to be removed.

> **If R0 cannot be established, STOP. No implementation is authorized.**

### R1 — Post-change verified

After successful verification:

1. Record final SHA.
2. Record test/eval evidence.
3. Record shadow-comparison evidence.
4. Record migration/deployment state.
5. Record feature flags.
6. Establish the new known-good checkpoint.

At every point the project must be able to answer:

> **What exact known-good state can we return to right now?**

For failed unmerged work, prefer abandoning the isolated branch/worktree and returning to R0 over asking another agent to repair an uncontrolled partially migrated state.

## 8. Convergence gates

### Gate 0 — Discovery

Read-only.

Determine current behavior, affected modules, declared architecture, observed architecture, hidden dependencies, duplicates and risk.

### Gate 1 — Dependency mapping

Generate:

- source graph;
- service/API graph;
- database ownership graph;
- queue/topic graph;
- deployment graph;
- affected product-flow graph.

No migration until consumers are understood.

### Gate 2 — Canonical ownership

Identify:

- canonical capability;
- owning system;
- consumers;
- migration candidates;
- legacy implementations;
- deletion criteria.

Record significant decisions in ADRs.

### Gate 3 — Behavior lock

Before migration, capture expected behavior through appropriate:

- unit tests;
- contract tests;
- integration tests;
- E2E tests;
- property tests;
- golden cases;
- DB invariants;
- security tests;
- performance thresholds;
- physical-device/equipment tests.

### Gate 4 — R0

Create and verify the rollback checkpoint.

### Gate 5 — Incremental implementation

For multi-consumer migrations use **Branch by Abstraction**:

```text
Stable contract
    ↓
Current implementation
    +
Candidate implementation
    ↓
Side-by-side comparison
    ↓
Incremental consumer migration
    ↓
Candidate becomes canonical
    ↓
Observation period
    ↓
Separate deletion decision
```

For larger service replacement use the **Strangler** pattern.

Never replace an entire subsystem in one mega-PR merely because an AI agent can modify many files.

### Gate 6 — Deterministic verification

Run applicable:

- lint;
- types;
- architecture tests;
- unit tests;
- integration tests;
- E2E;
- SAST;
- secret scanning;
- data invariants;
- AI evals;
- performance checks;
- migration dry runs;
- physical-device/equipment tests.

### Gate 7 — Independent adversarial review

The implementation agent does not perform final review.

**Default: the free-tier Groq → Cerebras → Together cascade — High reasoning.**
Invoke with `py tools/gate7_review.py <PR>` (see `.claude/commands/gate7-review.md`).

> **Amended 2026-08-16 (CU-11, owner decision).** This gate previously specified
> "GPT-5.6 Sol — High reasoning." **No OpenAI.** That name carried no configuration,
> credential, or vendor identity anywhere in either repo, so the lane could never have
> been wired as written — which is why every unit through CU-02 walked this gate on a
> substitute panel. The cascade is free-tier, OpenAI-compatible, and already proven in
> `.github/workflows/code-review.yml`, keeping the lane inside PRD §4 and
> `.claude/rules/zero-token-architecture.md`.
>
> **State the limit honestly wherever this gate is cited:** "independent" now means a
> *different vendor and model from the implementing agent, on a fresh context, briefed to
> disprove.* It is not a second human, and the reviewer does not run the tests. A unit
> record that implies more than that has drifted.

Escalate automatically to **xhigh** for:

- database/schema changes;
- ISA-95/UNS;
- canonical asset identity;
- authentication;
- authorization;
- tenant scoping;
- security boundaries;
- cross-repository contracts;
- production deployment;
- deletion/destructive changes;
- broad multi-module changes;
- shadow mismatches;
- ambiguous failures;
- concurrency/idempotency/state-machine changes.

Use **Max only by exception** for unresolved stop-the-line consequential concerns.

The reviewer attempts to disprove the implementation, including:

- hidden coupling;
- behavioral regression;
- architecture violations;
- security failures;
- tenant leakage;
- data corruption;
- invalid rollback;
- irreversible migration;
- false-green tests;
- duplicated logic;
- scope creep;
- documentation drift;
- observability gaps;
- premature deletion.

### Gate 8 — Shadow validation

When practical, execute old and candidate implementations against the same inputs.

Compare structured invariants rather than merely generated text:

- asset ID;
- UNS path;
- manufacturer/model/catalog number;
- document identity;
- citation/page;
- diagnostic/fault identity;
- required procedure steps;
- unsupported claims;
- write payload;
- idempotency;
- resulting WO/PM identity.

A mismatch is a finding.

### Gate 9 — Human GO

High-risk architecture changes retain a human promotion gate.

Agents may not bypass normal staging, migration, security or production controls.

### Gate 10 — R1

Record the new verified known-good state.

### Gate 11 — Deletion

Deletion is independently approved.

Before deleting an old implementation prove:

- zero runtime consumers;
- zero imports;
- zero API consumers;
- zero deployment references;
- zero scheduled jobs;
- zero DB/workflow dependencies;
- zero required feature flags;
- documentation no longer declares it authoritative;
- replacement passed its observation period;
- rollback implications are understood.

**Replacement success does not authorize deletion by itself.**

## 9. Agent roles

### Explorer

Read-only repository investigation.

### Planner

Produces migration plan, invariants, acceptance criteria, rollback plan and task decomposition.

### Implementer

Changes one bounded migration unit.

### Verifier

Fresh context; runs deterministic validation and attempts to reproduce failures.

### Adversarial Reviewer

**Codex / GPT-5.6 Sol**, fresh context, deliberately attempts to prove the change wrong.

### Human Gate

Approves consequential architecture, migration, deletion and production promotion.

### Parallelism

Parallelize independent research aggressively.

Parallelize implementation only when dependency analysis proves the work does not overlap.

## 10. Context strategy

Do not dump the entire Architecture Registry into root `CLAUDE.md`.

Use progressive disclosure.

Add this or equivalent to root `CLAUDE.md`:

> **Architecture changes:** Before any cross-module refactor, migration, consolidation, new service, dependency-direction change, canonical identity change, or legacy deletion, read and follow `docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md`. Query the Architecture Registry before planning. No architecture-affecting implementation may begin without an R0 known-good rollback point. Follow the gated workflow and independent adversarial-review requirements.

Then route agent context dynamically:

```text
Request
   ↓
Capability
   ↓
Architecture Registry
   ↓
Canonical modules
   ↓
Contracts + ADRs
   ↓
Tests + known traps
   ↓
Authorized change surface
```

## 11. Architecture drift

Continuously detect:

- documented vs configured provider chains;
- declared module status vs deployment;
- documented services/ports vs manifests;
- canonical APIs vs actual consumers;
- documented DB ownership vs actual writers;
- layer declarations vs imports;
- stale coverage/quality claims;
- superseded ADRs;
- legacy modules acquiring new consumers.

Prefer machine-validated architecture facts over prose that can silently become stale.

## 12. Open-source tooling

Keep and extend existing:

- architecture/boundary tests;
- Semgrep;
- Bandit;
- gitleaks;
- pyright;
- pytest/property tests;
- current CI/eval harnesses.

Evaluate:

- **dependency-cruiser** for JS/TS architectural boundaries;
- **ast-grep** for deterministic codemods;
- **GitHub CodeQL** for security/custom invariants;
- **Nx-style tagged boundaries** without necessarily adopting Nx wholesale.

A new architecture tool must remove more complexity than it introduces.

## 13. Explicit blind-spot hunt

Every convergence wave should look for:

1. Architecture-documentation drift.
2. Semantic duplication with different names.
3. Conflicting database writers.
4. Runtime coupling invisible to imports.
5. Asset identity bifurcation.
6. AI-generated architecture entropy.
7. Parallel-agent collisions.
8. False confidence from green tests.
9. Premature deletion.
10. Rollback theater—a SHA that does not actually restore data/runtime state.
11. Missing observability on candidate paths.
12. Cross-repository contract drift.
13. Generated/vendor/data LOC distorting architecture measurements.
14. Agents operating from stale remembered context.

## 14. FactoryLM Personal SWE-Bench

Build a repository-specific benchmark from approximately 50–100 strong historical PRs.

For each:

1. Restore the repository immediately before the fix.
2. Hide the known patch.
3. Give the original problem to the candidate coding agent.
4. Run the historical tests plus current architectural checks.
5. Compare against the known successful implementation.

Measure:

- solve rate;
- regression rate;
- architecture violations;
- unnecessary modifications;
- reviewer findings;
- time;
- tokens/cost;
- false assumptions.

This lets FactoryLM determine **which model + harness is safest on FactoryLM**, rather than relying only on generic coding benchmarks.

## 15. Pilot first

Do not fan implementation across all modules immediately.

Run one complete, non-catastrophic pilot:

```text
Discovery
→ Registry
→ Dependencies
→ Behavior lock
→ R0
→ Implementation
→ Deterministic verification
→ GPT-5.6 Sol review
→ Shadow validation
→ Human GO
→ Merge
→ R1
→ Observation
→ Separate deletion decision
```

Do not use authentication, tenancy, core DB ownership or the central Supervisor as the first pilot.

Broad convergence begins only after the pilot is GREEN.

## 16. Initial convergence deliverables

Before broad production refactoring, produce:

1. Architecture Registry for all surveyed modules.
2. Source dependency graph.
3. Runtime/API/queue/database dependency graph.
4. Declared-vs-observed drift report.
5. Semantic duplicate-capability report.
6. Canonical ownership decisions.
7. Executable architecture contracts in CI.
8. Ranked migration backlog.
9. FactoryLM Personal SWE-Bench starter set.
10. One fully evidenced pilot migration.

## 17. Standard convergence-unit record

Every unit records:

```markdown
# Convergence Unit

## Current behavior
## Target architecture
## Why this change exists
## Canonical implementation
## Old implementation
## Affected modules
## Contracts/invariants
## Risk classification
## Behavior-lock tests
## R0 SHA/checkpoint
## Data/schema recovery procedure
## Implementation plan
## Shadow-validation plan
## Adversarial reviewer effort
## Human approval requirement
## Promotion plan
## R1 SHA/checkpoint
## Observation window
## Deletion criteria
## Evidence required for GO
```

Prefer separate research/registry, contract/test, implementation/migration and deletion PRs over mega-PRs.

## 18. Permanent continuous-refactoring procedure

The initial convergence effort ends.

This process does not.

```text
Task
 ↓
Architecture Registry lookup
 ↓
Canonical modules/contracts
 ↓
Boundary check
 ↓
R0 if architecture-sensitive
 ↓
Bounded implementation
 ↓
Deterministic verification
 ↓
Independent risk-proportional review
 ↓
Merge/promote
 ↓
Registry/docs update
 ↓
R1
```

The objective is that FactoryLM/MIRA should **never again require a giant architectural cleanup merely because normal feature development slowly recreated duplication and drift.**

## 19. Definition of Done

A convergence unit is not DONE because code merged.

It is DONE when:

- intended behavior is proven;
- architecture boundaries pass;
- independent adversarial review passes;
- shadow comparison passes where required;
- no unexpected identity/data changes occurred;
- rollback is known and usable;
- registry reflects reality;
- documentation reflects reality;
- observability can distinguish the new path;
- R1 is recorded;
- legacy deletion is either completed or explicitly tracked separately.

## 20. Final governing principle

> **Make the safe path the automatic path.**

Claude, Codex and future agents should not need to remember how FactoryLM architecture work is performed.

The repository should tell them.

The registry should narrow their scope.

Tests should define behavior.

Architecture rules should constrain dependencies.

Rollback checkpoints should make experiments reversible.

Codex should challenge consequential changes independently.

Shadow execution should compare old and new behavior.

CI should enforce the rules.

Humans should decide consequential promotion.

That is the architecture of the refactoring process itself.

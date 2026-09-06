# MIRA-1000 / P0000 — Claude Code Master Operating Prompt

You are an implementation agent continuing **MIRA-1000: MIRA CLOUD GOLD — The Divergence** in the `Mikecranesync/MIRA` repository.

This prompt is a persistent operating contract. It does not itself authorize a particular implementation slice. Execute the prompt marked ACTIVE in `../CURRENT.md`.

## Mission

Build one MIRA product over one FactoryLM deterministic core with two inference editions:

- **Cloud Gold:** OpenAI Responses API provides frontier general intelligence.
- **On-Prem:** local inference provides the no-cloud-inference edition.

The divergence is at the provider boundary. Do not split FactoryLM's canonical context, evidence, tools, identity, conversation, or application architecture merely because the inference provider differs.

## Read before editing

1. repository root `CLAUDE.md`
2. relevant local `CLAUDE.md`
3. global multi-session/session-discipline rules
4. `docs/architecture/mira-1000/README.md`
5. `docs/architecture/mira-1000/ARCHITECTURE.md`
6. `docs/architecture/mira-1000/CURRENT.md`
7. `docs/architecture/mira-1000/TRACKER.yaml`
8. the ACTIVE prompt

## Mandatory repository discovery

Before substantial editing, inspect current reality. At minimum:

```bash
git status
git branch --show-current
git rev-parse HEAD
git remote -v
git worktree list
gh pr list --state open
```

Fetch current remote state when safe.

Then inspect relevant:

- open PRs/branches/worktrees
- runtime entrypoints
- provider/inference router code
- MIRA orchestration
- retrieval and evidence
- conversation state
- asset/UNS context
- knowledge graph
- work orders/CMMS
- client adapters
- feature flags
- migrations
- deploy configuration
- evals and gating

Do not duplicate active work.

## Core architecture rules

### R1 — Convergence, not parallel rewrite

A logical component described by MIRA-1000 is not permission to create a new service/table/module if the capability already exists.

Use a current→target map.

### R2 — FactoryLM owns authority

The model must not decide:

- tenant scope
- authenticated identity
- user permissions
- source approval
- approval requirements
- whether an external/industrial action succeeded
- whether an industrial write is safe

Code decides.

### R3 — Provider isolation

OpenAI-specific logic goes behind one provider adapter/interface.

Do not spread raw Responses API semantics through every client and subsystem.

### R4 — One MIRA runtime

No independent Telegram/Slack/web/Android reasoning stacks.

Channel-specific normalization/rendering is fine. Channel-specific truth/policy is not.

### R5 — Existing deterministic systems become tools

Prefer wrapping proven functions/routes behind strict contracts for:

- approved knowledge
- document evidence
- asset identity
- KG
- history
- live state
- fault/parameter validation
- CMMS
- nameplate/equipment identity
- future business integrations

### R6 — Strict schemas

Model-callable tools need explicit typed schemas and typed results.

Avoid general arbitrary-command interfaces.

### R7 — Least privilege

The tool catalog is computed from `RunContext`, permissions, connection availability, asset/site scope, and policy.

Do not expose every tool on every run.

### R8 — Sensitive writes

Start with read and draft.

Email sends, Slack posts, calendar changes, CMMS changes, and other material side effects use deterministic permission and approval policy, idempotency where appropriate, and audit.

### R9 — OT control is separate

MIRA-1000 does not create generic PLC/VFD/tag write authority.

Diagnosis and recommendations are allowed. Industrial actuation requires a separate safety program.

### R10 — Evidence remains structural

Do not solve conversational quality problems by weakening source approval, citation validation, parameter/fault-code guards, tenant isolation, or stale-data handling.

## Cloud Gold implementation baseline

Use current official OpenAI documentation, not memory.

The intended initial primitive is the **Responses API**, with FactoryLM owning the orchestration/tool loop.

Establish one strong Cloud Gold baseline before building aggressive model routing.

`chat-latest` may be used as a moving conversational reference in evals; do not make it the unpinned production dependency merely to claim ChatGPT parity.

## On-Prem contract

Do not delete or freeze local inference work.

Adapt the local path toward the same provider-independent:

- interaction envelope
- run context
- tool contracts
- evidence contracts
- conversation records
- client behavior
- eval cases

Where On-Prem cannot perform a Cloud capability, record an explicit gap.

## Cost rules

Do not optimize cost until Gold is measured.

Then consider:

1. prompt caching for repeated stable prefixes;
2. lower-cost models only where parity evals pass;
3. Flex for slower/lower-priority request workloads;
4. Batch for grouped asynchronous workloads.

Interactive technician chat remains latency/availability sensitive.

## Prompt-history rules

- Do not edit executed prompt history to change what it appears we asked for.
- New direction = new P-number.
- Child PR title/body should cite `MIRA-1000/Pxxxx`.
- On completion:
  - update `TRACKER.yaml`
  - append `HISTORY.md`
  - update `CURRENT.md`
  - identify the next smallest non-overlapping slice

## Completion standard

Report:

1. current-state discoveries
2. overlap avoided
3. exact old→new runtime path
4. files changed
5. tests
6. real-path proof
7. environment + feature-flag state
8. eval evidence
9. rollback
10. known gaps
11. cloud/on-prem impact
12. next prompt recommendation
13. exact branch/commit/PR state

A capability that exists only in code but is not connected, exercised, observable, and appropriately enabled is not complete.

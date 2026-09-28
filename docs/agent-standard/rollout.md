# Fleet Standardization Rollout

## Objective

Converge all FactoryLM computers and both Claude/Codex onto one repository-defined operating model **without interrupting active work or creating a second orchestration system**.

## Files in this pack

1. `FLEET_STANDARD.md` — canonical behavior.
2. `nodes/alpha.md`
3. `nodes/bravo.md`
4. `nodes/charlie.md`
5. `nodes/travel-laptop.md`
6. `nodes/plc-laptop.md`
7. `nodes/vps.md`
8. `providers/claude.md`
9. `providers/codex.md`

## Repository destination

```text
docs/agent-standard/
  README.md
  FLEET_STANDARD.md
  rollout.md
  nodes/
    alpha.md
    bravo.md
    charlie.md
    travel-laptop.md
    plc-laptop.md
    vps.md
  providers/
    claude.md
    codex.md
```

Then link, do not duplicate, from:
- root `AGENTS.md`
- root/provider `CLAUDE.md`
- `.claude/rules/`
- future Codex adapter
- Spec Kit constitution

## Rollout order

### Phase 0 — preserve state

Before changing any computer:

- inventory active sessions/worktrees
- record task owner + branch + HEAD
- do not stop or prune them
- freeze merge/deploy/OTA unless separately authorized

### Phase 1 — land provider-neutral docs

Create one documentation-only PR containing this standard. Resolve conflicts with existing ADRs and current rules before calling it canonical.

Do not install Spec Kit in the same PR unless that is explicitly desired; keeping the documentation baseline reviewable makes rollback easier.

### Phase 2 — provider adapters

On one non-production development node:

- make Claude point to provider-neutral rules
- make Codex point to provider-neutral rules
- prove both can open the same bounded task without chat history

Acceptance:
- same architecture answer
- same allowed files
- same acceptance criteria
- same ownership rules
- same verification language

### Phase 3 — node audit

Run each node's standardization runbook. Do not blindly copy config files between OSes.

Classify differences:
- `UNIVERSAL DRIFT`
- `NODE OVERLAY`
- `BLOCKER`

Fix universal drift centrally; keep node overlays local/documented.

### Phase 4 — Spec Kit pilot

Install/adopt GitHub Spec Kit in its own branch/PR.

Pilot one real FactoryLM task through:
`spec -> plan -> tasks -> implement -> converge`

Run it once with Claude and once with Codex in separate owned worktrees or use one as reviewer.

Measure:
- tokens
- tool calls
- files read
- accepted requirements
- defects/rework

Keep only if product yield improves.

### Phase 5 — parity gate

A future shared parity check should inspect, not own, the system. Prefer a small cross-platform script or CI check that verifies canonical files/config references and reports drift. It must not become a daemon or second scheduler.

## Success definition

A fresh supported agent on any general development node can receive:

> `Implement <task-id>. Follow FactoryLM standard.`

and correctly discover:
- current product rules
- active task contract
- relevant architecture
- relevant code
- verification requirements
- handoff format

without receiving a giant custom prompt.

## Failure definition

The standardization failed if:
- each machine ends up with its own duplicated instruction corpus
- Claude and Codex need different architecture prompts
- machine parity requires copying secrets
- agents still read the entire repo/history per task
- node roles are erased merely for cosmetic sameness
- active workers are interrupted during rollout

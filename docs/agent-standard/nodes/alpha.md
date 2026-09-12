# Alpha Standardization Runbook

**Node:** Alpha  
**Canonical node reference:** `wiki/nodes/alpha.md`  
**Role overlay:** orchestration / observability / fleet coordination

Read `docs/agent-standard/FLEET_STANDARD.md` first. This file contains only Alpha-specific deviations.

## Desired state

Alpha behaves like every other FactoryLM development node for repository context, task contracts, agent rules, ownership, and evidence. Its machine-specific orchestration/observability services remain intact.

## Audit first

Record:

- OS/hostname and current repo path
- current HEAD/branch/worktrees
- active FactoryLM/agent processes and owners
- Git/GitHub auth state
- Claude and Codex availability/version if installed
- Node/npm/npx and Python availability
- container runtime state
- Tailscale reachability
- Obsidian/wiki access
- `.mcp.json` visibility
- CodeGraph preflight result
- differences from the canonical standard

Do not change anything before producing the inventory.

## Safe convergence actions

An authorized agent may:

- bring provider-neutral repo instructions into view through normal Git workflow
- configure local agent adapters to point at the same canonical standards
- repair missing non-secret local tooling when the version/source is already defined by the repo or approved framework
- document Alpha-only paths/runtime details in `wiki/nodes/alpha.md`
- verify CodeGraph and Obsidian/wiki access

## Preserve

- Alpha's orchestration/observability role
- existing fleet ownership controls
- active Celery/observability workloads unless the task explicitly authorizes service changes
- node-specific network/runtime configuration

Do not migrate MIRA product services onto Alpha merely to make machines look identical.

## Alpha-specific stop conditions

Stop before:

- changing always-on/sleep/power configuration
- restarting orchestration services used by active workers
- altering fleet/Gateway ownership behavior
- deploying product services
- copying credentials from another node
- pruning worktrees or stopping sessions you do not own

## PASS evidence

Return:

- exact HEAD
- shared standard version/commit
- provider adapters found
- CodeGraph preflight verdict
- wiki/Obsidian accessibility
- Claude status
- Codex status
- any intentional Alpha-only deviations
- commands actually run

# Alpha Standardization Runbook

**Node:** Alpha  
**Canonical node reference:** `wiki/nodes/alpha.md` (stale — see below)  
**Role overlay:** **RETIRED FROM THE CLUSTER (2026-08-16).** No active role.

> **Status.** Alpha was retired on 2026-08-16 and repurposed as a household PC: other local user
> accounts exist alongside `factorylm`, the hostname is `Michaels-Mac-mini-2.local`, and
> `/Users/Shared/cluster` no longer exists on it — it is not the SMB host and not the
> orchestrator. **No replacement orchestrator has been designated.** The repository's
> `deployment/network.yml` and `wiki/nodes/alpha.md` still describe the pre-retirement role and
> are superseded by this notice until they are updated. Binding record: the cluster context
> (`~/factorylm/CLUSTER.md` on every node).
>
> **Do not standardize, inventory workloads on, install agents on, or operate services on Alpha
> without explicit owner authorization.** Do not assume it is reachable. Do not plan fleet
> orchestration around it. Everything below this notice is retained only as the procedure to
> follow *if* Alpha is ever re-commissioned.

Read `docs/agent-standard/FLEET_STANDARD.md` first. This file contains only Alpha-specific deviations.

## Desired state (only if re-commissioned)

Alpha behaves like every other FactoryLM development node for repository context, task contracts, agent rules, ownership, and evidence. Any machine-specific orchestration/observability services would be documented and preserved as node overlays — none are designated today.

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

- the household users and data on the machine — it is no longer a fleet asset
- existing fleet ownership controls
- any residual Celery/observability workload only if it is proven live and the owner has
  explicitly kept it; do not assume one exists (none is designated since retirement)
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

# Bravo Standardization Runbook

**Node:** Bravo  
**Canonical node reference:** `wiki/nodes/bravo.md`  
**Role overlay:** compute/worker node with local Docker/Ollama and historically production-hosted services

Read `docs/agent-standard/FLEET_STANDARD.md` first.

## Desired state

Bravo must use the same repository brain, task contracts, ownership rules, CodeGraph doctrine, and evidence standard as Alpha/Charlie/Windows nodes. Local Ollama/container services are capabilities, not separate architecture.

## Audit first

Record:

- current repo clone(s), branches and worktrees
- every active Claude/Codex/fleet session and its owner/task
- exact HEAD of each active task worktree
- Git/GitHub auth
- Claude/Codex availability
- CodeGraph preflight
- Obsidian/wiki access
- Doppler status without printing secrets
- Docker/Ollama health only if relevant to intended role
- local configuration that differs from canonical Git state

## Safe convergence actions

- point Claude and Codex at the same provider-neutral standard
- keep `.claude/` as an adapter, not the sole source of architecture
- verify CodeGraph MCP/CLI availability
- verify wiki/Obsidian MCP path
- reconcile stale committed configuration through an owned branch/PR
- record true Bravo-only runtime requirements in the node overlay

## Preserve

- active owned sessions
- local Ollama models/caches
- role-specific Docker configuration
- any service explicitly designated to Bravo by current deployment/network authority

Do not move workloads between Bravo and Charlie as a standardization shortcut.

## Bravo-specific stop conditions

Stop before:

- stopping/adopting an unowned session
- deleting/pruning another task's worktree
- restarting product/production containers without task authority
- changing deployment targets
- modifying secrets
- merging/deploying/OTA

## PASS evidence

Return a table:

| Check | Result | Evidence |
|---|---|---|
| Canonical standard visible | | |
| Agent rules provider-neutral | | |
| Claude aligned | | |
| Codex aligned | | |
| CodeGraph READY | | |
| Wiki/Obsidian accessible | | |
| Active sessions preserved | | |
| Node deviations documented | | |

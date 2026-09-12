# Travel Laptop Standardization Runbook

**Node:** Travel Laptop / Windows development client  
**Canonical references:** `wiki/nodes/windows-dev.md`, `docs/GITHUB_SETUP.md`, current fleet inventory  
**Role overlay:** portable development/operator client

Read `docs/agent-standard/FLEET_STANDARD.md` first.

## Desired state

The Travel Laptop should be able to start a fresh Claude or Codex session and receive substantially the same FactoryLM behavior as a Mac node without copying Mac-specific paths or services.

## Shell rule

Use the machine's documented shell. Do not paste Bash assumptions into PowerShell or PowerShell assumptions into Git Bash.

Committed scripts should remain cross-platform where practical. Machine-local shell wrappers are overlays.

## Audit first

Record:

- Windows version/hostname
- actual repo path
- default agent shell
- Git/GitHub auth
- Tailscale
- Claude/Codex versions
- Node/npm/npx
- Python
- Obsidian
- `.mcp.json`
- CodeGraph preflight or documented CLI equivalent
- current worktrees
- current `main`/remote relationship
- known Windows-specific blockers

## Safe convergence actions

- align shared repo rules through Git
- configure provider adapters to canonical docs
- verify Obsidian opens the same `wiki/`
- verify CodeGraph behavior
- ensure local absolute paths remain local
- document Windows-only limitations rather than contaminating universal architecture

## Known class of exception

If a database/network library has a Windows-specific connectivity issue already documented in the repo, route that operation through an approved Mac/service node rather than changing application architecture just to make the Travel Laptop identical.

## Stop conditions

Stop before:

- changing Windows security/network settings without approval
- copying secrets from another computer
- force-resetting an existing worktree
- altering shared branches to resolve local tooling problems
- introducing a separate Windows-only product architecture

## PASS evidence

Show that the same bounded task contract can be opened, navigated with CodeGraph, implemented in an owned worktree, and verified using the same acceptance criteria as on macOS.

# ADR-0004: Multi-Machine Claude Config Sync

## Status
Accepted

## Context

MIRA development spans five machines: BRAVO (production Mac Mini), CHARLIE (Telegram bot host),
Travel Laptop, PLC Laptop, and occasional CI runners. All machines need consistent Claude Code
configuration — skills, CLAUDE.md context files, and project memory. Without a sync mechanism,
machines diverge and Claude Code operates with stale context.

## Considered Options

1. claude-config-sync (git + gist) — dedicated tool, syncs via GitHub Gist
2. ccms (rsync-based) — rsync over SSH, requires all machines reachable simultaneously
3. toroleapinc/claude-brain (semantic merge) — conflict resolution via embeddings, heavy dependency
4. Git-native — track `.claude/` in the repository, sync via `git pull`

## Decision

**`.claude/` tracked in the MIRA git repository. Machines sync Claude Code configuration
by running `git pull origin main`.** No additional tooling is required. Machine-specific
overrides (personal API keys, local paths, user-level preferences) live in `~/.claude/`
at the user level and are never committed. The repo-level `.claude/` contains only
project context: CLAUDE.md files, skills, and shared memory files.

## Consequences

### Positive
- Zero extra tooling — every machine already has git
- All five machines get identical context after `git pull`
- Conflict resolution uses standard git workflows (stash, merge, rebase)
- History and rollback via normal git log

### Negative
- Machine-specific overrides must be carefully kept out of `.claude/` (gitignore patterns required)
- Sensitive data in user-level `~/.claude/` must never be `git add`-ed — requires discipline
- Sync is pull-only; a machine that hasn't pulled in days silently operates on stale context

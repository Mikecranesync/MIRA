# ADR-0006: Paperclip Dev Orchestration

## Status
Accepted

## Context

MIRA is a monorepo with 8+ independent subsystems (bots, ingest, MCP, CMMS, HUD, bridge,
core, tests). Development is currently bottlenecked on single-agent Claude Code sessions --
only one session can work on the repo at a time, and context switching between subsystems
wastes time re-establishing context.

Paperclip (paperclipai/paperclip, MIT license, 43k+ stars) is a multi-agent orchestration
control plane that coordinates parallel AI agent sessions with org charts, budgets, heartbeat
scheduling, and audit logs. It supports Claude Code as a first-class adapter.

## Considered Options

1. **Manual parallel Claude Code sessions** — open multiple terminals, manually coordinate
   what each session works on. No budget tracking, no audit trail, easy to create conflicts.

2. **Custom multi-agent harness** — build coordination logic using the existing adversarial-dev
   harness in `.claude/skills/harness.md`. Requires writing and maintaining custom orchestration.

3. **Paperclip multi-agent orchestration** — deploy Paperclip on a Mac Mini as an always-on
   coordinator accessible from any Tailscale device. Purpose-built for this exact problem.

## Decision

**Deploy Paperclip on Charlie Mac Mini (100.70.49.126) as a development-time orchestration
tool.** Paperclip runs as a Node.js process with embedded PGlite (no external Postgres),
accessible via Tailscale at port 3200 in authenticated mode.

Six agent roles defined: orchestrator (opus), bots-dev (sonnet), ingest-dev (sonnet),
hud-dev (sonnet), test-runner (haiku), docs-writer (sonnet). Specialist agents use
git worktrees for workspace isolation.

This is a dev tool only — not a production MIRA component. It does not appear in Docker
Compose, CI pipelines, or production infrastructure.

## Consequences

**Positive:**
- Parallel development across independent subsystems
- Budget tracking and audit logs per agent
- Session persistence across heartbeats (agents resume context)
- Accessible from phone + laptop via Tailscale

**Negative:**
- Adds Node.js + pnpm as dev dependencies on the Mac Mini (exception to bun preference)
- Paperclip is 4 weeks old — API surface may have breaking changes
- Requires Claude CLI installed and authenticated on the Mac Mini
- One more service to maintain on Charlie alongside Telegram bot and Qdrant

**Mitigations:**
- Pin Paperclip npm version to avoid breaking changes
- `dangerouslySkipPermissions: false` on all agents — respect Claude Code permission model
- Authenticated mode + Tailscale network isolation for security

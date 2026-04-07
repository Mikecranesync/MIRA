# Paperclip Dev Orchestration for MIRA

Multi-agent orchestration for parallel MIRA development using [Paperclip](https://github.com/paperclipai/paperclip).

## What This Is

Paperclip coordinates multiple Claude Code agent sessions working on different MIRA subsystems simultaneously. It runs on a Mac Mini (Charlie) and is accessible from any Tailscale device.

**This is a dev tool only** — not a production MIRA component.

## Agents

| Agent | Model | Scope |
|-------|-------|-------|
| mira-orchestrator | claude-opus-4-6 | Task decomposition, reviews, merging |
| mira-bots-dev | claude-sonnet-4-6 | mira-bots/, guardrails, inference |
| mira-ingest-dev | claude-sonnet-4-6 | mira-core/, mira-mcp/, tools/ |
| mira-hud-dev | claude-sonnet-4-6 | mira-hud/, ignition/ |
| mira-test-runner | claude-haiku-4-5 | tests/, evals/ |
| mira-docs-writer | claude-sonnet-4-6 | docs/, DEVLOG, CHANGELOG |

## Setup (one-time)

```bash
cd MIRA
bash paperclip/setup.sh
```

This installs Node.js, pnpm, Claude CLI, and Paperclip. It also resolves `__MIRA_HOME__` placeholders in all agent configs into `paperclip/.generated/`.

Works on both macOS and Linux.

## Start

```bash
bash paperclip/start.sh
```

Access from any Tailscale device: `http://100.70.49.126:3200` (Charlie)

## File Layout

```
paperclip/
├── setup.sh              # One-time onboarding (macOS + Linux)
├── start.sh              # Launch Paperclip with resolved configs
├── mcp-config.json       # MCP servers: sqlite, sequential-thinking, github
├── company-template.json # Company/org definition reference
├── agents/               # Agent role templates (6 JSON files, __MIRA_HOME__ placeholders)
├── .generated/           # Resolved configs (gitignored, created by setup.sh)
│   ├── agents/           # Agent JSONs with real paths
│   └── mcp-config.json   # MCP config with real paths
├── instructions/         # Agent-specific context (6 markdown files)
└── skills/               # Paperclip-injected skills (3 files)
```

## Architecture Decision

See [ADR-0006](../docs/adr/0006-paperclip-dev-orchestration.md).

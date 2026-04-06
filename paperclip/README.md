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

## Setup

On the target Mac Mini:

```bash
# Clone MIRA repo if not present, then:
cd MIRA
bash paperclip/setup.sh
```

Prerequisites installed by the script: Node.js 20+, pnpm, Claude CLI.

## Usage

```bash
# Start Paperclip
PORT=3200 npx paperclipai start

# Access from any Tailscale device
# http://100.70.49.126:3200 (Charlie)
```

1. Create a company: "MIRA Development"
2. Register agents using the JSON configs in `agents/`
3. Assign tasks and watch agents work

## File Layout

```
paperclip/
├── setup.sh              # Mac Mini onboarding script
├── mcp-config.json       # MCP server config for agents
├── company-template.json # Company/org definition reference
├── agents/               # Agent role definitions (6 JSON files)
├── instructions/         # Agent-specific context (6 markdown files)
└── skills/               # Paperclip-injected skills (3 files)
```

## Architecture Decision

See [ADR-0006](../docs/adr/0006-paperclip-dev-orchestration.md).

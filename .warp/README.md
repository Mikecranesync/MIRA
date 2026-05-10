# MIRA Warp Configuration

Warp terminal config for the MIRA project. All nodes that clone this repo get these automatically.

## Workflows

`workflows/` — 12 searchable command snippets. Open with `Ctrl-Shift-R` in Warp or search from the command palette.

| Workflow | What |
|----------|------|
| `mira-stack-up` | Start full stack via `install/up.sh` |
| `mira-stack-down` | Stop all containers |
| `mira-rebuild-service` | Rebuild single container (parameterized) |
| `mira-logs` | Tail container logs (parameterized) |
| `mira-smoke-test` | Smoke test localhost |
| `mira-smoke-remote` | Smoke test remote node (parameterized IP) |
| `mira-tests` | Full offline pytest suite |
| `mira-eval` | Golden eval cases only |
| `mira-enum-drift` | Enum drift check |
| `mira-pr-review` | PR self-fix script (parameterized PR#) |
| `plc-health` | PLC API health check |
| `cluster-ssh` | SSH to cluster node (parameterized) |

## MCP Setup

See `MCP_SETUP.md` to connect mira-mcp to Warp's local AI agent.
This gives Warp's Oz agent access to MIRA's equipment diagnostic tools.

## Claude Code in Warp

Run `claude` inside Warp to get:
- Rich multi-line input editor (`Ctrl-G`)
- Desktop notifications when Claude pauses for input
- Inline code review sidebar
- Remote Control (steer from another node via Tailscale)

One-time notification setup: `claude /install-github-app` → follow Warp plugin prompt.

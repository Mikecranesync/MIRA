<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# ok lets use charlienode setup a prd for claude code to setup this process i need to run something on each computer correct and how do we make the claude-peers open on startup?

Here's your complete PRD — drop it into your project root and Claude Code can execute the entire setup from it.

## What the PRD Covers

The document is organized as a 9-step runbook that Claude Code can follow directly:

### Roles per machine

- **PC-1 (broker host):** Runs the persistent broker daemon via systemd + acts as dispatcher
- **PC-2–5 (workers):** Each connects to PC-1's Tailscale IP, no daemon needed locally


### What runs on each machine

| Machine | Broker Daemon | Needs to Set | Auto-start Via |
| :-- | :-- | :-- | :-- |
| PC-1 | ✅ Yes | Nothing — is the broker | `systemd` service |
| PC-2–5 | ❌ No | `CLAUDE_PEERS_BROKER_URL=http://<PC1-tailscale-ip>:7899` in `.env` | Shell alias / desktop autostart |

### Startup automation

- **Broker on PC-1:** systemd service with `After=tailscaled.service` so it waits for Tailscale before starting
- **All machines:** `alias claudepeers='claude --dangerously-load-development-channels server:claude-peers'` in `.bashrc` — one command to launch a peer-connected session
- **Desktop autostart:** Optional `.desktop` entry with a 10-second delay to let Tailscale connect first


### Key things to do before handing to Claude Code

1. Get PC-1's Tailscale IP with `tailscale ip -4` and drop it in your `.env` on PC-2–5
2. Generate one shared secret: `openssl rand -hex 32` and put the same value in every machine's `.env`
3. Replace `youruser` in the systemd unit file with your actual Linux username

Hand Claude Code the PRD file and say: *"Follow this PRD step by step to set up claude-peers on this machine."* — it has all the commands inline.


---
title: Bravo — Mac Mini M4
type: node
updated: 2026-04-08
tags: [bravo, production, docker, ollama]
---

# Bravo — Mac Mini M4 (Production Host)

**Tailscale IP:** 100.86.236.11
**LAN IP:** 192.168.1.11
**SSH:** `ssh bravo` or `bravonode@100.86.236.11` (regular macOS sshd, NOT Tailscale SSH)
**SSH config aliases:** `bravo` on travel laptop; `charlie` alias on bravo -> 192.168.1.12

## Service Layout

```
/Users/bravonode/Mira/
├── mira-core/     → Open WebUI (port 8080) + mcpo proxy
├── mira-bridge/   → Node-RED + SQLite mira.db in data/
├── mira-bots/     → Telegram bot container
└── mira-mcp/      → FastMCP server (stdio, wrapped by mcpo)
```

## Key Files

| File | Path | Notes |
|------|------|-------|
| Bot env | `/Users/bravonode/Mira/mira-bots/.env` | TELEGRAM_BOT_TOKEN, OPENWEBUI_API_KEY, KNOWLEDGE_COLLECTION_ID |
| SQLite DB | `/Users/bravonode/Mira/mira-bridge/data/mira.db` | Mounted into bot container at `/data/mira.db` |
| WebUI DB | Inside mira-core container at `/app/backend/data/webui.db` | Docker volume, not host-mapped |

## Secrets

All secrets in Doppler (`factorylm/prd`). The `.env` on Bravo has local copies for Docker Compose.
Open WebUI API key and KB collection ID: see Doppler or WebUI admin panel.

## Docker + Doppler (Fixed 2026-03-21)

- **Doppler:** Service token in `~/.zshrc` + rewrote `~/.doppler/.doppler.yaml` to remove keychain reference. See [[gotchas/ssh-keychain]].
- **Docker pull:** Renamed `docker-credential-osxkeychain` and `docker-credential-desktop` to `.disabled`. Set `"credsStore": ""` in `~/.docker/config.json`.
- Volume naming: root compose uses `mira_` prefix (e.g. `mira_open-webui-data`)

## Auto-Recovery Chain (Configured 2026-03-24)

| Layer | Setting |
|-------|---------|
| Hardware | Restart after power failure = ON |
| macOS | Auto-login as bravonode = ON |
| Docker Desktop | AutoStart = true (settings-store.json) |
| Ollama | launchd RunAtLoad = true, OLLAMA_KEEP_ALIVE=-1, models on /Volumes/FactoryLM/ |
| Containers | All `restart: unless-stopped` |

## Known Issues

- **Doppler token expired** (as of 2026-03-24). Workaround: pass secrets from local Doppler via SSH env vars. Fix: `doppler login` on Bravo.

# Runbook: factorylm-prod VPS

DigitalOcean droplet hosting factorylm.com, OpenClaw, Atlas CMMS, Plane, and supporting services.

## Connection

```bash
# SSH alias (Charlie ~/.ssh/config)
ssh factorylm-prod

# Direct (works from anywhere)
ssh -i ~/.ssh/id_ed25519 root@165.245.138.91
```

| Item | Value |
|------|-------|
| Public IP | 165.245.138.91 |
| Tailscale IP | 100.68.120.99 |
| Region | DigitalOcean ATL1 |
| OS | Ubuntu 24.04 LTS |
| Specs | 8 GB RAM / 4 vCPU / 160 GB disk |
| SSH user | root |
| SSH key (Charlie) | `~/.ssh/id_ed25519` |

---

## Website — factorylm.com

| Item | Value |
|------|-------|
| Site root | `/var/www/html/preview/` |
| nginx config | `/etc/nginx/sites-enabled/factorylm-landing` |
| HTTPS cert | Let's Encrypt, expires 2026-06-28 (auto-renews) |
| Deploy | Push to `main` on `Mikecranesync/factorylm-landing` → GitHub Action rsync |
| Local clone (Charlie) | `~/Documents/GitHub/factorylm-landing/` |

**Manual deploy (bypass CI):**
```bash
rsync -az --delete \
  --exclude='.git/' --exclude='CLAUDE.md' --exclude='SITE_AUDIT.md' --exclude='VPS_INVENTORY.md' \
  -e "ssh -i ~/.ssh/id_ed25519" \
  ~/Documents/GitHub/factorylm-landing/ \
  root@165.245.138.91:/var/www/html/preview/
```

**Reload nginx:**
```bash
ssh factorylm-prod "nginx -t && nginx -s reload"
```

---

## Running Services

### Docker containers (19)
| Container | Port (host) | Purpose |
|-----------|-------------|---------|
| cmms-frontend | 3003 | Atlas CMMS UI (cmms.factorylm.ai) |
| cmms-backend | 8082 | Atlas CMMS API |
| cmms_db | 5433 | CMMS PostgreSQL |
| cmms_minio | 9002/9003 | CMMS file storage |
| flowise | 3001 (internal) | LLM workflow builder |
| plane-web-1 | 8070 (public) | Plane project management |
| plane-* (7 containers) | internal | Plane workers, DB, Redis, MQ, MinIO |
| n8n | 5678 | Workflow automation |
| infra_postgres_1 | 5432 (internal) | Shared pgvector PostgreSQL |
| infra_redis_1 | 6379 (internal) | Shared Redis |

### MIRA Stack (SaaS project — authoritative)
Compose: **`/opt/mira/docker-compose.saas.yml`**. Project: `mira`.

| Container | Role |
|-----------|------|
| mira-core-saas | Open WebUI — entrypoint for `app.factorylm.com`, port :3010 → :8080 |
| mira-pipeline-saas | OpenAI-compatible GSDEngine wrapper — **serves chat** via Docker DNS alias `mira-pipeline:9099` on `mira_mira-net` |
| mira-mcp-saas | FastMCP server — NeonDB recall, equipment tools |
| mira-ingest-saas | Photo / PDF ingest service |
| mira-docling-saas | PDF extraction |
| mira-web | PLG funnel (Hono/Bun), port :3200 |

**Deploy a mira change:**
```bash
cd /opt/mira && git pull origin main
doppler run -p factorylm -c prd -- docker compose -f docker-compose.saas.yml build <service>
doppler run -p factorylm -c prd -- docker compose -f docker-compose.saas.yml up -d --force-recreate <service>
```

**Retired 2026-04-18:** `mira-pipeline` from `/opt/mira/mira-core/docker-compose.yml` (was running on :9099 as an orphan — DNS collision made it invisible to OW). The `mira-core/docker-compose.yml` + `docker-compose.oracle.yml` files still exist but should not be used.

### Systemd services
| Service | Purpose |
|---------|---------|
| openclaw.service | Industrial AI gateway on :3000 (MIRA predecessor) |
| master-of-puppets.service | Celery task orchestration (alarm triage, content capture) |
| master-of-puppets-beat.service | Celery beat scheduler |
| flower.service | Celery monitor UI on :5555 |
| jarvis-telegram.service | Jarvis Telegram bot on :8081 |
| friday-telegram.service | Friday Telegram bot |
| discord-adapter.service | Discord bot gateway |
| conveyor-relay.service | Live conveyor demo relay on :8400 |
| remoteme.service | AI remote computer control on :8100 |
| mission-control.service | FactoryLM dashboard |

### Firewall (UFW) — publicly open ports
| Port | Service |
|------|---------|
| 22 | SSH |
| 80 | HTTP (redirects to HTTPS) |
| 443 | HTTPS |
| 8070 | Plane web |
| 8400 | Conveyor Relay demo |

All other ports: Tailscale only or internal.

---

## Common Operations

**Check what's running:**
```bash
ssh factorylm-prod "docker ps --format 'table {{.Names}}\t{{.Status}}' && systemctl list-units --state=running --type=service | grep -E 'openclaw|jarvis|master|flower|friday|discord|conveyor|remoteme|mission'"
```

**Check disk / memory:**
```bash
ssh factorylm-prod "df -h / && free -h"
```

**Restart a Docker service:**
```bash
ssh factorylm-prod "docker restart <container-name>"
```

**Apply security updates:**
```bash
ssh factorylm-prod "apt update && apt upgrade -y"
# Then reboot (system restart has been pending since Feb 2026)
ssh factorylm-prod "reboot"
# Wait ~60s then reconnect
```

---

## Secrets

Managed via Doppler:
- Project `factorylm` / config `dev` — Discord adapter, main services
- Project `openclaw` / config `dev_bot` — OpenClaw bot

---

## Notes

- **OpenClaw** (`:3000`) is the predecessor to MIRA — same mission, multi-LLM routing for industrial diagnostics. Consider whether to decommission or repurpose as a MIRA relay node.
- **infra_postgres** uses `pgvector/pgvector:pg16` — same vector extension as NeonDB. Could be used as a local vector store for MIRA if NeonDB is unavailable.
- **12 GB** of disk used by `/root/computer_use_ootb/` (Anthropic demo) — safe to archive/delete.
- **38 apt updates pending** as of 2026-03-30 including 15 security patches.

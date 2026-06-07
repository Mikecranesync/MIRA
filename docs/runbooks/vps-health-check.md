# VPS Health Check

**Authoritative doctrine:** `docs/environments.md`
**VPS facts (SSH aliases, disk layout):** `docs/runbooks/factorylm-vps.md`
**Recovery when the VPS hangs:** `docs/runbooks/vps-hang-recovery.md`

VPS: `165.245.138.91` (DigitalOcean, Ubuntu 24.04, 8 GB RAM, 4 vCPU, 160 GB disk).
Tailscale IP: `100.68.120.99` (from `docs/runbooks/factorylm-vps.md`).
All MIRA containers run under `/opt/mira/` using `docker-compose.saas.yml`.

---

## Prerequisites

- SSH access: `ssh factorylm-prod` (alias) or `ssh -i ~/.ssh/id_ed25519 root@165.245.138.91`
- `prod-guard.sh` hook blocks SSH to prod from a Claude Code session.
  Override for a single shell: `export MIRA_ALLOW_PROD=1`
- All commands below assume you are **on the VPS** unless prefixed with `(local)`.

---

## Quick external check (no SSH needed)

Run from your laptop before SSH-ing to rule out a local connectivity issue:

```bash
# (local)
curl -sS https://factorylm.com/api/health
curl -sS https://app.factorylm.com/api/health
```

Both should return HTTP 200. If both return 502/503, the nginx reverse-proxy or
the upstream containers are down. Proceed to the full check below.

---

## Full container status

```bash
# On VPS
docker ps -f name=mira --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
docker ps -f name=nango --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

### Expected containers (from `docker-compose.saas.yml`)

| Container | Expected status | Internal port | Host binding |
|---|---|---|---|
| `mira-pipeline-saas` | Up (healthy) | 9099 | `127.0.0.1:9099` |
| `mira-core-saas` | Up (healthy) | 8080 | `127.0.0.1:3010` |
| `mira-ingest-saas` | Up (healthy) | 8001 | `127.0.0.1:8002` |
| `mira-mcp-saas` | Up (healthy) | 8000 + 8001 | `127.0.0.1:8009`, `127.0.0.1:8001` |
| `mira-web` | Up (healthy) | 3000 | `127.0.0.1:3200` |
| `mira-hub` | Up (healthy) | 3000 | `127.0.0.1:3101` |
| `mira-bot-telegram` | Up | — | none |
| `mira-bot-slack` | Up | — | none |
| `mira-ask-saas` | Up (healthy) | 8011 | `100.68.120.99:8011` |
| `mira-docling-saas` | Up | 5001 | `127.0.0.1:5001` |
| `mira-relay` | Up (healthy) | 8765 | `127.0.0.1:8765` |
| `nango-db` | Up (healthy) | 5432 | none |
| `nango-server` | Up (healthy) | 3003 | `127.0.0.1:3003`, `127.0.0.1:3009` |
| `mira-cmms-sync` | Up | — | none |

Note: `mira-cmms-sync` has **no healthcheck defined** in `docker-compose.saas.yml`.
It shows as `Up` without a `(healthy)` suffix — that is normal.

Note: `mira-docling-saas` uses `restart: on-failure:5` (not `unless-stopped`) and
has `mem_limit: 3g` — the largest of any container. It may restart under load.

---

## Per-container health probes

```bash
# Chat pipeline (most critical path — VPS chat → this service)
curl -sf http://localhost:9099/health && echo "ok" || echo "FAIL"

# Hub (app.factorylm.com frontend)
curl -sf http://127.0.0.1:3101/api/health && echo "ok" || echo "FAIL"

# Open WebUI / knowledge backend
curl -sf http://localhost:3010/health && echo "ok" || echo "FAIL"

# Ingest API
curl -sf http://127.0.0.1:8002/health && echo "ok" || echo "FAIL"

# MCP server
curl -sf http://127.0.0.1:8001/health && echo "ok" || echo "FAIL"

# mira-web (marketing/PLG frontend)
curl -sf http://127.0.0.1:3200/api/health && echo "ok" || echo "FAIL"

# Relay (Ignition tag streaming)
curl -sf http://127.0.0.1:8765/health && echo "ok" || echo "FAIL"

# Nango (connector auth)
curl -sf http://127.0.0.1:3003/health && echo "ok" || echo "FAIL"

# Docling (PDF extraction)
curl -sf http://127.0.0.1:5001/health && echo "ok" || echo "FAIL"
```

For bots (no HTTP endpoint), verify the process is running:
```bash
# Telegram bot
docker inspect mira-bot-telegram --format '{{.State.Status}}'

# Slack bot
docker inspect mira-bot-slack --format '{{.State.Status}}'
```

---

## Disk

```bash
df -h /
```

Expected: `/dev/vda1` (or equivalent) at `/`, 160 GB total, usage below 75%.
If usage is above 85%, check Docker layer cache and logs:

```bash
docker system df           # breakdown: images / containers / volumes
du -sh /opt/mira/          # compose project dir
journalctl --disk-usage    # systemd journal
```

Prune dangling images (safe — does not remove running containers' images):
```bash
docker image prune -f
```

---

## Memory

```bash
free -h
```

Expected: 8 GB total. Typical idle consumption is ~5-6 GB across all containers.
The sum of `mem_limit` values across all 14 containers in `docker-compose.saas.yml`
exceeds 12 GB — these are soft caps, not reservations. Containers will be OOM-killed
individually before the host OOM-killer fires.

If memory pressure is high, identify the top consumers:
```bash
docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}" \
  | sort -t'%' -k1 -rn | head -15
```

Historical OOM incidents from unbounded Docling/Celery: see memory note
`project_vps_oom_docling_incidents.md`. `mira-docling-saas` is the most likely
candidate at 3 g mem_limit.

---

## Swap

```bash
swapon --show
free -h | grep Swap
```

This VPS may or may not have swap configured. If swap usage is high (>500 MB),
combined with high memory use, a reboot or targeted container restart may be needed.
See `docs/runbooks/vps-hang-recovery.md` for the full recovery playbook.

---

## Container logs (recent errors)

```bash
# Last 50 lines of a container's logs
docker logs --tail=50 mira-pipeline-saas

# Follow logs live (Ctrl-C to stop)
docker logs -f mira-pipeline-saas

# All containers: error-level only (last 20 lines each)
for c in mira-pipeline-saas mira-hub mira-ingest-saas mira-mcp-saas mira-web; do
  echo "=== $c ==="
  docker logs --tail=20 "$c" 2>&1 | grep -i 'error\|fatal\|exception\|traceback' || true
done
```

---

## What can go wrong

| Symptom | Likely cause | Next step |
|---|---|---|
| Container shows `Exited (1)` or `Restarting` | Crash-loop — startup error, missing env, bad import | `docker logs --tail=50 <container>` to find the traceback |
| `mira-pipeline-saas` absent from `docker ps` entirely | Container was *removed* (not stopped) — self-healer can't recreate it | Dispatch: `gh workflow run deploy-vps.yml -f services=mira-pipeline -f skip_staging_gate=true -f skip_reason="container removed"` |
| `mira-docling-saas` repeatedly restarting | OOM — 3 g limit exceeded or model download failed | `docker logs mira-docling-saas`; reduce concurrency or check disk for model files |
| `free -h` shows near-zero available, no swap | Multiple containers near their mem_limit | `docker stats --no-stream` to identify top consumers; consider restarting docling first |
| `df -h /` above 90% | Docker layer cache bloat or log accumulation | `docker image prune -f`; `journalctl --vacuum-size=500M` |
| External health check 502 but containers are up | nginx config issue or upstream socket mismatch | `nginx -t` on VPS; check nginx error log at `/var/log/nginx/error.log` |
| `mira-cmms-sync` not in `docker ps` | Not started (it has no healthcheck, easy to miss) | `docker ps -a -f name=mira-cmms-sync` — if Exited, check logs |

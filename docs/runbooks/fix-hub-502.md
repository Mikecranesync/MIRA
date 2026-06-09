# Fix: app.factorylm.com 502 Bad Gateway

**Updated:** 2026-06-06
**Scope:** VPS production only — `165.245.138.91`
**Cross-links:** [`fix-hub-container-removed.md`](fix-hub-container-removed.md) · [`vps-hang-recovery.md`](vps-hang-recovery.md) · [`docs/environments.md`](../environments.md)

> **Environment rule:** Never run raw `docker restart/stop/compose` against prod from a session —
> `prod-guard.sh` blocks it. Every mutation routes through `deploy-vps.yml`.
> Source: `docs/environments.md` Hard rule #2 + `tools/hooks/prod-guard.sh`.

---

## Prerequisites

- SSH access to VPS: `ssh root@prod` (Tailscale alias) or `ssh root@165.245.138.91` with key `~/.ssh/id_ed25519`
- GitHub CLI installed and authenticated: `gh auth status`
- `MIRA_ALLOW_PROD=1` set in shell if you need to run any diagnostic reads (non-mutating `docker inspect`, `docker ps`, `docker logs` are safe — prod-guard blocks writes)

---

## Decision Tree

### Step 1 — Confirm the 502 is real

```bash
curl -sv https://app.factorylm.com/api/health/ 2>&1 | grep -E "< HTTP|502|200"
```

**Expected when healthy:** `< HTTP/2 200`
**Expected when broken:** `< HTTP/2 502`

If you see 502, continue. If 200, the issue resolved itself — check if the self-healer acted (see Step 5).

---

### Step 2 — Is the container present?

SSH to the VPS, then:

```bash
ssh root@prod "docker ps -a --format '{{.Names}}\t{{.Status}}' | grep mira-hub"
```

**Interpret output:**

| Output | Meaning | Next step |
|--------|---------|-----------|
| `mira-hub   Up N minutes` | Container running, problem is elsewhere | → Step 3 |
| `mira-hub   Exited (137)` | OOM kill (exit 137 = SIGKILL from OOM) | → Step 4a |
| `mira-hub   Exited (1)` or other non-zero | Crash / startup failure | → Step 4b |
| *(no output)* | Container **removed** — not just stopped | → [`fix-hub-container-removed.md`](fix-hub-container-removed.md) |

Container presence check source: `mira-crawler/agents/heartbeat_monitor.py:204-210` (empty `docker ps` output → `container_missing` hint).

---

### Step 3 — Container is Up, still 502

The container is running but nginx gets a 502. Possible causes:

**3a — Health check failing internally**

```bash
ssh root@prod "docker inspect --format='{{json .State.Health}}' mira-hub"
```

Look for `"Status":"unhealthy"`. The healthcheck is:
`wget -qO- http://127.0.0.1:3000/api/health/`
Source: `docker-compose.saas.yml:635`

If unhealthy, check the last few health-check logs:
```bash
ssh root@prod "docker inspect --format='{{range .State.Health.Log}}{{.Output}}{{end}}' mira-hub | tail -5"
```

**3b — Check container logs for the actual error**

```bash
ssh root@prod "docker logs --tail 80 mira-hub 2>&1"
```

Common patterns:
- `ECONNREFUSED` or Next.js build error → startup failure → Step 4b
- NeonDB connection error → Step 3c
- Port already in use → Step 4c

**3c — NeonDB reachability** (not the 2026-06-04 incident cause, but rule it out)

```bash
ssh root@prod "docker exec mira-hub wget -qO- 'https://ep-lingering-salad.us-east-2.aws.neon.tech/ping' 2>&1 || echo 'neon_unreachable'"
```

If neon unreachable: check NeonDB console for billing/quota issues. Neon was NOT the cause of the 2026-06-04 outage (billing hypothesis was disproven — source: project memory `project_self_healer_recreate_gap.md`).

**3d — nginx config**

```bash
ssh root@prod "nginx -t && echo 'nginx_ok'"
ssh root@prod "grep -r 'mira-hub\|3101' /etc/nginx/ 2>/dev/null | head -20"
```

nginx proxies `app.factorylm.com` → `127.0.0.1:3101`.
mira-hub internal port: `127.0.0.1:3101:3000` — source: `docker-compose.saas.yml:537`

---

### Step 4 — Container exited

**4a — OOM kill (exit 137)**

mira-hub mem_limit is `1g` / `memswap_limit: 1g` — source: `docker-compose.saas.yml:632-633`.
Exit 137 = kernel OOM-killed the container, NOT the 1g compose limit (compose limit exits differently).

Check VPS free memory:
```bash
ssh root@prod "free -h && df -h /"
```

If disk full → see `vps-hang-recovery.md`.
If memory pressure → redeploy (compose will recreate with same 1g limit):

```bash
gh workflow run deploy-vps.yml \
  -f services="mira-hub" \
  -f skip_staging_gate=true \
  -f skip_reason="OOM kill recovery, mira-hub exited 137"
```

**4b — Non-zero exit (crash / startup error)**

Check logs before the container exited:
```bash
ssh root@prod "docker logs mira-hub 2>&1 | tail -100"
```

Look for missing env vars, Next.js compile errors, or DB migration errors.
Then redeploy:

```bash
gh workflow run deploy-vps.yml \
  -f services="mira-hub" \
  -f skip_staging_gate=true \
  -f skip_reason="mira-hub crash recovery (exit code non-zero)"
```

**4c — Port conflict**

```bash
ssh root@prod "ss -tlnp | grep 3101"
```

If another process holds port 3101, identify it and kill it before redeploying.

---

### Step 5 — Verify recovery

After any deploy action (wait ~3 minutes for the workflow to complete):

```bash
gh run list --workflow=deploy-vps.yml --limit 3
```

Then:

```bash
curl -sv https://app.factorylm.com/api/health/ 2>&1 | grep -E "< HTTP|200|502"
```

**Expected output:** `< HTTP/2 200`

If the deploy workflow shows red/failure despite the site being up, it may be the known mira-pipeline health-probe false alarm — verify `curl` returning 200 is the authoritative check.
Source: project memory `project_self_healer_recreate_gap.md`.

---

### Step 6 — If container was removed (no `docker ps` output)

Stop here and follow [`fix-hub-container-removed.md`](fix-hub-container-removed.md). The self-healer's `docker restart` cannot recreate a removed container — source: `mira-crawler/agents/self_healer.py:117-118`.

---

## What Can Go Wrong

| Symptom | Likely cause | Action |
|---------|-------------|--------|
| `deploy-vps.yml` fails but site returns 200 | mira-pipeline health-probe false alarm | Treat 200 as success; verify manually |
| Workflow completes but site still 502 | nginx not reloaded, or another container is the actual problem | Check `docker ps -a` for all services; check nginx |
| `docker logs` shows `Cannot find module` | Next.js build artifact missing in image | Full rebuild: deploy with no `services` filter to rebuild the image |
| Recurring OOM crashes | 1g limit too tight for current load | Investigate memory leak; file issue before raising limit |
| Self-healer shows it "fixed" but site was down for hours | ENDPOINT_TO_CONTAINER maps hub's health endpoint to `mira-web` (wrong) — source: `mira-crawler/agents/self_healer.py:203-207` | Self-healer bug; it was watching the wrong container — fix is tracked but unfixed as of 2026-06-06 |

---

## Known Self-Healer Bugs (as of 2026-06-06)

Both bugs are in `mira-crawler/agents/self_healer.py`:

1. **Line 117-118** — `restart_container` calls `docker restart <service>`. Docker cannot restart a container that was **removed** (as opposed to stopped). The command silently fails or errors, leaving the site down.

2. **Lines 203-207** — `ENDPOINT_TO_CONTAINER` maps `"app.factorylm.com/api/health"` → `"mira-web"`. This is wrong: `app.factorylm.com` is served by `mira-hub`, not `mira-web`. The monitor watches the wrong container.

These bugs mean the self-healer will NOT automatically recover a removed `mira-hub` container.

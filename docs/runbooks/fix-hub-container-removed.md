# Fix: mira-hub Container Removed (Not Just Stopped)

**Updated:** 2026-06-06
**Scope:** VPS production — `165.245.138.91`
**Incident reference:** 2026-06-04 outage (~7 hours) — `mira-hub` removed, not crashed
**Cross-links:** [`fix-hub-502.md`](fix-hub-502.md) · [`docs/environments.md`](../environments.md)

> **Why this runbook exists:** `docker restart` (used by the self-healer) can only restart a
> **stopped** container. If the container was **removed** from Docker's database entirely,
> `docker restart` silently fails or errors. The self-healer will NOT recover this.
> Source: `mira-crawler/agents/self_healer.py:117-118`

---

## Prerequisites

- SSH access to VPS: `ssh root@prod` (Tailscale) or `ssh root@165.245.138.91`
- GitHub CLI: `gh auth status`
- Confirm you are on a session where `MIRA_ALLOW_PROD` is NOT set (or is 0) — reads are safe, prod-guard only blocks writes

---

## Step 1 — Confirm the container is removed (not just stopped)

```bash
ssh root@prod "docker ps -a --format '{{.Names}}\t{{.Status}}' | grep mira-hub"
```

**If you see output** (e.g., `mira-hub   Exited (1)`): The container is stopped, not removed.
Use [`fix-hub-502.md`](fix-hub-502.md) Step 4 instead — a simple redeploy will suffice.

**If you see NO output**: The container is removed. Continue.

Secondary confirmation:
```bash
ssh root@prod "docker inspect mira-hub 2>&1 | head -3"
```

Expected when removed:
```
[]
Error: No such object: mira-hub
```

---

## Step 2 — Why was it removed? (investigate before acting)

Check Docker system events for the removal:

```bash
ssh root@prod "docker events --since 48h --until 0m --filter 'container=mira-hub' --filter 'event=destroy' 2>&1 | head -20"
```

Check VPS-level disk and memory (OOM-induced removal possible):

```bash
ssh root@prod "free -h && df -h / && dmesg | grep -i 'oom\|killed' | tail -20"
```

Check the VPS audit log for manual `docker rm` commands (if accessible):
```bash
ssh root@prod "grep -r 'docker rm\|docker-compose down' /var/log/ 2>/dev/null | tail -20"
```

Document your findings — especially if this is a recurring removal, file a GitHub issue.

---

## Step 3 — Recover via deploy workflow (ONLY sanctioned path)

`docker compose up -d` will recreate a removed container. Route this through `deploy-vps.yml` so the action is logged, gated, and smoke-tested.

```bash
gh workflow run deploy-vps.yml \
  -f services="mira-hub" \
  -f skip_staging_gate=true \
  -f skip_reason="mira-hub container removed (not stopped) — manual recovery"
```

> **Do NOT run** `docker compose up -d mira-hub` directly from a session.
> `prod-guard.sh` (registered as `PreToolUse(Bash)` hook) blocks direct compose/restart commands.
> Source: `docs/environments.md` Hard rule #2.

Wait for the workflow to complete:

```bash
gh run watch $(gh run list --workflow=deploy-vps.yml --limit 1 --json databaseId -q '.[0].databaseId')
```

---

## Step 4 — Verify recovery

```bash
curl -sv https://app.factorylm.com/api/health/ 2>&1 | grep -E "< HTTP|200|502"
```

**Expected:** `< HTTP/2 200`

Also confirm `mira-hub` is now present and healthy:

```bash
ssh root@prod "docker ps --format '{{.Names}}\t{{.Status}}' | grep mira-hub"
```

**Expected:** `mira-hub   Up N minutes (healthy)`

The healthcheck is `wget -qO- http://127.0.0.1:3000/api/health/` with a 30s interval.
Source: `docker-compose.saas.yml:635`. It may take up to 90s to reach `(healthy)`.

---

## Step 5 — False-alarm warning on the deploy workflow

The `deploy-vps.yml` workflow may report a **red/failure** status even when recovery succeeded.
This is a known false alarm from a mira-pipeline health probe.

**Authoritative check:** `curl https://app.factorylm.com/api/health/` returning 200 — NOT the workflow status badge.
Source: project memory `project_self_healer_recreate_gap.md`.

---

## What Can Go Wrong

| Symptom | Cause | Action |
|---------|-------|--------|
| Workflow red but site is 200 | mira-pipeline health-probe false alarm | Treat 200 as recovery; verify `docker ps` |
| Workflow completes, container still absent | Image pull failed or compose config error | Check workflow run logs: `gh run view --log` |
| Container keeps getting removed | Recurring OOM or runaway `docker rm` somewhere | Check `/etc/cron*` and systemd timers on VPS; file issue |
| Self-healer claims it fixed it but site was down for hours | Two bugs in `self_healer.py`: wrong container watched (line 203-207) + `docker restart` can't recreate (line 117-118) | Confirmed bug; the healer cannot fix this scenario |

---

## Known Self-Healer Bugs (root cause of this runbook)

File: `mira-crawler/agents/self_healer.py`

**Bug 1 — `restart_container` (line 117-118):**
```python
def restart_container(service: str, hint: str) -> HealAction:
    rc, out, err = _run(["docker", "restart", service], timeout=60)
```
`docker restart` operates on a stopped container. If the container object no longer exists in Docker's database (`docker ps -a` shows nothing), this command errors with `No such container: mira-hub` and returns a non-zero rc — but the self-healer may still log it as attempted. The container stays down.

**Bug 2 — Wrong container mapped (lines 203-207):**
```python
ENDPOINT_TO_CONTAINER = {
    "app.factorylm.com/api/health": "mira-web",   # BUG: should be mira-hub
    ...
}
```
`app.factorylm.com` is served by `mira-hub` (port `127.0.0.1:3101:3000`, source: `docker-compose.saas.yml:537`), not `mira-web`. The monitor watches the wrong container, so the removal of `mira-hub` may not trigger the correct remediation path.

**Combined effect:** The monitor detects the 502 but targets `mira-web`; the healer tries to restart `mira-hub` (once the missing-container logic runs), but `docker restart` fails silently because the container was removed. The self-healer cannot recover this scenario without code fixes.

---

## Prevention Checklist

After recovery, file a GitHub issue (or confirm the existing one) tracking:
1. Fix `ENDPOINT_TO_CONTAINER["app.factorylm.com/api/health"]` → `"mira-hub"` in `mira-crawler/agents/self_healer.py:203-207`
2. Replace `restart_container` with a path that calls `docker compose up -d <service>` (or triggers `deploy-vps.yml`) when `container_missing` hint is active
3. Add a Prometheus/Grafana alert for `docker ps -a` absence of critical containers (not just health-endpoint 502)

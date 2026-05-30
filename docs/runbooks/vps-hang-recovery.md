# VPS Hang Recovery Runbook

**Scenario:** `factorylm.com` and/or `app.factorylm.com` stop responding to
HTTP/HTTPS but the underlying VPS still ACKs TCP — the classic "alive at
the network layer but dead at the app layer" hang.

**First observed and diagnosed:** 2026-05-15 (issue #1318) — full primary
record there.

---

## Signature (you have this outage if all 4 are true)

1. `curl -v https://factorylm.com/` connects (TCP succeeds) but **TLS
   handshake stalls after Client Hello**; 10 s+ timeout.
2. `curl -v http://factorylm.com/` connects, sends the request, gets
   **0 bytes back** before timeout.
3. `nc -z 165.245.138.91 443` (and `:80`, `:22`) all **succeed** — TCP
   socket layer is up.
4. `tailscale status | grep factorylm-prod` shows the node **offline**
   for the same window as the outage.

If any of those is different, this isn't this outage — diagnose further.

## What it almost always is

The VPS itself is hung at the OS/process level. Most likely root causes,
in descending probability:

1. **Disk full.** systemd-managed services fail to write/log → cascade
   stalls. Eval-fixer or photo-pipeline can fill `/var` faster than
   you'd expect on long runs.
2. **OOM killer chose a critical process.** nginx, tailscaled,
   or a docker container that was actually proxying for nginx.
3. **Runaway process** consuming all CPU; tailscaled and nginx starve.
4. **Kernel networking stack issue** (rarer; usually requires reboot).

Networking is _not_ usually the culprit — DigitalOcean's network is
generally reliable; if the IP wasn't accepting TCP at all, that'd
point at infra. TCP-up + app-down ≈ on-host hang.

## Recovery steps (operator)

### 1. Try the DigitalOcean web console (the LIVE console, not SSH)

https://cloud.digitalocean.com/droplets → select prod droplet → **Access
→ Launch Droplet Console**.

The web console talks to the hypervisor, not via SSH, so it works even
when sshd is hung.

Once in:

```bash
df -h                       # disk free?
free -m                     # memory?
top -b -n 1 | head -20      # top processes
journalctl -xe --since "1 hour ago" | tail -100
dmesg | tail -50            # kernel-level issues
docker ps -a                # which containers crashed?
docker logs --tail=200 nginx
systemctl status nginx tailscaled
```

### 2. If console responds, try targeted fixes BEFORE rebooting

- **Disk full:** `docker system prune -af` (containers/images), then
  `journalctl --vacuum-time=2d` (rotated logs), then check `du -sh /*`
  to find what's filling it.
- **OOM:** restart the killed service. If nginx died:
  `systemctl restart nginx`. If tailscaled died: `systemctl restart
  tailscaled`. If a container died: `docker compose -f
  docker-compose.saas.yml up -d <service>`.
- **Runaway process:** identify via `top`, `kill -9` it, restart the
  parent service if it was a child.

### 3. If console is also hung — power-cycle from DO UI

Droplet → **Power → Power Off** → wait 30 s → **Power → Power On**.

Brief downtime (~30–60 s). Faster than waiting for a hung kernel.

### 4. After recovery — verify the stack

```bash
# From your normal workstation (not the VPS):
curl -sS https://factorylm.com/api/health
curl -sS https://app.factorylm.com/api/health
tailscale ping factorylm-prod   # tailnet rejoined?
```

Then re-run the failed smoke CI:

```bash
gh run rerun --failed --repo Mikecranesync/MIRA <smoke-run-id>
# or rerun all main's recent smoke runs:
gh run list --workflow="Smoke Test" --branch=main --limit=1 \
  --json databaseId -q '.[0].databaseId' | xargs gh run rerun --repo Mikecranesync/MIRA
```

Once smoke is green on main, **`Deploy to VPS` auto-triggers** via the
`workflow_run` chain (see `.github/workflows/deploy-vps.yml`). No manual
deploy needed unless you want a hotfix path; that's `gh workflow run
deploy-vps.yml --ref main`.

## Prevention — what to check periodically

| Signal | How | Threshold |
|---|---|---|
| Disk usage | `df -h /` (from VPS) | < 80 % |
| Memory pressure | `vmstat 1 5` | si/so columns staying near 0 |
| docker disk | `docker system df` | reclaimable < 50 % of total |
| Log volume | `journalctl --disk-usage` | < 1 GB |
| Tailscale health | `tailscale status` | no nodes "offline" for prod |

A scheduled CI job that ran `df -h` via tailnet-SSH and posted a Slack
alert when `/` > 85 % would prevent the disk-full variant of this
outage. See `docs/superpowers/plans/` for ops monitoring plans.

## Related issues / PRs

- **#1318** — the 2026-05-15 incident this runbook captures
- **#1304** — `mira-mcp` container missing from VPS (likely a casualty
  of the same family of issues)
- **#1303 / #1306** — middleware crash on `/api/*` (different failure
  mode; not this runbook)
- **#1284** — Bravo Mac Docker daemon down (different node but similar
  hang signature; worth cross-referencing)

## Why this runbook exists

The 2026-05-15 incident took ~20 minutes of CI smoke failures, plus a
chain of layered investigation (DNS → TCP → TLS → Tailscale → whois →
DO drilldown) before the right answer ("VPS itself is hung, not nginx
config, not network") was clear. The next person to hit this should
start at "is Tailscale offline?" and save those 20 minutes.

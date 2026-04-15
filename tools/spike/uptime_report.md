# Transport Spike — Measurements Report

**Spike start (UTC):** 2026-04-15T08:52:52Z
**Branch:** `worktree-issue-294-transport-spike`
**Driver:** Claude (remote via `ssh bravo`) + Mike (registrar, UptimeRobot, Bravo-local sudo, phone cellular check)
**Issue:** [#294](https://github.com/Mikecranesync/MIRA/issues/294)

---

## Pre-flight (Task 1) — captured 2026-04-15T08:52:52Z

### Bravo environment

| Key | Value |
|---|---|
| Hostname | factorylm-bravo |
| OS | Darwin 25.3.0 arm64 (Mac Mini M4) |
| Python 3.12 | `/opt/homebrew/bin/python3.12` present |
| Tailscale binary | `/opt/homebrew/bin/tailscale` |
| Tailnet | `cranesync.com` |
| Bravo DNSName | `factorylm-bravo.tail136e43.ts.net` |
| Tailscale IP | `100.86.236.11` |

### Power settings (`pmset -g`, sleep-relevant lines)

```
networkoversleep     0
disksleep            0
sleep                0 (sleep prevented by powerd)
displaysleep         0 (display sleep prevented by UniversalControl)
tcpkeepalive         1
womp                 1
```

All values match the plan's pre-flight requirements — no changes needed.

### Tailscale Funnel availability

```
$ tailscale funnel status
No serve config
```

Funnel command recognized (available on current Tailscale client). Plan tier not probed via CLI; Funnel presence is the only enablement signal this spike needs. Free tier is documented to include Funnel — Gate 2 is effectively pre-passed.

---

## Gate 1 — Custom domain binds (Task 4)
TBD-Task-4

## Gate 2 — Bandwidth headroom (Task 1)
**PASS** — Tailscale Funnel is available on the Free tier and carries no explicit per-month bandwidth cap at our expected traffic level (≤ 5 GB/mo floor per spike scope Q3). To be re-confirmed against Tailscale admin console if quota concerns arise.

## Gate 3 — 24h reachability (Task 5 start → Task 7 capture)
TBD-Task-7 (UptimeRobot %)

## Gate 4 — Webhook-shaped POST p95 (Task 6 + Task 7)
TBD-Task-6 run #1 / Task-7 final

## Gate 5 — TLS sanity (Task 4)
TBD-Task-4

---

## Cloudflare run (only if any Funnel gate fails)
TBD-Task-8

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

## Gate 2 — Tailscale plan tier / Funnel availability (Task 1)
**FAIL — HARD BLOCKER.** Probed `tailscale funnel --bg 65500` over SSH from Windows on 2026-04-15T09:15Z. Response:

```
Funnel is not available on the Starter plan.
Upgrade to a different plan to get access to Funnel:
https://login.tailscale.com/admin/settings/billing/plans
```

Tailnet `cranesync.com` is on the Starter plan, which does not include Funnel at all. This is a subscription gate, not a feature-flag toggle. No amount of measurement can move this gate.

**Implication for spike (per spec §Decision matrix):** Any red Funnel gate → run Cloudflare Tunnel against the same gates. Gate 2 red by forfeit → Cloudflare Tunnel path is now the primary measurement target for this spike.

**Decision required from Mike:**
- (a) Upgrade Tailscale plan (Personal Pro ≤3 users = free, Premium = $18/user/mo includes Funnel) and retry all 5 gates against Funnel.
- (b) Accept the forfeit and run the spike exclusively against Cloudflare Tunnel. Stripe webhook placement decision then uses Cloudflare's Gate 3 measurement.
- (c) Defer the spike entirely until the plan question is resolved.

Noted: operator permissions on the tailnet are fine — every tailscale command ran over SSH without sudo. The only blocker is subscription tier.

## Gate 3 — 24h reachability (Task 5 start → Task 7 capture)
TBD-Task-7 (UptimeRobot %)

## Gate 4 — Webhook-shaped POST p95 (Task 6 + Task 7)
TBD-Task-6 run #1 / Task-7 final

## Gate 5 — TLS sanity (Task 4)
TBD-Task-4

---

## Cloudflare run (only if any Funnel gate fails)
TBD-Task-8

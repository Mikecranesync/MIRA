# Transport Spike — Measurements Report

**Status:** 🅿️ **PARKED 2026-04-15** — Mike paid the DigitalOcean VPS renewal; production stays on VPS. This spike preserved as a documented backup path for when VPS renewal is next evaluated. See §Parking notes at bottom.

**Spike start (UTC):** 2026-04-15T08:52:52Z
**Branch:** `worktree-issue-294-transport-spike` — not to be merged until unparked.
**Driver:** Claude (remote via `ssh bravo`) + Mike (registrar, UptimeRobot, Bravo-local sudo, phone cellular check)
**Issue:** [#294](https://github.com/Mikecranesync/MIRA/issues/294) — moved back to Todo on parking.

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
Not executed — spike parked before this branch was opened.

---

## Parking notes (2026-04-15T09:25Z)

**Decision:** Mike paid the DigitalOcean VPS for another cycle; production stays on VPS. This spike is preserved as a fully-documented backup path so that when the next VPS renewal comes up, we can pick up from here without re-doing the thinking.

**What's preserved on this branch:**
- `docs/superpowers/specs/2026-04-15-transport-spike-design.md` (on main) — the design spec with 5 gates and decision matrix. Still valid.
- `docs/superpowers/plans/2026-04-15-transport-spike.md` (on main) — the 10-task implementation plan. Still valid, with the caveat that Task 4 / 8 need rewiring if Cloudflare is chosen over Funnel.
- `tools/spike/hello_server.py` + tests (this branch) — hello-world HTTPS server, reviewed, bounded, threaded. Reusable for either transport.
- `tools/spike/uptime_report.md` (this file) — pre-flight baseline + Gate 2 finding.
- PR #295 — parked as DRAFT. Not to be merged.

**Open decisions when unparked:**
1. Tailscale plan question. Current tailnet `cranesync.com` is on Starter, which does not include Funnel. Options: Personal Pro (free, ≤3 users, keeps single-vendor story), Premium (paid, adds $216/yr), or abandon Funnel in favor of Cloudflare Tunnel (free, adds one vendor surface).
2. If Cloudflare is chosen: the 10-task plan's Task 4 needs replacement with `cloudflared tunnel` setup. Everything else (server, DNS CNAME, Gates 3/4/5, ADR) carries over unchanged.
3. Stripe webhook placement — same decision matrix applies, now gated on whichever transport is measured.

**Resume checklist:**
- Re-probe Bravo environment (`ssh bravo` — confirm repo path, tailnet, funnel availability if plan changed).
- Resolve open decision 1 above.
- If Funnel is unblocked: continue at Task 3 (DNS CNAME). Everything else in the plan still applies.
- If Cloudflare is chosen: the server + tests stay; replace Task 4's `tailscale cert / funnel` commands with `cloudflared tunnel create / route dns / run`.
- Reopen #294 on kanban (move from Todo → In Progress) and attach this PR.

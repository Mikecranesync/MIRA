# Transport Spike — Tailscale Funnel pass/fail

**Date:** 2026-04-15
**Issue:** [#294](https://github.com/Mikecranesync/MIRA/issues/294)
**Sub-project:** 1 of 3 (transport spike → Bravo stack bring-up → cutover & decommission)
**Status:** Design approved, awaiting writing-plans

## Context

Issue #294 proposes replicating the DigitalOcean VPS stack (`factorylm.com` + `app.factorylm.com`, 6 services + retired sidecar) on Bravo Mac Mini and exposing it via a public tunnel. The issue spans transport choice, Caddy + docker-compose porting, DNS shadow-cutover, 7-day monitoring, and decommission — too large for a single spec.

This spec covers **only the transport-decision sub-project**: stand up a single hello-world HTTPS endpoint on Bravo behind Tailscale Funnel, run a defined set of pass/fail gates, and either green-light Funnel or fall back to validating Cloudflare Tunnel against the same gates. The output (an ADR + a recorded Stripe-webhook-placement decision) is the binding input for sub-projects 2 and 3.

Mike's stated decision rule: **default to Tailscale Funnel unless it's clearly broken.** This spike's purpose is to make "clearly broken" concrete and testable.

## Locked-in inputs

| Input | Value |
|---|---|
| Decision rule | Default to Funnel unless clearly broken |
| Bandwidth floor | ≥ 5 GB/mo headroom |
| Webhook reliability test | 24h external uptime monitor |
| Test domain | `spike.factorylm.com` (throwaway subdomain — never apex or `app.`) |

## Goal

One ADR at `docs/adr/0011-transport-choice.md` containing:

1. Measured outcomes for each pass/fail gate (Funnel, and Cloudflare if needed).
2. Transport decision: Funnel or Cloudflare Tunnel.
3. Stripe webhook placement decision: host on Bravo / keep on droplet forwarder / revisit migration. Choice is bound to Gate 3 outcome (see §Decision matrix).

## Scope

### In scope
- Single hello-world HTTPS vhost on Bravo behind Tailscale Funnel.
- Custom-domain binding via `tailscale cert spike.factorylm.com` + DNS CNAME.
- 24h external uptime monitor (UptimeRobot or equivalent).
- Webhook-shaped POST load test (`hey -n 50 -c 5 -m POST`).
- TLS sanity check (SSL Labs / `testssl.sh`).
- ADR write-up.
- Conditional Cloudflare Tunnel re-run if any Funnel gate fails.

### Out of scope
- Caddy multi-vhost config (sub-project 2)
- Porting `docker-compose.saas.yml` to Bravo (sub-project 2)
- Real Stripe webhook traffic (sub-project 2; this spike uses dummy POSTs)
- DNS cutover of `factorylm.com` or `app.factorylm.com` (sub-project 3)
- Charlie warm-standby (separate issue)
- VPS decommission (sub-project 3)

## Pass/fail gates

A failure on any gate triggers a Cloudflare Tunnel re-run with the same gates. Funnel wins ties.

| # | Gate | Pass criterion | Measurement |
|---|---|---|---|
| 1 | Custom domain binds | `https://spike.factorylm.com` returns 200 with valid TLS chain | `curl -v` from Windows + Travel laptop + phone on cellular |
| 2 | Bandwidth headroom | Documented Funnel cap ≥ 5 GB/mo on current Tailscale plan | Tailscale admin console, screenshot |
| 3 | 24h reachability | ≥ 99% uptime over 24h continuous (≤ ~14 min total downtime) | UptimeRobot 1-min-interval HTTP check |
| 4 | Webhook-shaped POST | 50 sequential `POST /hook` (JSON body) return 200 with p95 < 500ms | `hey -n 50 -c 5 -m POST -D body.json https://spike.factorylm.com/hook` |
| 5 | TLS sanity | Valid chain, HSTS header present, no mixed content | SSL Labs grade ≥ A or `testssl.sh` clean |

**Why these thresholds:**

- **Gate 3 at 99%:** Stripe retries webhooks for 3 days, so 1% loss in any 24h window is fully recoverable. Anything below 99% signals an infra problem worth fixing before production cutover (ISP flap, Mac sleep, keychain re-prompt).
- **Gate 4 stands in for Stripe:** Real Stripe events require live config (sub-project 2). Webhook-shaped POSTs to a dummy `/hook` endpoint exercise the same network properties — POST, JSON body, response time — without coupling to Stripe.

## Architecture

```
                 Bravo (100.86.236.11)
        ┌──────────────────────────────────┐
        │  tailscale funnel + tailscale    │
        │  cert (built-in HTTPS)           │
        │              │                   │
        │              ▼                   │
        │  python http.server (~40 LOC)    │
        │  serving:                        │
        │    /        → 200 "hello"        │
        │    /hook    → 200 echo body      │
        │    /health  → 200                │
        └──────────────────────────────────┘
                 ▲
                 │  CNAME spike.factorylm.com → bravo.<tailnet>.ts.net
                 │
        DNS registrar (existing)
                 ▲
                 │
        UptimeRobot — 1-min HTTP check, 24h
```

Single-process server. The spike tests **transport**, not application code.

## Procedure

| # | Step | Time |
|---|---|---|
| 1 | On Bravo, verify `tailscale funnel` is available; record plan tier. | 5 min |
| 2 | Add `spike.factorylm.com` CNAME → `<bravo-hostname>.<tailnet>.ts.net` at registrar. **Apex untouched.** | 5 min |
| 3 | `tailscale cert spike.factorylm.com` on Bravo. Capture command output. | 5 min |
| 4 | Write and start `tools/spike/hello_server.py` (~40 lines, created in this step) bound to the cert. Verify Gates 1 and 5 from Windows + phone. | 15 min |
| 5 | `tailscale funnel 443 on`. Re-verify Gate 1 from off-Tailscale device. | 5 min |
| 6 | Register UptimeRobot monitor — 1-min interval, alert on first failure. Note start timestamp. | 10 min |
| 7 | **Wait 24h.** Run Gate 4 a few times at staggered hours. Don't touch Bravo unless gates trigger. | 24h passive |
| 8 | At T+24h, pull UptimeRobot %, Gate 4 p95, capture numbers. | 10 min |
| 9 | **Decision branch.** All gates green → step 11. Any red → step 10. | — |
| 10 | Repeat steps 1–8 against Cloudflare Tunnel. Same domain, same gates. | 25 min active + 24h passive |
| 11 | Write ADR `docs/adr/0011-transport-choice.md` per §Decision matrix below. | 30 min |
| 12 | Tear down: remove DNS row, delete UptimeRobot monitor, `tailscale funnel 443 off`, kill server. Keep cert (reused in sub-project 2). | 10 min |

## Decision matrix

**Transport decision** (binary):
- All 5 Funnel gates green → **Funnel wins**, no Cloudflare run needed.
- Any Funnel gate red → run Cloudflare against the same gates, then pick whichever transport passes more gates. Funnel wins ties.

**Stripe webhook placement decision** is determined by the *winning transport's* measured Gate 3 uptime. Note the placement thresholds are stricter than the gate's pass threshold (99%) — passing the gate clears transport-level go/no-go, but Stripe gets the more conservative 99.9% bar:

| Winning transport's Gate 3 result | Stripe webhook decision |
|---|---|
| ≥ 99.9% | (a) Host on Bravo with everything else |
| 99.0–99.9% (passes gate, but tighter Stripe bar) | (b) Keep a $6/mo droplet as forwarder for `/api/stripe/webhook` only |
| < 99% (fails gate; should not occur on winning transport — escalate) | (c) Revisit the whole migration before cutover |

## Files this work creates

- `docs/superpowers/specs/2026-04-15-transport-spike-design.md` — this spec
- `tools/spike/hello_server.py` (~40 lines) — created during spike execution
- `docs/adr/0011-transport-choice.md` — created at procedure step 11

No changes to `docker-compose.saas.yml`, `mira-web/`, Doppler config, or any production runtime.

## Existing patterns reused

- `docs/adr/0008-sidecar-deprecation.md` — ADR format template
- `docs/runbooks/factorylm-vps.md` (lines 19–91) — port/service tabulation style for the future runbook (sub-project 3)

## Risks

- **DNS typo on apex.** Hard rule: only `spike.factorylm.com`. An accidental apex CNAME would break production immediately. Procedure step 2 explicitly calls this out.
- **Bravo Mac sleep.** Direct risk to Gate 3. Pre-spike check: `pmset -g` to confirm sleep / network sleep settings. Document the actual settings in the ADR.
- **Tailscale plan tier doesn't include Funnel.** Funnel is Free-tier per Tailscale's published pricing, but Gate 2 verifies explicitly.
- **24h is short for ISP-level patterns.** Acknowledged trade-off. Sub-project 3's 7-day monitoring window catches longer-period issues; sub-project 2 doesn't depend on this spike's window length.

## Verification of this design (not the spike)

- Every gate has a measurable pass criterion AND a measurement command.
- Procedure is fully ordered, every step is timeboxed, no step says "configure things appropriately."
- ADR template (`0008`) verified to exist.
- No procedure step requires Stripe live-mode credentials.
- Tear-down step exists and is unambiguous.
- Decision matrix is deterministic (no judgment calls in mapping Gate 3 number → Stripe decision).

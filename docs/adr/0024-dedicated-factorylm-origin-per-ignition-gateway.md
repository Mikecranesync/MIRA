# ADR-0024: Dedicated FactoryLM Origin Per Ignition Gateway for Perspective Framing

## Status
Accepted — 2026-06-28

Relates to: `.claude/rules/fieldbus-readonly.md` (read-only OT), `.claude/rules/direct-connection-uns-certified.md`, `docs/command-center-ignition-display.md` (the framing investigation this decision closes), `docs/handoffs/2026-06-28-plc-laptop-northwind-cv200-perspective.md`. Implemented by `tools/command-center/northwind-cv200.json`, `mira-hub/db/seeds/command_center_northwind_cv200.sql`, and the existing `COMMAND_CENTER_DISPLAY_HOST_ALLOWLIST` enforcement in `mira-hub/src/app/api/command-center/display/route.ts`.

---

## Context

The Command Center frames a customer's **live Ignition Perspective** view inside the FactoryLM Hub
(the CV-200 Discharge Conveyor is the first real one). Framing the gateway has a hard browser
constraint, documented and verified in `docs/command-center-ignition-display.md`:

- The Ignition gateway sends `X-Frame-Options: SAMEORIGIN` **gateway-wide**, and Perspective is an
  absolute-path SPA (`/res|/data|/system/...`, WebSocket at the origin root, no `<base>` tag).
- Direct framing of the raw gateway is therefore **blank** (XFO-blocked), and a per-id sub-path
  proxy (`/cc-display/{id}/<rest>`) **cannot** host the SPA (absolute asset/socket requests resolve
  against the iframe origin root, bypass the `{id}` prefix, and 404).
- The only thing proven to work is an **origin-root, XFO/CSP-stripping reverse proxy** in front of
  the whole gateway. The dev/staging instance is `127.0.0.1:8890`.

That dev proxy is fine for dev/staging but is **not** a production answer: it terminates a customer's
gateway behind a local, unauthenticated, XFO-stripped origin. Shipping that shape — or framing raw
customer gateways, or a single shared wildcard origin — would casually expose customer gateways and
risk cross-customer framing leakage. Production framing was the open blocker. Mike has now made the
call.

## Decision

**For production Ignition Perspective embedding, FactoryLM uses a dedicated, FactoryLM-controlled
origin per customer/gateway (and ultimately per display).** Production display registration points at
that dedicated origin — never at the raw Ignition gateway, and never at the dev-only 8890 proxy.

Example production origin for the first gateway:

- `https://northwind-cv200.factorylm-gateways.com`
- later: one isolated origin per customer/gateway/display under `*.factorylm-gateways.com`, each a
  distinct server block — **not** a shared wildcard vhost that serves many gateways from one origin.

### Enforcement (reuse, do not invent)

- The dedicated origin is enforced through the **existing** operator allowlist
  `COMMAND_CENTER_DISPLAY_HOST_ALLOWLIST` (`display/route.ts:92`). In production this env var holds
  the dedicated `*.factorylm-gateways.com` origins and **excludes** the raw gateway IP/host and
  `127.0.0.1`. A registration whose `host` is not in the allowlist is rejected `400`.
- Per-environment targets are encoded declaratively in `tools/command-center/northwind-cv200.json`:
  dev/staging → `127.0.0.1:8890`; production → the dedicated origin (status `PENDING_INFRA` until
  provisioned).
- No new route, env var, schema, or display type is introduced. `display_endpoints`,
  `validateDisplayRegistration`, and the allowlist already model everything needed.

### Read-only and tenant isolation are preserved

- Display registration stores only *where to watch* — never a control endpoint
  (`.claude/rules/fieldbus-readonly.md`). The dedicated origin reverse-proxies the gateway
  **read-only**; no PLC writes.
- `display_endpoints` is per-`(tenant_id, uns_path)` with RLS; one dedicated origin per
  gateway/customer means no shared origin can frame across tenants.

## Alternatives considered and rejected

| Alternative | Why rejected |
|---|---|
| **1. FactoryLM-controlled dedicated origin per gateway/customer** | **Chosen.** Preserves tenant isolation, read-only access, explicit allowlisting; no shared/wildcard origin; no casual public exposure. |
| 2. Customer-owned CNAME to their gateway | Possible later enterprise option, but pushes origin control (and XFO/CSP/TLS posture) to the customer; weaker isolation guarantees today. |
| 3. Cloud relay / server-side render service (screenshot/stream instead of iframe) | Possible later fallback if iframe proves too risky; heavier infra, loses live interactivity. Revisit only if the origin model can't be made safe. |
| 4. No production iframe at all | Fallback if the origin policy cannot be implemented safely; degrades the desk-troubleshooting experience. |
| Dev-only 8890 XFO-stripping proxy in production | Rejected: unauthenticated, XFO-stripped local origin; not a customer-isolation boundary. Dev/staging only, unless separately approved for a controlled environment. |
| Single shared wildcard production origin for all gateways | Rejected: one origin framing many gateways enables cross-customer framing leakage. |

## Consequences

**Positive**
- Production framing is unblocked with a clear, testable policy. The codebase already enforces it
  (allowlist), so no new attack surface.
- Tenant isolation and read-only doctrine are structurally preserved.

**Negative / cost**
- Each new customer Perspective display must be **provisioned** with its own origin before production
  embedding is enabled. `northwind-cv200.factorylm-gateways.com` is not yet provisioned
  (`PENDING_INFRA` in the config) — it needs a DNS record + a dedicated VPS nginx server block
  (XFO/CSP stripped, WebSocket forwarded, TLS) reaching the gateway over Tailscale, plus the host
  added to the prod `COMMAND_CENTER_DISPLAY_HOST_ALLOWLIST`. That infra is a follow-up, not part of
  this PR.
- Until provisioned, CV-200 framing is verifiable on **dev/staging only** (the 8890 proxy).

## Verification

- `tests/test_northwind_cv200_seed_and_config.py` pins: dev/staging display target is the 8890
  proxy; the production target is the dedicated origin and is neither the raw gateway nor the proxy;
  the garage config is untouched; the Northwind allowlist normalizes to the relay's match key.
- `mira-hub/src/app/api/command-center/display/route.ts` already rejects (`400`) a `host` outside
  `COMMAND_CENTER_DISPLAY_HOST_ALLOWLIST` when that env var is set — the production enforcement point.
- Manual (follow-up, PLC-laptop + infra): provision `northwind-cv200.factorylm-gateways.com`, add it
  to the prod allowlist, register via `POST /api/command-center/display`, confirm the green dot +
  live tags with no XFO/CSP errors and no raw-gateway exposure.

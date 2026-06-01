# gateway-origin — origin-root proxy for Ignition Perspective in the Command Center

The Command Center frames an HMI per `display_endpoints` row. For a **Node-RED**
dashboard (relative asset paths, no `X-Frame-Options`) the Hub can frame it
directly or via the per-id `mira-proxy`. For an **Ignition Perspective** view it
**cannot** — and this proxy is the fix.

## Why Perspective needs a different proxy

Verified against the live gateway (2026-05-31):

1. **`X-Frame-Options: SAMEORIGIN`** is set gateway-wide → a direct iframe is
   blocked (blank).
2. **Perspective is an absolute-path SPA** — every asset + the WebSocket loads from
   root-absolute paths (`/res/perspective/…`, `/data/perspective/…`, `/system/…`),
   no `<base>`. So the per-id sub-path proxy (`/cc-display/{id}/<rest>` →
   upstream`<rest>`) 404s every asset: the SPA's absolute requests resolve against
   the iframe origin root and skip the `{id}` prefix.

An absolute-path SPA must be framed at the **origin root** of a dedicated origin.
This proxy is that origin: `/` maps 1:1 onto the gateway, `X-Frame-Options` + CSP
are stripped, and the WebSocket is forwarded.

## Files

| File | What |
|---|---|
| `nginx.conf` | the proxy (origin-root, strip XFO/CSP, forward WS, 1:1) |
| `docker-compose.yml` | run it against the real gateway (loopback bind by default) |
| `test/` | **QA-A** deterministic test vs a mock gateway (`run_test.sh`) |

## Run it (dev)

```bash
# point at the gateway (default = PLC-laptop Tailscale 100.72.2.99) and bring it up
IGNITION_GATEWAY_IP=100.72.2.99 docker compose up -d
# the Command Center display_endpoints row points host:port at this origin:
#   web_iframe / http / 127.0.0.1 / 8890 / /data/perspective/client/<Project>
```

## QA-A — deterministic proxy test (CI-able, no live gateway)

```bash
bash test/run_test.sh
```

Stands the proxy in front of a mock gateway that reproduces XFO + an absolute asset
+ a WS upgrade, and asserts: **XFO stripped, CSP stripped, `/res/perspective/app.js`
→ 200, WS → 101**. This is the regression guard that would have caught the
"Perspective frames blank" failure the mocked Hub e2e misses. (QA-B — the
un-mocked live Hub test — lives in `mira-hub/tests/e2e/command-center-ignition-live.spec.ts`.)

## ⚠️ SAFETY — watch-only is NOT enforced here

This proxy fronts the **whole gateway** and forwards the Perspective WebSocket. A
Perspective view's control components (e.g. VFD FWD/STOP/REV) drive the PLC over
that **same socket** — so **method-level read-only does not make the framed view
watch-only**. Before framing a control-capable HMI in a customer Command Center,
enforce watch-only on the **Ignition side**: frame a display-only view, or give the
framed session a read-only role. Otherwise the Command Center becomes a PLC control
surface — violating `.claude/rules/fieldbus-readonly.md` and the SaaS scope guard.
This is a **prod gate**, tracked in `docs/command-center-ignition-display.md`.

## Cloud exposure is still an open decision

`docker-compose.yml` binds loopback. Lighting this up on `app.factorylm.com` needs
a decision on the origin's public exposure (dedicated `cc-gw.*` subdomain + TLS vs.
`tailscale serve` vs. a VPS server block) — see the finish-out plan in
`docs/command-center-ignition-display.md`. Do not bind `0.0.0.0` without it.

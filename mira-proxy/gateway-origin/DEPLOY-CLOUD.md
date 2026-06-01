# Cloud exposure runbook — `cc-gw.factorylm.com` (origin-root Ignition proxy)

How to light up the Command Center → Ignition live frame on `app.factorylm.com` using
a **dedicated subdomain** (the chosen Option 1). Most of this is **gated / Mike's** —
DNS, TLS, the CHARLIE Tailscale bind, and the prod nginx reload all go through the
normal gated paths, never a hand-edit on the box.

> **Why a subdomain, not the per-id `/cc-display` proxy (#1603):** Ignition Perspective
> is an absolute-path SPA — it must be framed at an **origin root**. The per-id
> `/cc-display/{id}/…` proxy works for relative-path HMIs (Node-RED) but 404s
> Perspective's assets. So Ignition displays use **this origin-root proxy at a
> dedicated origin**; the two proxies coexist (chosen by display type). See
> `docs/ignition-integration-architecture.md` §2.

## Prereqs / decisions to resolve first (Mike)

1. **CHARLIE Tailscale bind.** The origin-root proxy must be reachable from the VPS over
   Tailscale, i.e. listen on `100.70.49.126:8890` — not just loopback. Under Colima the
   VM can't bind the host's `tailscale0` directly (same blocker the per-id `mira-proxy`
   hit at `:8889`). **Decision (matches the Node-RED precedent already on this node,
   `mira-bridge` bound `0.0.0.0:1880`):** publish the proxy `8890:8890` (bind-all) so the
   Tailscale IP answers. Update `docker-compose.yml`'s port mapping accordingly **with
   your OK** (the classifier correctly blocks a header-stripping proxy bound to all
   interfaces without explicit sign-off).
2. **DNS.** `cc-gw.factorylm.com` → the VPS public IP (A record). DigitalOcean DNS.
3. **TLS.** Issue a cert for `cc-gw.factorylm.com` via the same Let's Encrypt/certbot
   path the other vhosts use.

## Security model — read this (demo-scoped)

An origin-root `cc-gw` exposes the **whole gateway** with **no per-tenant `auth_request`**
(unlike the per-id `/cc-display` proxy, which authz's each id at the Hub). For our
**single-gateway garage demo** that's acceptable. It does **not** generalize to a
multi-tenant customer feature — consistent with the architecture map's demo-vs-customer
boundary (a customer's live HMI is never framed from cloud; data arrives via the
Module's outbound push). Keep `cc-gw` to the garage gateway only.

**Plus the watch-only gate:** the framed Perspective view's control components drive the
PLC over the same WebSocket. Before anyone but us uses this, make the framed view
**watch-only on the Ignition side** — a display-only Perspective view, or a read-only
session role. See `## Watch-only` below.

## VPS nginx — new server block (deploy via the gated nginx workflow)

Add to `deployment/nginx-app-factorylm.conf` (TLS + the `map $http_upgrade
$connection_upgrade` must exist — prod lacked it, see the phase2 diff), then deploy via
`deploy-nginx-staging-passthrough.yml` (scp + `nginx -t && nginx -s reload`):

```nginx
server {
    listen 443 ssl http2;
    server_name cc-gw.factorylm.com;

    ssl_certificate     /etc/letsencrypt/live/cc-gw.factorylm.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cc-gw.factorylm.com/privkey.pem;

    # Origin-root: everything 1:1 to CHARLIE's origin-root proxy over Tailscale.
    # CHARLIE's proxy strips X-Frame-Options/CSP and forwards the Perspective WS.
    location / {
        proxy_pass http://100.70.49.126:8890;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        $connection_upgrade;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 75s;
        proxy_buffering off;
    }
}
```

## Hub wiring

- `display_endpoints` (prod) row for the conveyor → `scheme=https`, `host=cc-gw.factorylm.com`,
  `port=NULL`, `path=/data/perspective/client/ConvSimpleLive`, `display_type=web_iframe`.
- Hub env: add `https://cc-gw.factorylm.com` to `CSP_FRAME_SRC_DISPLAY_HOSTS`. Leave
  `COMMAND_CENTER_CLOUD_PROXY` **off** for this display — the route 302s straight to the
  same `cc-gw` origin (no per-id rewrite). HTTPS Hub framing HTTPS `cc-gw` → no
  mixed-content, `frame-src 'self' https://cc-gw.factorylm.com` is enough.

## Verify (off-LAN GO/NO-GO)

From a non-LAN network: open the Command Center on `app.factorylm.com` → green dot →
click the conveyor → the ConvSimpleLive frame renders → response CSP `frame-src` has
`'self'` + `cc-gw` → the Perspective WS holds (values render). This is QA-B's bar,
against prod.

## Watch-only (Ignition gateway — do before non-us users)

In the gateway: give the framed session a **read-only role** (Security → Roles, no write
permission), OR build a **display-only Perspective view** of the conveyor with no control
components, and point the `display_endpoints` `path` at that view. Either makes the frame
incapable of driving the PLC (`.claude/rules/fieldbus-readonly.md` + SaaS scope).

## Cross-references
- `docs/ignition-integration-architecture.md` — where this sits.
- `docs/command-center-ignition-display.md` — the feature + QA-B.
- `nginx.conf` / `docker-compose.yml` / `test/` (here) — the proxy + QA-A.

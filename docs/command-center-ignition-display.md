# Command Center → Ignition Perspective display (ConvSimpleLive)

**Status:** wiring repointed (seed) + rendering path proven (local). Two items pending Mike.
**Date:** 2026-05-31. **Branch:** `feat/hub-command-center`.

## What the conveyor display should be

The Command Center conveyor node's live display is the **Ignition Perspective
`ConvSimpleLive`** project on the PLC-laptop gateway — *not* the Node-RED
fault-detective dashboard the Phase-1 tracer originally seeded.

- Project: `ConvSimpleLive` — `project.json` title "Conv Simple Live",
  *"Live conveyor dashboard (Perspective) — bound to MIRA_IOCheck tags. Auto-built
  2026-05-29."* Views: `Conveyor`, `ConvSimpleLive`. Live and serving (HTTP 200).
- Confirmed on the box (`ssh plc`, read-only): the gateway also still has the older
  `ConveyorMIRA` project (the monorepo `ignition/` one). `ConvSimpleLive` is the
  newer, hand-built live view (a `ConvSimpleLive._broken_20260531` backup shows it
  was edited 2026-05-31). The user's "MIRA_PLC repo" is the CCW ladder project under
  `Documents\CCW\MIRA_PLC*`, not an Ignition source — the dashboard lives on the
  gateway.
- Gateway URL (raw — do NOT frame directly, see below):
  `http://100.72.2.99:8088/data/perspective/client/ConvSimpleLive` (Tailscale;
  LAN `192.168.1.20:8088` when the laptop is on the LAN).

## Why you can't just point an iframe at it

Verified 2026-05-31 against the live gateway:

1. **`X-Frame-Options: SAMEORIGIN`** is set gateway-wide → the Phase-1 direct 302
   path (browser frames the gateway directly) is **blocked → blank frame**.
   (Node-RED framed fine because it sent no XFO.)
2. **Perspective is an absolute-path SPA.** Every asset + the WebSocket loads from
   `/res/perspective/...`, `/data/perspective/...`, `/system/...` with no `<base>`
   tag. The Phase-2 **per-id sub-path** proxy (`/cc-display/{id}/<rest>` → upstream
   `<rest>`) therefore **cannot host Perspective**: the SPA's absolute requests
   resolve against the iframe origin root, skip the `{id}` prefix, and 404
   (assets + socket) → blank/frozen frame. The proxy's "relative assets resolve
   as-is" assumption holds for Node-RED, not for Perspective.

## The rendering path that works (proven)

An **origin-root, XFO-stripping reverse proxy** in front of the whole gateway:
strip `X-Frame-Options` + `Content-Security-Policy`, forward the WebSocket, pass
every path 1:1. The iframe points at the proxy's **origin root** so the SPA's
absolute paths resolve correctly. Proven with this nginx (container on
`127.0.0.1:8890` → `100.72.2.99:8088`):

```nginx
map $http_upgrade $connection_upgrade { default upgrade; '' close; }
server {
  listen 8890;
  location / {
    proxy_pass http://100.72.2.99:8088;       # the gateway
    proxy_http_version 1.1;
    proxy_read_timeout 75s; proxy_send_timeout 75s;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_hide_header X-Frame-Options;         # the make-or-break
    proxy_hide_header Content-Security-Policy;
    proxy_buffering off;
  }
}
```

Playwright proof (host page frames `…:8890/data/perspective/client/ConvSimpleLive`):
all Perspective assets + the session `hello` handshake returned 200, **no XFO
console block, no asset 404s**, the SPA booted and painted inside the iframe.
Screenshot: `docs/promo-screenshots/2026-05-31_command-center-ConvSimpleLive-framed.png`.

## Two items pending (both Mike)

1. **Gateway Perspective trial is expired.** The framed page rendered
   *"Trial Expired — log into your Ignition Gateway to start a new 2-hour trial."*
   The gateway runs Ignition Standard **trial**; reset the 2-hour Perspective trial
   on the gateway (or license it) to get live conveyor values. This is a gateway
   action on the PLC laptop — not doable from a code session.
2. **Proxy architecture decision.** The per-id Phase-2 proxy can't host an
   absolute-path SPA. The product-correct pattern is a **dedicated origin per
   gateway** (e.g. a `cc-gw.*` subdomain / dedicated server block on the VPS,
   reverse-proxying the gateway with XFO stripped + WS forwarded), framed
   origin-root. Decide: add an origin-root gateway proxy alongside the per-id
   `mira-proxy`, vs. fold gateway-origin handling into it. Until then, the
   `display_endpoints` row should point `host:port` at an origin-root proxy, with
   `path = /data/perspective/client/ConvSimpleLive` (see the seed).

## Wiring (seed)

`mira-hub/db/seeds/command_center_conveyor.sql` registers the conveyor display as
`display_type='web_iframe'`, `path='/data/perspective/client/ConvSimpleLive'`, with
`:host`/`:port` pointed at the origin-root proxy. Dev/staging only (env doctrine).

# Command Center → Ignition Perspective display (ConvSimpleLive)

**Status:** CONNECTED + verified end-to-end on dev — the real Command Center frames
the live `ConvSimpleLive` HMI through the origin-root proxy. One decision pending
for prod (proxy-origin shape).
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

**Verified end-to-end on dev (the REAL Command Center, not an isolated frame):**
the dev Hub (`:3990`, `CSP_FRAME_SRC_DISPLAY_HOSTS=http://127.0.0.1:8890`) with the
dev `display_endpoints` row repointed at the proxy — clicking Conveyor 1 drives
`iframe → /hub/api/command-center/display/{id}` (308→302) →
`http://127.0.0.1:8890/data/perspective/client/ConvSimpleLive` (200). ALL Perspective
assets + `/data/perspective/project/ConvSimpleLive` + components + translations
returned 200 through the proxy; **no XFO/CSP frame-block console errors**; the SPA
rendered the live **"PMC STATION"** HMI with real OPC tag states (GREEN·DO_00 lit,
DRIVE·DO_02 lit, START·DI_04, "-- OFF --"; footer *"Conv_Simple · Micro 820 ·
MIRA_PLC (CIP) · live OPC tags"*). Green dot + "1 live · 1 display" + "Live" badge.
Screenshot: `docs/promo-screenshots/2026-05-31_command-center-ConvSimpleLive-LIVE-framed_desktop.png`.
(WS caveat: the HTTP/asset/session-init path + initial live tag *states* are proven;
a continuous WebSocket push frame was not separately captured — values rendered live
but "moving values" over time depends on the conveyor actually changing state.)

## One decision pending (Mike) — for PROD only

**Proxy-origin shape for cloud.** Dev works because the browser + Hub probe + proxy
are all on Charlie loopback. For `app.factorylm.com` the per-id Phase-2 proxy
(`/cc-display/{id}/<rest>`) can't host an absolute-path SPA like Perspective. The
product-correct pattern is a **dedicated origin per gateway** (e.g. a `cc-gw.*`
subdomain / dedicated VPS server block reverse-proxying the gateway with XFO+CSP
stripped and WS forwarded), framed origin-root. Decide: add an origin-root gateway
proxy alongside the per-id `mira-proxy`, vs. fold gateway-origin handling into it.

(Gateway Perspective trial: the gateway runs Ignition Standard *trial*; if a framed
session shows "Trial Expired", reset the 2-hour Perspective trial on the gateway.
Transient gateway state, not a wiring issue — it was active and rendering live this run.)

## Wiring

- **Seed** `mira-hub/db/seeds/command_center_conveyor.sql`: `display_type='web_iframe'`,
  `path='/data/perspective/client/ConvSimpleLive'`, `:host`/`:port` → origin-root proxy.
  Dev/staging only (env doctrine).
- **Live dev row** (tenant `e88bd0e8…`, `enterprise.home_garage.conveyor_lab.conveyor_1`)
  updated to `web_iframe / http / 127.0.0.1 / 8890 / /data/perspective/client/ConvSimpleLive`.
- **Origin-root proxy (dev):** nginx container `ign-proxy-test`, `127.0.0.1:8890` →
  `100.72.2.99:8088`, conf at `~/ign-proxy/default.conf`. Ephemeral (dies on reboot,
  like the `:3990/:3991` dev-view servers) — `docker start ign-proxy-test` to restart.
- **View it:** open `http://127.0.0.1:3991/` on CHARLIE → Command Center → Conveyor 1.

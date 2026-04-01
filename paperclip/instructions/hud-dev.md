# MIRA HUD Developer Agent

You develop and maintain the AR HUD desktop app, VIM pipeline, and Ignition HMI Co-Pilot.

## Your Scope

- `mira-hud/server.js` — Express + Socket.IO server, PROCEDURES object, MIRA proxy
- `mira-hud/hud.html` — HUD overlay UI (scanlines, vignette, corner brackets)
- `mira-hud/package.json` — Dependencies (express, socket.io)
- `mira-hud/vim/` — VIM (Visual Inspection Module) pipeline
- `ignition/` — Ignition HMI Co-Pilot components
- `ignition-sdk-examples/` — Ignition SDK reference implementations

## Architecture

```
CharlieHUD.app (macOS)
    -> Node.js server (server.js)
        ├── Express -- serves hud.html on PORT (default: 3000)
        ├── Socket.IO -- real-time state sync
        └── MIRA proxy -> http://localhost:1993/v0/api/chat
```

The HUD runs standalone (not a Docker container). It proxies MIRA queries to the local instance.

## PROCEDURES Object

Maintenance procedures are defined as JavaScript objects in `server.js`:
- `id` — step number (1-based)
- `zone` — factory floor zone (e.g. 'A-04')
- `action` — procedure text displayed on HUD
- `warn` — true for LOTO, live electrical, pressurized systems, pinch points

## Socket.IO Events

Server emits: `init`, `stepUpdate`, `mira_insight`
Client emits: `setProcedure`, `step` (next/prev), `mira_query`, `mira_insight`

## Adding a Procedure

1. Add key to PROCEDURES object in server.js
2. Each step: `{ id, zone, action, warn }`
3. Appears automatically in HUD selector on next load

## HUD Overlay CSS

- Scanlines: horizontal repeating lines for CRT effect
- Vignette: radial gradient darkens edges
- Corner brackets: targeting-reticle corners via pseudo-elements

## Standards

- JavaScript (Node.js) for HUD server
- Express + Socket.IO (pinned versions in package.json)
- No additional frameworks for the HUD
- Python for VIM pipeline components
- Conventional commit format

## Testing

```bash
# HUD smoke test
cd mira-hud && node server.js &
curl -s http://localhost:3000 | head -5
kill %1
```

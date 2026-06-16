# ADR-0005: AR HUD Architecture

## Status
Accepted

## Context

MIRA needs a compelling demo artifact showing real-time AR-style maintenance procedure
guidance connected to the live diagnostic engine. The HUD must display step-by-step
procedures, advance/retreat steps, and inject MIRA diagnostic insights in real time.
It must run on CHARLIE (Mac Mini, charlienode) and be viewable from any device on the
local network — including phones and tablets brought to the factory floor for demos.

## Considered Options

1. Native iOS/Android app — requires App Store distribution, platform-specific builds
2. Electron desktop app — heavyweight, macOS-only distribution
3. Lightweight Express + Socket.IO web server with static HTML overlay

## Decision

**Express + Socket.IO web server (`server.js`) serving a single-file HUD overlay (`hud.html`).
Bundled as `CharlieHUD.app` for macOS demo convenience.**

`PROCEDURES` data lives in `server.js` as a plain JavaScript object. Socket.IO broadcasts
`stepUpdate` events to all connected clients simultaneously — multiple viewers stay in sync.
MIRA integration is a simple HTTP proxy: `queryMiraOSS()` POSTs to `localhost:1993/v0/api/chat`
with an 8-second timeout and falls back gracefully to `MIRA: OFFLINE` if unreachable.

## Consequences

### Positive
- `hud.html` runs in any browser — phone, tablet, or desktop, no install required
- Socket.IO enables real-time step sync across multiple simultaneous viewers
- Adding a new procedure is 10 lines of JavaScript in the `PROCEDURES` object, no backend changes
- `CharlieHUD.app` bundles the server for one-click demo launch on CHARLIE
- Total runtime dependencies: `express` + `socket.io` — minimal attack surface

### Negative
- Server state (`activeProcedure`, `currentStep`) is in-memory only; server restart resets to
  `ABB IRB-2600` step 0 — acceptable for demo use, not for production
- MIRA proxy target hardcoded to `localhost:1993` — requires MIRA OSS running on same host
- No auth on the Socket.IO endpoint — any device on the LAN can emit `setProcedure` or `step`

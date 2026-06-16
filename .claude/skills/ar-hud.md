---
name: ar-hud
description: MIRA AR HUD desktop app — Express + Socket.IO architecture, procedure data format, Socket.IO events, MIRA proxy, overlay CSS, how to add maintenance procedures
---

# AR HUD

## Source Files

- `mira-hud/server.js` — Express server, Socket.IO, PROCEDURES object, MIRA proxy
- `mira-hud/hud.html` — HUD overlay UI (scanlines, vignette, corner brackets)
- `mira-hud/package.json` — dependencies (express, socket.io)
- `mira-hud/CharlieHUD.app` — macOS app bundle (wraps the Node server)
- `mira-hud/install.sh` — install script

---

## Architecture

```
CharlieHUD.app (macOS)
    └── Node.js server (server.js)
            ├── Express — serves hud.html on PORT (default: 3000)
            ├── Socket.IO — real-time state sync to browser
            └── MIRA proxy → http://localhost:1993/v0/api/chat
```

The HUD runs standalone — it is not a Docker container. It runs on the local machine (typically Charlie Mac Mini) and proxies MIRA queries to the local MIRA-OSS instance at `localhost:1993`.

---

## PROCEDURES Object

Maintenance procedures are defined as a plain JavaScript object in `server.js`:

```javascript
const PROCEDURES = {
  'ABB IRB-2600': [
    { id: 1, zone: 'A-04', action: 'LOTO all energy sources...', warn: true },
    { id: 2, zone: 'A-04', action: 'Don PPE: safety glasses...', warn: false },
    // ...up to 10 steps
  ],
  'FANUC R2000': [
    { id: 1, zone: 'B-02', action: 'LOTO all energy sources...', warn: true },
    // ...
  ],
};
```

**Step fields:**
- `id` — step number (1-based)
- `zone` — factory floor zone identifier (e.g. `'A-04'`)
- `action` — full procedure text displayed on HUD
- `warn` — `true` if step requires special caution (highlighted differently in HUD)

**Server state:**
```javascript
let activeProcedure = 'ABB IRB-2600';  // currently selected procedure
let currentStep     = 0;               // 0-based index into steps array
```

---

## Socket.IO Events

### Server emits

| Event        | Payload                                       | When                              |
|--------------|-----------------------------------------------|-----------------------------------|
| `init`       | `{procedures, active, steps, currentStep}`    | On client connect                 |
| `stepUpdate` | `{active, steps, currentStep}`                | When step or procedure changes    |
| `mira_insight` | `{text, tags}`                              | MIRA query result or bridge push  |

### Client emits

| Event          | Payload             | Effect                                    |
|----------------|---------------------|-------------------------------------------|
| `setProcedure` | `name: string`      | Switch active procedure, reset to step 0  |
| `step`         | `'next'` or `'prev'` | Advance or retreat one step              |
| `mira_query`   | `query: string`     | Proxy query to MIRA at localhost:1993     |
| `mira_insight` | `{text, tags}`      | Re-broadcast to all clients (bridge push path) |

### MIRA proxy

```javascript
async function queryMiraOSS(query) {
  // POST http://localhost:1993/v0/api/chat
  // {message: query}
  // Returns {text, tags}
  // Timeout: 8 seconds
  // On error: returns {text: 'MIRA: OFFLINE', tags: []}
}
```

The `hud_bridge.py` script can also push `mira_insight` events directly via Socket.IO, bypassing the HTTP proxy.

---

## HUD Overlay CSS

`hud.html` uses these visual effects classes:
- **Scanlines** — repeating horizontal lines overlay for retro CRT feel
- **Vignette** — radial gradient darkens screen edges
- **Corner brackets** — pseudo-elements create targeting-reticle corners

The overlay is designed to be used as a transparent window layer over real camera feed or full-screen on a monitor near the technician.

---

## Running the HUD

```bash
# Option 1: Direct Node
cd mira-hud
npm install
node server.js

# Option 2: macOS app bundle
open mira-hud/CharlieHUD.app

# Access HUD in browser
open http://localhost:3000
```

`PORT` env var overrides default 3000.

---

## How to Add a New Maintenance Procedure

1. Open `mira-hud/server.js`
2. Add a new key to the `PROCEDURES` object:

```javascript
'YOUR EQUIPMENT NAME': [
  { id: 1, zone: 'X-00', action: 'Step 1 procedure text...', warn: true },
  { id: 2, zone: 'X-00', action: 'Step 2 procedure text...', warn: false },
  // ... add up to 10-15 steps
],
```

3. The new procedure appears automatically in the HUD selector on next page load — no code changes needed beyond the data entry.

**Conventions:**
- `zone` — use your factory's zone naming convention (e.g. area-aisle: `'B-02'`)
- `warn: true` for any step involving: LOTO, live electrical, pressurized systems, pinch points
- `action` text should be imperative and specific (who does what, to what, with what tool, at what value)

---

## Adding MIRA Integration

The HUD currently proxies to `localhost:1993` (MIRA-OSS). To point at the main MIRA stack:

1. Change the proxy target in `queryMiraOSS()` to `http://mira-core:8080/api/chat/completions`
2. Add `Authorization: Bearer ${OPENWEBUI_API_KEY}` header
3. Adjust response parsing to match the OpenAI-compatible response format

Or use the `hud_bridge.py` push path: a Python script that subscribes to MIRA events and pushes `mira_insight` via Socket.IO directly.

# MIRA Charlie HUD — User Manual

**Version:** 1.0 | **Node:** CHARLIE (192.168.1.12) | **Port:** 3000

---

## Overview

The MIRA Charlie HUD is a browser-based industrial maintenance assistant. It displays step-by-step maintenance procedures on screen while a live webcam feed provides visual context — designed for hands-free use with AR glasses (Halo or similar) or as a desktop / mobile reference during field work.

**What it does:**
- Guides a technician through a numbered maintenance procedure, one step at a time
- Displays safety warnings (CAUTION steps) prominently
- Provides real-time AI assistance via the MIRA backend
- Syncs all connected clients (desktop + phone) in real time — advance a step on your desktop, your phone updates instantly
- Reflects live hardware state (E-STOP, RUN, FAULT) from the bench PLC and VFD once wired

**What it does NOT do:**
- Control any hardware (read-only from hardware)
- Store procedures in a database (procedures live in `server.js`)
- Require an internet connection (fully local LAN)

---

## Running the Server

### First time (one-time setup)
```bash
cd ~/Documents/GitHub/MIRA/mira-hud
npm install
```

### Every time
```bash
node server.js
```

Expected output:
```
✅  MIRA CHARLIE NODE SERVER
   Desktop HUD : http://localhost:3000
   Halo Sim    : http://localhost:3000/halo_sim
   Phone (LAN) : http://192.168.1.12:3000/halo_sim
   History     : http://localhost:3000/history
```

To stop the server: `Ctrl + C`

### Open the HUD
- **Desktop:** `http://localhost:3000`
- **Phone (same WiFi network):** `http://192.168.1.12:3000/halo_sim`
- Chrome will ask for camera permission — click Allow

---

## Server Routes

| URL | Returns |
|-----|---------|
| `GET /` | `hud.html` — desktop HUD with webcam |
| `GET /halo_sim` | `halo_sim.html` — mobile-optimized HUD (PWA) |
| `GET /history` | JSON array of last 50 events `[{type, text, ts}]` |

---

## HUD Elements — Desktop (`hud.html`)

### Boot Screen
Shown on page load. Animated progress bar runs through 5 stages: CONNECTING CAMERA → LOADING PROCEDURES → ESTABLISHING SOCKET → RENDERING HUD → READY. Auto-dismisses when complete.

### Camera Feed
Full-screen video element behind all HUD elements. Requests rear-facing camera first (for mobile/glasses), falls back to any available camera. Opacity reduced to 72% so HUD overlays are readable.

### Corner Brackets
Four green corner brackets at screen edges — visual framing only, no interactive function.

### Scanlines + Vignette
CSS effects layered over the camera feed for the AR aesthetic — no interactive function.

### Top Bar
| Element | ID / Selector | Description |
|---------|--------------|-------------|
| `SYS:CHARLIE-NODE` | static | Node identity — always shown |
| `PROC: ---` | `#active-proc` | Name of the currently active procedure |
| `HH:MM:SS` | `#clock` | Live local time, updated every second |
| `CAM:INIT` / `CAM:ACTIVE` / `CAM:ERROR` | `#cam-status` | Camera stream status. Orange=initializing, Green=live, Red=failed |
| `● LIVE` | static | Always shown, blinks red — indicates HUD is rendering |

### Left Panel
Displays the current equipment and hardware status. Updates automatically from the server.

| Label | ID | Source | Values |
|-------|----|--------|--------|
| `UNIT:` | `#unit-id` | Procedure name | e.g. `ABB IRB-2600` |
| `ZONE:` | `#zone-id` | Current step's zone field | e.g. `A-04` |
| `MODE:` | static | Always `INSPECT` | Fixed |
| `ESTOP:` | `#hw-estop` | `hardwareUpdate` event | `CLEAR` (green) or `ENGAGED` (red) |
| `SERVO:` | `#hw-servo` | `hardwareUpdate` event | `ON` (green) or `OFF` (amber) |
| `FAULT:` | `#hw-fault` | `hardwareUpdate` event | `NONE` (green) or `F<code>` (red) |

### Right Panel
Displays session tracking information.

| Label | ID | Description |
|-------|----|-------------|
| `TECH:` | static | Always `LOCAL` |
| `STEP:` | `#step-counter` | Current step number / total steps (e.g. `2/10`) |
| `STATUS:` | static | Always `RUN` |
| `FRAME:` | `#frame-ct` | Frame counter incremented ~30fps — visual activity indicator |
| `SIGNAL:` | static | Always `100%` |
| `STREAM:` | static | Always `ON` |

### Crosshair
Centered targeting reticule — visual reference only, no interactive function.

### Procedure Selector
Buttons rendered dynamically from the server's `PROCEDURES` object. Click any button to switch procedures. The active procedure is highlighted. Switching resets the step counter to step 1.

### Instruction Panel (center bottom)
The main working area.

| Element | ID | Description |
|---------|----|-------------|
| Step label | `#step-label` | `STEP X OF Y — MAINTENANCE PROCEDURE [⚠ CAUTION]` |
| Step text | `#step-text` | Full action text for the current step. Yellow + left border if `warn: true` |
| Progress bar | `#progress-fill` | Fills left-to-right as steps advance. CSS transition 0.45s |

### PREV / NEXT Buttons
Navigate between steps. PREV disabled on step 1, NEXT disabled on final step. Clicking sends a `step` event to the server, which broadcasts `stepUpdate` to all connected clients — all open browsers update simultaneously.

### MIRA AI Panel (top right)
The AI query interface.

| Element | ID | Description |
|---------|----|-------------|
| Title | `#mira-title` | Always `MIRA` |
| Status | `#mira-status` | `CONNECTING...` → `ONLINE` (green) → `OFFLINE` (red) |
| Output | `#mira-output` | Scrollable log. System messages (green-dim), queries (amber), responses (bright green) |
| Input | `#mira-input` | Free-text query field. Enter key sends. |
| SEND button | `#mira-send` | Sends query. Disabled while waiting for response. |

MIRA queries are proxied through the server to `http://localhost:1993/v0/api/chat`. If the backend is unreachable, the panel shows `MIRA: OFFLINE` — all other HUD functions continue to work.

---

## HUD Elements — Mobile / Halo Sim (`halo_sim.html`)

Identical procedure data and Socket.IO events as the desktop HUD. Touch-optimized layout:

- **Top bar:** Node name, procedure name (truncated), live clock
- **Procedure tabs:** Horizontal scrollable tab strip for switching procedures
- **Step area:** Large readable text box with WARN badge and progress bar
- **PREV / NEXT:** Two full-width buttons taking up ~20% of screen height — designed for gloved hands
- **MIRA panel:** Collapsible section at bottom — tap `MIRA AI ▾` to expand/collapse. Scrollable response history, keyboard-friendly input.

### PWA Installation (Add to Home Screen)
On iPhone: tap Share → Add to Home Screen → Add
On Android: tap menu → Add to Home screen
Opens directly to `/halo_sim` in fullscreen standalone mode (no browser chrome).

---

## Socket.IO Event Reference

All events are JSON over WebSocket. The server broadcasts most events to **all** connected clients simultaneously — desktop and phone stay in sync.

### Server → Client

| Event | Payload | When | Effect on HUD |
|-------|---------|------|---------------|
| `init` | `{procedures: string[], active: string, steps: Step[], currentStep: number}` | On every new connection | Loads all procedures, renders step display, builds procedure buttons |
| `stepUpdate` | `{active: string, steps: Step[], currentStep: number}` | After any `step` or `setProcedure` event | Updates step display and procedure button highlight on all clients |
| `mira_insight` | `{text: string, tags: string[]}` | After a `mira_query` is answered | Appends AI response to MIRA panel output |
| `hardwareUpdate` | `{estop: bool, run: bool, fault: bool, direction: 'FWD'|'REV'|'OFF', vfd_hz: number, vfd_fault_code: number}` | Every 500ms from server polling loop | Updates left panel ESTOP / SERVO / FAULT indicators |

### Client → Server

| Event | Payload | Effect |
|-------|---------|--------|
| `step` | `'next'` or `'prev'` | Advances or retreats `currentStep` (bounds-checked). Broadcasts `stepUpdate` to all clients. Pushes to history log. |
| `setProcedure` | `name: string` | Switches active procedure and resets `currentStep` to 0. Broadcasts `stepUpdate` to all clients. |
| `mira_query` | `query: string` | Logs query to history. Proxies to mira-OSS backend. On response, broadcasts `mira_insight` to all clients. |
| `mira_insight` | `{text, tags}` | Re-broadcast path for `hud_bridge.py` push — server re-emits to all clients. |

### Step Object Schema
```json
{
  "id": 1,
  "zone": "A-04",
  "action": "Full text of the maintenance action to perform.",
  "warn": false
}
```
- `id`: 1-indexed step number
- `zone`: physical location code on the factory floor
- `action`: the instruction displayed in the center panel
- `warn`: `true` = display in amber with CAUTION badge; `false` = normal green display

---

## Adding a New Procedure

Edit `mira-hud/server.js`. Find the `PROCEDURES` object at the top of the file and add a new key:

```js
const PROCEDURES = {
  'ABB IRB-2600': [ /* existing */ ],
  'FANUC R2000':  [ /* existing */ ],

  // ADD YOUR PROCEDURE HERE:
  'CONVEYOR BELT PM': [
    { id: 1, zone: 'C-01', action: 'Lock out main conveyor drive breaker CB-3. Apply LOTO padlock. Verify zero voltage at motor terminals.', warn: true },
    { id: 2, zone: 'C-01', action: 'Inspect belt tension: deflection at center span must be 12–15mm under 5 kg load.', warn: false },
    { id: 3, zone: 'C-01', action: 'Check belt tracking. Belt edge must be within 10mm of pulley edge throughout full rotation.', warn: false },
    // ... more steps
  ],
};
```

Rules:
- Key name = button label shown in the HUD
- `id` values must be 1-indexed and sequential
- `warn: true` triggers amber coloring and CAUTION badge — use for LOTO, electrical, pinch points
- Restart the server after editing: `Ctrl+C` → `node server.js`

---

## History Log

`GET http://localhost:3000/history` returns a JSON array of the last 50 events:

```json
[
  { "type": "step",     "text": "[ABB IRB-2600] Step 2: Don PPE: safety glasses…", "ts": "2026-03-23T14:22:01.123Z" },
  { "type": "query",    "text": "What torque should I use on J1 gearbox?",           "ts": "2026-03-23T14:23:10.456Z" },
  { "type": "response", "text": "MIRA: J1 gearbox cover bolts: 24 Nm. MOBILGEAR…",  "ts": "2026-03-23T14:23:11.789Z" }
]
```

Types: `step` | `query` | `response`
History is in-memory only — cleared when the server restarts.

---

## halo_bridge.py (Future)

`halo_bridge.py` is a planned Python script that will push MIRA AI responses directly to Halo AR glasses over their native socket interface, bypassing the browser entirely. When running:

1. The Halo glasses connect to `halo_bridge.py` via their SDK socket
2. `halo_bridge.py` connects to the HUD server as a Socket.IO client
3. It listens for `mira_insight` events and forwards text to the glasses display
4. It also receives button press events from the glasses and emits `step` events back to the server

Not yet implemented. The HUD's `mira_insight` re-broadcast path (`socket.on('mira_insight', ...)` in `server.js`) is the hook point — bridge connects as a regular Socket.IO client and uses the same event names.

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `Error: Cannot find module 'express'` | Dependencies not installed | `npm install` |
| `Error: listen EADDRINUSE 3000` | Port already in use | `lsof -ti:3000 \| xargs kill` |
| `CAM:ERROR` on HUD | Browser blocked camera or no camera | Check browser permissions; HTTPS required on some browsers for `getUserMedia` |
| Procedure buttons don't appear | Socket.IO not connected | Check server is running; refresh page |
| MIRA shows OFFLINE | mira-OSS backend not running | Normal — HUD works without MIRA. Start mira-OSS if needed. |
| Phone can't reach server | Not on same WiFi | Connect phone to same LAN as Charlie node |
| `halo_sim.html` 404 | File not in mira-hud/ | Confirm `halo_sim.html` exists in same directory as `server.js` |

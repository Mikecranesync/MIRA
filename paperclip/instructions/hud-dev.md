# MIRA HUD Developer Agent

You develop and maintain the AR HUD desktop app, VIM pipeline, and Ignition HMI Co-Pilot.

## Your Scope

- `mira-hud/server.js` — Express + Socket.IO server, PROCEDURES object, MIRA proxy
- `mira-hud/hud.html` — HUD overlay UI (scanlines, vignette, corner brackets)
- `mira-hud/package.json` — Dependencies (express, socket.io)
- `mira-hud/vim/` — VIM (Visual Inspection Module) pipeline
- `ignition/` — Ignition HMI Co-Pilot components
- `ignition-sdk-examples/` — Ignition SDK reference implementations

## Standards

- JavaScript (Node.js) for HUD server
- Express + Socket.IO (pinned versions in package.json)
- No additional frameworks for the HUD
- Python for VIM pipeline components
- Conventional commit format

## Testing

```bash
cd mira-hud && node server.js &
curl -s http://localhost:3000 | head -5
kill %1
```

---

## Domain Skill: PROCEDURES Data Format

Maintenance procedures are plain JavaScript objects in `server.js`:

```javascript
const PROCEDURES = {
  'ABB IRB-2600': [
    { id: 1, zone: 'A-04', action: 'LOTO all energy sources...', warn: true },
    { id: 2, zone: 'A-04', action: 'Don PPE: safety glasses...', warn: false },
  ],
};
```

**Step fields:**
- `id` — step number (1-based)
- `zone` — factory floor zone identifier (e.g. `'A-04'`)
- `action` — procedure text displayed on HUD overlay
- `warn` — `true` for LOTO, live electrical, pressurized, pinch points (highlighted differently)

**Server state vars:**
```javascript
let activeProcedure = 'ABB IRB-2600';  // currently selected
let currentStep     = 0;               // 0-based index
```

**Adding a procedure:** Add key to PROCEDURES object → appears automatically in HUD selector on next load.

---

## Domain Skill: Socket.IO Protocol

### Server Emits

| Event | Payload | When |
|-------|---------|------|
| `init` | `{procedures, active, steps, currentStep}` | On client connect |
| `stepUpdate` | `{active, steps, currentStep}` | Step or procedure changes |
| `mira_insight` | `{text, tags}` | MIRA query result or bridge push |

### Client Emits

| Event | Payload | Effect |
|-------|---------|--------|
| `setProcedure` | `name: string` | Switch procedure, reset to step 0 |
| `step` | `'next'` or `'prev'` | Advance/retreat one step |
| `mira_query` | `query: string` | Proxy query to MIRA |
| `mira_insight` | `{text, tags}` | Display insight on HUD |

---

## Domain Skill: MIRA Proxy

`queryMiraOSS()` in server.js:
- POST to `http://localhost:1993/v0/api/chat`
- 8-second timeout
- Falls back to offline message if MIRA unreachable
- Bridge push path: `hud_bridge.py` pushes insights via Socket.IO from Python side

**Vision→RAG gap (#24):** Camera identifies equipment but context doesn't flow into chat. `lastVision` variable needs to be injected into `techQuery` payload. PRD written, implementation deferred until after RAG pipeline work.

---

## Domain Skill: HUD Overlay CSS

- **Scanlines:** Horizontal repeating lines for CRT/tactical effect
- **Vignette:** Radial gradient darkens edges
- **Corner brackets:** Targeting-reticle corners via CSS pseudo-elements
- **Color scheme:** Green-on-black (#00ff00 primary), designed for AR glasses overlay

---

## Domain Skill: VIM Pipeline

Phases 1A→4 built in `mira-hud/vim/`:
- Scene scanner (frame capture from camera)
- Equipment classifier (nameplate detection)
- DB adapter (SQLite state persistence)
- Orchestrator (ties scanner → classifier → DB → HUD)

**Known issue (#25):** Frame capture loop is missing — MIRA has no visual context from the camera feed yet.

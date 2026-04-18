# mira-hud — AR HUD Demo Server

Express + Socket.IO real-time AR-style maintenance procedure overlay.
Connects to the MIRA diagnostic engine for live insight injection.

## Stack

- `express ^4.18.2` + `socket.io ^4.7.5`
- Entry point: `server.js`
- Static HUD overlay: `hud.html` (single file, served at `/`)
- Bundled macOS app: `CharlieHUD.app`

## Procedure Data (server.js)

`PROCEDURES` object — keyed by equipment name, value is array of step objects:

```js
{ id: Number, zone: String, action: String, warn: Boolean }
```

Current procedures: `'ABB IRB-2600'` (10 steps, zone A-04),
`'FANUC R2000'` (10 steps, zone B-02).

`warn: true` flags steps that require extra attention (LOTO, arc flash, voltage checks).

## Socket.IO Events

| Event | Direction | Payload | Purpose |
|-------|-----------|---------|---------|
| `init` | server→client | `{procedures, active, steps, currentStep}` | Full state on connect |
| `setProcedure` | client→server | `name: String` | Switch active procedure |
| `stepUpdate` | server→all | `{active, steps, currentStep}` | Broadcast after step change |
| `step` | client→server | `dir: "next" \| "prev"` | Advance or retreat step |
| `mira_query` | client→server | `query: String` | Proxy query to MIRA OSS |
| `mira_insight` | server→all | `{text, tags}` | Broadcast MIRA diagnostic result |

`mira_insight` is also accepted server→server (from `hud_bridge.py`) for push-path injection.

## MIRA Proxy (queryMiraOSS)

POSTs to `http://localhost:1993/v0/api/chat` with 8-second timeout.
Falls back to `{ text: 'MIRA: OFFLINE', tags: [] }` if unreachable.

## Adding a New Procedure

Add an entry to `PROCEDURES` in `server.js`:

```js
'MY EQUIPMENT': [
  { id: 1, zone: 'C-01', action: 'First step text.', warn: true },
  ...
]
```

No other changes required — the HUD dropdown and step renderer populate dynamically.

## Running

```bash
npm install          # install express + socket.io
node server.js       # default port 3000
PORT=3001 node server.js   # alternate port
```

Connect message: `[HUD] Charlie Node HUD running at http://localhost:3000`

## CharlieHUD.app

Double-click to launch bundled macOS version. Embeds Chromium + Node.js.
Port defaults to 3000 — do not run alongside standalone `node server.js`.

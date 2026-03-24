# Runbook: HUD Demo Setup

Get the AR HUD running on CHARLIE (charlienode, 100.70.49.126 / 192.168.1.12)
for a live maintenance procedure demo.

## Prerequisites

- Node.js 18+ installed on CHARLIE (`node --version`)
- `mira-hud/` directory present (`ls ~/Mira/mira-hud/`)
- Optional: MIRA OSS backend running on port 1993 for live diagnostic queries

## Steps

### 1. Install Dependencies

```bash
cd ~/Mira/mira-hud
npm install
# Installs express ^4.18.2 and socket.io ^4.7.5
```

### 2. Start the Server

```bash
node server.js
# Expected output:
# [HUD] Charlie Node HUD running at http://localhost:3000
# [HUD] mira-OSS target: http://localhost:1993
```

If port 3000 is already in use:

```bash
PORT=3001 node server.js
```

### 3. Open the HUD

On CHARLIE or any device on the same network:

```
http://192.168.1.12:3000
```

The HUD overlay loads immediately. No login required.

### 4. Verify Socket.IO Connection

Open browser DevTools console. You should see the server log:

```
[HUD] client connected: <socket-id>
```

The HUD receives an `init` event with procedures, active procedure (`ABB IRB-2600`),
and `currentStep: 0`.

### 5. Navigate Procedures

- Use the **procedure dropdown** to switch between `ABB IRB-2600` and `FANUC R2000`
- Use **arrow keys** (or on-screen buttons) to advance and retreat steps
- Steps with `warn: true` display with a warning highlight

### 6. Live MIRA Integration (Optional)

Start MIRA OSS on port 1993 before launching the HUD:

```bash
# On CHARLIE — ensure mira-core or mira-OSS is running on :1993
```

Type a query in the HUD's query input field. The HUD emits `mira_query`, which calls
`queryMiraOSS()` → `POST http://localhost:1993/v0/api/chat`. The response is broadcast
as `mira_insight` to all connected viewers.

If MIRA is not running, the insight panel shows `MIRA: OFFLINE` — this is expected
and does not affect procedure navigation.

### 7. CharlieHUD.app (macOS)

For a one-click demo launch on CHARLIE without a terminal:

```
Double-click: mira-hud/CharlieHUD.app
```

The app embeds the server and opens the HUD in a Chromium window automatically.
Do not run `node server.js` at the same time — both will attempt to bind port 3000.

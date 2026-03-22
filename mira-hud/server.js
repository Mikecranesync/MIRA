'use strict';

const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const path     = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

// ─── PROCEDURE DATA ──────────────────────────────────────────────────────────
const PROCEDURES = {
  'ABB IRB-2600': [
    { id: 1, zone: 'A-04', action: 'Verify E-stop buttons disengaged and control cabinet powered OFF. Lock out tag out (LOTO) all energy sources.', warn: true },
    { id: 2, zone: 'A-04', action: 'Don PPE: safety glasses, cut-resistant gloves, steel-toed boots. Confirm buddy is present for LOTO sign-off.', warn: false },
    { id: 3, zone: 'A-04', action: 'Open servo drive cabinet door. Verify DC bus voltage reads <50 V on multimeter before touching internals.', warn: true },
    { id: 4, zone: 'A-04', action: 'Inspect J1-J6 resolver cables for chafing, pinch points, and connector seating. Wiggle each connector firmly.', warn: false },
    { id: 5, zone: 'A-04', action: 'Remove teach pendant. Power ON controller. Navigate IRC5 → Event Log. Record any fault codes before clearing.', warn: false },
    { id: 6, zone: 'A-04', action: 'Run RAPID program TestJogLimits at 10% speed. Watch each joint for smooth motion, no stutter or grinding noise.', warn: true },
    { id: 7, zone: 'A-04', action: 'Check TCP calibration: jog to 4-point calibration fixture. Max deviation allowed: ±0.3 mm. Log measured values.', warn: false },
    { id: 8, zone: 'A-04', action: 'Inspect end-effector gripper fingers for wear. Replace if gap sensor reads >2.1 mm open on empty-grip test.', warn: false },
    { id: 9, zone: 'A-04', action: 'Lubricate J1-J3 gearboxes: 5 cc MOBILGEAR SHC 460. Wipe excess. Log grease type and date in maintenance logbook.', warn: false },
    { id: 10, zone: 'A-04', action: 'Restore LOTO. Power up. Run full production cycle at 25% speed. Confirm no faults. Release to production supervisor.', warn: false },
  ],
  'FANUC R2000': [
    { id: 1, zone: 'B-02', action: 'LOTO all energy sources: main breaker, pneumatic supply valve. Verify stored energy discharged (capacitor bleed >3 min).', warn: true },
    { id: 2, zone: 'B-02', action: 'Open R-30iB controller front panel. Check cooling fan rotation and heatsink for dust buildup. Vacuum if needed.', warn: false },
    { id: 3, zone: 'B-02', action: 'Inspect servo amplifier fuses F1-F6. Check for discoloration or tripped indicator. Replace any blown fuses with matching spec.', warn: true },
    { id: 4, zone: 'B-02', action: 'Run FANUC TP → Diagnosis → Servo Error. Note any encoder error counts on J1-J6. Threshold: <5 counts/hr normal.', warn: false },
    { id: 5, zone: 'B-02', action: 'Check wrist cable bundle exit at J5-J6 for kinking. Bend radius must be ≥3× cable diameter throughout full range.', warn: false },
    { id: 6, zone: 'B-02', action: 'Inspect spot weld gun electrodes for mushrooming. Dress or replace if face diameter >20 mm (nominal 16 mm spec).', warn: true },
    { id: 7, zone: 'B-02', action: 'Verify water cooling flow: min 3 L/min at weld transformer. Check hose connectors for leaks. Torque to 8 Nm if loose.', warn: false },
    { id: 8, zone: 'B-02', action: 'Run mastering verification: jog each joint to master position marks. Confirm within ±0.5° or perform zero-point mastering.', warn: false },
    { id: 9, zone: 'B-02', action: 'Execute DryRun program at 30% override. Monitor RMS torque on TP → Servo → Status. Alert if any joint >75% rated torque.', warn: true },
    { id: 10, zone: 'B-02', action: 'Restore power and air. Run production sample at 100% speed. Record cycle time and compare to baseline. Sign off maintenance log.', warn: false },
  ],
};

// ─── SERVER STATE ────────────────────────────────────────────────────────────
let activeProcedure = 'ABB IRB-2600';
let currentStep     = 0;

// ─── STATIC FILE SERVING ─────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'hud.html'));
});

// ─── MIRA-OSS PROXY ──────────────────────────────────────────────────────────
async function queryMiraOSS(query) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch('http://localhost:1993/v0/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: query }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) throw new Error(`mira-OSS HTTP ${resp.status}`);
    const data = await resp.json();
    return {
      text: data.response || data.message || data.text || JSON.stringify(data),
      tags: data.memory_tags || data.tags || [],
    };
  } catch (err) {
    clearTimeout(timeout);
    console.warn('[mira-OSS] unreachable:', err.message);
    return { text: 'MIRA: OFFLINE', tags: [] };
  }
}

// ─── SOCKET.IO EVENTS ────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[HUD] client connected: ${socket.id}`);

  // Send full state on connect
  socket.emit('init', {
    procedures: Object.keys(PROCEDURES),
    active:      activeProcedure,
    steps:       PROCEDURES[activeProcedure],
    currentStep,
  });

  // Switch procedure
  socket.on('setProcedure', (name) => {
    if (!PROCEDURES[name]) return;
    activeProcedure = name;
    currentStep     = 0;
    io.emit('stepUpdate', {
      active:      activeProcedure,
      steps:       PROCEDURES[activeProcedure],
      currentStep,
    });
  });

  // Advance / retreat step  (dir: 'next' | 'prev')
  socket.on('step', (dir) => {
    const total = PROCEDURES[activeProcedure].length;
    if (dir === 'next' && currentStep < total - 1) currentStep++;
    else if (dir === 'prev' && currentStep > 0)    currentStep--;
    io.emit('stepUpdate', {
      active:      activeProcedure,
      steps:       PROCEDURES[activeProcedure],
      currentStep,
    });
  });

  // Proxy mira-OSS query
  socket.on('mira_query', async (query) => {
    console.log(`[MIRA] query: "${query}"`);
    const result = await queryMiraOSS(query);
    io.emit('mira_insight', result);
  });

  // hud_bridge.py push path — re-broadcast to all clients
  socket.on('mira_insight', (data) => {
    io.emit('mira_insight', data);
  });

  socket.on('disconnect', () => {
    console.log(`[HUD] client disconnected: ${socket.id}`);
  });
});

// ─── START ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[HUD] Charlie Node HUD running at http://localhost:${PORT}`);
  console.log(`[HUD] mira-OSS target: http://localhost:1993`);
});

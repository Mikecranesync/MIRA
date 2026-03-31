'use strict';

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');
const os         = require('os');
const fs         = require('fs');
const Anthropic  = require('@anthropic-ai/sdk');

function getLanIP() {
  for (const iface of Object.values(os.networkInterfaces()).flat()) {
    if (iface && iface.family === 'IPv4' && !iface.internal) return iface.address;
  }
  return 'localhost';
}

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);
let pythonBackendActive = false;
let pythonSocketId      = null;  // set when mira_core.py registers; gates server.js RAG

// ─── AI SETUP ────────────────────────────────────────────────────────────────
const DOCS_DIR = path.join(__dirname, 'vision_backend', 'docs');
let DOC_CONTEXT = '';
if (fs.existsSync(DOCS_DIR)) {
  const docFiles = fs.readdirSync(DOCS_DIR).filter(f => f.endsWith('.txt'));
  DOC_CONTEXT = docFiles.map(f =>
    `=== ${f} ===\n${fs.readFileSync(path.join(DOCS_DIR, f), 'utf8')}`
  ).join('\n\n');
  console.log(`[docs] loaded ${docFiles.length} doc(s) from vision_backend/docs/`);
}

const VISION_PROMPT =
  'You are an industrial equipment assistant analyzing a camera frame.\n' +
  'Identify any equipment visible. Return ONLY valid JSON with no markdown:\n' +
  '{"equipment":"type or \'Unknown\'","model":"brand and model if visible or \'Unknown\'","observations":"1-2 sentence description","alerts":["safety concerns — empty array if none"]}\n' +
  'If no industrial equipment is visible set equipment to "General environment".';

function buildRAGPrompt(equipContext, question) {
  const equip = (equipContext || '').replace(/\s+/g, ' ').trim() || 'Unknown';
  return `You are MIRA, an industrial maintenance assistant. Answer concisely.\nEquipment: ${equip}\nQuestion: ${question}${DOC_CONTEXT ? '\n\nDocumentation:\n' + DOC_CONTEXT : ''}\n\nAnswer in 2-4 sentences. Be specific. Include fault code reset steps if relevant.`;
}

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const anthropic    = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
if (!anthropic) console.warn('[claude] ANTHROPIC_API_KEY not set — vision/RAG disabled');

function parseVisionJSON(text) {
  let clean = text.trim();
  if (clean.startsWith('```')) {
    clean = clean.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
  }
  try {
    return JSON.parse(clean);
  } catch {
    return { equipment: 'Unknown', model: 'Unknown', observations: clean.slice(0, 150), alerts: [] };
  }
}

async function callVision(base64Jpeg) {
  const msg = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Jpeg } },
        { type: 'text', text: VISION_PROMPT },
      ],
    }],
  });
  const raw = msg.content[0].text;
  return { result: parseVisionJSON(raw), raw, usage: msg.usage };
}

async function callRAG(equipContext, question) {
  const msg = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 400,
    messages: [{ role: 'user', content: buildRAGPrompt(equipContext, question) }],
  });
  return { answer: msg.content[0].text.trim(), usage: msg.usage };
}

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

async function queryClaude(query) {
  try {
    const ctxMatch = query.match(/\[context:([^\]]*)\]/);
    const equipCtx = ctxMatch ? ctxMatch[1] : '';
    const cleanQ   = query.replace(/\[context:[^\]]*\]/, '').trim();
    const prompt   = buildRAGPrompt(equipCtx, cleanQ);
    const msg = await anthropic.messages.create({
      model:      CLAUDE_MODEL,
      max_tokens: 512,
      messages:   [{ role: 'user', content: prompt }],
    });
    const text = msg.content[0]?.text || 'MIRA: No response';
    console.log(`[claude] in=${msg.usage.input_tokens} out=${msg.usage.output_tokens}`);
    return { text, tags: [] };
  } catch (err) {
    console.error('[claude] error:', err.message);
    return { text: 'MIRA: OFFLINE', tags: [] };
  }
}

// ─── SERVER STATE ────────────────────────────────────────────────────────────
let activeProcedure = 'ABB IRB-2600';
let currentStep     = 0;

const history = [];
function pushHistory(type, text) {
  history.push({ type, text, ts: new Date().toISOString() });
  if (history.length > 100) history.shift();
}

const LOG_DIR      = path.join(__dirname, 'vision_backend', 'logs');
const CAPTURES_DIR = path.join(__dirname, 'vision_captures');
fs.mkdirSync(LOG_DIR,      { recursive: true });
fs.mkdirSync(CAPTURES_DIR, { recursive: true });

// ─── VISION CAPTURE STATE ─────────────────────────────────────────────────────
const CAPTURE_RATE_MS = 5 * 60 * 1000;   // min gap between saves for same equipment
let _lastSavedEquip = '';
const _lastSaveTime = new Map();          // slug → timestamp
let _lastFrameB64   = null;              // most recent frame, for demand capture
let _lastVisionRes  = null;              // most recent vision result

function toSlug(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function saveCaptureFrame(base64Jpeg, result, significance) {
  if (!base64Jpeg) return;
  try {
    const now  = new Date();
    const date = now.toISOString().slice(0, 10);
    const slug = toSlug(result.equipment);
    const ts   = now.toISOString().replace(/:/g, '-').replace(/\..+/, '');
    const dir  = path.join(CAPTURES_DIR, date, slug);
    fs.mkdirSync(dir, { recursive: true });
    const relPath = `vision_captures/${date}/${slug}/${ts}.jpg`;
    fs.writeFileSync(path.join(dir, `${ts}.jpg`), Buffer.from(base64Jpeg, 'base64'));
    fs.writeFileSync(path.join(dir, `${ts}.json`), JSON.stringify({
      ts:           now.toISOString(),
      session_date: date,
      significance,
      image_path:   relPath,
      equipment:    result.equipment,
      model:        result.model,
      observations: result.observations,
      alerts:       result.alerts || [],
      input_tokens:  result.input_tokens  || 0,
      output_tokens: result.output_tokens || 0,
    }, null, 2));
    console.log(`[capture] ${slug} — ${significance}`);
  } catch (err) {
    console.error('[capture] save error:', err.message);
  }
}

function logSession(type, data) {
  const entry = { ts: new Date().toISOString(), type, ...data };
  const date  = entry.ts.slice(0, 10);
  fs.appendFileSync(
    path.join(LOG_DIR, `session-${date}.jsonl`),
    JSON.stringify(entry) + '\n'
  );
  pushHistory(type, JSON.stringify(data).slice(0, 120));
}

// ─── HARDWARE STATE ───────────────────────────────────────────────────────────
const hwState = {
  estop:          false,   // true = E-STOP ENGAGED
  run:            false,   // true = drive running
  fault:          false,   // true = active fault
  direction:      'OFF',   // 'FWD' | 'REV' | 'OFF'
  vfd_hz:         0,       // output frequency Hz
  vfd_fault_code: 0,       // VFD fault register (0 = no fault)
};

// ─── HARDWARE POLLING ─────────────────────────────────────────────────────────
// To wire real hardware:
//   1. npm install ethernet-ip jsmodbus
//   2. See HARDWARE_INTEGRATION.md for full code snippets
//   3. Paste pollPLC() and pollVFD() functions here
//   4. Uncomment the two lines inside the setInterval below
//
// const { Controller, Tag } = require('ethernet-ip');  // Allen-Bradley EtherNet/IP
// const Modbus = require('jsmodbus');                    // AutomationDirect Modbus TCP
// const net    = require('net');
//
// async function pollPLC() { /* see HARDWARE_INTEGRATION.md */ }
// async function pollVFD() { /* see HARDWARE_INTEGRATION.md */ }
//
setInterval(async () => {
  // await pollPLC();
  // await pollVFD();
  io.emit('hardwareUpdate', hwState);
}, 500);

// ─── STATIC FILE SERVING ─────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'hud.html'));
});

app.get('/halo_sim', (req, res) => {
  res.sendFile(path.join(__dirname, 'halo_sim.html'));
});

app.get('/history', (req, res) => {
  res.json(history.slice(-50));
});

app.get('/session-log', (req, res) => {
  const date = (req.query.date || new Date().toISOString()).slice(0, 10);
  const file = path.join(LOG_DIR, `session-${date}.jsonl`);
  if (!fs.existsSync(file)) return res.json([]);
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
  res.json(lines.map(l => JSON.parse(l)).reverse());
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
  logSession('client_connect', { socket_id: socket.id, ip: socket.handshake.address });

  // Send full state on connect
  socket.emit('init', {
    procedures: Object.keys(PROCEDURES),
    active:      activeProcedure,
    steps:       PROCEDURES[activeProcedure],
    currentStep,
  });
  socket.emit('hardwareUpdate', hwState);

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
    const step = PROCEDURES[activeProcedure][currentStep];
    pushHistory('step', `[${activeProcedure}] Step ${step.id}: ${step.action.slice(0, 60)}…`);
    io.emit('stepUpdate', {
      active:      activeProcedure,
      steps:       PROCEDURES[activeProcedure],
      currentStep,
    });
  });

  // Proxy mira-OSS query
  socket.on('mira_query', async (query) => {
    console.log(`[MIRA] query: "${query}"`);
    if (process.env.MIRA_PYTHON_RAG === 'true') {
      io.emit('techQuery', { query_text: query });
      return;
    }
    pushHistory('query', query);
    const result = anthropic ? await queryClaude(query) : await queryMiraOSS(query);
    pushHistory('response', result.text.slice(0, 120));
    io.emit('mira_insight', result);
  });

  // VIM vision overlay relay — Python → all HUD clients
  socket.on('vim_overlay', (data) => {
    io.emit('vim_overlay', data);
  });

  // VIM manifest update relay — Python → all HUD clients
  socket.on('visionUpdate', (data) => {
    io.emit('visionUpdate', data);
  });

  // hud_bridge.py push path — re-broadcast to all clients
  socket.on('mira_insight', (data) => {
    io.emit('mira_insight', data);
  });

  // Python backend registration — disables server.js RAG to prevent duplicate responses
  socket.on('registerPythonBackend', () => {
    pythonBackendActive = true;
    pythonSocketId = socket.id;
    console.log('[backend] Python mira_core connected — server.js RAG disabled');
  });

  // Browser sends a base64 JPEG frame for Claude Vision analysis
  socket.on('analyzeFrame', async (base64Jpeg) => {
    if (!anthropic) {
      socket.emit('visionUpdate', {
        equipment: 'Vision offline', model: '--',
        observations: 'Set ANTHROPIC_API_KEY env var and restart server.',
        alerts: [], pendingConfirm: false,
      });
      return;
    }
    const t0 = Date.now();
    try {
      const { result, raw, usage } = await callVision(base64Jpeg);
      const specific = result.equipment !== 'Unknown' && result.equipment !== 'General environment';
      result.pendingConfirm = specific;
      io.emit('visionUpdate', result);
      logSession('vision_scan', {
        equipment:       result.equipment,
        model:           result.model,
        observations:    result.observations,
        alerts:          result.alerts,
        pending_confirm: specific,
        raw_response:    raw.slice(0, 300),
        duration_ms:     Date.now() - t0,
        input_tokens:    usage.input_tokens,
        output_tokens:   usage.output_tokens,
      });

      // ─── SIGNIFICANCE CAPTURE ─────────────────────────────────────────────
      _lastFrameB64  = base64Jpeg;
      _lastVisionRes = { ...result, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens };

      if (specific) {
        const slug      = toSlug(result.equipment);
        const hasAlert  = result.alerts && result.alerts.length > 0;
        const newScene  = result.equipment !== _lastSavedEquip;
        const rateClear = (Date.now() - (_lastSaveTime.get(slug) || 0)) > CAPTURE_RATE_MS;
        const sig = hasAlert ? 'alert'
                  : newScene  ? 'scene_transition'
                  : rateClear ? 'rate_limit_cleared'
                  : null;
        if (sig) {
          saveCaptureFrame(base64Jpeg, _lastVisionRes, sig);
          _lastSavedEquip = result.equipment;
          _lastSaveTime.set(slug, Date.now());
        }
      }
    } catch (err) {
      console.error('[vision]', err.message);
      logSession('vision_error', { error: err.message, duration_ms: Date.now() - t0 });
      socket.emit('visionUpdate', {
        equipment: 'Vision error', model: '--',
        observations: err.message.slice(0, 120),
        alerts: [], pendingConfirm: false,
      });
    }
  });

  // Tech confirmed the identified equipment — demand capture + RAG
  socket.on('confirmEquipment', async ({ equipment, model }) => {
    if (!anthropic) return;
    // Demand capture: user confirmed — always save, highest confidence
    if (_lastFrameB64) {
      saveCaptureFrame(_lastFrameB64, {
        ..._lastVisionRes,
        equipment: equipment || _lastVisionRes?.equipment || 'Unknown',
        model:     model     || _lastVisionRes?.model     || 'Unknown',
      }, 'user_confirmed');
      _lastSavedEquip = equipment;
      _lastSaveTime.set(toSlug(equipment), Date.now());
    }
    const t0 = Date.now();
    const question = 'What should the technician check or know about this equipment right now?';
    try {
      const equipContext = `${equipment} ${model || ''}`.trim();
      const { answer, usage } = await callRAG(equipContext, question);
      io.emit('mira_insight', { text: answer, tags: [] });
      logSession('mira_response', {
        equipment, model,
        question,
        answer,
        sources:       DOC_CONTEXT ? ['docs'] : [],
        duration_ms:   Date.now() - t0,
        input_tokens:  usage.input_tokens,
        output_tokens: usage.output_tokens,
      });
    } catch (err) {
      console.error('[rag]', err.message);
      logSession('mira_error', { equipment, error: err.message, duration_ms: Date.now() - t0 });
      io.emit('mira_insight', { text: `MIRA: ${err.message}`, tags: [] });
    }
  });

  // Text query from browser query bar — re-broadcast + AI response
  socket.on('techQuery', async (data) => {
    io.emit('techQuery', data);  // re-broadcast for display + Python path
    if (!anthropic || data.source !== 'text' || pythonBackendActive) return;
    const question = (data.query || '').trim();
    if (!question) return;
    const t0 = Date.now();
    try {
      const ctx = (data.equipment_context || '').trim();
      const { answer, usage } = await callRAG(ctx || 'Unknown', question);
      io.emit('mira_insight', { text: answer, tags: [] });
      logSession('tech_query', {
        query:             question,
        equipment_context: ctx,
        answer,
        duration_ms:   Date.now() - t0,
        input_tokens:  usage.input_tokens,
        output_tokens: usage.output_tokens,
      });
    } catch (err) {
      io.emit('miraResponse', { answer: `Error: ${err.message}`, sources: [], equipment_context: '' });
    }
  });

  socket.on('rejectEquipment', ({ equipment, model }) => {
    logSession('vision_reject', { equipment, model });
  });

  socket.on('scanAgain', () => {
    logSession('scan_reset', { socket_id: socket.id });
  });

  socket.on('disconnect', (reason) => {
    if (socket.id === pythonSocketId) {
      pythonBackendActive = false;
      pythonSocketId = null;
      console.log('[backend] Python mira_core disconnected — server.js RAG re-enabled');
    }
    console.log(`[HUD] client disconnected: ${socket.id}`);
    logSession('client_disconnect', { socket_id: socket.id, reason });
  });
});

// ─── START ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  const lan = getLanIP();
  console.log(`\n✅  MIRA CHARLIE NODE SERVER`);
  console.log(`   Desktop HUD : http://localhost:${PORT}`);
  console.log(`   Halo Sim    : http://localhost:${PORT}/halo_sim`);
  console.log(`   Phone (LAN) : http://${lan}:${PORT}/halo_sim`);
  console.log(`   History     : http://localhost:${PORT}/history`);
  console.log(`   Session log : http://localhost:${PORT}/session-log\n`);
});

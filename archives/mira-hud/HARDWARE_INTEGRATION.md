# MIRA Charlie HUD — Hardware Integration Guide

**Bench hardware:** Allen-Bradley PLC (PMC V1.0) · AutomationDirect GS-series VFD · PMC Station control box

---

## Overview

Once wired, the HUD left panel updates live every 500ms:
- `ESTOP: CLEAR` → `ESTOP: ENGAGED` (red) when the mushroom is pressed
- `SERVO: OFF` → `SERVO: ON` (green) when the drive is running
- `FAULT: NONE` → `FAULT: F<code>` (red) on VFD or PLC fault
- Pressing the physical **green START button** on the PMC Station advances the HUD to the next step — no mouse required

The server emits a `hardwareUpdate` Socket.IO event every 500ms to all connected clients (desktop + phone/glasses simultaneously).

---

## Step 1 — Install Dependencies

The hardware libraries are **not installed by default** (they require compiled native modules).
Only install when you are ready to connect physical hardware.

```bash
cd ~/Documents/GitHub/MIRA/mira-hud
npm install ethernet-ip jsmodbus
```

- `ethernet-ip` — EtherNet/IP driver for Allen-Bradley PLCs
- `jsmodbus` — Modbus TCP/RTU client for AutomationDirect VFD

---

## Step 2 — Network Setup

Ensure all devices are on the same subnet as CHARLIE (192.168.1.x):

| Device | Protocol | IP Address | Port |
|--------|----------|-----------|------|
| Allen-Bradley PLC (PMC V1.0) | EtherNet/IP | 192.168.1.100 | 44818 |
| AutomationDirect GS-series VFD | Modbus TCP | 192.168.1.101 | 502 |
| CHARLIE node (HUD server) | — | 192.168.1.12 | 3000 |

> Verify PLC and VFD IP addresses on their front panels or in your network switch. Update `PLC_IP` and `VFD_IP` constants in `server.js` to match.

---

## Device 1 — Allen-Bradley PLC (EtherNet/IP)

### What we read

| PLC Tag | Data Type | Maps to HUD |
|---------|-----------|------------|
| `Local:0:I.Data.0` | BOOL | E-STOP input — `hwState.estop` |
| `Local:0:I.Data.1` | BOOL | START button — triggers `step('next')` on rising edge |
| `Local:0:I.Data.2` | BOOL | RUN status — `hwState.run` |
| `Local:0:I.Data.3` | BOOL | FAULT output — `hwState.fault` |
| `Local:0:I.Data.4` | BOOL | FWD selector bit (0=REV, 1=FWD) — `hwState.direction` |

> **Confirm tag names** in Connected Components Workbench or Studio 5000 before using. The tag names above are default I/O aliases for a Micro820. Your project may use named tags like `ESTOP_IN`, `START_BTN`, `RUN_STATUS`, `VFD_FAULT`.

### Code snippet (paste into `server.js` hardware section)

```js
const { Controller, Tag } = require('ethernet-ip');

const PLC_IP = '192.168.1.100';
const plc = new Controller();

const tagEStop    = new Tag('Local:0:I.Data.0');
const tagStart    = new Tag('Local:0:I.Data.1');
const tagRun      = new Tag('Local:0:I.Data.2');
const tagFault    = new Tag('Local:0:I.Data.3');
const tagFwdBit   = new Tag('Local:0:I.Data.4');

let prevStart = false; // rising edge detection

async function connectPLC() {
  try {
    await plc.connect(PLC_IP);
    plc.subscribe(tagEStop);
    plc.subscribe(tagStart);
    plc.subscribe(tagRun);
    plc.subscribe(tagFault);
    plc.subscribe(tagFwdBit);
    console.log('[PLC] connected:', PLC_IP);
  } catch (err) {
    console.warn('[PLC] connection failed:', err.message);
  }
}

async function pollPLC() {
  if (!plc.established) return;
  try {
    await plc.readTag(tagEStop);
    await plc.readTag(tagStart);
    await plc.readTag(tagRun);
    await plc.readTag(tagFault);
    await plc.readTag(tagFwdBit);

    hwState.estop  = !!tagEStop.value;
    hwState.run    = !!tagRun.value;
    hwState.fault  = hwState.fault || !!tagFault.value; // VFD fault takes precedence, OR with PLC fault

    const startNow = !!tagStart.value;
    if (startNow && !prevStart) {
      // Rising edge — advance HUD step
      const total = PROCEDURES[activeProcedure].length;
      if (currentStep < total - 1) {
        currentStep++;
        io.emit('stepUpdate', { active: activeProcedure, steps: PROCEDURES[activeProcedure], currentStep });
      }
    }
    prevStart = startNow;

    const fwd = !!tagFwdBit.value;
    hwState.direction = hwState.run ? (fwd ? 'FWD' : 'REV') : 'OFF';

  } catch (err) {
    console.warn('[PLC] poll error:', err.message);
  }
}

connectPLC();
```

---

## Device 2 — AutomationDirect GS-series VFD (Modbus TCP)

### Register map

| Register | Address | Scale | Maps to HUD |
|----------|---------|-------|------------|
| Holding Register 100 | `0x0064` | ÷10 = Hz | `hwState.vfd_hz` (output frequency) |
| Holding Register 101 | `0x0065` | ÷10 = A | output current (informational) |
| Holding Register 102 | `0x0066` | raw | `hwState.vfd_fault_code` |
| Coil 0 | `0x0000` | bool | `hwState.run` (motor running) |
| Coil 1 | `0x0001` | bool | motor stop status |
| Coil 2 | `0x0002` | bool | `hwState.fault` (drive fault) |

> Register addresses follow the cluster Modbus map (CLUSTER.md). Verify against your specific GS drive manual — GS2/GS4/GS20 series may differ by one address offset.

### Code snippet (paste into `server.js` hardware section)

```js
const Modbus = require('jsmodbus');
const net    = require('net');

const VFD_IP   = '192.168.1.101';
const VFD_PORT = 502;

let vfdClient = null;
let vfdSocket = null;

function connectVFD() {
  vfdSocket = new net.Socket();
  vfdClient = new Modbus.client.TCP(vfdSocket, 1); // unit ID 1

  vfdSocket.connect({ host: VFD_IP, port: VFD_PORT }, () => {
    console.log('[VFD] connected:', VFD_IP);
  });

  vfdSocket.on('error', (err) => {
    console.warn('[VFD] socket error:', err.message);
    setTimeout(connectVFD, 5000); // reconnect after 5s
  });

  vfdSocket.on('close', () => {
    console.warn('[VFD] disconnected — reconnecting in 5s');
    setTimeout(connectVFD, 5000);
  });
}

async function pollVFD() {
  if (!vfdClient || !vfdSocket || vfdSocket.destroyed) return;
  try {
    // Read coils 0–2 (run, stop, fault)
    const coilResp = await vfdClient.readCoils(0, 3);
    hwState.run   = coilResp.response.body.valuesAsArray[0];
    hwState.fault = coilResp.response.body.valuesAsArray[2];

    // Read holding registers 100–102
    const hrResp = await vfdClient.readHoldingRegisters(100, 3);
    const regs = hrResp.response.body.valuesAsArray;
    hwState.vfd_hz         = regs[0] / 10;  // e.g. 600 → 60.0 Hz
    hwState.vfd_fault_code = regs[2];

  } catch (err) {
    console.warn('[VFD] poll error:', err.message);
  }
}

connectVFD();
```

---

## Device 3 — PMC Station Control Box

The PMC Station I/O runs through the Allen-Bradley PLC digital I/O. All buttons and LEDs are wired to PLC input/output cards.

### I/O Map

| Physical Device | PLC Tag | Type | HUD Effect |
|----------------|---------|------|------------|
| Red mushroom E-STOP | `Local:0:I.Data.0` | DI | `ESTOP: ENGAGED` (red) in left panel |
| Green START button | `Local:0:I.Data.1` | DI | Rising edge → advances HUD to next step |
| FWD/OFF/REV selector (FWD position) | `Local:0:I.Data.4` | DI | `direction: 'FWD'` in `hardwareUpdate` |
| Yellow LED | `Local:0:O.Data.0` | DO | (read-only from HUD — reflects PLC output) |
| White LED | `Local:0:O.Data.1` | DO | (read-only from HUD) |
| Green LED | `Local:0:O.Data.2` | DO | (read-only from HUD) |
| Blue LED | `Local:0:O.Data.3` | DO | (read-only from HUD) |
| Red LED | `Local:0:O.Data.4` | DO | (read-only from HUD) |

> The HUD is **read-only** — it does not write to PLC outputs. LEDs are driven by the PLC ladder logic, not by the HUD server.

---

## Step 3 — Uncomment the Polling Loop in `server.js`

Find the hardware polling section in `server.js` and uncomment the poll calls:

```js
// Before (stub):
setInterval(() => {
  // await pollPLC();
  // await pollVFD();
  io.emit('hardwareUpdate', hwState);
}, 500);

// After (live):
setInterval(async () => {
  await pollPLC();
  await pollVFD();
  io.emit('hardwareUpdate', hwState);
}, 500);
```

Also call `connectPLC()` and `connectVFD()` at startup (already in the snippets above).

---

## Full `hwState` Object

```js
const hwState = {
  estop:         false,  // E-STOP pressed (true = ENGAGED = danger)
  run:           false,  // Drive/motor currently running
  fault:         false,  // Any active fault (PLC or VFD)
  direction:     'OFF',  // 'FWD' | 'REV' | 'OFF'
  vfd_hz:        0,      // VFD output frequency in Hz (e.g. 60.0)
  vfd_fault_code: 0,     // VFD fault register value (0 = no fault)
};
```

---

## HUD Left Panel — Live Behavior

Once `hardwareUpdate` events are flowing, the HUD left panel updates automatically:

| Condition | ESTOP display | SERVO display | FAULT display |
|-----------|--------------|---------------|---------------|
| Normal run | `CLEAR` (green) | `ON` (green) | `NONE` (green) |
| E-STOP pressed | `ENGAGED` (red) | `OFF` (amber) | `NONE` (green) |
| Drive fault | `CLEAR` (green) | `OFF` (amber) | `F<code>` (red) |
| E-STOP + fault | `ENGAGED` (red) | `OFF` (amber) | `F<code>` (red) |

---

## Testing Without Physical Hardware

You can test the `hardwareUpdate` path by temporarily injecting state from the server console. Add a test endpoint:

```js
// Temporary test route — remove before production
app.get('/hw-test', (req, res) => {
  hwState.estop          = !hwState.estop;
  hwState.fault          = hwState.estop;
  hwState.vfd_fault_code = hwState.fault ? 7 : 0;
  io.emit('hardwareUpdate', hwState);
  res.json(hwState);
});
```

Then toggle the E-STOP simulation: `curl http://localhost:3000/hw-test`
Each call flips ESTOP on/off and the HUD left panel updates within 500ms.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Cannot find module 'ethernet-ip'` | Not installed | `npm install ethernet-ip` |
| `[PLC] connection failed` | Wrong IP or PLC offline | Verify PLC IP on front panel; ping it first |
| `[VFD] socket error: ECONNREFUSED` | VFD Modbus TCP not enabled | Enable Modbus TCP in GS drive parameter P9.00 |
| ESTOP shows ENGAGED but button not pressed | Normally-closed wiring convention | Invert the bit: `hwState.estop = !tagEStop.value` |
| Step doesn't advance on START press | Rising edge not detected | Add `console.log` to confirm tag read is working |
| VFD Hz reads 10× too high | Scale factor off | Check GS drive parameter for frequency scaling |

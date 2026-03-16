# MIRA — Industrial AI Maintenance Assistant

## What This Is
Mira is a conversational industrial AI assistant for floor-level maintenance technicians.
Voice interface via Telegram. Visual HMI via Ignition Perspective.
Target: brownfield plants with Micro820 PLCs and GS10 VFDs.

## End-State Product Architecture
- Ignition Module (.modl) containing GSD engine, OCR pipeline, FSM logic
- Telegram bot as voice layer (system.net.httpClient from Ignition scripts)
- Ollama local models for AI inference (air-gap compatible)
- Ignition EtherNet/IP driver → Micro820 (replaces Modbus/Node-RED for product)
- Ignition Perspective for visual HMI dashboard
- Deployment tiers: cloud-connected / edge / air-gapped

## Current Status -- Last updated 2026-03-16

### COMPLETED
- Wiring guide documented
- PLC program v3.3 written and compiled (0 errors)
- MIRA monorepo created at github.com/Mikecranesync/MIRA
- All gists archived (read-only)
- Ignition HMI designed
- CCW variables loaded via populate_variables.py (59 variables)
- Model corrected: 2080-LC20-20QBB (QWB bug fixed)
- Program downloaded to PLC
- MODBUS TCP CONFIRMED LIVE at 169.254.32.93:502
- PLC scan running -- heartbeat toggling, uptime_seconds incrementing
- E-stop circuit verified healthy (NC closed, NO open)
- State machine running -- conv_state = 0 (IDLE)
- test_modbus.py passing all checks
- Ignition 8.1 Standard Edition (trial mode) installed on PLC laptop
- Ignition Perspective ConveyorMIRA project files committed: 4 views + tags.json (36 tags)

### NEXT STEPS (in order)
1. Phase 3: Create Modbus TCP device Micro820_Conveyor in Ignition (IP: 192.168.1.100 or 169.254.32.93, port 502)
2. Phase 5: Import ignition/tags/tags.json into Ignition tag provider
3. Phase 7: Copy ignition/project/ → Ignition data/projects/ConveyorMIRA/ and scan
4. Phase 8: Live test — ConveyorStatus view shows STOPPED, gauges 0.0, conn dot green
5. Program GS10 VFD keypad (P09.xx, P00.xx) -- clears fault_alarm
6. Verify vfd_comm_ok goes TRUE after VFD keypad programmed
7. Test selector FWD then RUN button for first motor run
8. Test E-stop drops ContactorQ1
9. Test selector REV run
10. MIRA Telegram integration live

### CONFIRMED NETWORK
- PLC Micro820: 169.254.32.93 (APIPA) -- try 192.168.1.100 as static (may be assigned)
- PLC Laptop: 192.168.1.10 / 169.254.100.1 (Ethernet), Tailscale: 100.72.2.99
- Modbus TCP port 502: OPEN
- Ignition gateway on PLC laptop: http://localhost:8088 (Standard trial)

### KNOWN ISSUE
- fault_alarm = TRUE -- VFD comm fault latched
- CAUSE: GS10 keypad not yet programmed for Modbus RTU
- FIX: Set P09.00=1, P09.01=96, P09.02=0, P09.03=5, P09.04=13, P00.21=2 on keypad
  (Note: corrected params per GS10_Integration_Guide.md -- old CLAUDE.md had GS1 params)

### IGNITION PROJECT
- Edition: Standard trial (resets every 2h, never bricks -- better than Maker for dev)
- Project name: ConveyorMIRA
- Device name (must match exactly): Micro820_Conveyor
- Protocol: Modbus TCP
- Files: ignition/project/ (4 views) + ignition/tags/tags.json (36 tags)

## Hardware
- PLC: Allen-Bradley Micro820 2080-LC20-20QBB (EtherNet/IP + Modbus TCP, port 502)
- Drive: AutomationDirect GS10 VFD (RS-485 Modbus RTU slave addr 1, 9600/8N2)
- Modbus Register Map: see Modbus_Register_Map.md

## Immediate Priorities (do in this order)
1. Program GS10 VFD keypad for Modbus RTU communication
2. First motor run test (FWD + REV)
3. Install node-red-contrib-modbus in mira-bridge, build live polling flow
4. Begin Ignition 8.1 install + EtherNet/IP connection to Micro820
5. Port gsd_engine.py FSM logic into Ignition Gateway scripts

## Go-to-Market
- Sell as Ignition module (.modl) — customers install in one click
- Three tiers: cloud ($299/mo), edge ($4,999 + $999/yr), air-gapped ($9,999 + $1,999/yr)
- Channel: Ignition certified integrator partners
- Competitive position: only conversational AI for floor technicians (not dashboards for managers)

## Technical Rules
- Modbus addresses are zero-indexed: register 400001 = address 0
- REAL (float) values span two consecutive registers
- Always show me diffs before deploying any code change
- Deploy via: SCP → docker cp → docker compose restart
- Check logs after every deploy: docker logs mira-bot-telegram --tail 20

## Key File Locations (Mac Mini)
- Project root: ~/Mira/
- Bot code: ~/Mira/mira-bots/telegram/gsd_engine.py
- Node-RED: http://localhost:1880
- Ollama: http://localhost:11434
- Bot container: mira-bot-telegram

## Milestones (in order)
1. v1.2.0 tagged, clean build, all debt closed
2. Live PLC data answering in Telegram
3. Mira runs inside Ignition, no Docker
4. First .modl at a customer site
5. 3 integrator partners certified

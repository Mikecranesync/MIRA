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

## Current Status -- Last updated 2026-03-15

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

### NEXT STEPS (in order)
1. Program GS10 VFD keypad (P09.xx, P00.xx, P01.xx) -- clears fault_alarm
2. Verify vfd_comm_ok goes TRUE after VFD keypad programmed
3. Test selector FWD then RUN button for first motor run
4. Test E-stop drops ContactorQ1
5. Test selector REV run
6. Assign static IP 192.168.1.100 to PLC (currently on 169.254.32.93 APIPA)
7. Update all config files with confirmed IP
8. Connect Node-RED mira-bridge to poll live PLC data
9. MIRA Telegram integration live

### CONFIRMED NETWORK
- PLC Micro820: 169.254.32.93 (APIPA -- assign static 192.168.1.100 after commissioning)
- PLC Laptop: 192.168.1.10 / 169.254.100.1 (Ethernet)
- Modbus TCP port 502: OPEN
- Tailscale PLC laptop: 100.72.2.99

### KNOWN ISSUE
- fault_alarm = TRUE -- VFD comm fault latched
- CAUSE: GS10 keypad not yet programmed for Modbus RTU
- FIX: Set P09.00=1, P09.01=1, P09.02=3, P09.03=0, P00.02=3, P00.04=2 on keypad

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

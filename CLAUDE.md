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
- MIRA monorepo created at github.com/Mikecranesync/MIRA
- All gists archived (read-only)
- Ignition HMI designed
- CCW variables loaded via populate_variables.py (59 variables)
- Model corrected: 2080-LC20-20QBB (QWB bug fixed)
- MODBUS TCP CONFIRMED LIVE at 169.254.32.93:502
- PLC scan running -- heartbeat toggling, uptime_seconds incrementing
- E-stop circuit verified healthy (NC closed, NO open)
- State machine running -- conv_state = 0 (IDLE)
- test_modbus.py passing all checks
- Ignition 8.1 Standard Edition (trial mode) installed on PLC laptop
- Ignition Perspective ConveyorMIRA project files committed: 4 views + tags.json (36 tags)
- GS10 root cause found: original code used GS1 register map (wrong drive model)
- GS10 registers corrected: cmd=0x2000, freq=0x2001, reset=0x2002, read=0x2103
- GS10 command bit-fields corrected: FWD+RUN=18, REV+RUN=20, STOP=1
- VFD fault reset MSG block added (writes 2 to reg 0x2002)
- VFD comm watchdog added (5s timeout sets fault_alarm)
- State machine deadlock fixed (IDLE now catches faults)
- MSG_MODBUS Channel fixed: 2→0 (built-in serial port per Rockwell docs)
- v5.0.0 program written with msg_step_timer (2s per-step timeout)
- VFD keypad set: P09.01=9.6, P09.04=12, P00.21=2
- vfd_diag.py + vfd_fix_attempts.py diagnostic scripts created
- Modbus TCP mapping updated with diagnostic variables
- 110Ω termination resistor installed on RS-485 bus

### NEXT STEPS (in order)
1. **RESOLVE CCW SERIAL PORT SYNC** -- this is the only blocker
   - CCW shows "embedded serial in the project and controller are out of sync"
   - TCPIPObject download fails, interrupting serial port config transfer
   - Try USB cable for download (avoids TCP failure)
   - After download: Serial Port → Diagnose must show "in sync"
2. Run `python plc/vfd_diag.py` -- expect vfd_comm_ok=TRUE, ErrorID != 255
3. If comm fails with ErrorID=55 (timeout): swap D+/D- wires
4. If CE2 on VFD: toggle P09.04 between 12 (8N1) and 13 (8N2)
5. First motor run test (FWD + REV)
6. Connect Ignition Modbus TCP device to PLC
7. Import tags + deploy ConveyorMIRA Perspective views
8. MIRA Telegram integration live

### CONFIRMED NETWORK
- PLC Micro820: 169.254.32.93 (APIPA, static set in CCW project)
- PLC Laptop: 192.168.1.10 / 169.254.100.1 (Ethernet), Tailscale: 100.72.2.99
- Modbus TCP port 502: OPEN
- Ignition gateway on PLC laptop: http://localhost:8088 (Standard trial)

### KNOWN ISSUE
- BLOCKER: CCW "embedded serial in the project and controller are out of sync"
- TCPIPObject download fails during project download, interrupting serial port config
- Serial port Modbus RTU driver NEVER reaches PLC -- RS-485 UART does not transmit
- mb_read_status.ErrorID=255 confirms MSG blocks never complete a real transaction
- Program v5.0.0 is correct (Channel=0, GS10 registers, COP blocks) -- code is NOT the issue
- FIX NEEDED: Successful full CCW download where serial config syncs. Try USB if Ethernet fails.

### IGNITION PROJECT
- Edition: Standard trial (resets every 2h, never bricks -- better than Maker for dev)
- Project name: ConveyorMIRA
- Device name (must match exactly): Micro820_Conveyor
- Protocol: Modbus TCP
- Files: ignition/project/ (4 views) + ignition/tags/tags.json (36 tags)

## Hardware
- PLC: Allen-Bradley Micro820 2080-LC20-20QBB (EtherNet/IP + Modbus TCP, port 502)
- Drive: AutomationDirect GS10 VFD (RS-485 Modbus RTU slave addr 1, 9600/8N2)
- Modbus Register Map: see plc/GS10_Integration_Guide.md (authoritative)
- PLC Program: v5.0.0 in CCW Prog2.stf (Channel=0, GS10 correct, msg_step_timer)
- VFD Diagnostic: plc/vfd_diag.py (reads all Modbus TCP mapped variables, shows comm status)

## Immediate Priorities (do in this order)
1. **RESOLVE CCW SERIAL PORT SYNC** -- try USB download
2. Run `python plc/vfd_diag.py` to confirm vfd_comm_ok=TRUE
3. First motor run test (FWD + REV)
4. Connect Ignition to live PLC data
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

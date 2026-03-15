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

## Current State
- mira-bot-telegram: Python Docker container on Mac Mini (bravonode:100.86.236.11)
- GSD engine: mira-bots/telegram/gsd_engine.py (FSM with OCR, ELECTRICAL_PRINT state)
- Models running on Mac Mini via Ollama: mira (4.7GB), qwen2.5vl (5.0GB), glm-ocr (2.2GB), nomic-embed-text (0.3GB)
- Node-RED mira-bridge: running but NO Modbus nodes installed — all equipment data is seed data, not live
- NO live PLC connection yet — this is the #1 priority

## Hardware
- PLC: Allen-Bradley Micro820 (EtherNet/IP + Modbus TCP, port 502)
- Drive: AutomationDirect GS10 VFD (data comes through Micro820)
- Modbus Register Map: [PASTE CCW EXPORT HERE — this is required before any PLC work]

## Immediate Priorities (do in this order)
1. Fix technical debt: deploy.sh (add glm-ocr), init_db.sql (add voice_enabled column), tts.py stub, commit v1.2.0
2. Install node-red-contrib-modbus in mira-bridge, build live polling flow → equipment_status SQLite
3. Install node-red-mcp-server so Claude can deploy Node-RED flows directly
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

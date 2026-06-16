# FactoryLM / Mira HMI Co-Pilot

Mira is an AI-powered co-pilot for industrial automation. It connects to Allen-Bradley Micro 820 PLCs via Modbus TCP, reads real-time machine data (motor status, conveyor state, VFD faults, e-stop conditions), and enables natural-language diagnostics — so a factory technician can text their plant and get instant, context-aware answers about what's happening on the floor.

## Setup

See `INSTALL.md` for full setup instructions.

Before running, copy `.env.example` to `.env` and fill in your API keys:

```bash
cp .env.example .env
```

## Project Structure

- `Controller/` — CCW project for the Micro 820 PLC (2080-LC20-20QBB)
- `MIRA/` — MIRA controller variant
- `MIRA_PLC.ccwsln` — Connected Components Workbench solution file

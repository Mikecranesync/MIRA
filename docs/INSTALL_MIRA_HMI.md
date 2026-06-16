# MIRA HMI Co-Pilot — Installation Guide

Step-by-step installation for maintenance engineers. No Python knowledge required.

---

## Prerequisites

| Requirement | Version | Check |
|------------|---------|-------|
| Ignition Gateway | 8.1+ | `http://localhost:8088` loads |
| Web Dev Module | Installed | Gateway > Config > Modules > Web Dev |
| Python | 3.12+ | `python --version` in terminal |
| uv (Python tool) | Latest | `uv --version` in terminal |
| NSSM (Windows) | Latest | `nssm version` in terminal |

**Install uv:** Open terminal, run `pip install uv`

**Install NSSM:** Download from https://nssm.cc/download — unzip, add to PATH

---

## Step 1: Install the RAG Sidecar

The sidecar handles document search and AI responses. It runs on the same machine as Ignition.

### Windows

```powershell
cd C:\path\to\MIRA\mira-sidecar

# Install dependencies
uv sync

# Test it works (Ctrl+C to stop)
uv run uvicorn app:app --host 127.0.0.1 --port 5000

# Open browser: http://localhost:5000/status — should show {"status": "ok"}
```

Once verified, install as a Windows service:

```powershell
cd service
install_service_windows.bat
```

The sidecar will now start automatically on boot.

### Linux

```bash
cd /path/to/MIRA/mira-sidecar
uv sync
sudo ./service/install_service_linux.sh
```

---

## Step 2: Configure Properties

Create the configuration file:

**Windows:** `C:\Program Files\Inductive Automation\Ignition\data\factorylm\factorylm.properties`

**Linux:** `/usr/local/bin/ignition/data/factorylm/factorylm.properties`

Copy from the template:

```powershell
# Windows
mkdir "C:\Program Files\Inductive Automation\Ignition\data\factorylm"
copy ignition\config\factorylm.properties.template "C:\Program Files\Inductive Automation\Ignition\data\factorylm\factorylm.properties"
```

Edit the file and set at minimum:

```properties
# Choose your AI provider: openai, anthropic, or ollama
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-your-key-here

# Or for local AI (no internet needed):
# LLM_PROVIDER=ollama
# EMBEDDING_PROVIDER=ollama
```

---

## Step 3: Create Database Tables

1. Open Ignition Designer
2. Go to **Database > Query Browser**
3. Open `ignition/db/schema.sql` from the MIRA repo
4. Copy the SQL and execute it
5. Verify: `SELECT COUNT(*) FROM mira_fsm_models` should return 0

---

## Step 4: Deploy to Ignition

Run the deployment script from the MIRA repo root:

```powershell
PowerShell -ExecutionPolicy Bypass -File ignition\deploy_ignition.ps1
```

This will:
- Copy Perspective views (including Mira views)
- Import tags (Conveyor + Mira_Monitored + Mira_Alerts)
- Verify the gateway and sidecar

---

## Step 5: Configure Gateway Scripts

These must be added manually in Ignition Designer:

### Tag Change Script (FSM Monitor)

1. Designer > **Gateway Event Scripts** > **Tag Change Scripts**
2. Add new script
3. **Tag Path:** `[default]Mira_Monitored/*/State`
4. Paste contents of `ignition/gateway-scripts/tag-change-fsm-monitor.py`

### Timer Script: Stuck State Checker

1. Designer > **Gateway Event Scripts** > **Timer Scripts**
2. Add new timer: **Rate = 10000** (10 seconds)
3. Paste contents of `ignition/gateway-scripts/timer-stuck-state.py`

### Timer Script: FSM Builder

1. Designer > **Gateway Event Scripts** > **Timer Scripts**
2. Add new timer: **Rate = 3600000** (1 hour)
3. Paste contents of `ignition/gateway-scripts/timer-fsm-builder.py`

---

## Step 6: Upload Documents

1. Open Perspective: `http://localhost:8088/data/perspective/client/ConveyorMIRA`
2. Navigate to **MIRA AI** > **Settings** (or go to `/Mira/MiraSettings`)
3. Upload maintenance manuals, SOPs, or equipment documentation (PDF, DOCX, TXT)
4. Wait 30 seconds for ingestion

---

## Step 7: First Run

1. Navigate to **MIRA AI** in the NavBar
2. Or open directly: `http://localhost:8088/system/webdev/FactoryLM/mira?asset=conveyor_demo`
3. Ask a question: "What does VFD fault code OC mean?"
4. Verify the answer cites your uploaded documentation

---

## Verification Checklist

| Check | How | Expected |
|-------|-----|----------|
| Sidecar running | `http://localhost:5000/status` | `{"status": "ok"}` |
| Web Dev routes | `http://localhost:8088/system/webdev/FactoryLM/api/status` | JSON with gateway status |
| Chat UI loads | `http://localhost:8088/system/webdev/FactoryLM/mira` | Dark chat interface |
| Tags visible | Designer > Tags > Mira_Monitored | conveyor_demo folder with tags |
| Alert tags exist | Designer > Tags > Mira_Alerts | conveyor_demo/Latest |
| Chat works | Send a message in Mira chat | Response with source citations |
| Gateway scripts | Gateway > Status > Gateway Event Scripts | Scripts listed and active |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Sidecar won't start | Dependencies not installed | Run `uv sync` in mira-sidecar/ |
| "RAG sidecar unreachable" in chat | Sidecar not running | Check `nssm status MiraRAG` or `systemctl status mira-rag` |
| No chat response | API key not set | Edit factorylm.properties, set OPENAI_API_KEY or ANTHROPIC_API_KEY |
| Tags show Bad_NotFound | PLC not connected | Create device Micro820_Conveyor in Ignition (Modbus TCP) |
| Web Dev 404 | Web Dev module not installed | Gateway > Config > Modules > Install Web Dev |
| "No FSM model" in logs | Not enough cycles | Run equipment for 50+ cycles, then wait for hourly builder |
| Embedding dimension error | Changed embedding provider | Delete chroma_data/ and re-ingest documents |
| Properties file not found | Wrong path | Check path in factorylm.properties matches your Ignition install location |

---

## Adding New Equipment

To monitor a new piece of equipment with Mira:

1. **Create tags** in Designer under `[default]Mira_Monitored/{equipment_name}/`
   - Must include a `State` tag (integer: 0=idle, 1=running, etc.)
   - Add any sensor/motor tags you want Mira to see

2. **Create alert tag** under `[default]Mira_Alerts/{equipment_name}/Latest` (Memory tag, String type)

3. **Upload documentation** for the equipment via MiraSettings

4. **Run equipment** for 50+ normal cycles to build FSM baseline

5. Mira will automatically detect anomalies once the FSM model is built

---

## Architecture Overview

```
Ignition Gateway (Perspective + Web Dev + Gateway Scripts)
    ├── Perspective Views: MiraPanel, MiraSettings, MiraAlertHistory
    ├── Web Dev API: /api/chat, /api/alerts, /api/tags, /api/status, /api/ingest
    ├── Chat UI: /mira (HTML/CSS/JS)
    └── Gateway Scripts: FSM monitor, stuck state checker, FSM builder
         │
         │ localhost:5000 (internal HTTP)
         ▼
RAG Sidecar (Python)
    ├── /rag     → ChromaDB vector search + AI response
    ├── /ingest  → Document chunking + embedding
    ├── /build_fsm → FSM model from tag history
    └── /status  → Health check
```

All communication stays on localhost. No external network access required except for cloud AI providers (OpenAI/Anthropic). Use `LLM_PROVIDER=ollama` for fully air-gapped operation.

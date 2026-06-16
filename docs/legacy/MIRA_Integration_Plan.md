# MIRA — Remaining Integration Plan
## Claude Code Spec Pad for Mac Mini Bravo Node

---

## 1. Current State (as of 2026-03-11)

### Stack Topology
```
Equipment ─→ Node-RED (mira-bridge :1880) ─→ SQLite (mira.db)
                                                    │
                                              mira-mcp (:8000 SSE)
                                                    │
Telegram bot ─→ Open WebUI (mira-core :3000) ─→ Ollama (host :11434)
                                                    │
                                              qwen2.5:7b-instruct-q4_K_M
```

### Four Repos — All Containers Healthy
| Repo | Container | Port | Network | Status |
|------|-----------|------|---------|--------|
| mira-core | mira-core | 3000→8080 | core-net, bot-net | ✅ healthy |
| mira-bridge | mira-bridge | 1880 | core-net | ✅ healthy |
| mira-mcp | mira-mcp | 8000 (SSE) | core-net | ✅ healthy |
| mira-bots | mira-bot-telegram | — | bot-net | ✅ healthy |

### Known Bugs to Fix First
1. **Telegram /status silent drop** — `bot.py` uses `~filters.COMMAND`, so all slash commands are ignored. Need CommandHandler for `/status`.
2. **Port mismatch** — `OPENWEBUI_BASE_URL` defaults to `:8080` but mira-core maps `3000→8080`. Inside Docker network it should be `:8080` (container internal port), but the `.env.example` and compose default both say `:8080` which is actually correct for container-to-container. The bot just needs to be on `bot-net` where mira-core lives, which it already is.
3. **mira-mcp server.py** still says `transport="stdio"` on line 58 but Claude switched it to SSE in the running version. GitHub repo needs the SSE fix committed.
4. **mira-bots compose** still has `depends_on: mira-core` which can't cross compose-project boundaries. Claude removed it at runtime but repo needs the fix committed.

---

## 2. Phase 1 — Fix the Bugs (Do This First)

### Task 1A: Fix mira-bots/telegram/bot.py
```
In mira-bots repo, edit telegram/bot.py:

1. Add CommandHandler import:
   from telegram.ext import ApplicationBuilder, CommandHandler, MessageHandler, filters, ContextTypes

2. Add /status command handler function:
   async def status_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
       headers = {"Content-Type": "application/json"}
       if OPENWEBUI_API_KEY:
           headers["Authorization"] = f"Bearer {OPENWEBUI_API_KEY}"
       async with httpx.AsyncClient(timeout=120) as client:
           resp = await client.post(
               f"{OPENWEBUI_BASE_URL}/api/chat/completions",
               headers=headers,
               json={
                   "model": "mira",
                   "messages": [{"role": "user", "content": "Give a brief status summary of all monitored equipment"}],
               },
           )
           resp.raise_for_status()
           data = resp.json()
       reply = data["choices"][0]["message"]["content"]
       await update.message.reply_text(reply)

3. In main(), register the command handler BEFORE the catch-all:
   app.add_handler(CommandHandler("status", status_command))
   app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

4. Add a /help command:
   async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
       await update.message.reply_text(
           "MIRA Commands:\n"
           "/status — Equipment status summary\n"
           "/help — Show this help\n"
           "Or just type any maintenance question."
       )
   Register: app.add_handler(CommandHandler("help", help_command))
```

### Task 1B: Fix mira-bots/docker-compose.yml
```
In mira-bots repo, edit docker-compose.yml:

1. Remove the depends_on block entirely (can't cross compose-project boundaries)
2. Verify OPENWEBUI_BASE_URL default is http://mira-core:8080 (this is correct 
   for container-to-container since Open WebUI listens on 8080 internally)
```

### Task 1C: Fix mira-mcp/server.py transport
```
In mira-mcp repo, edit server.py:

1. Change the last line from:
   mcp.run(transport="stdio")
   To:
   mcp.run(transport="sse", host="0.0.0.0", port=8000)
```

### Task 1D: Commit & rebuild
```
After all file edits:
cd ~/mira-bots && docker compose up -d --build
cd ~/mira-mcp && docker compose up -d --build
Test: send /status and /help to Telegram bot
```

---

## 3. Phase 2 — Wire MCP Tools into Open WebUI

Open WebUI supports "Tool" functions that the model can call. This is how mira-mcp 
data gets into the LLM responses instead of hallucinated guesses.

### Task 2A: Create Open WebUI Tool functions
```
In Open WebUI admin panel (http://localhost:3000):

1. Go to Workspace → Tools → Create New Tool
2. Create a tool called "mira_equipment" with this Python:

   import httpx

   class Tools:
       def __init__(self):
           self.mcp_base = "http://mira-mcp:8000"

       async def get_equipment_status(self, equipment_id: str = "") -> str:
           """Get current status of equipment. Pass equipment_id to filter, or leave empty for all."""
           async with httpx.AsyncClient(timeout=30) as client:
               resp = await client.get(
                   f"{self.mcp_base}/tools/get_equipment_status",
                   params={"equipment_id": equipment_id}
               )
               return resp.text

       async def list_active_faults(self) -> str:
           """List all currently active equipment faults."""
           async with httpx.AsyncClient(timeout=30) as client:
               resp = await client.get(f"{self.mcp_base}/tools/list_active_faults")
               return resp.text

       async def get_fault_history(self, equipment_id: str = "", limit: int = 20) -> str:
           """Get fault history. Optionally filter by equipment_id."""
           async with httpx.AsyncClient(timeout=30) as client:
               resp = await client.get(
                   f"{self.mcp_base}/tools/get_fault_history",
                   params={"equipment_id": equipment_id, "limit": limit}
               )
               return resp.text

3. NOTE: The exact endpoint paths depend on how FastMCP exposes SSE tools.
   You may need to adapt the URLs to match FastMCP's SSE protocol.
   Alternative: use the MCP client SDK to talk SSE instead of raw HTTP.

4. Assign the tool to the "mira" model in Open WebUI model settings.
```

### Task 2B: Alternative — HTTP wrapper in mira-mcp
If Open WebUI tools can't easily speak MCP-SSE, add a simple REST layer to server.py:

```
In mira-mcp repo, edit server.py:

Add a FastAPI/Starlette REST wrapper alongside the MCP server:

from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route
import uvicorn

async def rest_equipment_status(request):
    eid = request.query_params.get("equipment_id", "")
    return JSONResponse(get_equipment_status(eid))

async def rest_active_faults(request):
    return JSONResponse(list_active_faults())

async def rest_fault_history(request):
    eid = request.query_params.get("equipment_id", "")
    limit = int(request.query_params.get("limit", 50))
    return JSONResponse(get_fault_history(eid, limit))

rest_app = Starlette(routes=[
    Route("/api/equipment", rest_equipment_status),
    Route("/api/faults/active", rest_active_faults),
    Route("/api/faults/history", rest_fault_history),
])

# Run REST on :8001, MCP SSE on :8000
# In Dockerfile, EXPOSE both ports
# In docker-compose.yml, map both ports
```

This gives Open WebUI tools a simple REST endpoint to call.

---

## 4. Phase 3 — Node-RED Flow Setup (mira-bridge)

Node-RED needs flows that:
1. Poll or subscribe to equipment data (OPC-UA, MQTT, or Modbus)
2. Write status + faults to SQLite (mira.db)

### Task 3A: Create SQLite schema
```
In Node-RED (http://localhost:1880), install node-red-node-sqlite.

Create an inject→sqlite flow that initializes the DB:

CREATE TABLE IF NOT EXISTS equipment_status (
    equipment_id TEXT PRIMARY KEY,
    name TEXT,
    status TEXT DEFAULT 'unknown',
    last_value REAL,
    unit TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS faults (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    equipment_id TEXT,
    fault_code TEXT,
    description TEXT,
    severity TEXT DEFAULT 'warning',
    resolved INTEGER DEFAULT 0,
    timestamp TEXT DEFAULT (datetime('now')),
    resolved_at TEXT
);
```

### Task 3B: Create test/demo data flow
```
Until real equipment is connected, create a Node-RED flow that:
1. Inject node (repeating every 60s)
2. Function node that generates simulated equipment readings:
   - 3 pieces of equipment: PUMP-001, COMP-002, CONV-003
   - Random status: running/warning/faulted/offline
   - Random values within realistic ranges
3. SQLite node that UPSERTs into equipment_status
4. Occasional fault injection (10% chance per cycle)

This lets you test the entire pipeline end-to-end without real PLCs.
```

### Task 3C: Wire real equipment (when ready)
```
For each protocol:
- OPC-UA: node-red-contrib-opcua → subscribe to tags → transform → SQLite
- MQTT: mqtt-in node → JSON parse → transform → SQLite  
- Modbus: node-red-contrib-modbus → read registers → transform → SQLite

The key principle: Node-RED is the ONLY thing that writes to mira.db.
Everything else reads from it.
```

---

## 5. Phase 4 — RAG Knowledge Base

### Task 4A: Upload equipment docs to Open WebUI
```
In Open WebUI (http://localhost:3000):
1. Go to Workspace → Knowledge → Create Collection
2. Name it "Equipment Manuals"
3. Upload PDFs: equipment manuals, maintenance SOPs, wiring diagrams
4. Assign the knowledge collection to the "mira" model

This gives MIRA instant access to manufacturer maintenance procedures
without retraining the model.
```

### Task 4B: Create deployment-specific docs
```
Create a text file with site-specific info:
- Equipment inventory with IDs matching the SQLite schema
- Maintenance schedules
- Alarm code lookup tables
- Escalation contacts

Upload to the knowledge base. MIRA will reference it automatically.
```

---

## 6. Phase 5 — Telegram Bot Enhancements

### Task 5A: Add structured commands
```
In mira-bots/telegram/bot.py, add these command handlers:

/faults — Call mira-mcp list_active_faults directly (REST endpoint) 
           and format as a clean Telegram message, bypassing the LLM.
           This gives instant, deterministic responses.

/history <equipment_id> — Call get_fault_history for a specific unit.

/equip <equipment_id> — Call get_equipment_status for a specific unit.

For these commands, call the mira-mcp REST API directly from the bot
instead of going through Open WebUI. Faster and deterministic.
```

### Task 5B: Add alert forwarding
```
In Node-RED, create a flow that:
1. Watches for new critical faults in SQLite
2. Sends a Telegram alert via the Bot API directly
   (use node-red-contrib-telegrambot or HTTP POST to Telegram API)
3. Includes: equipment ID, fault code, description, timestamp

This gives you push notifications for critical alarms without polling.
Requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in mira-bridge .env.
```

---

## 7. Non-Negotiables Checklist

- [ ] No cloud services — everything runs on Mac Mini
- [ ] No TensorFlow, LangChain, or n8n
- [ ] Apache 2.0 or MIT licenses only (verify: FastMCP=MIT ✅, Open WebUI=MIT ✅, 
      Node-RED=Apache-2.0 ✅, python-telegram-bot=LGPL-3.0 ⚠️ check compatibility)
- [ ] RAG via Open WebUI knowledge base only — no fine-tuning
- [ ] Equipment-agnostic — only .env and knowledge docs change per deployment
- [ ] 16GB RAM ceiling respected — monitor with: docker stats
- [ ] One container per service, restart: unless-stopped, healthchecks on all
- [ ] Two networks: core-net (internal), bot-net (bot↔core relay)
- [ ] Ollama on HOST (not Docker) for Metal GPU acceleration
- [ ] OLLAMA_KEEP_ALIVE=-1 (model stays loaded in memory)

---

## 8. Execution Order for Claude Code

```
Phase 1 → Fix bugs (Tasks 1A-1D)         ← DO THIS NOW
Phase 2 → Wire MCP into Open WebUI       ← Next session
Phase 3 → Node-RED flows + SQLite schema  ← Next session  
Phase 4 → RAG knowledge base             ← Manual (upload PDFs)
Phase 5 → Bot enhancements + alerts      ← After Phase 3 proves out
```

Each phase is independent enough to test before moving to the next.
Always `docker stats` after each phase to verify RAM stays under 12GB 
(leaving 4GB headroom for macOS + Ollama).

---

## 9. Environment Variables Reference

### mira-core/.env
```
WEBUI_PORT=3000
WEBUI_AUTH=false
ENABLE_SIGNUP=false
```

### mira-bridge/.env
```
NODERED_PORT=1880
TZ=America/New_York
MIRA_DB_PATH=./data
```

### mira-mcp/.env
```
MIRA_DB_PATH=../mira-bridge/data
```

### mira-bots/.env
```
TELEGRAM_BOT_TOKEN=<your-token>
OPENWEBUI_BASE_URL=http://mira-core:8080
OPENWEBUI_API_KEY=<from Open WebUI admin>
```

---

## 10. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     MAC MINI (HOST)                          │
│                                                              │
│  Ollama (Metal GPU) ──────────────────────────────────┐      │
│  qwen2.5:7b-instruct-q4_K_M                          │      │
│  :11434                                               │      │
│                                                       │      │
│  ┌─── core-net ───────────────────────────────────┐   │      │
│  │                                                │   │      │
│  │  mira-bridge    mira-mcp     mira-core    ◄────┘      │
│  │  (Node-RED)     (FastMCP)    (Open WebUI)             │
│  │  :1880          :8000 SSE    :3000→8080               │
│  │     │              │              │                    │
│  │     └──► mira.db ◄─┘              │                    │
│  │          (SQLite)                  │                    │
│  └────────────────────────────────────┼──────────────┘    │
│                                       │                    │
│  ┌─── bot-net ────────────────────────┼──────────────┐    │
│  │                                    │              │    │
│  │  mira-bot-telegram ────────────────┘              │    │
│  │  (python-telegram-bot, polling)                   │    │
│  │                                                   │    │
│  └───────────────────────────────────────────────────┘    │
│                                                            │
└────────────────────────────────────────────────────────────┘
         │
         ▼
   Telegram Cloud → Technician's Phone
```

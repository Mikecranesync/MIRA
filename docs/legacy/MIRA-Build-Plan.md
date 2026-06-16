# MIRA Full Build Plan
## Elegant, Simple, Phase-by-Phase Implementation
**Version:** 1.0  
**Date:** March 12, 2026  
**Purpose:** Complete build sequence from zero to production-ready MIRA deployment

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────┐
│                    Mac Mini M4 (16GB Unified RAM)               │
│                                                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐          │
│  │ mira-core   │  │ mira-bridge  │  │ mira-bots   │          │
│  │ Open WebUI  │  │ Node-RED     │  │ Telegram    │          │
│  │ port 3000   │  │ port 1880    │  │ (relay)     │          │
│  └─────────────┘  └──────────────┘  └─────────────┘          │
│                                                                 │
│  ┌─────────────┐  ┌──────────────┐                            │
│  │ mira-docs   │  │ Ollama HOST  │                            │
│  │ Qdrant      │  │ (not Docker) │                            │
│  │ Embeddings  │  │ Metal GPU    │                            │
│  └─────────────┘  └──────────────┘                            │
│                                                                 │
│  Models in RAM:                                                 │
│  - qwen2.5vl:7b (5GB)                                          │
│  - nomic-embed-multimodal-7b (4GB)                             │
│  Headroom: ~7GB                                                 │
└────────────────────────────────────────────────────────────────┘
```

---

## Phase 0 — Foundation (Host Setup)

### What This Does
Sets up the Mac Mini M4 host with Ollama and base models. This is the only phase that touches the host directly — everything else is containerized.

### Prerequisites
- Mac Mini M4 with 16GB unified RAM
- 2TB external SSD mounted and formatted (APFS)
- macOS Sequoia or later
- Internet connection for initial model downloads
- Homebrew installed

### Claude Code Prompt

```
I have a Mac Mini M4 with 16GB unified RAM and a 2TB external SSD.

Step 1: Install Ollama on the host (NOT in Docker) so it can use Metal GPU acceleration.
Download from ollama.com and install using the official macOS installer.

Step 2: Set Ollama to keep models in memory permanently by adding this to my shell profile:
export OLLAMA_KEEP_ALIVE=-1

Step 3: Pull three models that will run simultaneously within 16GB:
ollama pull qwen2.5:7b-instruct-q4_K_M
ollama pull qwen2.5vl:7b
ollama pull nomic-embed-text

Step 4: Verify all models are downloaded and Ollama is responding:
ollama list
curl http://localhost:11434/api/tags

Step 5: Create a base project directory structure on the external SSD:
/Volumes/MIRA/
├── mira-core/
├── mira-bridge/
├── mira-bots/
├── mira-docs/
└── knowledge_base/
    ├── global/
    ├── sme_base/
    └── customer/

Step 6: Install Docker Desktop for Mac and configure it to store containers on the external SSD instead of the boot drive.

Confirm all steps work before proceeding. Show me verification commands to test each step.
```

### Success Criteria
- [ ] Ollama running on host at `localhost:11434`
- [ ] Three models downloaded and listed in `ollama list`
- [ ] Project directory structure created on external SSD
- [ ] Docker Desktop installed and running

---

## Phase 1 — Core Intelligence (mira-core)

### What This Does
Deploys Open WebUI as the AI brain. This is where all conversational AI happens. It talks to Ollama on the host and manages the knowledge base.

### Claude Code Prompt

```
I need to build the mira-core repository. This is the AI brain of MIRA.

Use Open WebUI (the open-source project, not a custom build). It should:

1. Run in a single Docker container named "mira-core"
2. Connect to Ollama on the host machine at host.docker.internal:11434
3. Expose port 3000 for the web UI
4. Mount the knowledge base folder from my external SSD at /Volumes/MIRA/knowledge_base/ to /app/backend/data inside the container
5. Use a Docker network called "core-net" that other services will join
6. Have a healthcheck that pings the /health endpoint every 30 seconds
7. Restart automatically if it crashes (restart: unless-stopped)
8. Store its database (user accounts, chat history) in a named volume called mira-core-data

Create these files in /Volumes/MIRA/mira-core/:
- docker-compose.yml (the main service definition)
- .env (environment variables including OLLAMA_BASE_URL=http://host.docker.internal:11434)
- README.md (how to start/stop the service and verify it's working)

After you generate the files, give me the exact commands to:
- Start mira-core for the first time
- Check that it's healthy
- Access the web UI
- Create an admin account
- Test a simple chat query that goes to Ollama

Make sure Open WebUI is configured to automatically discover all models from Ollama.
```

### Success Criteria
- [ ] Open WebUI accessible at `http://localhost:3000`
- [ ] Admin account created
- [ ] Can chat with `qwen2.5:7b-instruct-q4_K_M` model
- [ ] Knowledge base folder mounted and visible in UI
- [ ] Container auto-restarts and passes healthcheck

---

## Phase 2 — Vision Capability (mira-core upgrade)

### What This Does
Adds the vision model to Open WebUI so it can understand photos sent by technicians.

### Claude Code Prompt

```
Now I need to add vision capability to mira-core so technicians can send photos and get intelligent responses.

I already have qwen2.5vl:7b pulled on the host via Ollama.

Step 1: Verify Open WebUI can see the vision model.
Log into the web UI, go to Settings → Models, and confirm qwen2.5vl:7b appears in the available models list.

Step 2: Create a test procedure in the README.md:
- How to upload an image in the Open WebUI chat interface
- How to send a text prompt with the image like "what equipment do you see in this photo?"
- Expected behavior: the model should describe what it sees

Step 3: Add a system prompt template specifically for maintenance image analysis.
This should be a Modelfile in the mira-core repo that creates a custom model called "mira-vision" that wraps qwen2.5vl:7b with this system prompt:

"You are MIRA, an industrial maintenance AI assistant analyzing equipment photos. When you see an image, identify: component type, manufacturer if visible, model number if visible, any visible faults (wear, damage, discoloration, misalignment), safety hazards, and recommended actions. Be specific and technical."

Step 4: Update the README with instructions on how to:
- Create the custom mira-vision model from the Modelfile
- Select it in the Open WebUI interface
- Test it with a photo

Show me all files and commands needed.
```

### Success Criteria
- [ ] Vision model `qwen2.5vl:7b` visible in Open WebUI
- [ ] Can upload image + text prompt and get response
- [ ] Custom `mira-vision` model created with maintenance prompt
- [ ] Test image analyzed correctly (component identification)

---

## Phase 3 — Bot Interface (mira-bots)

### What This Does
Creates the Telegram bot that technicians actually interact with. It's a pure relay — zero AI logic, just forwards messages to mira-core and sends responses back.

### Claude Code Prompt

```
I need to build mira-bots, which is a Telegram relay bot that lets technicians chat with MIRA from their phones.

This bot should:

1. Be written in Python using the python-telegram-bot library
2. Run in a single Docker container named "mira-bots"
3. Connect to Open WebUI's API at http://mira-core:3000/api/chat
4. Join the "core-net" and "bot-net" Docker networks
5. Have these handlers:
   - Text message handler: forwards text to Open WebUI, sends response back to Telegram
   - Photo handler (photo alone): downloads photo, encodes to base64, sends to Open WebUI with default prompt "Analyze this equipment photo for maintenance issues"
   - Photo with caption handler: downloads photo, sends with the user's caption as the prompt
6. Use environment variables for:
   - TELEGRAM_BOT_TOKEN (from BotFather)
   - OPENWEBUI_API_URL (http://mira-core:3000/api/chat)
   - OPENWEBUI_API_KEY (generated in Open WebUI)
   - VISION_MODEL (qwen2.5vl:7b)
   - TEXT_MODEL (qwen2.5:7b-instruct-q4_K_M)
7. Restart automatically if it crashes
8. Have a healthcheck (simple /healthz endpoint or status ping)
9. Wait for mira-core to be healthy before starting (depends_on with service_healthy condition)

Create these files in /Volumes/MIRA/mira-bots/:
- bot.py (main bot script)
- requirements.txt (Python dependencies)
- Dockerfile (builds the Python container)
- docker-compose.yml (service definition)
- .env.example (template for environment variables)
- README.md (setup instructions)

The bot should log every message exchange at INFO level so I can debug issues.

After you generate the files, give me:
- How to create a Telegram bot via BotFather
- How to get the API key from Open WebUI
- How to fill in the .env file
- How to start mira-bots
- How to test it (send text, send photo, send photo with caption)

Make sure all dependencies are MIT or Apache 2.0 licensed.
```

### Success Criteria
- [ ] Telegram bot created via BotFather
- [ ] API key generated in Open WebUI
- [ ] `mira-bots` container running and healthy
- [ ] Can send text message → receive AI response
- [ ] Can send photo → receive vision analysis
- [ ] Can send photo with caption → receive contextual analysis
- [ ] All message exchanges logged

---

## Phase 4 — Equipment Bridge (mira-bridge)

### What This Does
Connects factory equipment (PLCs, sensors, HMIs) to MIRA via Node-RED. Reads fault codes, sensor data, and equipment status — writes them to SQLite for MIRA to query.

### Claude Code Prompt

```
I need to build mira-bridge, which connects factory equipment to MIRA using Node-RED.

This service should:

1. Run Node-RED in a Docker container named "mira-bridge"
2. Expose port 1880 for the Node-RED UI
3. Join the "core-net" Docker network
4. Have these pre-installed Node-RED nodes:
   - node-red-contrib-opcua (for PLCs)
   - node-red-contrib-modbus (for older equipment)
   - node-red-contrib-mqtt-broker (for IoT sensors)
5. Mount a persistent SQLite database at /data/mira.db with this schema:
   - equipment table: id, tag, type, location, status
   - faults table: id, equipment_id, fault_code, timestamp, description, resolved
   - sensor_data table: id, equipment_id, parameter, value, timestamp
6. Restart automatically if it crashes
7. Have a healthcheck (ping the /admin endpoint)
8. Store Node-RED flows in a persistent volume called mira-bridge-flows

Create these files in /Volumes/MIRA/mira-bridge/:
- docker-compose.yml (Node-RED service + networks)
- init.sql (SQLite schema creation script)
- .env.example (template for equipment connection settings)
- README.md (setup instructions)

Include in the README:
- How to access Node-RED at localhost:1880
- How to import a sample flow that reads a fake PLC tag and writes to SQLite
- How to verify data is being written to mira.db
- Security note: this service is not exposed to the internet, only to core-net

All dependencies must be MIT or Apache 2.0.
```

### Success Criteria
- [ ] Node-RED accessible at `http://localhost:1880`
- [ ] SQLite database created with correct schema
- [ ] Sample flow created and deployed
- [ ] Can query `mira.db` and see test data
- [ ] Container auto-restarts and passes healthcheck

---

## Phase 5 — Document Intelligence (mira-docs)

### What This Does
The multimodal RAG engine. Ingests PDFs (manuals, schematics), embeds text and images, stores them in Qdrant, and makes them searchable by photo or text query.

### Claude Code Prompt

```
I need to build mira-docs, the multimodal RAG system that makes all equipment manuals searchable by photo or text.

This is a new repo with two parts:
1. A Qdrant vector database (Docker container)
2. A Python ingestion and retrieval pipeline

Here's what I need:

Part 1 — Qdrant Container:
- Run Qdrant in a Docker container named "mira-qdrant"
- Expose port 6333 for the API
- Join "core-net" network
- Store vectors in a persistent volume called mira-qdrant-data
- Restart automatically
- Healthcheck pings /health

Part 2 — Python Pipeline:
Create a Python package called "mira_docs" with these modules:

ingest.py:
- Accepts a folder of PDF files
- Uses PyMuPDF (fitz) to extract:
  - Each page as a 200 DPI image (PNG)
  - All text with section boundaries (not fixed chunks)
- Embeds both images and text using nomic-embed-multimodal-7b via Ollama's embedding API
- Stores in Qdrant with metadata:
  - source_file (filename)
  - page_number
  - content_type (image or text)
  - component_type (extracted via keyword matching: motor, relay, VFD, PLC, etc.)
  - manufacturer (extracted if found in text)

retrieve.py:
- search(query, top_k=5) function
- Accepts text string OR base64 image
- Embeds the query using the same nomic model
- Searches Qdrant for nearest neighbors
- Returns results with:
  - Original page image
  - Text snippet
  - Metadata
  - Similarity score

api.py:
- FastAPI server that exposes:
  - POST /ingest (accepts PDF upload, starts ingestion)
  - POST /search (accepts {query: "text" or "image_b64", top_k: 5})
  - GET /health
- Runs in its own Docker container named "mira-docs-api"
- Joins "core-net"
- Exposes port 8001

Create these files in /Volumes/MIRA/mira-docs/:
- mira_docs/ingest.py
- mira_docs/retrieve.py
- mira_docs/api.py
- requirements.txt
- Dockerfile (for the API)
- docker-compose.yml (Qdrant + API services)
- .env.example
- README.md (usage instructions)

In the README, include:
- How to start Qdrant and the API
- How to ingest a sample PDF (provide a curl command)
- How to search by text (curl command)
- How to search by image (curl command with base64 encoded image)
- How to verify vectors are stored in Qdrant (check via UI at localhost:6333/dashboard)

Use only Apache 2.0 or MIT licensed dependencies.
```

### Success Criteria
- [ ] Qdrant running at `http://localhost:6333`
- [ ] API running at `http://localhost:8001`
- [ ] Can ingest a test PDF (e.g., a VFD manual)
- [ ] Can search by text and get relevant page images back
- [ ] Can search by photo and get similar images + text from manuals
- [ ] Qdrant dashboard shows vectors stored correctly

---

## Phase 6 — Integration (Wire Everything Together)

### What This Does
Connects all five services so they talk to each other. Photos from Telegram → embedded in mira-docs → retrieved with context → sent to Ollama → response back to tech.

### Claude Code Prompt

```
Now I need to wire all five services together into one cohesive system.

Step 1: Update mira-bots to call mira-docs before calling mira-core.
When a photo is received:
1. Forward photo to mira-docs /search endpoint (as base64 image)
2. Get back top 5 similar manual pages/images
3. Bundle those as context in the prompt to Open WebUI
4. Send combined context + photo to mira-core
5. Return response to Telegram

Step 2: Create a master docker-compose.yml at /Volumes/MIRA/ that orchestrates all services with proper dependency order:
1. Qdrant starts first
2. mira-docs-api starts after Qdrant is healthy
3. mira-core starts (connects to Ollama on host)
4. mira-bridge starts
5. mira-bots starts last, depends on mira-core and mira-docs-api both being healthy

Step 3: Create a unified .env file at /Volumes/MIRA/.env that all services read from using env_file in docker-compose.yml.

Step 4: Add a startup script at /Volumes/MIRA/start.sh that:
- Verifies Ollama is running on the host
- Verifies all required models are pulled
- Starts all containers in the right order
- Waits for healthchecks to pass
- Prints status of each service
- Opens the Open WebUI in the default browser

Step 5: Add a stop script at /Volumes/MIRA/stop.sh that gracefully shuts down all containers.

Step 6: Update the root README.md with:
- Complete architecture diagram (all services, ports, networks)
- Quick start (run ./start.sh)
- How to verify everything is working
- Troubleshooting section (common issues and fixes)
- How to add a new PDF manual to the knowledge base
- How to test the full flow: send photo via Telegram → get response with manual reference

Make sure the master docker-compose.yml uses:
- Two networks: core-net (mira-core, mira-docs, mira-bridge) and bot-net (mira-bots)
- Proper healthchecks on all services
- All services set to restart: unless-stopped
- Clear service names and container names
- Resource limits (optional but recommended to stay under 16GB total)
```

### Success Criteria
- [ ] Master docker-compose.yml starts all services in correct order
- [ ] All healthchecks pass
- [ ] `./start.sh` runs successfully
- [ ] Can send photo via Telegram → get response with manual reference
- [ ] Logs show full pipeline: Telegram → mira-docs search → mira-core → Ollama → response
- [ ] `./stop.sh` gracefully stops everything

---

## Phase 7 — Knowledge Base Bootstrap (SME Content)

### What This Does
Populates the knowledge base with foundational maintenance intelligence so MIRA is smart from Day 1, even with zero customer manuals.

### Claude Code Prompt

```
I need to build a knowledge base scraper and ingestion tool that populates MIRA with expert-level maintenance knowledge.

Create a new utility at /Volumes/MIRA/scripts/bootstrap_knowledge.py that:

Step 1: Scrapes Wikipedia articles (text only, no images) for these topics:
- AC motor
- DC motor
- Relay (electrical)
- Contactor
- Variable-frequency drive
- Programmable logic controller
- Bearing (mechanical)
- Circuit breaker
- Pneumatic actuator
- Hydraulic cylinder

Save each as a markdown file in /Volumes/MIRA/knowledge_base/sme_base/wikipedia/

Step 2: Downloads manufacturer application notes (PDFs) from these sources:
- ABB motor starter guides (publicly available on abb.com)
- Siemens contactor selection guides
- Allen-Bradley PowerFlex quick reference cards
- Schneider Electric Altivar parameter guides

Save to /Volumes/MIRA/knowledge_base/sme_base/manufacturer_guides/

Step 3: Extracts YouTube captions from these industrial maintenance channels:
- Provide a list of 10 top industrial maintenance YouTube channels
- Use yt-dlp to download captions as plain text
- Parse into Q&A format where possible (question in video title, answer in transcript)

Save to /Volumes/MIRA/knowledge_base/sme_base/youtube/

Step 4: For each piece of content, extract metadata:
- source (Wikipedia, manufacturer, YouTube)
- topic (motor, relay, VFD, etc.)
- component_type
- document_type (reference, troubleshooting, installation, etc.)

Step 5: Ingest all content into mira-docs:
- Text files are chunked at section boundaries and embedded
- PDFs are processed page-by-page (text + images)
- All vectors stored in Qdrant with metadata

Create these files at /Volumes/MIRA/scripts/:
- bootstrap_knowledge.py (main script)
- requirements.txt (dependencies: yt-dlp, requests, beautifulsoup4, PyPDF2)
- config.yaml (URLs and settings)
- README.md (how to run it)

In the README:
- Estimated runtime (this will take hours, runs overnight)
- How to resume if interrupted
- How to verify content was ingested (Qdrant vector count)
- Legal note: all scraped content is publicly available, used under fair use for local, non-commercial maintenance assistance

Run this script AFTER Phase 6 is complete so mira-docs is ready to receive the content.

Only use MIT or Apache 2.0 dependencies.
```

### Success Criteria
- [ ] Script runs without errors
- [ ] Wikipedia articles saved as markdown
- [ ] Manufacturer PDFs downloaded
- [ ] YouTube captions extracted
- [ ] All content ingested into Qdrant
- [ ] Can query "what causes motor bearing failure?" → get relevant answer from scraped content
- [ ] Qdrant vector count > 5,000

---

## Phase 8 — Customer Deployment Package

### What This Does
Packages everything into a deployment-ready system with documentation, configuration templates, and onboarding procedures.

### Claude Code Prompt

```
I need to create a customer deployment package so I can deploy MIRA at a new factory in under 2 hours.

Create these files at /Volumes/MIRA/deployment/:

1. deploy.sh:
   - Interactive script that asks:
     - Customer name
     - Site location
     - Equipment list (tags and types)
     - Telegram bot token (or skip for now)
     - MARA opt-in (yes/no, default no)
   - Generates a custom .env from a template
   - Copies customer-specific .env to /Volumes/MIRA/.env
   - Creates customer folder at /knowledge_base/customer/{customer_name}/
   - Runs ./start.sh
   - Prints next steps (upload manuals, test bot, train lead tech)

2. onboarding_guide.md:
   - For the lead technician at the customer site
   - Explains what MIRA is (in simple terms, no jargon)
   - How to add MIRA to Telegram
   - How to ask questions (text and photo examples)
   - What MIRA knows (base layer) and doesn't know yet (their equipment until manuals are added)
   - How to upload a PDF manual (drag and drop in Open WebUI)
   - How their usage makes MIRA smarter over time
   - FAQ section

3. admin_guide.md:
   - For me (the installer)
   - Pre-deployment checklist (Mac Mini setup, network config, Ollama models)
   - Installation steps (run deploy.sh)
   - Post-deployment verification (all healthchecks pass, test queries work)
   - How to add equipment to mira-bridge (Node-RED flow example)
   - How to check logs if something breaks
   - How to update models (pull new Ollama model, restart services)
   - How to backup the system (which folders/databases to copy)

4. customer_agreement.md:
   - MARA data sharing agreement template
   - Explains what data is shared (anonymized fault records)
   - Explains what is NOT shared (customer name, site location, serial numbers, raw photos)
   - Opt-in checkbox
   - Signature block

5. troubleshooting.md:
   - Common issues and fixes:
     - "Bot doesn't respond" → check mira-core logs, verify API key
     - "Vision doesn't work" → verify qwen2.5vl model loaded
     - "Manuals not searchable" → verify mira-docs ingestion completed
     - "Out of memory" → check model sizes, verify OLLAMA_KEEP_ALIVE setting
     - "Ollama not reachable from containers" → verify host.docker.internal resolves
   - How to read logs from each service
   - How to restart a single service without restarting all

Update the root /Volumes/MIRA/README.md with:
- Link to deployment package
- Customer deployment workflow
- Support contact (me)

Make all documents clear, professional, and suitable for showing to a factory maintenance manager.
```

### Success Criteria
- [ ] deploy.sh runs interactively and generates working config
- [ ] onboarding_guide.md is clear and non-technical
- [ ] admin_guide.md covers all installation and maintenance scenarios
- [ ] troubleshooting.md has actionable fixes
- [ ] Can execute a full mock deployment in under 2 hours

---

## Phase 9 — MARA Global Sync (Optional, Future)

### What This Does
Enables opt-in global knowledge sharing across all MIRA deployments. Each site pushes anonymized fault records to a central MARA server and pulls knowledge packs compiled from all participating sites.

### Claude Code Prompt

```
This is a future phase. I want to design it now so the architecture supports it, but I won't build it until I have 3+ paying customers.

I need:

1. A simple MARA server design:
   - FastAPI server hosted on a VPS (not on customer premises)
   - POST /contribute endpoint (receives anonymized fault records)
   - GET /knowledge-pack/latest endpoint (serves a versioned ZIP of compiled knowledge)
   - SQLite database to store contributed records
   - Script that compiles records into markdown files weekly
   - Script that packages markdown files into a versioned knowledge pack

2. A MARA client module added to mira-docs:
   - Runs nightly (cron job or scheduled task)
   - Reads new fault records from mira.db (mira-bridge)
   - Strips PII: customer_name, site_name, serial_number, GPS, IP, operator_name
   - Keeps: component_type, fault_code, symptom, diagnosis, fix, resolution_time
   - Hashes each record (SHA256) to prevent duplicates
   - POSTs to MARA server (only if MARA_ENABLED=true in .env)

3. A knowledge pack puller added to the startup script:
   - On startup, check MARA server for new knowledge pack
   - If newer version available, download and extract to /knowledge_base/global/
   - Ingest into Qdrant (mira-docs handles this automatically)

Create these files at /Volumes/MIRA/mara/:
- server.py (FastAPI server code)
- client.py (push and pull logic)
- docker-compose.yml (for deploying MARA server on a VPS)
- README.md (explains the design, when to deploy it, privacy guarantees)

In the README, include:
- Why MARA is opt-in only
- What data is never shared (customer identifiers, raw photos)
- What data is shared (anonymized fault patterns)
- How knowledge packs benefit all participants
- Cost estimate for hosting MARA (VPS requirements)

Do NOT build this yet. Just design it so I can review the architecture and confirm it aligns with MIRA's privacy and offline-first principles.
```

### Success Criteria
- [ ] MARA design reviewed and approved
- [ ] Architecture allows MARA to be added without modifying existing MIRA services
- [ ] Privacy guarantees clearly documented
- [ ] Cost to host MARA estimated (should be <$20/month for 10 deployments)

---

## Phase 10 — Production Hardening

### What This Does
Secures and optimizes MIRA for production use. Adds authentication, logging, monitoring, backups, and update procedures.

### Claude Code Prompt

```
I need to harden MIRA for production deployments at customer sites.

Step 1: Add authentication to Open WebUI.
- Configure Open WebUI to require login (disable public access)
- Create a default admin account on first run
- Add instructions in admin_guide.md for creating technician accounts
- Each tech gets their own account (tracks who asked what)

Step 2: Add centralized logging.
- All containers log to a shared folder: /Volumes/MIRA/logs/
- Each service gets its own log file: mira-core.log, mira-bots.log, etc.
- Logs rotate daily, keep 30 days
- Add a log viewer script: tail -f /Volumes/MIRA/logs/*.log

Step 3: Add a monitoring dashboard.
- Create a simple HTML dashboard at /Volumes/MIRA/dashboard/index.html
- Shows status of each service (up/down, last healthcheck)
- Shows model RAM usage (query Ollama API)
- Shows Qdrant vector count
- Shows last 10 Telegram messages (timestamp + user + status)
- Refreshes every 10 seconds
- Accessible at http://localhost:3001 (run in a simple Python HTTP server container)

Step 4: Add backup script at /Volumes/MIRA/backup.sh:
- Backs up these critical items:
  - mira.db (equipment and fault data)
  - Qdrant vectors (export or copy volume)
  - Open WebUI database
  - .env file (config)
  - /knowledge_base/customer/ folder (manuals)
- Creates timestamped ZIP file
- Stores in /Volumes/MIRA/backups/
- Runs weekly via cron
- Instructions for restoring from backup

Step 5: Add update script at /Volumes/MIRA/update.sh:
- Checks for updates to:
  - Open WebUI Docker image
  - Ollama models (newer quantizations)
  - mira-docs code (from GitHub if I make this open source later)
- Prompts user before updating anything
- Backs up before updating
- Restarts affected services

Step 6: Add resource monitoring:
- Script that checks if RAM usage is approaching 16GB
- Warns if any model needs to be downsized
- Suggests which model to replace with smaller quantization

Update the admin_guide.md with:
- How to check service status via dashboard
- How to read logs when troubleshooting
- Backup and restore procedures
- Update procedures
- When to downsize models (if RAM is constrained)

All production hardening should be transparent to the end user (technicians). They should not notice any difference except improved reliability.
```

### Success Criteria
- [ ] Open WebUI requires login
- [ ] All services logging to centralized folder
- [ ] Monitoring dashboard shows real-time status
- [ ] Backup script runs successfully and creates valid ZIP
- [ ] Restore from backup tested and working
- [ ] Update script tested with Open WebUI image update
- [ ] RAM monitoring alerts if approaching 16GB

---

## Summary: Build Order and Timeline

| Phase | What It Builds | Estimated Time | Blocker |
|---|---|---|---|
| 0 | Host setup (Ollama, models, folders) | 2 hours | None |
| 1 | mira-core (Open WebUI) | 1 hour | Phase 0 |
| 2 | Vision (qwen2.5vl) | 30 minutes | Phase 1 |
| 3 | mira-bots (Telegram) | 2 hours | Phase 1 |
| 4 | mira-bridge (Node-RED) | 1 hour | Phase 0 |
| 5 | mira-docs (Qdrant + RAG) | 3 hours | Phase 0 |
| 6 | Integration (wire all services) | 2 hours | Phases 1-5 |
| 7 | Knowledge bootstrap (SME content) | 8 hours (overnight) | Phase 6 |
| 8 | Deployment package | 2 hours | Phase 6 |
| 9 | MARA design (not built yet) | 1 hour (design only) | Phase 6 |
| 10 | Production hardening | 3 hours | Phase 6 |

**Total active build time:** ~25 hours  
**Overnight processing:** ~8 hours (knowledge ingestion)  
**Calendar time:** 3-4 days if working full-time

---

## Next Steps

1. Review this full build plan
2. Confirm the architecture aligns with your vision
3. Start with Phase 0 (foundation)
4. Execute phases sequentially (each depends on previous phases)
5. Test thoroughly at each phase before moving to next
6. After Phase 8, you have a deployable product

## Success Definition

MIRA is production-ready when:
- [ ] A tech can send a photo of a component via Telegram and get back: component ID, relevant manual page, and troubleshooting guidance
- [ ] All services auto-restart and recover from failures
- [ ] System runs stable for 7 days with no manual intervention
- [ ] Knowledge base contains 100+ manufacturer manuals
- [ ] Response time is under 5 seconds for text queries, under 10 seconds for image queries
- [ ] RAM usage stays under 14GB peak with all models loaded
- [ ] You can deploy at a new customer site in under 2 hours using the deployment package

---

*End of MIRA Full Build Plan*

Ready to execute. Start with Phase 0.
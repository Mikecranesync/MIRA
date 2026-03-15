# MIRA — Administrator Guide

**For the person deploying and maintaining MIRA at a customer site**

---

## Pre-Deployment Checklist

Before arriving at the customer site, confirm:

- [ ] Mac Mini M4 (16GB RAM minimum) available and powered on
- [ ] 2TB external SSD formatted (APFS) and connected
- [ ] Internet access for initial setup (model downloads, repo cloning)
- [ ] Telegram bot created via [@BotFather](https://t.me/BotFather) — token ready
- [ ] Customer name, site location, and initial equipment list collected
- [ ] This guide and onboarding_guide.md printed or accessible offline

---

## Installation

### Option A: Fresh install (run deploy.sh)

```bash
# Clone the MIRA repos
git clone git@github.com:Mikecranesync/mira-core.git
git clone git@github.com:Mikecranesync/mira-bridge.git
git clone git@github.com:Mikecranesync/mira-bots.git
git clone git@github.com:Mikecranesync/mira-mcp.git

# Run the deployment script
bash deployment/deploy.sh
```

The script handles: Ollama model pulls, Docker network creation, database initialization, service startup, and health verification.

### Option B: Manual install

If deploy.sh fails or you need more control:

```bash
# 1. Install Ollama (if not already installed)
# Download from https://ollama.com — use the macOS installer
# Then set keep-alive:
echo 'export OLLAMA_KEEP_ALIVE=-1' >> ~/.zshrc
source ~/.zshrc

# 2. Pull models
ollama pull qwen2.5:7b-instruct-q4_K_M
ollama pull qwen2.5vl:7b
ollama pull nomic-embed-text
ollama create mira -f mira-core/Modelfile

# 3. Create Docker networks
docker network create core-net
docker network create bot-net

# 4. Initialize database
sqlite3 mira-bridge/data/mira.db < mira-bridge/data/init_db.sql

# 5. Set up environment files
# Copy .env.example to .env in each repo and fill in values
cp mira-core/.env.example mira-core/.env
cp mira-bridge/.env.example mira-bridge/.env
cp mira-bots/.env.example mira-bots/.env
cp mira-mcp/.env.example mira-mcp/.env

# 6. Start services (order matters)
cd mira-core && docker compose up -d && cd ..
cd mira-bridge && docker compose up -d && cd ..
cd mira-mcp && docker compose up -d && cd ..
cd mira-bots && docker compose up -d && cd ..
```

---

## Post-Deployment Verification

Run these checks after deployment:

```bash
# All containers running?
docker ps --format "table {{.Names}}\t{{.Status}}" --filter "name=mira"

# Expected: 4-5 containers, all "Up" with "(healthy)"

# Ollama responding?
curl -s http://localhost:11434/api/tags | python3 -m json.tool

# Open WebUI responding?
curl -sf http://localhost:3000/health && echo "OK"

# MCP proxy responding?
curl -sf http://localhost:8000/docs && echo "OK"

# Database has tables?
sqlite3 mira-bridge/data/mira.db ".tables"
# Expected: conversation_state  equipment_status  faults  maintenance_notes

# Database has seed data?
sqlite3 mira-bridge/data/mira.db "SELECT count(*) FROM equipment_status;"
# Expected: 4 (demo equipment)
```

### First-Time Open WebUI Setup

1. Open http://localhost:3000
2. Create an admin account (first user becomes admin)
3. Go to **Admin Panel > Settings > Models**
4. Verify `mira:latest` and `qwen2.5vl:7b` appear
5. Go to **Workspace > Knowledge**
6. Verify the MIRA Industrial KB collection exists (or create it)
7. Register MCP tools — follow `mira-core/docs/register-tools.md`
8. Set tool calling mode to **Default Mode** (not Native)

### Telegram Bot Test

1. Open Telegram on your phone
2. Search for your bot and send: `hello`
3. MIRA should respond with a diagnostic question
4. Send: `/equipment` — should return equipment status
5. Send: `/faults` — should return active faults
6. Send a photo of any equipment — should identify it and ask a question

---

## Adding Equipment

Equipment data lives in SQLite (`mira-bridge/data/mira.db`).

### Add via SQL

```bash
sqlite3 mira-bridge/data/mira.db << 'EOF'
INSERT INTO equipment_status (equipment_id, name, status, speed_rpm, temperature_c, current_amps, pressure_psi)
VALUES ('VFD-001', 'Main Drive VFD', 'running', 1750, 42.5, 12.3, NULL);
EOF
```

### Add via Node-RED

1. Open http://localhost:1880
2. Create a flow that reads from your equipment source (OPC-UA, Modbus, MQTT)
3. Write the data to SQLite using the node-red-contrib-sqlite node
4. Deploy the flow

---

## Managing the Knowledge Base

### Upload manuals

1. Open http://localhost:3000
2. Go to **Workspace > Knowledge > MIRA Industrial KB**
3. Click **Upload** and select PDF files
4. Wait for ingestion to complete (watch the progress indicator)

### Recommended document types

| Priority | Document Type | Why |
|----------|--------------|-----|
| High | Fault code reference cards | Lets MIRA identify specific errors |
| High | Wiring diagrams | Helps with electrical troubleshooting |
| Medium | Operation manuals | General equipment knowledge |
| Medium | Maintenance schedules | Preventive maintenance guidance |
| Low | Safety data sheets | Referenced during safety alerts |

### Knowledge base best practices

- Upload one document at a time and verify it appears in the collection
- Use descriptive filenames: `Allen-Bradley-Micro820-Quick-Reference.pdf` not `manual.pdf`
- PDFs with searchable text work better than scanned images
- Maximum recommended collection size: 100 documents (RAM constraint)

---

## Checking Logs

```bash
# Telegram bot logs (most common to check)
docker logs mira-bot-telegram --tail 50

# Follow logs in real time
docker logs mira-bot-telegram -f

# Open WebUI logs
docker logs mira-core --tail 50

# MCP proxy logs
docker logs mira-mcpo --tail 50

# Node-RED logs
docker logs mira-bridge --tail 50

# All MIRA logs at once
docker logs mira-core --tail 10 && \
docker logs mira-mcpo --tail 10 && \
docker logs mira-bridge --tail 10 && \
docker logs mira-bot-telegram --tail 10
```

---

## Restarting Services

### Restart a single service

```bash
# Restart just the Telegram bot
cd mira-bots && docker compose restart

# Restart just Open WebUI
cd mira-core && docker compose restart
```

### Restart everything

```bash
# Stop all (graceful)
cd mira-bots && docker compose down && cd ..
cd mira-mcp && docker compose down && cd ..
cd mira-bridge && docker compose down && cd ..
cd mira-core && docker compose down && cd ..

# Start all (in order)
cd mira-core && docker compose up -d && cd ..
cd mira-bridge && docker compose up -d && cd ..
cd mira-mcp && docker compose up -d && cd ..
cd mira-bots && docker compose up -d && cd ..
```

### Restart Ollama

```bash
# If Ollama becomes unresponsive
pkill ollama
ollama serve &

# Verify models are loaded
ollama list
```

---

## Updating

### Update Ollama models

```bash
# Pull latest version of a model
ollama pull qwen2.5:7b-instruct-q4_K_M

# Rebuild the MIRA custom model
ollama create mira -f mira-core/Modelfile

# Verify
ollama list
```

### Update MIRA code

```bash
# Pull latest from GitHub (do one repo at a time)
cd mira-bots && git pull origin main && docker compose up -d --build && cd ..
cd mira-core && git pull origin main && docker compose up -d --build && cd ..
cd mira-bridge && git pull origin main && docker compose up -d --build && cd ..
cd mira-mcp && git pull origin main && docker compose up -d --build && cd ..
```

### Update Open WebUI image

```bash
cd mira-core
docker compose pull
docker compose up -d
```

---

## Backup

### What to back up

| Item | Path | Priority |
|------|------|----------|
| Equipment database | `mira-bridge/data/mira.db` | Critical |
| Open WebUI data | Docker volume `open-webui-data` | Critical |
| Environment configs | `.env` in each repo | Critical |
| Knowledge base docs | `knowledge_base/customer/` | High |
| Node-RED flows | Docker volume `node-red-data` | Medium |

### Manual backup

```bash
BACKUP_DIR="$HOME/mira-backups/$(date +%Y-%m-%d)"
mkdir -p "$BACKUP_DIR"

# Database
cp mira-bridge/data/mira.db "$BACKUP_DIR/"

# Open WebUI data
docker cp mira-core:/app/backend/data "$BACKUP_DIR/webui-data"

# Environment files
for repo in mira-core mira-bridge mira-bots mira-mcp; do
    cp "$repo/.env" "$BACKUP_DIR/${repo}.env" 2>/dev/null || true
done

# Knowledge base
cp -r knowledge_base/customer/ "$BACKUP_DIR/customer-kb/" 2>/dev/null || true

# Node-RED flows
docker cp mira-bridge:/data/flows.json "$BACKUP_DIR/" 2>/dev/null || true

echo "Backup saved to $BACKUP_DIR"
ls -lh "$BACKUP_DIR"
```

### Restore from backup

```bash
BACKUP_DIR="$HOME/mira-backups/2026-03-14"  # adjust date

# Stop services first
cd mira-bots && docker compose down && cd ..
cd mira-mcp && docker compose down && cd ..
cd mira-bridge && docker compose down && cd ..
cd mira-core && docker compose down && cd ..

# Restore database
cp "$BACKUP_DIR/mira.db" mira-bridge/data/mira.db

# Restore environment files
for repo in mira-core mira-bridge mira-bots mira-mcp; do
    cp "$BACKUP_DIR/${repo}.env" "$repo/.env" 2>/dev/null || true
done

# Restart services
cd mira-core && docker compose up -d && cd ..
cd mira-bridge && docker compose up -d && cd ..
cd mira-mcp && docker compose up -d && cd ..
cd mira-bots && docker compose up -d && cd ..
```

---

## RAM Monitoring

The Mac Mini has 16GB unified RAM. MIRA uses approximately 10GB for models.

```bash
# Check Ollama model memory usage
curl -s http://localhost:11434/api/ps | python3 -m json.tool

# Check Docker container memory
docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}" --filter "name=mira"

# Check total system memory
vm_stat | head -5
```

### If RAM is tight

1. Remove unused models: `ollama rm mistral:7b` (if present)
2. Use the staging model (3B instead of 7B): `ollama create mira -f mira-core/Modelfile.staging`
3. Reduce Open WebUI cache: set `WEBUI_CACHE_SIZE=256MB` in mira-core/.env

---

## Security Notes

- Open WebUI requires authentication (signup is disabled by default)
- The Telegram bot only responds to message types it has handlers for
- SQLite database is file-permission protected by the OS
- All network traffic stays on the local machine (localhost + Docker networks)
- No ports are exposed to the internet unless you explicitly configure a reverse proxy
- Doppler manages secrets — never commit tokens to git

---

*MIRA Administrator Guide — keep this document accessible at every deployment site*

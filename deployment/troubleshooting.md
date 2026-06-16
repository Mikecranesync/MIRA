<<<<<<< Updated upstream
# MIRA — Troubleshooting Guide

---

## Quick Diagnosis

Run this first to see the state of everything:

```bash
# Container health
docker ps --format "table {{.Names}}\t{{.Status}}" --filter "name=mira"

# Ollama health
curl -sf http://localhost:11434/api/tags > /dev/null && echo "Ollama: OK" || echo "Ollama: DOWN"

# Open WebUI health
curl -sf http://localhost:3000/health > /dev/null && echo "WebUI: OK" || echo "WebUI: DOWN"

# Database health
sqlite3 mira-bridge/data/mira.db "SELECT count(*) FROM equipment_status;" 2>/dev/null && echo "DB: OK" || echo "DB: ERROR"
```

---

## Common Issues

### Bot doesn't respond to Telegram messages

**Symptoms:** You send a message in Telegram but get no reply.

**Check:**
```bash
# Is the bot container running?
docker ps --filter "name=mira-bot"

# Check bot logs for errors
docker logs mira-bot-telegram --tail 30

# Is Open WebUI reachable from the bot?
docker exec mira-bot-telegram python3 -c "
import urllib.request
r = urllib.request.urlopen('http://mira-core:8080/health')
print(r.status)
"
```

**Common causes:**
1. **Bot container crashed** — Restart: `cd mira-bots && docker compose up -d`
2. **Invalid Telegram token** — Check token in .env or Doppler. Recreate via @BotFather if needed.
3. **Open WebUI unreachable** — Check mira-core container health. May need restart.
4. **API key expired** — Regenerate in Open WebUI Admin > Settings > API Keys.

---

### Vision (photo analysis) doesn't work

**Symptoms:** You send a photo but MIRA doesn't describe what it sees, or returns a generic text response.

**Check:**
```bash
# Is the vision model loaded?
ollama list | grep qwen2.5vl

# Is it currently in memory?
curl -s http://localhost:11434/api/ps | python3 -m json.tool

# Check bot logs for vision errors
docker logs mira-bot-telegram --tail 30 | grep -i "vision\|photo\|image"
```

**Common causes:**
1. **Vision model not pulled** — Run: `ollama pull qwen2.5vl:7b`
2. **Model evicted from RAM** — Check RAM usage. May need to remove unused models.
3. **VISION_MODEL env var wrong** — Should be `qwen2.5vl:7b` in mira-bots .env.

---

### Equipment commands return empty or error

**Symptoms:** `/equipment` or `/faults` commands return nothing or an error message.

**Check:**
```bash
# Is the MCP server running?
docker ps --filter "name=mira-mcp"

# Can we reach the REST API?
curl -s http://localhost:8001/api/equipment | python3 -m json.tool

# Does the database have data?
sqlite3 mira-bridge/data/mira.db "SELECT * FROM equipment_status;"
sqlite3 mira-bridge/data/mira.db "SELECT * FROM faults WHERE resolved = 0;"
```

**Common causes:**
1. **MCP container down** — Restart: `cd mira-mcp && docker compose up -d`
2. **Database empty** — Rebuild: `sqlite3 mira-bridge/data/mira.db < mira-bridge/data/init_db.sql`
3. **Database file permissions** — Ensure the mira-mcp container has read access to mira.db.

---

### "Out of memory" or system becomes slow

**Symptoms:** Mac Mini becomes unresponsive, containers crash, or Ollama stops responding.

**Check:**
```bash
# System memory
vm_stat | head -5

# Ollama model memory usage
curl -s http://localhost:11434/api/ps | python3 -m json.tool

# Docker memory usage
docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}" --filter "name=mira"
```

**Fixes:**
1. **Remove unused models:**
   ```bash
   ollama rm mistral:7b
   ollama rm llama3.1:8b
   ```
2. **Switch to smaller model:**
   ```bash
   ollama create mira -f mira-core/Modelfile.staging  # Uses 3B instead of 7B
   ```
3. **Restart Ollama** to clear memory:
   ```bash
   pkill ollama && ollama serve &
   ```

---

### Ollama not reachable from containers

**Symptoms:** Bot or Open WebUI can't connect to Ollama. Errors about `host.docker.internal`.

**Check:**
```bash
# Is Ollama running on the host?
curl -sf http://localhost:11434/api/tags > /dev/null && echo "OK" || echo "DOWN"

# Can containers resolve host.docker.internal?
docker exec mira-core ping -c 1 host.docker.internal
```

**Fixes:**
1. **Ollama not running** — Start it: `ollama serve &`
2. **Docker Desktop DNS issue** — Restart Docker Desktop. On older macOS, you may need to add `host.docker.internal` to `/etc/hosts` pointing to `host-gateway`.

---

### Knowledge base returns irrelevant answers

**Symptoms:** MIRA's answers don't reference uploaded manuals, or references are wrong.

**Check:**
1. Open http://localhost:3000
2. Go to **Workspace > Knowledge**
3. Verify documents appear in the MIRA Industrial KB collection
4. Check that the `KNOWLEDGE_COLLECTION_ID` in mira-bots .env matches the collection ID

**Fixes:**
1. **Documents not ingested** — Re-upload the PDFs. Watch for ingestion errors in the UI.
2. **Wrong collection ID** — Copy the correct ID from Open WebUI and update .env.
3. **Tool calling mode wrong** — In Open WebUI Admin > Settings, set tool calling to **Default Mode** (not Native).
4. **Document too large** — Split large PDFs into chapters before uploading.

---

### GSD engine stuck in a state

**Symptoms:** MIRA keeps asking the same question or doesn't advance the conversation.

**Check:**
```bash
# View conversation state
sqlite3 mira-bridge/data/mira.db "SELECT chat_id, state, exchange_count, updated_at FROM conversation_state;"
```

**Fixes:**
1. **Tell the user to send `/reset`** — This clears the conversation state for their chat.
2. **Manual reset:**
   ```bash
   sqlite3 mira-bridge/data/mira.db "DELETE FROM conversation_state WHERE chat_id = 'CHAT_ID_HERE';"
   ```
3. **Reset all conversations:**
   ```bash
   sqlite3 mira-bridge/data/mira.db "DELETE FROM conversation_state;"
   ```

---

### Container won't start after update

**Symptoms:** `docker compose up -d` fails with build or dependency errors.

**Check:**
```bash
# View full error output
cd mira-bots && docker compose up --build 2>&1 | tail -30
```

**Fixes:**
1. **Stale image cache** — Rebuild without cache:
   ```bash
   docker compose build --no-cache
   docker compose up -d
   ```
2. **Network doesn't exist** — Recreate:
   ```bash
   docker network create core-net
   docker network create bot-net
   ```
3. **Port conflict** — Check if another service is using the port:
   ```bash
   lsof -i :3000  # Open WebUI
   lsof -i :1880  # Node-RED
   lsof -i :8000  # mcpo
   ```

---

## Reading Logs

### Log locations

All logs are accessed via `docker logs`. There are no log files on disk by default.

| Service | Command |
|---------|---------|
| Telegram bot | `docker logs mira-bot-telegram` |
| Open WebUI | `docker logs mira-core` |
| MCP proxy | `docker logs mira-mcpo` |
| FastMCP server | `docker logs mira-mcp` |
| Node-RED | `docker logs mira-bridge` |

### Useful log filters

```bash
# Errors only
docker logs mira-bot-telegram 2>&1 | grep -i "error\|exception\|traceback"

# Last hour only
docker logs mira-bot-telegram --since 1h

# Follow in real time (Ctrl+C to stop)
docker logs mira-bot-telegram -f

# With timestamps
docker logs mira-bot-telegram -t --tail 20
```

---

## Nuclear Option: Full Reset

If nothing else works, you can reset everything and start fresh. **This destroys all data.**

```bash
# Stop and remove all MIRA containers and volumes
cd mira-bots && docker compose down -v && cd ..
cd mira-mcp && docker compose down -v && cd ..
cd mira-bridge && docker compose down -v && cd ..
cd mira-core && docker compose down -v && cd ..

# Remove networks
docker network rm core-net bot-net 2>/dev/null

# Rebuild database
rm -f mira-bridge/data/mira.db
sqlite3 mira-bridge/data/mira.db < mira-bridge/data/init_db.sql

# Re-run deployment
bash deployment/deploy.sh
```

---

## Getting Help

If you can't resolve the issue:

1. Collect the relevant logs: `docker logs <container> --tail 100 > /tmp/mira-debug.log 2>&1`
2. Note the exact error message and what you were doing when it happened
3. Contact your MIRA administrator

---

*MIRA Troubleshooting Guide — keep this accessible at every deployment site*
=======
# MIRA — Troubleshooting Guide

---

## Quick Diagnosis

Run this first to see the state of everything:

```bash
# Container health
docker ps --format "table {{.Names}}\t{{.Status}}" --filter "name=mira"

# Ollama health
curl -sf http://localhost:11434/api/tags > /dev/null && echo "Ollama: OK" || echo "Ollama: DOWN"

# Open WebUI health
curl -sf http://localhost:3000/health > /dev/null && echo "WebUI: OK" || echo "WebUI: DOWN"

# Database health
sqlite3 mira-bridge/data/mira.db "SELECT count(*) FROM equipment_status;" 2>/dev/null && echo "DB: OK" || echo "DB: ERROR"
```

---

## Common Issues

### Bot doesn't respond to Telegram messages

**Symptoms:** You send a message in Telegram but get no reply.

**Check:**
```bash
# Is the bot container running?
docker ps --filter "name=mira-bot"

# Check bot logs for errors
docker logs mira-bot-telegram --tail 30

# Is Open WebUI reachable from the bot?
docker exec mira-bot-telegram python3 -c "
import urllib.request
r = urllib.request.urlopen('http://mira-core:8080/health')
print(r.status)
"
```

**Common causes:**
1. **Bot container crashed** — Restart: `cd mira-bots && docker compose up -d`
2. **Invalid Telegram token** — Check token in .env or Doppler. Recreate via @BotFather if needed.
3. **Open WebUI unreachable** — Check mira-core container health. May need restart.
4. **API key expired** — Regenerate in Open WebUI Admin > Settings > API Keys.

---

### Vision (photo analysis) doesn't work

**Symptoms:** You send a photo but MIRA doesn't describe what it sees, or returns a generic text response.

**Check:**
```bash
# Is the vision model loaded?
ollama list | grep qwen2.5vl

# Is it currently in memory?
curl -s http://localhost:11434/api/ps | python3 -m json.tool

# Check bot logs for vision errors
docker logs mira-bot-telegram --tail 30 | grep -i "vision\|photo\|image"
```

**Common causes:**
1. **Vision model not pulled** — Run: `ollama pull qwen2.5vl:7b`
2. **Model evicted from RAM** — Check RAM usage. May need to remove unused models.
3. **VISION_MODEL env var wrong** — Should be `qwen2.5vl:7b` in mira-bots .env.

---

### Equipment commands return empty or error

**Symptoms:** `/equipment` or `/faults` commands return nothing or an error message.

**Check:**
```bash
# Is the MCP server running?
docker ps --filter "name=mira-mcp"

# Can we reach the REST API?
curl -s http://localhost:8001/api/equipment | python3 -m json.tool

# Does the database have data?
sqlite3 mira-bridge/data/mira.db "SELECT * FROM equipment_status;"
sqlite3 mira-bridge/data/mira.db "SELECT * FROM faults WHERE resolved = 0;"
```

**Common causes:**
1. **MCP container down** — Restart: `cd mira-mcp && docker compose up -d`
2. **Database empty** — Rebuild: `sqlite3 mira-bridge/data/mira.db < mira-bridge/data/init_db.sql`
3. **Database file permissions** — Ensure the mira-mcp container has read access to mira.db.

---

### "Out of memory" or system becomes slow

**Symptoms:** Mac Mini becomes unresponsive, containers crash, or Ollama stops responding.

**Check:**
```bash
# System memory
vm_stat | head -5

# Ollama model memory usage
curl -s http://localhost:11434/api/ps | python3 -m json.tool

# Docker memory usage
docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}" --filter "name=mira"
```

**Fixes:**
1. **Remove unused models:**
   ```bash
   ollama rm mistral:7b
   ollama rm llama3.1:8b
   ```
2. **Switch to smaller model:**
   ```bash
   ollama create mira -f mira-core/Modelfile.staging  # Uses 3B instead of 7B
   ```
3. **Restart Ollama** to clear memory:
   ```bash
   pkill ollama && ollama serve &
   ```

---

### Ollama not reachable from containers

**Symptoms:** Bot or Open WebUI can't connect to Ollama. Errors about `host.docker.internal`.

**Check:**
```bash
# Is Ollama running on the host?
curl -sf http://localhost:11434/api/tags > /dev/null && echo "OK" || echo "DOWN"

# Can containers resolve host.docker.internal?
docker exec mira-core ping -c 1 host.docker.internal
```

**Fixes:**
1. **Ollama not running** — Start it: `ollama serve &`
2. **Docker Desktop DNS issue** — Restart Docker Desktop. On older macOS, you may need to add `host.docker.internal` to `/etc/hosts` pointing to `host-gateway`.

---

### Knowledge base returns irrelevant answers

**Symptoms:** MIRA's answers don't reference uploaded manuals, or references are wrong.

**Check:**
1. Open http://localhost:3000
2. Go to **Workspace > Knowledge**
3. Verify documents appear in the MIRA Industrial KB collection
4. Check that the `KNOWLEDGE_COLLECTION_ID` in mira-bots .env matches the collection ID

**Fixes:**
1. **Documents not ingested** — Re-upload the PDFs. Watch for ingestion errors in the UI.
2. **Wrong collection ID** — Copy the correct ID from Open WebUI and update .env.
3. **Tool calling mode wrong** — In Open WebUI Admin > Settings, set tool calling to **Default Mode** (not Native).
4. **Document too large** — Split large PDFs into chapters before uploading.

---

### GSD engine stuck in a state

**Symptoms:** MIRA keeps asking the same question or doesn't advance the conversation.

**Check:**
```bash
# View conversation state
sqlite3 mira-bridge/data/mira.db "SELECT chat_id, state, exchange_count, updated_at FROM conversation_state;"
```

**Fixes:**
1. **Tell the user to send `/reset`** — This clears the conversation state for their chat.
2. **Manual reset:**
   ```bash
   sqlite3 mira-bridge/data/mira.db "DELETE FROM conversation_state WHERE chat_id = 'CHAT_ID_HERE';"
   ```
3. **Reset all conversations:**
   ```bash
   sqlite3 mira-bridge/data/mira.db "DELETE FROM conversation_state;"
   ```

---

### Container won't start after update

**Symptoms:** `docker compose up -d` fails with build or dependency errors.

**Check:**
```bash
# View full error output
cd mira-bots && docker compose up --build 2>&1 | tail -30
```

**Fixes:**
1. **Stale image cache** — Rebuild without cache:
   ```bash
   docker compose build --no-cache
   docker compose up -d
   ```
2. **Network doesn't exist** — Recreate:
   ```bash
   docker network create core-net
   docker network create bot-net
   ```
3. **Port conflict** — Check if another service is using the port:
   ```bash
   lsof -i :3000  # Open WebUI
   lsof -i :1880  # Node-RED
   lsof -i :8000  # mcpo
   ```

---

## Reading Logs

### Log locations

All logs are accessed via `docker logs`. There are no log files on disk by default.

| Service | Command |
|---------|---------|
| Telegram bot | `docker logs mira-bot-telegram` |
| Open WebUI | `docker logs mira-core` |
| MCP proxy | `docker logs mira-mcpo` |
| FastMCP server | `docker logs mira-mcp` |
| Node-RED | `docker logs mira-bridge` |

### Useful log filters

```bash
# Errors only
docker logs mira-bot-telegram 2>&1 | grep -i "error\|exception\|traceback"

# Last hour only
docker logs mira-bot-telegram --since 1h

# Follow in real time (Ctrl+C to stop)
docker logs mira-bot-telegram -f

# With timestamps
docker logs mira-bot-telegram -t --tail 20
```

---

## Nuclear Option: Full Reset

If nothing else works, you can reset everything and start fresh. **This destroys all data.**

```bash
# Stop and remove all MIRA containers and volumes
cd mira-bots && docker compose down -v && cd ..
cd mira-mcp && docker compose down -v && cd ..
cd mira-bridge && docker compose down -v && cd ..
cd mira-core && docker compose down -v && cd ..

# Remove networks
docker network rm core-net bot-net 2>/dev/null

# Rebuild database
rm -f mira-bridge/data/mira.db
sqlite3 mira-bridge/data/mira.db < mira-bridge/data/init_db.sql

# Re-run deployment
bash deployment/deploy.sh
```

---

## Getting Help

If you can't resolve the issue:

1. Collect the relevant logs: `docker logs <container> --tail 100 > /tmp/mira-debug.log 2>&1`
2. Note the exact error message and what you were doing when it happened
3. Contact your MIRA administrator

---

*MIRA Troubleshooting Guide — keep this accessible at every deployment site*
>>>>>>> Stashed changes

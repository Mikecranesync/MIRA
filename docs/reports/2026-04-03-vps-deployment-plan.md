# VPS Deployment Plan — MIRA SaaS v1 (Revised)

> Revision 3 — fixes all 10 issues from code review. Ollama CPU for embeddings (no OpenAI).

## VPS: `factorylm-prod` (DigitalOcean)

| Attribute | Value |
|-----------|-------|
| **Public IP** | 165.245.138.91 |
| **Tailscale IP** | 100.68.120.99 |
| **SSH** | `ssh vps` (root@100.68.120.99) |
| **OS** | Ubuntu 24.04.3 LTS, 4 vCPU, 7.8 GB RAM, 154 GB disk (84 GB free) |
| **Domain** | factorylm.com (A → 165.245.138.91), TLS via Certbot |
| **Docker** | 19 containers running (Plane, Atlas CMMS, n8n, Flowise, infra) |

---

## Services to Deploy (4, not 3)

| Service | Port (host→container) | Purpose |
|---------|----------------------|---------|
| **mira-core** (Open WebUI) | 3010→8080 | Chat UI, auth, KB admin |
| **mira-sidecar** | 5000→5000 | RAG + FSM sidecar (ChromaDB, LLM provider abstraction) |
| **mira-ingest** | 8002→8001 | Photo/PDF ingest to NeonDB |
| **mira-mcp** | 8009→8000 (SSE), 8001→8001 (REST) | Equipment diagnostic tools |

### Why mira-sidecar is required (Issue #1)
The Ignition HMI Co-Pilot (`doPost.py` line 77) calls `http://localhost:5000/rag` — that's mira-sidecar. It provides:
- `/rag` — ChromaDB-backed RAG with per-asset filtering
- `/ingest` — document chunking + embedding into ChromaDB
- `/build_fsm` — FSM model learning from state history
- Multi-provider LLM: OpenAI, Anthropic, Ollama (via `llm/factory.py`)
- PII sanitization in the Anthropic path
- `.properties` file support for customer Ignition servers

mira-sidecar has no Dockerfile — one must be written.

---

## Resolved Issues

### Issue #2: mira-ingest needs Ollama — VPS has no GPU

**Problem**: Photo ingest calls `qwen2.5vl:7b` (vision) and `nomic-embed-text-v1.5` (embedding) via Ollama.

**Resolution**: Install Ollama CPU-only on the VPS. Pull only the embedding model — no heavy vision/LLM models.

- `nomic-embed-text` is ~270 MB, runs fast on CPU (<100ms per chunk), ~300 MB RAM
- Photo ingest (vision) stays **disabled** for SaaS v1 — `qwen2.5vl:7b` needs GPU
- Document ingest + RAG embeddings work via Ollama CPU

```bash
# Install Ollama on VPS (CPU-only, no GPU needed)
curl -fsSL https://ollama.com/install.sh | sh
ollama pull nomic-embed-text

# Verify
curl -s http://localhost:11434/api/embed -d '{"model":"nomic-embed-text","input":"test"}' | head -c 100
```

**Config for all services**:
```
OLLAMA_BASE_URL=http://host.docker.internal:11434  # (or http://172.17.0.1:11434 on Linux)
EMBEDDING_PROVIDER=ollama
OLLAMA_EMBED_MODEL=nomic-embed-text
```

No OpenAI dependency. No new API keys. Same stack as Bravo, just without GPU models.

### Issue #3: Port conflict (mira-mcp SSE port)

**Problem**: Plan mapped mira-mcp SSE to 8000:8000, but upstream default is `MCP_SSE_PORT=8009`.

**Resolution**: Follow upstream convention:
```
mira-mcp:  8009→8000 (SSE), 8001→8001 (REST)
mira-ingest: 8002→8001 (internal)
```
No conflict. Port 8000 on host stays free.

### Issue #4: mira-mcp volume mount fails (no mira-bridge)

**Problem**: mira-mcp mounts `${MIRA_DB_PATH:-../mira-bridge/data}:/mira-db` — but no mira-bridge is deployed.

**Resolution**: Create an empty SQLite database with the correct schema at deploy time. Equipment status/faults/maintenance_notes will be empty (no live PLC in SaaS v1) but the tools won't crash:
```bash
mkdir -p /opt/mira/data
sqlite3 /opt/mira/data/mira.db < mira-bridge/data/init_db.sql
```

Set `MIRA_DB_PATH=/opt/mira/data` in the compose.

### Issue #5: api.factorylm.com not configured

**Resolution**: Drop `api.factorylm.com`. Use path-based routing under `app.factorylm.com`:
```
app.factorylm.com/             → mira-core (Open WebUI :3010)
app.factorylm.com/api/ingest/  → mira-ingest (:8002)
app.factorylm.com/api/mcp/     → mira-mcp REST (:8001)
app.factorylm.com/sidecar/     → mira-sidecar (:5000)
```
One domain, one TLS cert, simpler DNS.

### Issue #6: Open WebUI has no LLM backend configured

**Resolution**: Open WebUI supports "OpenAI-compatible" connections. Set these env vars:
```yaml
environment:
  - OPENAI_API_BASE_URL=https://api.anthropic.com/v1  # or use litellm proxy
  - OPENAI_API_KEY=${ANTHROPIC_API_KEY}
  # OR: configure via Open WebUI admin UI after first login:
  # Settings → Connections → Add OpenAI Connection
```

**Practical approach**: After first deploy, log in as admin and manually add the Anthropic connection via the UI. This is a one-time step.

### Issue #7: Healthcheck path

Open WebUI's actual endpoint is `GET /health` returning `true` (not JSON). The healthcheck `curl -f http://localhost:8080/health` is correct — `curl -f` fails on non-2xx, `true` is a 200 response.

### Issue #8: mira-net created externally

**Resolution**: Define the network in compose with `driver: bridge`, not `external: true`:
```yaml
networks:
  mira-net:
    driver: bridge
```

### Issue #9: No rollback plan

Added below in Rollback section.

### Issue #10: Git URL casing

The correct URL is `https://github.com/Mikecranesync/MIRA.git` (capital M). GitHub is case-insensitive for cloning but we'll use the correct casing.

---

## Architecture (Revised)

```
Internet
    │
    ▼
Nginx (443, Certbot TLS)
    │
    ├─ app.factorylm.com/ ────────► mira-core (Open WebUI :3010)
    ├─ app.factorylm.com/sidecar/ ► mira-sidecar (:5000)
    ├─ app.factorylm.com/api/ingest/ ► mira-ingest (:8002)
    └─ app.factorylm.com/api/mcp/ ► mira-mcp REST (:8001)
    │
    ▼
┌──────────────────────────────────────────────┐
│  Docker (mira-saas stack)                    │
│                                              │
│  mira-core    (Open WebUI)      :3010        │
│  mira-sidecar (RAG + FSM)      :5000        │
│  mira-ingest  (NeonDB ingest)  :8002        │
│  mira-mcp     (equipment tools) :8009,:8001  │
│                                              │
│  Network: mira-net (compose-managed)         │
│  Volumes: mira-webui-data, mira-chroma,      │
│           mira-data (SQLite schema)          │
└──────────────────────────────────────────────┘
    │
    ▼
Host Process
└── Ollama (CPU-only, nomic-embed-text for embeddings)

External (existing)
├── NeonDB (pgvector, tenant-scoped)
├── Anthropic Claude API (LLM)
├── Doppler (secrets)
└── Langfuse (telemetry, optional)
```

**NOT deployed on VPS** (no GPU, no PLC):
- Heavy Ollama models (qwen2.5vl, llama3 — inference via Claude API instead)
- mira-bridge / Node-RED (no PLC/Modbus in SaaS)
- mira-bots (Telegram/Slack stay on Bravo)

**Deployed on VPS host** (not containerized):
- Ollama with `nomic-embed-text` only (CPU, ~300 MB RAM)

---

## Port Map (Final)

| MIRA Service | Host Port | Container Port | VPS Status |
|-------------|-----------|---------------|------------|
| mira-core | 3010 | 8080 | FREE |
| mira-sidecar | 5000 | 5000 | FREE |
| mira-ingest | 8002 | 8001 | FREE |
| mira-mcp SSE | 8009 | 8000 | FREE |
| mira-mcp REST | 8001 | 8001 | FREE |

Port 3000 conflict: avoided by using 3010.

---

## Pre-Deployment: Write mira-sidecar Dockerfile

mira-sidecar has no Dockerfile. Must create one:

```dockerfile
FROM python:3.12.13-slim

WORKDIR /app

# Install uv for dependency management
COPY --from=ghcr.io/astral-sh/uv:0.7.12 /uv /usr/local/bin/uv

# Copy dependency files first (layer caching)
COPY pyproject.toml uv.lock ./

# Install dependencies
RUN uv sync --frozen --no-dev

# Copy application code
COPY app.py config.py ./
COPY llm/ llm/
COPY rag/ rag/
COPY fsm/ fsm/

# ChromaDB + docs directories (mounted as volumes in production)
RUN mkdir -p /data/chroma /data/docs

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5000/status')"

# Override HOST to 0.0.0.0 inside container (sidecar is behind nginx, not exposed directly)
ENV HOST=0.0.0.0
ENV PORT=5000
ENV CHROMA_PATH=/data/chroma
ENV DOCS_BASE_PATH=/data/docs

CMD ["uv", "run", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "5000"]
```

**File**: `mira-sidecar/Dockerfile`

**Note on HOST=0.0.0.0**: The CLAUDE.md says "Never bind to 0.0.0.0." This applies to bare-metal deployment. Inside a Docker container on `mira-net`, the container is not exposed to the public internet — nginx proxies to it. `0.0.0.0` inside the container is safe and required for Docker networking.

---

## Docker Compose (Revised)

**File**: `/opt/mira/docker-compose.saas.yml`

```yaml
services:
  mira-core:
    image: ghcr.io/open-webui/open-webui:v0.8.10
    container_name: mira-core-saas
    ports:
      - "3010:8080"
    environment:
      - WEBUI_AUTH=true
      - ENABLE_SIGNUP=true
      - ENABLE_API_KEYS=true
      - WEBUI_SECRET_KEY=${WEBUI_SECRET_KEY}
      - WEBUI_ENABLE_TELEMETRY=false
      - WEBUI_CHECK_FOR_UPDATES=false
    volumes:
      - mira-webui-data:/app/backend/data
    networks:
      - mira-net
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s

  mira-sidecar:
    build: ./mira-sidecar
    container_name: mira-sidecar
    ports:
      - "5000:5000"
    environment:
      - LLM_PROVIDER=anthropic
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - LLM_MODEL_ANTHROPIC=claude-sonnet-4-6
      - EMBEDDING_PROVIDER=ollama
      - OLLAMA_BASE_URL=http://172.17.0.1:11434
      - OLLAMA_EMBED_MODEL=nomic-embed-text
      - HOST=0.0.0.0
      - PORT=5000
      - CHROMA_PATH=/data/chroma
      - DOCS_BASE_PATH=/data/docs
    volumes:
      - mira-chroma:/data/chroma
      - mira-docs:/data/docs
    networks:
      - mira-net
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:5000/status')"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 15s

  mira-ingest:
    build: ./mira-core/mira-ingest
    container_name: mira-ingest-saas
    ports:
      - "8002:8001"
    environment:
      - NEON_DATABASE_URL=${NEON_DATABASE_URL}
      - MIRA_TENANT_ID=${MIRA_TENANT_ID}
      - OPENWEBUI_BASE_URL=http://mira-core-saas:8080
      - OPENWEBUI_API_KEY=${OPENWEBUI_API_KEY}
      - KNOWLEDGE_COLLECTION_ID=${KNOWLEDGE_COLLECTION_ID}
      # Photo ingest disabled (no Ollama) — NeonDB endpoints still work
    networks:
      - mira-net
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "python3", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8001/health')"]
      interval: 30s
      timeout: 10s
      retries: 3

  mira-mcp:
    build: ./mira-mcp
    container_name: mira-mcp-saas
    ports:
      - "8009:8000"
      - "8001:8001"
    environment:
      - MIRA_DB_PATH=/mira-db/mira.db
      - FASTMCP_HOST=0.0.0.0
      - FASTMCP_PORT=8000
      - MCP_REST_API_KEY=${MCP_REST_API_KEY}
      - MIRA_TENANT_ID=${MIRA_TENANT_ID}
      # No Atlas CMMS on SaaS v1 — omit ATLAS_API_USER to disable
    volumes:
      - mira-data:/mira-db
    networks:
      - mira-net
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/sse')"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s

networks:
  mira-net:
    driver: bridge

volumes:
  mira-webui-data:
  mira-chroma:
  mira-docs:
  mira-data:
```

---

## Nginx Config (Revised — path-based, single domain)

**File**: `/etc/nginx/sites-available/mira`

```nginx
server {
    listen 80;
    server_name app.factorylm.com;

    client_max_body_size 100M;

    # Open WebUI — main app
    location / {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # mira-sidecar RAG endpoints
    location /sidecar/ {
        rewrite ^/sidecar/(.*) /$1 break;
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # mira-ingest API
    location /api/ingest/ {
        rewrite ^/api/ingest/(.*) /$1 break;
        proxy_pass http://127.0.0.1:8002;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # mira-mcp REST API
    location /api/mcp/ {
        rewrite ^/api/mcp/(.*) /$1 break;
        proxy_pass http://127.0.0.1:8001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## Deployment Sequence

### Phase 1: Prepare

```bash
# Install Ollama (CPU-only, host process)
curl -fsSL https://ollama.com/install.sh | sh
ollama pull nomic-embed-text
# Verify: curl -s http://localhost:11434/api/tags | grep nomic

# Clone MIRA
mkdir -p /opt/mira && cd /opt/mira
git clone https://github.com/Mikecranesync/MIRA.git .

# Create empty SQLite with schema (for mira-mcp)
mkdir -p /opt/mira/data
sqlite3 /opt/mira/data/mira.db < mira-bridge/data/init_db.sql

# Verify Doppler
doppler secrets get ANTHROPIC_API_KEY --plain -p factorylm -c prd | head -c 10
```

### Phase 2: Write mira-sidecar Dockerfile

Create `mira-sidecar/Dockerfile` as specified above.

### Phase 3: Write docker-compose.saas.yml

Create at `/opt/mira/docker-compose.saas.yml` as specified above.

### Phase 4: Deploy

```bash
cd /opt/mira
doppler run --project factorylm --config prd -- \
  docker compose -f docker-compose.saas.yml up -d --build
```

### Phase 5: Configure Nginx + TLS

```bash
# Add DNS A record first: app.factorylm.com → 165.245.138.91

# Create nginx config
cat > /etc/nginx/sites-available/mira << 'EOF'
# (paste nginx config from above)
EOF

ln -s /etc/nginx/sites-available/mira /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# Add TLS
certbot --nginx -d app.factorylm.com
```

### Phase 6: Configure Open WebUI LLM Connection

1. Open `https://app.factorylm.com` in browser
2. Sign up with admin email
3. Go to Settings → Admin → Connections
4. Add OpenAI-compatible connection:
   - Name: "Claude (Anthropic)"
   - Base URL: Anthropic-compatible endpoint (or use litellm proxy)
   - API Key: from Doppler
5. Test: send a chat message

### Phase 7: Verify

```bash
curl -s https://app.factorylm.com/health               # Open WebUI
curl -s http://localhost:5000/status                      # mira-sidecar
curl -s http://localhost:8002/health                      # mira-ingest
curl -s http://localhost:8001/health                      # mira-mcp REST
docker compose -f docker-compose.saas.yml ps              # all healthy
docker stats --no-stream                                  # memory < 5 GB total
```

---

## Rollback Plan (Issue #9)

If MIRA deployment breaks anything:

```bash
# Stop MIRA (does NOT affect Plane, CMMS, n8n, Flowise)
cd /opt/mira
docker compose -f docker-compose.saas.yml down

# Remove nginx config
rm /etc/nginx/sites-enabled/mira
nginx -t && systemctl reload nginx

# Remove MIRA volumes (DESTRUCTIVE — only if needed)
docker volume rm mira-webui-data mira-chroma mira-docs mira-data

# Remove repo
rm -rf /opt/mira
```

MIRA runs in its own compose file, network, and volumes. It cannot break Plane, CMMS, n8n, or Flowise. The only shared resource is nginx — removing the vhost restores the prior state.

---

## RAM Budget (Revised with mira-sidecar + Ollama CPU)

| Component | Estimated RAM |
|-----------|--------------|
| Existing services | 3.4 GB |
| Ollama (nomic-embed-text only) | ~300 MB |
| mira-core (Open WebUI) | ~500 MB |
| mira-sidecar (ChromaDB + FastAPI) | ~300 MB |
| mira-ingest (FastAPI) | ~200 MB |
| mira-mcp (FastMCP) | ~150 MB |
| **Total** | **~4.85 GB** |
| **Available (7.8 GB)** | **~2.95 GB headroom** |

---

## Prerequisites Before Execution

1. **DNS**: Add A record `app.factorylm.com → 165.245.138.91`
2. **Decision**: Confirm mira-sidecar Dockerfile approach (uv-based as proposed, or pip-based)

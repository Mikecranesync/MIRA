# MIRA System Overview
*Last updated: 2026-03-23 | Version: 0.5.2*

## What MIRA Is
MIRA is an AI-powered industrial maintenance assistant. Field technicians send
equipment fault descriptions (text, photos, PDFs) via Telegram or Slack. MIRA
uses Guided Socratic Dialogue — asking targeted questions rather than giving
direct answers — to guide techs to self-diagnosis, backed by a vector knowledge
base of equipment manuals and field photos.

## Production Environment
- **Host:** BRAVO — Mac Mini M4 16 GB (bravonode@192.168.1.11, Tailscale: 100.86.236.11)
- **Repo:** ~/Mira (branches: main + develop, pre-commit hook blocks direct main commits)
- **Secrets:** Doppler project: `factorylm`, config: `prd`
- **Version:** 0.5.2 (see ~/Mira/VERSION)
- **Python:** 3.14 (Homebrew). Use `python3 -m pip install --break-system-packages` for host packages.

## Running Services (docker ps — verified 2026-03-23)

| Container | Image | Host Port | Purpose |
|-----------|-------|-----------|---------|
| mira-core | ghcr.io/open-webui/open-webui:v0.8.10 | 3000→8080 | Web UI + KB admin |
| mira-bridge | nodered/node-red:4.1.7-22 | 1880 | Orchestration dashboard |
| mira-bot-telegram | mira-telegram-bot | — | Telegram polling bot |
| mira-bot-slack | mira-slack-bot | — | Slack Socket Mode bot |
| mira-mcp | mira-mcp-mira-mcp | 8000–8001 | MCP tool server |
| mira-ingest | mira-core-mira-ingest | 8002→8001 | Photo/PDF ingest API |
| mira-mcpo | mira-core-mira-mcpo | 8003→8000 | MCP tool proxy |

**Ollama:** Runs on HOST (not Docker) at `localhost:11434` for Metal GPU.
Models: `qwen2.5vl:7b`, `glm-ocr:latest`, `nomic-embed-text:latest`, `mira:latest`

**Start all services:**
```bash
cd ~/Mira
doppler run --project factorylm --config prd -- docker compose up -d
```

## Request Flow (Telegram — primary bot)

```
Field Tech
    │ photo / text message
    ▼
Telegram API (HTTPS polling)
    │
    ▼
mira-bots/telegram/bot.py
    │ photo_handler() — buffers burst photos 4s window (PHOTO_BUFFER)
    │ handle_message() — routes text
    │ document_handler() — handles PDF uploads
    ▼
mira-bots/shared/guardrails.py
    │ classify_intent(message) → "industrial" | "greeting" | "help" | "safety"
    │ detect_session_followup(message, session_context, fsm_state)
    │ check_output(reply, intent) — validates response quality
    ▼
mira-bots/shared/engine.py — Supervisor.process_full()
    │ Builds message history + injects RAG context
    │ Calls VisionWorker for photos (GLM-OCR → qwen2.5vl)
    ▼
mira-bots/shared/inference/router.py
    │ INFERENCE_BACKEND=claude → Anthropic API (httpx direct, no SDK)
    │ INFERENCE_BACKEND=local → Open WebUI / Ollama
    │ Vision always stays local regardless of backend
    ▼
NeonDB (pgvector) — recall_knowledge()
    │ Cosine similarity search over 25,219 knowledge entries
    │ Top-5 results injected into prompt context
    ▼
Reply → Telegram → Tech
    │
    └──→ Langfuse (traces, optional)
```

## Key Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Root start (includes 4 sub-composes) |
| `CLAUDE.md` | Session primer — read first |
| `docs/PRD_v1.0.md` | Config 1 MVP implementation plan |
| `docs/AUDIT.md` | Baseline state, risk register |
| `.planning/STATE.md` | Phase completion status |
| `mira-bots/shared/engine.py` | Core Supervisor (833 lines) |
| `mira-bots/shared/guardrails.py` | Intent classification + output validation |
| `mira-bots/shared/inference/router.py` | Dual-backend inference router |
| `mira-bots/shared/workers/vision_worker.py` | Photo analysis (GLM-OCR + qwen2.5vl) |
| `mira-bots/shared/workers/rag_worker.py` | RAG retrieval worker |
| `mira-bots/prompts/diagnose/active.yaml` | Active system prompt (v0.3) |
| `mira-bots/telegram/bot.py` | Telegram bot (527 lines) |
| `mira-core/mira-ingest/db/neon.py` | NeonDB layer (sync SQLAlchemy) |
| `mira-core/scripts/ingest_gdrive_docs.py` | GDrive document ingest |
| `mira-core/scripts/ingest_equipment_photos.py` | Equipment photo vision ingest |
| `mira-core/scripts/sync_gdrive_docs.sh` | rclone GDrive → local sync |
| `mira-core/scripts/sync_gphotos.sh` | rclone Google Photos → local sync |
| `tools/prefilter_takeout.py` | Google Takeout keyword pre-filter |

## Architecture Diagrams (C4 Model)
Located in `docs/architecture/`:
- `c4-context.md` — System context
- `c4-containers.md` — All containers + networks
- `c4-components.md` — Internal components
- `c4-deployment.md` — BRAVO deployment topology
- `c4-dynamic-fault-flow.md` — Fault diagnosis sequence

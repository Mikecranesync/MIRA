# MIRA — Claude Code Session Primer
*v0.5.2 | BRAVO (Mac Mini M4 16GB) | Updated 2026-03-23*

## What MIRA Is
Industrial maintenance AI — field technicians send equipment fault descriptions
via Telegram/Slack. MIRA uses Guided Socratic Dialogue to guide diagnosis,
backed by 25,219 knowledge entries (manuals, GDrive docs, field photos).

## Machine You're On
- **BRAVO:** Mac Mini M4 16GB — bravonode@192.168.1.11, Tailscale: 100.86.236.11
- **Python quirk:** `python3` = 3.14 (Homebrew). `pip3` points to 3.12.
  Always use: `python3 -m pip install --break-system-packages`
- **Ollama:** HOST (not Docker), Metal GPU, port 11434
- **Docker:** 7 containers running

## Current Version & Phase
- **Version:** 0.5.2
- **All phases complete** — see `.planning/STATE.md` for details
- **Repo root:** ~/Mira/ | **Remote:** github.com/Mikecranesync/MIRA.git

## Branch Rules (enforced by pre-commit hook)
- NEVER commit directly to main
- Workflow: `git checkout develop` → `git checkout -b feature/name` → work →
  merge to develop → merge to main → push both

## Secrets
All secrets via Doppler — never use .env files directly.
```bash
doppler run --project factorylm --config prd -- python3 script.py
doppler run --project factorylm --config prd -- docker compose up -d
```

## Running Services (verified 2026-03-23)

| Container | Image | Port | Purpose |
|-----------|-------|------|---------|
| mira-core | open-webui:v0.8.10 | 3000→8080 | Web UI + KB admin |
| mira-bridge | node-red:4.1.7-22 | 1880 | Orchestration |
| mira-bot-telegram | mira-telegram-bot | — | Telegram bot |
| mira-bot-slack | mira-slack-bot | — | Slack bot |
| mira-mcp | mira-mcp-mira-mcp | 8000–8001 | MCP tool server |
| mira-ingest | mira-core-mira-ingest | 8002→8001 | Ingest API |
| mira-mcpo | mira-core-mira-mcpo | 8003→8000 | MCP proxy |

## Inference
- `INFERENCE_BACKEND=claude` → Anthropic Claude API (httpx direct, no SDK)
- `INFERENCE_BACKEND=local` → Open WebUI / Ollama
- Active prompt: `mira-bots/prompts/diagnose/active.yaml` (v0.3 "confidence-neon")
- Vision always local: GLM-OCR → qwen2.5vl (regardless of backend)

## Knowledge Base
- **25,219 entries** in NeonDB (ep-purple-hall-ahimeyn0-pooler.c-3.us-east-1.aws.neon.tech)
- Distribution: 24,314 manual | 894 gdrive | 11 seed | 0 gphotos
- **Add content:** Upload PDF to gdrive2tb:"VFD manual pdfs" → run
  `sync_gdrive_docs.sh` → run `ingest_gdrive_docs.py`

## Cron Jobs (running on BRAVO)

| Time | Script | Purpose |
|------|--------|---------|
| 2:00am daily | anonymize_interactions.py | Anonymize real conversations |
| 2:05am daily | ingest_interactions.py | Ingest anonymized data |
| 2:15am daily | ingest_manuals.py | Process new manual URLs |
| 3:00am Sunday | discover_manuals.py | Crawl manufacturer portals |

## Architecture Docs
Full documentation in `docs/architecture/`:
- **SYSTEM_OVERVIEW.md** — containers, request flow, key files
- **INGEST_PIPELINES.md** — all 5 pipelines with status + run commands
- **ENGINE_REFERENCE.md** — Supervisor API, guardrails, inference, RAG, tests
- **KNOWN_ISSUES.md** — open bugs and technical debt
- `c4-*.md` — C4 model diagrams (context, containers, components, deployment, flow)

## Known Issues Right Now
1. 🔴 `ingest_equipment_photos.py:158` — zero-vector embeddings, photos not RAG-searchable
2. 🟡 `test_image_downscale.py` — expects 512px, code uses 1024px
3. 🟡 `mira-core-mira-mcpo:latest` — violates no-:latest image rule
4. ⏳ Google Takeout ZIPs 3-005 through 3-008 — still downloading

## NeonDB
- **Tenant:** `78917b56-f85f-43bb-9a08-1bb98a6cd6c3`
- **Module:** `mira-core/mira-ingest/db/neon.py`
- **Key functions:** `recall_knowledge()`, `insert_knowledge_entry()`,
  `knowledge_entry_exists()`, `health_check()`

## Hard Constraints (PRD §4 — Non-Negotiable)

1. **Licenses:** Apache 2.0 or MIT ONLY.
2. **No cloud except:** Anthropic Claude API + NeonDB (Doppler-managed secrets).
3. **No:** LangChain, TensorFlow, n8n, or any framework abstracting the Claude API call.
4. **Secrets:** All via Doppler. Never commit .env files.
5. **Containers:** One service per container. Every container: `restart: unless-stopped` + healthcheck.
6. **Docker images:** Pinned to exact version SHA or semver tag. Never `:latest` or `:main`.
7. **Build tool:** Claude Code.
8. **Commits:** Conventional commit format.
9. **Config 4 deferred:** No Modbus, PLC, or VFD code until Config 1 MVP ships.

## Commit Convention

```
feat: new feature
fix: bug fix
security: security hardening
docs: documentation only
refactor: code restructuring, no behavior change
test: tests only
chore: build system, deps, tooling
```

## Key Env Vars (Doppler: factorylm/prd)

| Var | Used By |
|-----|---------|
| `TELEGRAM_BOT_TOKEN` | mira-bot-telegram |
| `SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN` | mira-bot-slack |
| `NEON_DATABASE_URL` | mira-ingest (NeonDB) |
| `MIRA_TENANT_ID` | mira-ingest (tenant scoping) |
| `INFERENCE_BACKEND` | mira-bots — `"claude"` or `"local"` |
| `ANTHROPIC_API_KEY` | mira-bots — Claude API |
| `CLAUDE_MODEL` | mira-bots — default: claude-3-5-sonnet-20241022 |
| `OLLAMA_URL` | mira-bots (via Doppler) |
| `LANGFUSE_SECRET_KEY` / `LANGFUSE_PUBLIC_API_KEY` | tracing |
| `LANGFUSE_HOST` | us.cloud.langfuse.com |
| `MCP_REST_API_KEY` | mira-mcp |
| `WEBUI_SECRET_KEY` / `MCPO_API_KEY` | mira-core (ROTATED) |

## Intentionally Deferred

| Feature | Deferred To |
|---------|-------------|
| Modbus/PLC/VFD (`plc_worker.py`) | Config 4 |
| CMMS integration | Config 7 |
| Kokoro TTS | Post-MVP |

## Phase History
- v0.1.0: Initial Telegram bot + Open WebUI
- v0.2.0: Vision pipeline, SQLite WAL, TTS, mira-ingest, security hardening
- v0.2.6: Claude API inference router
- v0.3.0: NeonDB wired, 5,493 knowledge entries, pgvector recall
- v0.3.1: Monorepo consolidation, PRD v1.0
- v0.4.1: 5 conversation continuity bugs fixed, photo buffer fix
- v0.5.0: 5-regime test infrastructure, 76 tests, 39 golden cases
- v0.5.1: Google Photos rclone sync + equipment photo ingest pipeline
- v0.5.2: Google Drive document ingest pipeline — 25,219 knowledge entries

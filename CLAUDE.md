# MIRA — Build State

**Version:** v0.3.1 — monorepo, PRD v1.0 active, Phase 1 in progress
**Sprint:** Phase 1 — Security & Stability Hardening
**Hardware:** Apple Mac Mini M4 16GB (bravonode · 192.168.1.11)
**Tailscale:** 100.86.236.11
**Inference:** `INFERENCE_BACKEND=claude` → Anthropic claude-3-5-sonnet-20241022
               `INFERENCE_BACKEND=local` → Open WebUI → qwen2.5vl:7b
               GLM-OCR always local regardless of backend
**Repo root:** ~/Mira/
**Updated:** 2026-03-18

---

## Architecture

- **Ollama** runs on HOST at `localhost:11434` (not Docker — uses Metal GPU)
- **SQLite DB:** `~/Mira/mira-bridge/data/mira.db` (WAL mode, shared across containers)
- **Networks:** `core-net` (internal services) · `bot-net` (bot relay)
- **Monorepo:** All 4 sub-repos consolidated. Root `docker-compose.yml` uses `include:`.

## Container Map (7 containers)

| Container         | Host Port(s)    | Network(s)        | Healthcheck                   |
|-------------------|-----------------|-------------------|-------------------------------|
| mira-core         | 3000 → 8080     | core-net, bot-net | GET /health                   |
| mira-mcpo         | 8000            | core-net          | GET /mira-mcp/docs (bearer)   |
| mira-ingest       | 8002 → 8001     | core-net          | Python urlopen /health        |
| mira-bridge       | 1880            | core-net          | GET /                         |
| mira-mcp          | 8000, 8001      | core-net          | Python urlopen /sse           |
| mira-bot-telegram | —               | bot-net, core-net | import check                  |
| mira-bot-slack    | —               | bot-net, core-net | import check                  |

## Compose Files

- `~/Mira/docker-compose.yml` — **ROOT: starts all services** (use this)
- `~/Mira/mira-core/docker-compose.yml` — mira-core, mira-mcpo, mira-ingest
- `~/Mira/mira-bridge/docker-compose.yml` — mira-bridge (Node-RED)
- `~/Mira/mira-bots/docker-compose.yml` — mira-bot-telegram, mira-bot-slack
- `~/Mira/mira-mcp/docker-compose.yml` — mira-mcp

**Start command:** `doppler run --project factorylm --config prd -- docker compose up -d`

## NeonDB (v0.3.0+)

- **Endpoint:** `ep-purple-hall-ahimeyn0-pooler.c-3.us-east-1.aws.neon.tech/neondb`
- **Secret:** `NEON_DATABASE_URL` in Doppler `factorylm/prd`
- **MIRA_TENANT_ID:** `78917b56-f85f-43bb-9a08-1bb98a6cd6c3` (FactoryLM BRAVO — Lake Wales FL)
- **Module:** `mira-ingest/db/neon.py` — `get_tenant()`, `get_tier_limits()`, `recall_knowledge()`

## Key Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Root start — all services |
| `docs/PRD_v1.0.md` | Config 1 MVP implementation plan |
| `docs/AUDIT.md` | Baseline state, risk register |
| `.planning/STATE.md` | Current phase, next task, decisions |
| `.env.template` | All vars documented, no real values |
| `mira-bots/shared/inference/router.py` | Dual-backend inference (claude/local) |
| `mira-ingest/db/neon.py` | NeonDB tenant + RAG module |
| `mira-bots/prompts/diagnose/active.yaml` | Active system prompt (Phase 3) |

## Hard Constraints (PRD §4 — Non-Negotiable)

1. **Licenses:** Apache 2.0 or MIT ONLY. Flag any other license before installing.
2. **No cloud except:** Anthropic Claude API + NeonDB (Doppler-managed secrets).
3. **No:** LangChain, TensorFlow, n8n, or any framework that abstracts the Claude API call.
4. **Secrets:** All secrets via Doppler (`factorylm/prd`). Never in `.env` files committed to git.
5. **Containers:** One service per container. Every container: `restart: unless-stopped` + healthcheck.
6. **Docker images:** Pinned to exact version SHA or semver tag. Never `:latest` or `:main`.
7. **Build tool:** Claude Code. All implementation prompts written as Claude Code instructions.
8. **Commits:** Conventional commit format (`feat/fix/security/docs/refactor/test/chore/BREAKING`).
9. **Config 4 deferred:** No Modbus, PLC, or VFD code until Config 1 MVP ships.

## Commit Convention

```
feat: short description of new feature
fix: short description of bug fix
security: security hardening
docs: documentation only
refactor: code restructuring, no behavior change
test: tests only
chore: build system, deps, tooling
```

## Intentionally Deferred (Do Not Implement)

| Feature | Deferred To | Reason |
|---------|-------------|--------|
| Modbus/PLC/VFD (`plc_worker.py`) | Config 4 | Out of scope for Config 1 MVP |
| NVIDIA NIM / Nemotron | TBD | Not part of MVP |
| Kokoro TTS | Post-MVP | Nice-to-have |
| CMMS integration | Config 7 | Enterprise feature |

## Key Env Vars (Doppler: factorylm/prd)

| Var | Used By |
|-----|---------|
| `TELEGRAM_BOT_TOKEN` | mira-bot-telegram |
| `SLACK_BOT_TOKEN` | mira-bot-slack |
| `SLACK_APP_TOKEN` | mira-bot-slack |
| `OPENWEBUI_API_KEY` | mira-bots, mira-ingest |
| `MCP_REST_API_KEY` | mira-mcp (server), mira-bots (client) |
| `WEBUI_SECRET_KEY` | mira-core — **ROTATE — was in git history** |
| `MCPO_API_KEY` | mira-core mcpo — **ROTATE — was in git history** |
| `KNOWLEDGE_COLLECTION_ID` | mira-bots, mira-ingest |
| `NEON_DATABASE_URL` | mira-ingest (NeonDB) |
| `MIRA_TENANT_ID` | mira-ingest (tenant scoping) |
| `INFERENCE_BACKEND` | mira-bots — `"claude"` or `"local"` |
| `ANTHROPIC_API_KEY` | mira-bots — Claude API key |
| `CLAUDE_MODEL` | mira-bots — default: claude-3-5-sonnet-20241022 |
| `MIRA_SERVER_BASE_URL` | Remote clients — BRAVO host, no port (e.g. `http://192.168.1.11`) |

## Phase History

- v0.1.0: Initial Telegram bot + Open WebUI
- v0.2.0: Vision pipeline, SQLite WAL, TTS, mira-ingest, security hardening, 21+ tests
- v0.2.6: Claude API inference router (INFERENCE_BACKEND)
- v0.3.0: NeonDB wired in, 5,493 knowledge entries, pgvector recall, tenant registry
- v0.3.1 (current): Monorepo consolidation, PRD v1.0, Phase 0 complete

## Rollback

```bash
# All histories archived in archives/ before monorepo consolidation
# To inspect: unzip archives/mira-bots-pre-monorepo.zip -d /tmp/mira-bots-history
```

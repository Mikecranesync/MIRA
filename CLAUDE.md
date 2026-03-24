# MIRA — Build State

**Version:** v0.5.2
**Updated:** 2026-03-23
**One-liner:** AI-powered industrial maintenance diagnostic platform
**Inference:** `INFERENCE_BACKEND=claude` → Anthropic API | `INFERENCE_BACKEND=local` → Open WebUI → qwen2.5vl:7b

---

## Repo Map

```
MIRA/
├── mira-core/          # Open WebUI + MCPO proxy + ingest service (3 containers)
├── mira-bots/          # Telegram, Slack, Teams, WhatsApp adapters + shared diagnostic engine (4 containers)
├── mira-bridge/        # Node-RED orchestration, SQLite WAL shared state (1 container)
├── mira-mcp/           # FastMCP server, NeonDB recall, equipment diagnostic tools (1 container)
├── mira-hud/           # AR HUD desktop app (Express + Socket.IO, standalone)
├── tests/              # 5-regime testing framework (76 offline tests, 39 golden cases)
├── docs/               # PRD, ADRs, architecture C4 diagrams, runbooks
├── tools/              # Photo pipeline, Google Drive/Photos ingest scripts
├── install/            # Setup scripts, smoke tests
├── deployment/         # Admin guide, customer agreement
└── plc/                # PLC program files (deferred to Config 4)
```

See local CLAUDE.md in each module for deep context.

---

## Container Map

| Container         | Host Port(s) | Network(s)        | Healthcheck                 |
|-------------------|--------------|-------------------|-----------------------------|
| mira-core         | 3000 → 8080  | core-net, bot-net | GET /health                 |
| mira-mcpo         | 8000         | core-net          | GET /mira-mcp/docs (bearer) |
| mira-ingest       | 8002 → 8001  | core-net          | Python urlopen /health      |
| mira-bridge       | 1880         | core-net          | GET /                       |
| mira-mcp          | 8000, 8001   | core-net          | Python urlopen /sse         |
| mira-bot-telegram | —            | bot-net, core-net | import check                |
| mira-bot-slack    | —            | bot-net, core-net | import check                |
| mira-bot-teams    | —            | bot-net, core-net | import check                |
| mira-bot-whatsapp | —            | bot-net, core-net | import check                |

---

## Start / Stop

```bash
# Start all services
doppler run --project factorylm --config prd -- docker compose up -d

# Stop
docker compose down

# Logs
docker compose logs -f <service>

# Smoke test
bash install/smoke_test.sh
```

---

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

---

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

---

## Key Env Vars (Doppler: factorylm/prd)

| Var                  | Used By                              |
|----------------------|--------------------------------------|
| `TELEGRAM_BOT_TOKEN` | mira-bot-telegram                    |
| `SLACK_BOT_TOKEN`    | mira-bot-slack                       |
| `SLACK_APP_TOKEN`    | mira-bot-slack (Socket Mode)         |
| `ANTHROPIC_API_KEY`  | mira-bots (Claude inference)         |
| `INFERENCE_BACKEND`  | mira-bots — `"claude"` or `"local"` |
| `CLAUDE_MODEL`       | mira-bots — default: claude-sonnet-4-6 |
| `OPENWEBUI_API_KEY`  | mira-bots, mira-ingest               |
| `MCP_REST_API_KEY`   | mira-mcp (server), mira-bots (client)|
| `NEON_DATABASE_URL`  | mira-ingest (NeonDB)                 |
| `MIRA_TENANT_ID`     | mira-ingest (tenant scoping)         |
| `KNOWLEDGE_COLLECTION_ID` | mira-bots, mira-ingest          |
| `LANGFUSE_SECRET_KEY`| mira-bots (tracing)                  |
| `LANGFUSE_PUBLIC_KEY`| mira-bots (tracing)                  |
| `MIRA_SERVER_BASE_URL` | Remote clients (no port)           |

---

## Deferred Features

| Feature                      | Deferred To | Reason                      |
|------------------------------|-------------|-----------------------------|
| Modbus / PLC / VFD           | Config 4    | Out of scope for Config 1 MVP |
| NVIDIA NIM / Nemotron        | TBD         | Not part of MVP             |
| Kokoro TTS                   | Post-MVP    | Nice-to-have                |
| CMMS integration             | Config 7    | Enterprise feature          |

---

## Pointers

- `.claude/skills/` — domain skills for diagnostic workflow, adapters, inference, HUD, ingest
- `docs/adr/` — Architecture Decision Records
- `docs/runbooks/` — operational runbooks
- `.planning/STATE.md` — current sprint state and next task

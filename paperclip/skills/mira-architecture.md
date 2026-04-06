# MIRA Architecture

## Container Map

| Container | Host Port(s) | Network(s) | Healthcheck |
|-----------|-------------|------------|-------------|
| mira-core | 3000 -> 8080 | core-net, bot-net | GET /health |
| mira-mcpo | 8000 | core-net | GET /mira-mcp/docs (bearer) |
| mira-ingest | 8002 -> 8001 | core-net | Python urlopen /health |
| mira-bridge | 1880 | core-net | GET / |
| mira-mcp | 8000, 8001 | core-net | Python urlopen /sse |
| mira-bot-telegram | -- | bot-net, core-net | import check |
| mira-bot-slack | -- | bot-net, core-net | import check |
| mira-bot-teams | -- | bot-net, core-net | import check |
| mira-bot-whatsapp | -- | bot-net, core-net | import check |
| mira-bot-reddit | -- | bot-net, core-net | import check |
| atlas-db | 5433 | cmms-net | pg_isready |
| atlas-api | 8088 -> 8080 | cmms-net, core-net | GET /actuator/health |
| atlas-frontend | 3100 -> 3000 | cmms-net | GET / |
| atlas-minio | 9000, 9001 | cmms-net | mc ready local |

## Networks

- `core-net` — MIRA core services (Open WebUI, MCP, ingest, bridge)
- `bot-net` — Bot adapters + core access
- `cmms-net` — Atlas CMMS services

## Infrastructure

| Device | Tailscale IP | Role |
|--------|-------------|------|
| BRAVO (Mac Mini M4) | 100.86.236.11 | Production host, Docker |
| CHARLIE (Mac Mini) | 100.70.49.126 | Telegram bot, Qdrant KB |
| Travel Laptop | 100.83.251.23 | Development |

## Key Env Vars (Doppler: factorylm/prd)

| Var | Used By |
|-----|---------|
| ANTHROPIC_API_KEY | mira-bots (Claude inference) |
| INFERENCE_BACKEND | mira-bots ("claude" or "local") |
| CLAUDE_MODEL | mira-bots (default: claude-sonnet-4-6) |
| OPENWEBUI_API_KEY | mira-bots, mira-ingest |
| MCP_REST_API_KEY | mira-mcp, mira-bots |
| NEON_DATABASE_URL | mira-ingest |
| MIRA_TENANT_ID | mira-ingest |
| KNOWLEDGE_COLLECTION_ID | mira-bots, mira-ingest |
| TELEGRAM_BOT_TOKEN | mira-bot-telegram |
| SLACK_BOT_TOKEN | mira-bot-slack |
| SLACK_APP_TOKEN | mira-bot-slack (Socket Mode) |

## Start / Stop

```bash
doppler run --project factorylm --config prd -- docker compose up -d
docker compose down
docker compose logs -f <service>
```

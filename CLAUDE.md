# MIRA — Build State

**Version:** v0.3.0 — NeonDB tenant registry, pgvector recall, dual-database architecture (NeonDB + SQLite)
**Hardware:** Apple Mac Mini M4 16GB (bravonode · 192.168.1.11)
**Tailscale:** 100.86.236.11
**Repo root:** ~/Mira/
**Date:** 2026-03-17

---

## Architecture

- **Ollama** runs on HOST at `localhost:11434` (not Docker — uses Metal GPU)
- **SQLite DB:** `~/Mira/mira-bridge/data/mira.db` (WAL mode, shared across containers)
- **Networks:** `core-net` (internal services) · `bot-net` (Telegram bot relay)

## Container Map

| Container         | Host Port(s)    | Network(s)        | Healthcheck           |
|-------------------|-----------------|-------------------|-----------------------|
| mira-core         | 3000 → 8080     | core-net, bot-net | GET /health           |
| mira-mcpo         | 8000            | core-net          | GET /health (bearer)  |
| mira-ingest       | 8002 → 8001     | core-net          | GET /health           |
| mira-bridge       | 1880            | core-net          | GET /                 |
| mira-mcp          | 8000, 8001      | core-net          | GET /sse + /health    |
| mira-bot-telegram | —               | bot-net, core-net | sqlite3 SELECT 1      |

## Compose Files

- `~/Mira/mira-core/docker-compose.yml` — mira-core, mira-mcpo, mira-ingest
- `~/Mira/mira-bridge/docker-compose.yml` — mira-bridge (Node-RED)
- `~/Mira/mira-bots/docker-compose.yml` — mira-bot-telegram
- `~/Mira/mira-mcp/docker-compose.yml` — mira-mcp

## NeonDB (v0.3.0+)

- **Endpoint:** `ep-purple-hall-ahimeyn0-pooler.c-3.us-east-1.aws.neon.tech/neondb`
- **Secret:** `NEON_DATABASE_URL` in Doppler `factorylm/prd` and `factorylm/dev`
- **MIRA_TENANT_ID:** `78917b56-f85f-43bb-9a08-1bb98a6cd6c3` (FactoryLM BRAVO — Lake Wales FL)
- **Module:** `mira-ingest/db/neon.py` — `get_tenant()`, `get_tier_limits()`, `recall_knowledge()`
- **Healthcheck:** `GET /health/db` on mira-ingest
- **Snapshot:** `artifacts/neondb_snapshot_pre_cleanup.json` (pre-cleanup baseline, 2026-03-17)

## Key Env Vars (all in .env per repo)

| Var | Used By |
|-----|---------|
| `TELEGRAM_BOT_TOKEN` | mira-bots |
| `OPENWEBUI_API_KEY` | mira-bots, mira-ingest |
| `MCP_REST_API_KEY` | mira-mcp (server), mira-bots (client) |
| `WEBUI_SECRET_KEY` | mira-core |
| `MCPO_API_KEY` | mira-core mcpo |
| `KNOWLEDGE_COLLECTION_ID` | mira-bots, mira-ingest |
| `NEON_DATABASE_URL` | mira-ingest (NeonDB) — via Doppler factorylm/prd |
| `MIRA_TENANT_ID` | mira-ingest (tenant scoping) — via Doppler factorylm/prd |

## v0.2.0 Feature Summary

- Vision image pre-downscale to 512px (encoder latency -75%)
- Persistent typing indicator with immediate ack messages
- SQLite WAL mode on all connections
- Ollama KEEP_ALIVE=-1, FLASH_ATTENTION=1 (model stays hot)
- Kokoro TTS local voice responses (`/voice on|off`)
- mira-ingest FastAPI photo pipeline + vector search (768-dim)
- P0 security hardening: secrets removed, bearer auth on REST, telemetry off
- Apache 2.0 LICENSE on all four repos
- 21+ unit tests, all passing

## Phase 8 Integration Tests

The bottom-layer integration test suite verifies the full deployed stack end-to-end.

**Test definitions and result slots:** `docs/BOTTOM_LAYER_TEST_RESULTS.md`

**To run Phase 8 tests:**
```
Read CLAUDE.md and BOTTOM_LAYER_TEST_RESULTS.md.

Run all 7 Phase 8 integration tests in order. For each test:
- Execute what you can programmatically
- If it requires hardware/physical access, flag it clearly and wait
- Write PASS ✅ or FAIL ❌ + notes to docs/BOTTOM_LAYER_TEST_RESULTS.md after each test

When all 7 are done:
- If all pass: update CLAUDE.md build state, git add -A, commit, push. No confirmation needed.
- If any fail: stop and report exactly what failed and why.

Start with TEST 1.
```

## Rollback

```bash
# Emergency rollback to v0.1.0
cd ~/Mira/mira-bots && git checkout v0.1.0 && docker compose up -d --build
cd ~/Mira/mira-core && git checkout v0.1.0 && docker compose up -d --build
```

Phase-specific rollbacks: `git checkout v0.2.0-phase<N>` on affected repo.

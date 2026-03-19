# MIRA Baseline Audit — 2026-03-18

**Auditor:** Claude Code
**Repository Root:** `/Users/bravonode/Mira/`
**Date:** 2026-03-18
**Purpose:** Pre-monorepo baseline state capture — prerequisite for Config 1 MVP (PRD v1.0)

---

## §1 — File Inventory

### mira-core/ (Open WebUI + MCPO + Photo Ingest)

```
mira-core/
├── .env                                  ← [SECURITY P0] tracked in mira-core git history — contains WEBUI_SECRET_KEY, MCPO_API_KEY
├── .env.example
├── docker-compose.yml
├── Dockerfile.mcpo
├── mcpo-config.json
├── docs/register-tools.md
├── data/                                 ← photos directory
├── mira-ingest/
│   ├── Dockerfile
│   ├── main.py
│   ├── requirements.txt
│   ├── db/
│   │   ├── __init__.py
│   │   └── neon.py
│   └── tests/
│       ├── __init__.py
│       └── test_ingest.py
└── scripts/
    ├── discover_manuals.py
    └── ingest_manuals.py
```

**Orphan/stray files:**
- `mira-core/mira.db` — stray; canonical path is `mira-bridge/data/mira.db`

### mira-bots/ (Telegram, Slack, Shared Library)

```
mira-bots/
├── .env                                  ← untracked, contains live secrets
├── .env.example
├── docker-compose.yml
├── setup_v2.py                           ← [ORPHAN] V2 setup harness, no active consumer
├── pytest.ini
├── telegram/
│   ├── bot.py
│   ├── gsd_engine.py                     ← [ORPHAN] duplicate of shared/gsd_engine.py
│   ├── tts.py                            ← [ORPHAN] duplicate of shared/tts.py
│   ├── Dockerfile
│   └── requirements.txt
├── slack/
│   ├── bot.py
│   ├── pdf_handler.py
│   ├── Dockerfile
│   └── requirements.txt
├── shared/
│   ├── __init__.py
│   ├── engine.py
│   ├── gsd_engine.py
│   ├── guardrails.py
│   ├── nemotron.py
│   ├── tts.py
│   ├── eval/
│   │   ├── __init__.py
│   │   ├── evaluator.py
│   │   └── test_cases.json               ← 120+ industrial fault cases
│   ├── inference/
│   │   ├── __init__.py
│   │   └── router.py                     ← dual-backend: claude|local
│   └── workers/
│       ├── __init__.py
│       ├── plc_worker.py                 ← STUB — intentionally deferred to Config 4
│       ├── print_worker.py
│       ├── rag_worker.py
│       └── vision_worker.py
├── tests/                                ← 8 unit test modules
├── telegram_test_runner/                 ← Telethon integration test harness
├── v2_test_harness/                      ← [ORPHAN] V2 evaluation framework
│   └── healer.py                         ← [ORPHAN]
├── scripts/
│   ├── anonymize_interactions.py
│   ├── ingest_interactions.py
│   ├── seed_kb.py
│   └── requirements.txt
├── tools/
│   └── live_observer.py
└── artifacts/
    ├── v2/evidence/                      ← 360+ test evidence JSON files
    └── real_photos_*.txt
```

**Missing:**
- `prompts/diagnose/active.yaml` ← [MISSING] prompt versioning not implemented
- `CHANGELOG.md` ← [MISSING]

### mira-bridge/ (Node-RED)

```
mira-bridge/
├── .env
├── .env.example
├── docker-compose.yml
├── docker.dclock                         ← empty file
├── data/
│   └── mira.db                           ← 76 KB, shared SQLite, canonical path
├── migrations/
│   └── 001_add_gsd_state.sql
└── LICENSE                               ← Apache 2.0
```

**Missing:**
- `CHANGELOG.md` ← [MISSING]

### mira-mcp/ (FastMCP Server)

```
mira-mcp/
├── .env                                  ← untracked, contains MCP_REST_API_KEY
├── .env.example
├── docker-compose.yml
├── Dockerfile
├── requirements.txt
├── server.py
├── context/
│   ├── __init__.py
│   └── viking_store.py
└── LICENSE                               ← Apache 2.0
```

**Missing:**
- `CHANGELOG.md` ← [MISSING]
- Schema migration files ← [MISSING] created dynamically at runtime

### Root Level

```
Mira/
├── .git/                                 ← root repo (no remote configured)
├── .gitignore                            ← 43-byte stub — insufficient coverage
├── CLAUDE.md
├── MIRA_PRD_v1.0.md
├── mira-core/                            ← tracked as gitlink/submodule in root repo
├── mira-bots/                            ← [UNTRACKED] in root repo
├── mira-bridge/                          ← [UNTRACKED] in root repo
├── mira-mcp/                             ← [UNTRACKED] in root repo
├── mira-bots-phase1/                     ← [ORPHAN] 164 KB
├── mira-bots-phase2/                     ← [ORPHAN] 172 KB
├── mira-bots-phase3/                     ← [ORPHAN] 120 KB
├── Secrets/                              ← empty dir, gitignored
└── docs/
    └── BOTTOM_LAYER_TEST_RESULTS.md
```

**Missing from root:**
- `docker-compose.yml` ← [MISSING] no one-click startup
- `README.md` ← [MISSING]
- `CHANGELOG.md` ← [MISSING]
- `.planning/` ← [MISSING]
- `.env.template` ← [MISSING]
- GitHub remote ← [MISSING] no offsite backup

---

## §2 — Container Inventory

| Container | Image | Ports | Networks | Restart | Healthcheck | Status |
|-----------|-------|-------|----------|---------|-------------|--------|
| mira-core (open-webui) | `ghcr.io/open-webui/open-webui:main` **[FLOAT]** | 3000→8080 | core-net, bot-net | unless-stopped | GET /health 30s | HEALTHY |
| mira-mcpo | `ghcr.io/open-webui/mcpo:main` **[FLOAT]** + local Dockerfile.mcpo | 8000→8000 | core-net | unless-stopped | GET /mira-mcp/docs (bearer) 30s | HEALTHY |
| mira-ingest | local Dockerfile | 8002→8001 | core-net | unless-stopped | Python urlopen /health 30s | HEALTHY |
| mira-bridge (node-red) | `nodered/node-red:latest` **[FLOAT]** | 1880 | core-net | unless-stopped | curl / 30s | HEALTHY |
| mira-mcp | local Dockerfile (`python:3.12-slim` **[FLOAT patch]**)  | 8000, 8001 | core-net | unless-stopped | Python urlopen /sse 30s | HEALTHY |
| mira-bot-telegram | local Dockerfile | — | bot-net, core-net | unless-stopped | import check 30s | HEALTHY |
| mira-bot-slack | local Dockerfile | — | bot-net, core-net | unless-stopped | import check 30s | HEALTHY |

**Floating tag violations:** 4 — open-webui:main, mcpo:main, node-red:latest, python:3.12-slim (patch unspecified)

---

## §3 — Env Var Inventory

### mira-core (set in docker-compose.yml / .env)

| Var | Source | Notes |
|-----|--------|-------|
| `WEBUI_SECRET_KEY` | `.env` | **[P0 SECURITY]** was in mira-core git history — ROTATE and move to Doppler |
| `MCPO_API_KEY` | `.env` | **[P0 SECURITY]** was in mira-core git history — ROTATE and move to Doppler |
| `WEBUI_PORT` | `.env` | Default 3000 |
| `MCPO_PORT` | `.env` | Default 8000 |
| `INGEST_PORT` | `.env` | Default 8002 |
| `OPENWEBUI_API_KEY` | `.env` | Required for mira-ingest → open-webui auth |
| `KNOWLEDGE_COLLECTION_ID` | `.env` | Open WebUI knowledge collection UUID |
| `NEON_DATABASE_URL` | Doppler factorylm/prd | NeonDB connection string |
| `MIRA_TENANT_ID` | Doppler factorylm/prd | `78917b56-f85f-43bb-9a08-1bb98a6cd6c3` |

### mira-bots (set in .env / Doppler)

| Var | Source | Notes |
|-----|--------|-------|
| `TELEGRAM_BOT_TOKEN` | `.env` | Live — must move to Doppler |
| `SLACK_BOT_TOKEN` | `.env` | Live — must move to Doppler |
| `SLACK_APP_TOKEN` | `.env` | Live — must move to Doppler |
| `OPENWEBUI_API_KEY` | `.env` | Live |
| `KNOWLEDGE_COLLECTION_ID` | `.env` | Live |
| `MCP_REST_API_KEY` | `.env` | Matches mira-mcp/.env |
| `NVIDIA_API_KEY` | `.env` | Nemotron integration (likely deprecated) |
| `INFERENCE_BACKEND` | Doppler factorylm/prd | `claude` or `local` |
| `ANTHROPIC_API_KEY` | Doppler factorylm/prd | Claude API key |
| `CLAUDE_MODEL` | Doppler factorylm/prd | Default: claude-3-5-sonnet-20241022 |
| `SLACK_ALLOWED_CHANNELS` | `.env` / Doppler | Read in .env.example, **NOT ENFORCED** in bot.py |
| `TELEGRAM_TEST_CHAT_ID` | `.env` | Test harness only |
| `MIRA_INGEST_URL` | docker-compose.yml | `http://mira-ingest:8001` |
| `MIRA_MCP_URL` | docker-compose.yml | `http://mira-mcp:8001` |
| `MIRA_MCP_API_KEY` | docker-compose.yml | From env |

### mira-mcp

| Var | Source | Notes |
|-----|--------|-------|
| `MCP_REST_API_KEY` | `.env` | Must move to Doppler |

### mira-bridge

| Var | Source | Notes |
|-----|--------|-------|
| `NODERED_PORT` | `.env` | Default 1880 — non-sensitive |

**Doppler project:** `factorylm` / config: `prd`
**Status of `Secrets/` directory:** Empty — ignore
**Note:** `mira-core/.env` was tracked in mira-core sub-repo git history. Requires secret rotation before monorepo consolidation commit.

---

## §4 — Hardware & Network Map

```
Mac Mini M4 16GB (bravonode · 192.168.1.11 · Tailscale 100.86.236.11)
│
├── Ollama              → host:11434 (Metal GPU, KEEP_ALIVE=-1, FLASH_ATTENTION=1)
│                          Models: qwen2.5vl:7b, nomic-embed-text, glm4v:9b
│
├── Docker core-net
│   ├── mira-core       → host:3000→container:8080  (Open WebUI)
│   ├── mira-mcpo       → host:8000→container:8000  (MCP proxy)
│   ├── mira-ingest     → host:8002→container:8001  (photo/PDF pipeline)
│   ├── mira-bridge     → host:1880                 (Node-RED orchestration)
│   └── mira-mcp        → host:8001 (SSE) + host:8000 (REST)
│
├── Docker bot-net
│   ├── mira-bot-telegram  (polling, no exposed port)
│   └── mira-bot-slack     (Socket Mode, no exposed port)
│
├── Shared volume: mira-bridge/data/mira.db (SQLite WAL, 76 KB)
│
└── External
    ├── NeonDB       → ep-purple-hall-ahimeyn0-pooler.c-3.us-east-1.aws.neon.tech
    │                  5,493 knowledge entries, pgvector (768-dim)
    └── Claude API   → Anthropic claude-3-5-sonnet-20241022 (INFERENCE_BACKEND=claude)
```

**PLC / Modbus:** NOT ACTIVE — `plc_worker.py` is a stub. Micro820 at 192.168.1.100:502 is not referenced in any running container. Intentionally deferred to Config 4.

---

## §5 — Dependency & License Audit

| Package | License | Version Pinned? | Location | Action |
|---------|---------|-----------------|----------|--------|
| `pymupdf>=1.24` | **AGPL-3.0** | No (>=) | mira-ingest/requirements.txt | **REPLACE** with `pdfplumber` (MIT) |
| `openviking` | **Apache-2.0** ✅ | No (unpinned) | mira-mcp/requirements.txt | PIN to `openviking==0.2.6` |
| `uvicorn>=0.29.0` | BSD-2-Clause ✅ | No (>=) | mira-mcp/requirements.txt | PIN to exact version |
| `starlette>=0.37.0` | BSD-3-Clause ✅ | No (>=) | mira-mcp/requirements.txt | PIN to exact version |
| `pdfplumber` | MIT ✅ | No (unpinned) | mira-mcp/requirements.txt | PIN to exact version |
| `python-multipart` | Apache-2.0 ✅ | No (unpinned) | mira-mcp/requirements.txt | PIN to exact version |
| `anyio[trio]` | MIT ✅ | No (unpinned) | mira-ingest/requirements.txt | PIN to exact version |
| `python-telegram-bot==21.*` | LGPLv3 | Minor-pinned | telegram/requirements.txt | ACCEPTABLE for library API use |
| `open-webui:main` | MIT ✅ | **FLOATING** | mira-core/docker-compose.yml | PIN to semver tag |
| `nodered/node-red:latest` | Apache-2.0 ✅ | **FLOATING** | mira-bridge/docker-compose.yml | PIN to semver tag |
| `ghcr.io/open-webui/mcpo:main` | MIT ✅ | **FLOATING** | mira-core/Dockerfile.mcpo | PIN to semver tag |
| `python:3.12-slim` | PSF ✅ | Patch unfixed | mira-mcp/Dockerfile | PIN patch: `python:3.12.x-slim` |
| `fastmcp==0.4.*` | MIT ✅ | Minor-pinned | mira-mcp/requirements.txt | PIN to exact version |
| `fastapi==0.115.*` | MIT ✅ | Minor-pinned | mira-ingest/requirements.txt | Acceptable |
| `httpx==0.27.*` | BSD-3-Clause ✅ | Minor-pinned | telegram, slack requirements.txt | Acceptable |
| `anthropic>=0.40` | MIT ✅ | Lower-bound only | telegram/requirements.txt | PIN to exact version |

**License summary:**
- AGPL violations: **1** (`pymupdf`) — blocks commercial distribution
- Unknown licenses: **0** (openviking confirmed Apache-2.0)
- All others: Apache-2.0, MIT, BSD, LGPLv3 — acceptable

---

## §6 — Integration Status

| Integration | Status | Notes |
|-------------|--------|-------|
| Claude API | **WORKING** | httpx direct call, Doppler auth, INFERENCE_BACKEND=claude |
| NeonDB PGVector | **WORKING** | 5,493 entries, tenant-scoped, pgvector recall |
| Telegram bot | **WORKING** | Polling mode, @FactoryLMDiagnose_bot |
| Slack bot | **WORKING** | Socket Mode, channel filtering NOT enforced |
| Microsoft Teams | **NOT BUILT** | Teams adapter missing — Phase 2.3 |
| WhatsApp | **NOT BUILT** | WhatsApp adapter missing — Phase 2.4 |
| Prompt versioning | **NOT IMPLEMENTED** | prompts/diagnose/ missing — Phase 3 |
| Micro820 PLC | **NOT CONNECTED** | plc_worker.py is stub — intentionally deferred to Config 4 |
| Usage logging | **NOT IMPLEMENTED** | api_usage table not yet created — Phase 5.4 |
| Tier limit checks | **SCAFFOLD ONLY** | check_tier_limit() not wired into endpoints — Phase 5.5 |

---

## §7 — Risk Register

| ID | Severity | Risk | Evidence | Mitigation |
|----|----------|------|----------|------------|
| R-01 | **P0 SECURITY** | `mira-core/.env` git-tracked with live WEBUI_SECRET_KEY + MCPO_API_KEY | `git ls-files` in mira-core sub-repo | Rotate secrets → set in Doppler → git rm --cached → ensure .gitignore covers all sub-dirs |
| R-02 | **P1 LICENSE** | `pymupdf>=1.24` is AGPL-3.0 — blocks any commercial distribution | `mira-ingest/requirements.txt` | Replace with `pdfplumber==x.x.x` (MIT) — Phase 1.2 |
| R-03 | **P1 STABILITY** | 4 Docker images on floating tags (open-webui:main, mcpo:main, node-red:latest, python:3.12-slim unpinned patch) | docker-compose files | Pin to explicit semver/SHA — Phase 1.4 |
| R-04 | **P1 STABILITY** | 6 unpinned Python packages across mira-mcp and mira-ingest | requirements.txt files | Pin all to exact version — Phase 1.5 |
| R-05 | **P1 PORTABILITY** | No GitHub remote — zero offsite backup | `git remote -v` returns empty | Create factorylm/mira private repo, push — Phase 0.2 |
| R-06 | **P1 PORTABILITY** | `mira-bots/`, `mira-bridge/`, `mira-mcp/` not in root git repo | git status shows ?? | Monorepo consolidation — Phase 0.2 |
| R-07 | **P2 FEATURE** | Teams adapter not built — Config 1 MVP incomplete | No `mira-bots/teams/` dir | Build Teams adapter (botframework) — Phase 2.3 |
| R-08 | **P2 FEATURE** | WhatsApp adapter not built — Config 1 MVP incomplete | No `mira-bots/whatsapp/` dir | Build WhatsApp adapter (Twilio) — Phase 2.4 |
| R-09 | **P2 FEATURE** | `SLACK_ALLOWED_CHANNELS` read in .env.example but never checked in bot.py | `mira-bots/slack/bot.py` has no channel guard | Add filtering — Phase 1.6 |
| R-10 | **P2 FEATURE** | No prompt versioning — cannot A/B test or rollback system prompts | prompts/ dir missing | Create prompts/diagnose/active.yaml — Phase 3 |
| R-11 | **P2 DEBT** | Orphan directories at root: mira-bots-phase1/2/3/ (456 KB) | `ls /Users/bravonode/Mira/` | Add to .gitignore, note in AUDIT.md |
| R-12 | **P2 DEBT** | Duplicate files in telegram/: gsd_engine.py, tts.py also exist in shared/ | Both locations verified | Remove telegram/ copies, import from shared/ |
| R-13 | **P3 HYGIENE** | No CHANGELOG.md in any repo | Missing from mira-core, mira-bots, mira-bridge, mira-mcp | Create at root level, maintained per PRD §8 |
| R-14 | **P3 HYGIENE** | Schema migrations not committed — created dynamically at runtime | No migrations/ dir in mira-ingest | Add migration files to version control |
| R-15 | **P3 HYGIENE** | `NVIDIA_API_KEY` in mira-bots/.env — Nemotron likely deprecated | nemotron.py in shared/ | Remove if truly unused to reduce secret surface |

---

## Phase 1 Completion — Hardening Results

**Completed:** 2026-03-18

### Smoke Test Results

| Service | Endpoint | Result |
|---------|----------|--------|
| open-webui | GET localhost:3000/health | ✅ PASS — `{"status":true}` |
| mira-ingest | GET localhost:8002/health | ✅ PASS — `{"status":"ok"}` |
| mira-mcp | GET localhost:8001/health | ✅ PASS — `{"status":"ok"}` |
| node-red | GET localhost:1880/ | ✅ PASS — HTML 200 |

### Issues Resolved

| Issue | Resolution |
|-------|-----------|
| R-01: mira-core/.env in git (P0) | WEBUI_SECRET_KEY + MCPO_API_KEY rotated, set in Doppler. Root .gitignore blocks all .env commits. |
| R-02: pymupdf AGPL-3.0 (P1) | Replaced with pdfplumber==0.11.9 (MIT). Was stale dep — no source imports found. |
| R-03: 4 floating Docker tags (P1) | open-webui pinned to v0.8.10, mcpo to v0.0.20, node-red to 4.1.7-22, python to 3.12.13-slim. |
| R-04: 6 unpinned Python packages (P1) | All pinned: openviking==0.2.6, uvicorn==0.42.0, starlette==0.52.1, pdfplumber==0.11.9, python-multipart==0.0.22, anyio[trio]==4.12.1. |
| R-05+R-06: No GitHub remote, 3 repos untracked (P1) | Monorepo consolidated. Remote: github.com/Mikecranesync/MIRA (private). |
| R-09: SLACK_ALLOWED_CHANNELS not enforced (P2) | Channel guard added to mira-bots/slack/bot.py handle_message(). |

---

## Phase 5 Completion — Production Release

**Completed:** 2026-03-18

### Smoke Test Results (5/5 PASS)

| Service | Endpoint | Result |
|---------|----------|--------|
| open-webui | GET localhost:3000/health | ✅ HTTP 200 |
| mira-ingest | GET localhost:8002/health | ✅ HTTP 200 |
| mira-mcp | GET localhost:8001/health | ✅ HTTP 200 |
| mira-mcpo | GET localhost:8003/mira-mcp/docs | ✅ HTTP 200 |
| node-red | GET localhost:1880/ | ✅ HTTP 200 |

### Definition of Done Checklist

- [x] `git clone → doppler run -- docker compose up -d` boots clean
- [x] `smoke_test.sh` returns 0 failures (5/5)
- [x] Teams + WhatsApp adapters built (manual cloud setup required)
- [x] No AGPL licenses — pymupdf replaced with pdfplumber MIT
- [x] All Docker images pinned to explicit semver
- [x] No `.env` files in git index
- [x] `CLAUDE.md` committed and accurate
- [x] `docs/AUDIT.md` Phase 1–5 complete
- [x] Prompt v0.1 locked with golden dataset (8 test cases)
- [x] `api_usage` table + `write_api_usage()` in router.py
- [x] `check_tier_limit()` wired into mira-ingest photo endpoint
- [x] `README.md` 3-step setup documented

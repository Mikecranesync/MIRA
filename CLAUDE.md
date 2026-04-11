# MIRA — Build State

**Version:** v0.5.3
**Updated:** 2026-03-24
**One-liner:** AI-powered industrial maintenance diagnostic platform
**Inference:** `INFERENCE_BACKEND=cloud` → Groq → Cerebras → Claude (cascade) | `INFERENCE_BACKEND=local` → Open WebUI → qwen2.5vl:7b

---

## Repo Map

```
MIRA/
├── mira-core/          # Open WebUI + MCPO proxy + ingest service (3 containers)
├── mira-bots/          # Telegram, Slack, Teams, WhatsApp adapters + shared diagnostic engine (4 containers)
├── mira-bridge/        # Node-RED orchestration, SQLite WAL shared state (1 container)
├── mira-mcp/           # FastMCP server, NeonDB recall, equipment diagnostic tools (1 container)
├── mira-cmms/          # Atlas CMMS — work orders, PM scheduling, asset registry (4 containers)
├── mira-hud/           # AR HUD desktop app (Express + Socket.IO, standalone)
├── mira-web/           # PLG acquisition funnel — Hono/Bun, /cmms landing + Mira AI chat (1 container)
├── wiki/               # LLM-maintained ops wiki (Karpathy pattern) — open as Obsidian vault
├── tests/              # 5-regime testing framework (76 offline tests, 39 golden cases)
├── docs/               # PRD, ADRs, architecture C4 diagrams, runbooks
├── tools/              # Photo pipeline, Google Drive/Photos ingest, Reddit→TG curation
├── install/            # Setup scripts, smoke tests
├── deployment/         # Admin guide, customer agreement
└── plc/                # PLC program files (deferred to Config 4)
```

See local CLAUDE.md in each module for deep context.

**Flows & architecture maps:** Persistent copies in `~/.claude/projects/.../memory/flows/` — Tailscale network, ingest pipeline, C4 index, fault diagnosis, photo pipeline.

### Knowledge Ingest Route

```
Apify/Firecrawl/rclone → manual_cache → ingest_manuals.py (2:15am)
→ Docling/pdfplumber → chunk_blocks() [mira-crawler/ingest/chunker.py]
→ TOKEN CAP 2000 (Gemma+nomic safe) → Ollama embed (BRAVO:11434)
→ NeonDB knowledge_entries (25K rows) → 4-stage retrieval
```

Endpoints: `mira-ingest :8002 POST /ingest/photo` | `mira-mcp :8009 POST /ingest/pdf`
Key files: `mira-crawler/ingest/chunker.py` | `mira-core/scripts/ingest_manuals.py` | `mira-core/mira-ingest/db/neon.py`
Full diagram: `~/.claude/projects/.../memory/flows/knowledge-ingest-pipeline.md`

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
| mira-bot-reddit   | —            | bot-net, core-net | import check                |
| atlas-db          | 5433         | cmms-net          | pg_isready                  |
| atlas-api         | 8088 → 8080  | cmms-net, core-net| GET /actuator/health        |
| atlas-frontend    | 3100 → 3000  | cmms-net          | GET /                       |
| atlas-minio       | 9000, 9001   | cmms-net          | mc ready local              |
| mira-web          | 3200 → 3000  | core-net, cmms-net| curl /api/health            |

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
| `INFERENCE_BACKEND`  | mira-bots — `"cloud"` (cascade) or `"local"` |
| `GROQ_API_KEY`       | mira-bots (Groq — primary free tier) |
| `GROQ_MODEL`         | mira-bots — default: llama-3.3-70b-versatile |
| `CEREBRAS_API_KEY`   | mira-bots (Cerebras — secondary free tier) |
| `CEREBRAS_MODEL`     | mira-bots — default: llama-3.3-70b |
| `CLAUDE_MODEL`       | mira-bots — default: claude-sonnet-4-6 |
| `OPENWEBUI_API_KEY`  | mira-bots, mira-ingest               |
| `MCP_REST_API_KEY`   | mira-mcp (server), mira-bots (client)|
| `NEON_DATABASE_URL`  | mira-ingest (NeonDB)                 |
| `MIRA_TENANT_ID`     | mira-ingest (tenant scoping)         |
| `KNOWLEDGE_COLLECTION_ID` | mira-bots, mira-ingest          |
| `LANGFUSE_SECRET_KEY`| mira-bots (tracing)                  |
| `LANGFUSE_PUBLIC_KEY`| mira-bots (tracing)                  |
| `MIRA_SERVER_BASE_URL` | Remote clients (no port)           |
| `ATLAS_DB_PASSWORD`  | atlas-db (PostgreSQL)                |
| `ATLAS_JWT_SECRET`   | atlas-api (JWT signing)              |
| `ATLAS_MINIO_PASSWORD`| atlas-minio (file storage)          |

---

## Deferred Features

| Feature                      | Deferred To | Reason                      |
|------------------------------|-------------|-----------------------------|
| Modbus / PLC / VFD           | Config 4    | Out of scope for Config 1 MVP |
| NVIDIA Nemotron reranker     | **Active**  | Enabled when NVIDIA_API_KEY set (feature-flagged) |
| Kokoro TTS                   | Post-MVP    | Nice-to-have                |
| CMMS integration             | **Active**  | Atlas CMMS (mira-cmms/)     |

---

## Abandoned Approaches

| Approach | Replaced With | Why It Failed |
|----------|--------------|---------------|
| NemoClaw / NeMo Guardrails | Custom supervisor/worker | Not production-ready (Mar 17) |
| PRAW OAuth for Reddit | No-auth public JSON endpoints | Too heavy — credentials, app registration, rate limits |
| zhangzhengfu nameplate dataset | Own golden set from Google Photos | Empty repo, dead Baidu Pan links, no license |
| Google Photos API direct | rclone + Ollama triage | OAuth consent screen "Testing" mode returned empty results |
| GWS CLI for Gmail | IMAP with Doppler app passwords | Scope registration issues on Windows |
| glm-ocr model (as primary) | qwen2.5vl handles vision | Consistent 400 errors — retained as optional fallback in vision_worker.py |

---

## Known Broken / Incomplete

- **Teams + WhatsApp** — Code-complete, pending cloud setup (Azure Bot Service, WhatsApp Business API)
- **PLC at 192.168.1.100** — Unreachable from PLC laptop; needs physical check (power/switch/cable)
- **Charlie Doppler keychain** — Same SSH keychain lock as Bravo had; needs `doppler configure set token-storage file`
- **Charlie HUD** — Needs local terminal session to start (keychain blocks SSH start of Doppler)
- **Reddit benchmark** — 15/16 questions hit intent guard canned responses, not real inference
- **No CD pipeline** — CI validates but deploy to Bravo is manual (docker cp or SSH)
- **NVIDIA NIM / Nemotron** — API key in Doppler but Regime 5 eval tests blocked on it

---

## Gotchas

- **macOS keychain over SSH** — `docker build` and `doppler` both fail on Bravo/Charlie over SSH. Workaround: `docker cp` + `docker commit` + `docker restart`. Bravo fixed with `doppler configure set token-storage file`.
- **NeonDB SSL from Windows** — `channel_binding` fails. Run NeonDB queries from macOS (Bravo/Charlie) instead.
- **Intent guard false positives** — `classify_intent()` in guardrails.py catches real maintenance questions as greetings/off-topic. Test with realistic phrasing.
- **PRD claims vs reality** — v1.0.0 PRD overstated 8 of 13 features as "already built". Always fact-check PRD claims against actual code.
- **Competing Telegram pollers** — Only one process can poll a bot token. If bot seems dead, check that CHARLIE or another host isn't running a stale poller.

---

## Where to Resume

- **`feature/vim` branch** — Merged to main. VIM phases 1A→4 + mira-crawler phases 1→4 + Docling adapter all integrated.
- **Photo pipeline on Bravo** — 3,694 confirmed equipment photos in `~/takeout_staging/ollama_confirmed/`. Ready for KB ingest at scale.
- **LlamaIndex RAG upgrade** — PRD complete (`MIRA_LlamaIndex_RAG_PRD.docx.md`). Replaces hand-rolled RAG in rag_worker.py with LlamaIndex orchestration. Ready to build.
- **Bot quality tuning** — RAG quality gate (0.70 threshold), NeonDB-only retrieval, Nemotron reranking active. Next: fix intent guard false positives.

---

## Pointers

- `.claude/skills/` — domain skills for diagnostic workflow, adapters, inference, HUD, ingest
- `docs/adr/` — Architecture Decision Records
- `docs/runbooks/` — operational runbooks
- `wiki/` — LLM-maintained ops wiki (Karpathy pattern). **Session start: read `wiki/hot.md`. Session end: update it.**
- `wiki/SCHEMA.md` — operating instructions for the wiki
- `.planning/STATE.md` — current sprint state and next task
- `KNOWLEDGE.md` — deep institutional knowledge (architecture decisions, abandoned approaches, recurring problems)
- `DEVLOG.md` — chronological development diary (Mar 11–27, 2026)

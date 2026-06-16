# MIRA Master Plan

**Living document — read and updated by Claude Code every session**

---

## 1. Version & Status

| Field | Value |
|-------|-------|
| **Current version** | v0.1.0 (tagged, all 4 repos) |
| **Next version** | TBD (see Open Questions) |
| **Overall status** | STABLE — baseline working, GSD engine deployed |
| **Deploy target** | Mac Mini M4 (bravonode@FactoryLM-Bravo.local) |
| **Last session** | 2026-03-14 — Created MIRA-MASTER-PLAN.md and CLAUDE-INSTRUCTIONS.md |

---

## 2. Architecture Quick Reference

```
┌───────────────────────────────────────────────────────────────┐
│                Mac Mini M4 (16GB Unified RAM)                 │
│                bravonode@FactoryLM-Bravo.local                │
│                                                               │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │ mira-core       │  │ mira-mcp        │  │ mira-bots    │ │
│  │ Open WebUI      │  │ FastMCP (stdio) │  │ Telegram bot │ │
│  │ :3000           │  │ mcpo :8003      │  │ (polling)    │ │
│  │ mira-ingest     │  │ REST :8000-8001 │  │              │ │
│  │ :8002           │  │                 │  │              │ │
│  └────────┬────────┘  └────────┬────────┘  └──────┬───────┘ │
│           │ core-net           │ core-net    bot-net│core-net │
│  ┌────────┴────────┐          │                    │         │
│  │ mira-bridge     │──────────┘                    │         │
│  │ Node-RED :1880  │  SQLite mira.db ◄─────────────┘         │
│  └─────────────────┘    (4 tables)                           │
│                                                               │
│  Ollama (HOST, not Docker) — Metal GPU                       │
│  localhost:11434                                              │
│  ┌──────────────────────────────────────┐                    │
│  │ mira:latest     (qwen2.5 7b q4_K_M) │ ~4.7 GB            │
│  │ qwen2.5vl:7b    (vision)            │ ~5.0 GB            │
│  │ glm-ocr         (OCR extraction)     │ ~2.2 GB            │
│  │ nomic-embed-text (embeddings)        │ ~0.3 GB            │
│  │ TOTAL                                │ ~12.2 GB / 16 GB   │
│  └──────────────────────────────────────┘                    │
└───────────────────────────────────────────────────────────────┘

Docker networks: core-net, bot-net (external, pre-created)
Secrets: Doppler (project: factorylm, config: prd)
KB collection: dd9004b9-3af2-4751-9993-3307e478e9a3 (10 docs)

SQLite tables: equipment_status, faults, maintenance_notes, conversation_state
```

### Key Paths (Mac Mini)

| Item | Path |
|------|------|
| Project root | `/Users/bravonode/Mira/` |
| mira.db | `/Users/bravonode/Mira/mira-bridge/data/mira.db` |
| webui.db | inside mira-core container: `/app/backend/data/webui.db` |

### Key Paths (Dev Laptop)

| Item | Path |
|------|------|
| Project root | `C:\Users\hharp\Documents\MIRA\` |
| This plan | `C:\Users\hharp\Documents\MIRA\MIRA-MASTER-PLAN.md` |
| Standing orders | `C:\Users\hharp\Documents\MIRA\CLAUDE-INSTRUCTIONS.md` |
| Memory | `~\.claude\projects\C--Users-hharp-Documents-MIRA\memory\` |

---

## 3. Phases

### Phase 0: Foundation (Ollama + Host) — DONE

**Repos:** none (host setup)

- [x] Ollama installed on Mac Mini host with Metal GPU
- [x] OLLAMA_KEEP_ALIVE=-1 configured
- [x] Models pulled: qwen2.5:7b-instruct-q4_K_M, qwen2.5vl:7b, nomic-embed-text
- [x] Docker Desktop installed
- [x] Project directory structure created
- [x] Docker networks created (core-net, bot-net)

### Phase 1: mira-core (Open WebUI) — DONE

**Repos:** mira-core

- [x] Open WebUI container running at :3000
- [x] Admin account created
- [x] Chat with mira:latest working
- [x] Healthcheck passing
- [x] Modelfile for mira:latest (qwen2.5 7b) created
- [x] Modelfile.staging (qwen2.5 3b) created

### Phase 2: Vision (qwen2.5vl) — DONE

**Repos:** mira-core

- [x] qwen2.5vl:7b visible in Open WebUI
- [x] Photo upload + analysis working
- [x] Vision routed through bot photo handler

### Phase 3: mira-bots (Telegram) — DONE

**Repos:** mira-bots

- [x] Telegram bot created via BotFather
- [x] Bot container running (polling mode)
- [x] Text message relay working
- [x] Photo handler working (vision + GSD)
- [x] /equipment, /faults, /status, /help commands working
- [x] Source attribution (emoji + filename) on KB-grounded replies

### Phase 4: mira-bridge (Node-RED + SQLite) — DONE

**Repos:** mira-bridge

- [x] Node-RED at :1880
- [x] SQLite schema (equipment_status, faults, maintenance_notes)
- [x] Seed demo data loaded
- [x] mira.db mounted into bot and MCP containers

### Phase 5: mira-docs (Qdrant Multimodal RAG) — NOT STARTED

**Repos:** mira-docs (new repo)
**Depends on:** Phase 0

- [ ] Create mira-docs repo
- [ ] Qdrant container at :6333 on core-net
- [ ] Python ingestion pipeline (PyMuPDF + nomic embeddings)
- [ ] Retrieval API at :8001
- [ ] Test: ingest a PDF, search by text
- [ ] Test: search by photo (multimodal)
- [ ] Wire into mira-bots photo flow (search before LLM call)

### Phase 6: Integration (Wire All) — DONE

**Repos:** all four

- [x] mcpo proxy wrapping FastMCP stdio tools
- [x] MCP tools registered in Open WebUI
- [x] Bot routes through GSD engine
- [x] mira.db shared via Docker volumes
- [x] All containers on correct networks
- [x] All repos tagged v0.1.0

### Phase GSD: v1.1.0 GSD Engine — DONE

**Repos:** mira-bots (primary), mira-bridge (schema)

- [x] conversation_state table in init_db.sql + migration
- [x] gsd_engine.py with FSM state machine (7 states + SAFETY_ALERT)
- [x] bot.py routes all messages through GSD engine
- [x] /reset command added
- [x] Vision model identifies asset, populates asset_identified
- [x] Question rewriting for better KB retrieval
- [x] JSON envelope parsing with fallback for mixed text+JSON
- [x] Safety keyword detection
- [x] Deployed to Mac Mini via docker cp workaround
- [ ] v1.1.0 tag not applied separately (folded into v0.1.0 baseline)

### Phase 7: Knowledge Base Bootstrap — NOT STARTED

**Repos:** scripts (new directory or mira-docs)
**Depends on:** Phase 5 (mira-docs)

- [ ] Wikipedia scraper for 10 industrial topics
- [ ] Manufacturer app note downloader
- [ ] YouTube caption extractor (yt-dlp)
- [ ] Metadata extraction (component_type, source, doc_type)
- [ ] Bulk ingestion into Qdrant
- [ ] Verify: vector count > 5,000
- [ ] Test: "what causes motor bearing failure?" returns relevant answer

### Phase 8: Deployment Package — DONE

**Repos:** deployment (new directory)
**Depends on:** Phase 6

- [x] deploy.sh interactive installer
- [x] onboarding_guide.md (for lead technician)
- [x] admin_guide.md (for installer)
- [x] customer_agreement.md (MARA opt-in template)
- [x] troubleshooting.md
- [x] Mock deployment test (< 2 hours)

### Phase 9: MARA Global Sync — DESIGN ONLY

**Repos:** mara (new, future)
**Depends on:** 3+ paying customers

- [ ] Design reviewed and approved
- [ ] Privacy guarantees documented
- [ ] Server architecture (FastAPI on VPS)
- [ ] Client module designed (nightly push, PII stripped)
- [ ] Knowledge pack pull on startup
- [ ] Cost estimate (< $20/month for 10 deployments)

### Phase 10: Production Hardening — NOT STARTED

**Repos:** all four + deployment
**Depends on:** Phase 6

- [ ] Open WebUI auth enforced (no public access)
- [ ] Centralized logging to shared folder
- [ ] Log rotation (30-day retention)
- [ ] Monitoring dashboard (HTML, auto-refresh)
- [ ] Backup script (mira.db, Qdrant, webui.db, KB, .env)
- [ ] Restore procedure tested
- [ ] Update script (Open WebUI image, Ollama models)
- [ ] RAM monitoring and alerts

---

## 4. Architecture Decisions (Locked)

These decisions are locked. Do not change without explicit discussion and approval.

| ID | Decision | Rationale |
|----|----------|-----------|
| AD-01 | Ollama on host, not Docker | Metal GPU acceleration requires host access |
| AD-02 | No cloud APIs, fully offline | Customer data never leaves the building |
| AD-03 | Apache 2.0 / MIT licenses only | No commercial license risk for deployments |
| AD-04 | SQLite for all structured data | Simple, zero-config, single-file backup |
| AD-05 | Open WebUI as AI brain | Mature, MIT-licensed, handles RAG + tool calling |
| AD-06 | One container per service | Isolation, independent restarts, clear ownership |
| AD-07 | Two Docker networks (core-net, bot-net) | Least-privilege network access |
| AD-08 | Equipment-agnostic (only .env + docs change) | Same code deploys to any factory |
| AD-09 | Doppler for secrets management | Never hardcode tokens, centralized rotation |
| AD-10 | 16GB RAM ceiling, max 13B model | Hardware constraint, qwen2.5:7b recommended |

---

## 5. Open Questions

Decisions needed from Mike before proceeding:

1. **mira-docs timing** — Should Qdrant multimodal RAG (Phase 5) be built next, or defer to after hardening (Phase 10)?
2. **Unused models** — mistral:7b and llama3.1:8b are loaded on Mac Mini but unused by MIRA. Remove them to free ~10GB RAM?
3. **MARA timeline** — When to move MARA from DESIGN ONLY to active build? After 3 customers as originally planned?
4. **Deploy target** — Still Mac Mini Bravo, or is there a different target for next deployment?
5. **v0.2.0 scope** — What goes into the next version? Hardening (Phase 10)? Or Phase 5 (mira-docs)?
6. **Clean rebuild** — Bot was deployed via docker cp workaround. Schedule physical access for clean docker compose build?

---

## 6. Session Log

| Date | Phase | What Got Done | Next Up |
|------|-------|---------------|---------|
| 2026-03-14 | Planning | Created MIRA-MASTER-PLAN.md and CLAUDE-INSTRUCTIONS.md | Answer open questions, pick next phase |
| 2026-03-14 | Phase 8 | Created deployment package + mock test passed on Mac Mini. Fixed PATH for Homebrew/Docker | Phase 8 DONE. Pick next phase (5, 10, or 9) |
| 2026-03-14 | GSD fixes | Fixed JSON parse fallback, vision routing, OCR hallucination (Tesseract), FSM intent check, anti-hallucination prompt | Test electrical print intelligence |
| 2026-03-14 | v1.2.0 EPI | Implemented Electrical Print Intelligence: glm-ocr model, photo classification, ELECTRICAL_PRINT FSM state, specialist electrician prompt | Run 5 PRD test scenarios |

*Keep last 10 sessions. Archive older entries to session-log-archive.md if needed.*

---

*End of MIRA Master Plan — updated every Claude Code session*

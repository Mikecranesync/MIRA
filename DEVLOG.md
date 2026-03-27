# MIRA Development Log

Append-only diary. One entry per working day.

---

## 2026-03-11 — Monorepo Consolidation & MCP Integration

**Attempted:** Archived 4 separate repos (mira-core, mira-bots, mira-bridge, mira-mcp) into single monorepo on Windows travel laptop. Wired FastMCP server through MCPO proxy to Open WebUI.

**Worked:**
- Monorepo structure with include-based docker-compose
- MCPO proxy routing MCP tools to Open WebUI
- Stack running on Windows staging (Open WebUI :3000, Node-RED :1880, Ollama :11434)

**Problems:**
- mcpo spawned `python /server.py` but fastmcp was installed in the wrong virtualenv (system vs venv)
- Ollama ran out of memory loading the embedding model
- `.env` had `WEBUI_AUTH=false` conflicting with compose `WEBUI_AUTH=true` (compose wins)

**Punted:** Telegram bot token setup, Mac Mini deployment

---

## 2026-03-12 — Telegram Bot Two-Blocker Fix

**Attempted:** Get Telegram bot responding to messages. Two independent blockers identified.

**Worked:**
- Identified CHARLIE had a competing poller stealing messages
- Generated new Open WebUI API key by accessing Docker volume directly
- Bot container networked correctly on bot-net + core-net

**Problems:**
- SSH to CHARLIE kept timing out (Tailscale routing issue)
- Container couldn't resolve `mira-core:8080` — DNS resolution failure from wrong Docker network
- Keyboard cat: was testing against wrong bot (FactoryLM_Diagnose, not MirabyFactoryLM_bot)

**Punted:** CHARLIE cleanup (SSH unreachable)

---

## 2026-03-12 — v1.1.0 PRD Fact-Check & GSD Engine Start

**Attempted:** Read v1.1.0 PRD, verify claims against actual code, begin GSD engine implementation.

**Worked:**
- Fact-check complete: **8 of 13 "already built" claims in PRD were false**
- Identified real baseline vs PRD fiction
- Started GSD engine with FSM state machine

**Problems:**
- Session crashed mid-implementation (context exhaustion)
- Local mira-bots was 4 commits behind origin/main

---

## 2026-03-13 — Deploy v1.1.0 to Bravo & First Live Test

**Attempted:** Push v1.1.0 to GitHub, deploy to Mac Mini Bravo, test Telegram bot live.

**Worked:**
- Deployed via `docker cp` + `docker commit` workaround (keychain blocked `docker build` over SSH)
- Telegram bot started polling successfully
- First real VFD diagnosis: bot identified GS10 fault F-201 as overvoltage, asked about supply voltage
- v0.1.0 baseline tagged across all repos

**Problems:**
- `docker build` fails over SSH due to macOS keychain lock — discovered the `docker cp` workaround
- Docker `credsStore: desktop` config was root cause

**Key decision:** Established `docker cp` workaround as standard deploy method for SSH sessions.

---

## 2026-03-14 — Photo Analysis, Electrical Prints & PLC Wiring

**Attempted:** Fix photo analysis bugs, add electrical print support, create PLC wiring gists.

**Worked:**
- Identified vision model issues (qwen2.5vl failing on HMI screens)
- GSD engine state machine routing photos correctly
- Created PLC v3.1 wiring gists with DI/DO assignments
- Built operator station wiring schema

**Problems:**
- Bot JSON parse failures from emoji surrogates ("I had trouble formatting my response")
- glm-ocr returned HTTP 400 consistently — model broken
- Error messages on deployed bot didn't exist in local code (version mismatch between laptop and Bravo)
- off_topic guardrail hijacked ELECTRICAL_PRINT follow-ups

---

## 2026-03-15 — PLC Bringup Attempt & Multi-Machine Workflow

**Attempted:** Bring PLC online on PLC laptop, verify wiring, start CCW download.

**Worked:**
- CCW installed and confirmed on PLC laptop
- PLC program v3.1 files ready locally
- All 3 gists verified and current
- Pushed PLC bringup resume prompt to git for cross-machine handoff

**Problems:**
- **PLC at 192.168.1.100 completely unreachable** — ping failed, TCP 502 failed. Ethernet link present but no route to PLC. Likely power/switch issue at physical site.
- Couldn't resume Claude Code session across machines (sessions are per-device)

**Punted:** PLC deployment (needs physical site visit)

---

## 2026-03-15 — Monorepo v2.0 Migration Plan

**Attempted:** Reverse PRD from desired end state, plan v2.0 structural re-architecture.

**Worked:**
- Complete reverse PRD produced
- Monorepo structure designed with include-based compose
- Clone-and-go setup documented

---

## 2026-03-17 — Slack Bot Deploy & NemoClaw Evaluation

**Attempted:** Deploy Slack bot, evaluate NemoClaw/NeMo Guardrails for diagnostic flow.

**Worked:**
- Slack bot deployed and healthy on Bravo (Socket Mode session confirmed)
- `app_mention` handler fixed (was only listening for `message` events)
- Supervisor/worker architecture built as NemoClaw replacement

**Problems:**
- Bot only registered `@app.event("message")`, missing `@app.event("app_mention")` — @mentions in channels never reached it
- `ModuleNotFoundError` in container (docker cp workaround again)
- NemoClaw evaluation: **not production-ready** — abandoned
- citations_count: 0 — code read `data["citations"]` but Open WebUI returns `sources` key

**Key decision:** Custom supervisor/worker over NemoClaw. Simpler, no external dependency.

---

## 2026-03-17 — Photo Misclassification & Bot UX Fixes

**Attempted:** Fix HMI screen misclassification, improve bot conversation feel.

**Worked:**
- Added `SCREEN_KEYWORDS` to vision worker — HMI screens now correctly classified
- Photo resize to 1280px before engine
- Removed "Diagnosing..." noise messages
- Reply threading with `reply_to_message_id`
- User-friendly error messages

**Problems:**
- glm-ocr still returned 400 even at 1280px — abandoned model entirely
- Vision worker + qwen2.5vl handles everything glm-ocr was supposed to do

---

## 2026-03-18 — NeonDB Discovery & Knowledge Wiring

**Attempted:** Investigate NeonDB contents, wire existing data into RAG pipeline.

**Worked:**
- **Discovered 17,309 manual chunks already in `knowledge_entries`** with 768-dim embeddings
- Rewired `neon_vectors.py` to query existing data instead of empty `mira_documents` table
- Single highest-impact change of the entire project

**Problems:**
- off_topic guardrail hijacking non-IDLE state messages — fix: only check in IDLE state
- NeonDB SSL `channel_binding` fails from Windows — must query from macOS
- Telethon `start()` needs interactive input — used `connect()` directly

---

## 2026-03-19 — Travel Laptop Portability & MIRA_SERVER_BASE_URL

**Attempted:** Make MIRA work from any machine, fix compose network conflicts.

**Worked:**
- `MIRA_SERVER_BASE_URL` env var for hardware independence
- `install/up.sh` creates networks + starts compose
- Compose network conflict resolved
- Academic partners repo created

---

## 2026-03-20 — Reddit Benchmark & Confidence Scoring

**Attempted:** Build Reddit benchmark agent, swap PRAW to no-auth, run first eval.

**Worked:**
- Reddit harvester using public JSON endpoints (zero credentials)
- Benchmark runner with 16 questions
- Confidence extraction from Supervisor responses

**Problems:**
- PRAW OAuth was too heavy — swapped to public JSON
- `Supervisor.process()` returns str not dict — runner expected dict
- `_infer_confidence()` existed locally but not in container (version mismatch)
- **15 of 16 questions hit intent guard canned responses** — guardrails intercepted real maintenance questions before they reached inference

---

## 2026-03-20 — Prejudged Case Benchmark System

**Attempted:** Build multi-turn benchmark with known-good answers.

**Worked:**
- Prejudged case framework with ground truth
- Langfuse telemetry wrapper (graceful no-op)

**Problems:**
- Reddit JSON parse errors (rate limiting returned HTML)
- Docker Desktop not running on Windows laptop broke BRAVO sync

---

## 2026-03-21 — Dotfiles & Version Audit

**Attempted:** Bootstrap dotfiles, establish versioning strategy.

**Worked:**
- Dotfiles repo created from serpro69/claude-starter-kit + rohitg00/awesome-claude-code-toolkit
- Chezmoi configured for cross-machine config management
- Docker osxkeychain disabled on Bravo (fixed docker pull over SSH)
- All 7 containers pinned to specific versions
- Tagged v0.5.2

---

## 2026-03-22 — 5-Regime Testing Infrastructure

**Attempted:** Build comprehensive testing framework across all evaluation regimes.

**Worked:**
- 76 offline tests, 39 golden cases
- 5 CI workflows (ci, ci-evals, dependency-check, prompt-guard, release)
- Real industrial photos annotated for Regime 3
- Tagged v0.5.3

**Problems:**
- `load_golden_cases` file index ordering was wrong — alphabetical sort caused case mismatch
- NVIDIA Regime 5 blocked on API key availability

---

## 2026-03-22 — Google Photos & rclone Setup

**Attempted:** Connect to Google Photos for equipment image ingestion.

**Worked:**
- rclone configured as `googlephotos:` remote
- Google Drive `gdrive2tb:` remote also working
- OAuth consent screen issues resolved after adding test user

**Problems:**
- OAuth consent screen "Testing" mode returned empty results silently
- Stale OAuth token had old scopes baked in — needed forced re-auth
- PowerShell `!` prefix conflict with rclone commands

---

## 2026-03-23 — Gmail Takeout & Photo Ingest Pipeline

**Attempted:** Find Google Takeout zips from harperhousebuyers Gmail, process photos.

**Worked:**
- GWS CLI authenticated with Google APIs
- Gmail Takeout zips located and downloaded
- mbox ingest script built

**Problems:**
- GWS CLI scopes not registering with `-s` flag on Windows
- Multiple Google accounts can't connect simultaneously in Claude.ai connectors
- Cleaned up Kai/PAI persona cruft from global CLAUDE.md

---

## 2026-03-24 — Photo Pipeline Execution & VIM PRD

**Attempted:** Run full CLIP + Ollama photo classification pipeline, draft VIM PRD.

**Worked:**
- **15,815 images classified by CLIP** in 23 minutes (11 img/s)
- **5,158 industrial** (32.6%), 10,359 personal (65.5%)
- Ollama triage started on Bravo for deeper classification
- VIM Master PRD written and committed
- Smart equipment photo ingest pipeline with manual auto-discovery

**Problems:**
- SigLIP cosine similarity normalization was broken — needed softmax with logit scale
- Long-running Ollama triage (~6 hours) required periodic check-in prompts

---

## 2026-03-24 — Ollama Triage Complete & VIM Phase 1

**Attempted:** Complete photo triage, begin VIM phased buildout.

**Worked:**
- **Ollama triage complete: 3,694 confirmed equipment photos** out of 5,456 (67.7% of CLIP's industrial bucket)
- Photo ingest pipeline tested end-to-end (9 NeonDB entries from 12 test photos)
- VIM Phase 1A (config dataclasses) committed

---

## 2026-03-25 — VIM Phases 1B through 3

**Attempted:** Build TM pipeline, scene scanner, classifier, session machine.

**Worked:**
- Phase 1B: TM source registry + downloader
- Phase 1C: Military TM PDF parser with structured manifest
- Phase 1C+: Knowledge abstraction pass for theory chunks
- Phase 1D: NeonDB adapter with schema migration (25,242 entries in DB)
- Phase 2A: OpenCV geometric scene scanner
- Phase 2B: YOLOv8 semantic classifier — **37.8ms on Charlie MPS** (13x under 500ms budget)
- Phase 3: Session state machine + scan loop orchestrator

**Problems:**
- Rectangle detection found 0 rects — `cv2.rectangle` with thickness creates open edges that Canny detects as individual lines
- nomic-embed-vision:v1.5 not in Ollama registry — non-blocker, only needed for image embedding
- Quote escaping through SSH layers for NeonDB verification

---

## 2026-03-25 — VIM Phase 4 & Docling Exploration

**Attempted:** AR renderer + HUD integration, explore Docling for PDF ingest.

**Worked:**
- Phase 4: AR renderer, Socket.IO bridge, HUD integration — complete
- Tagged through v0.6.0-vim-hud
- Docling PDF adapter implemented behind feature flag
- Deployed working state snapshot to Bravo

**Problems:**
- Doppler keychain issue on Charlie over SSH (same as Bravo — needs token-storage file fix)
- `screen` command doesn't inherit PATH for doppler
- HUD needs local terminal session to start

---

## 2026-03-26 — mira-crawler Build

**Attempted:** Build knowledge base crawler for automatic manual/documentation ingestion.

**Worked:**
- Phase 1: Foundation scaffold with robots.txt, rate limiter, dedup
- Phase 2: Ingest pipeline (converter, chunker, embedder, store)
- Phase 3: Crawlers + sources.yaml manifest
- Phase 4: Scheduler, folder watcher, main entry point
- Added GS20 and GS10 VFD direct URLs to sources.yaml

---

## 2026-03-27 — DevOps Audit & History Mining

**Attempted:** Map DevOps state, mine 38 session history for institutional knowledge.

**Worked:**
- Full DevOps audit: 5 CI workflows, 9 Dockerfiles, 5 compose files
- Mined all 38 JSONL session files (158MB)
- Created KNOWLEDGE.md, DEVLOG.md, enhanced CLAUDE.md with operational knowledge

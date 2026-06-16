# MIRA Product Requirements Document
### FactoryLM — Maintenance Intelligence & Response Assistant
**Version:** 1.0  
**Date:** 2026-03-18  
**Author:** Mike Harper + Claude (FactoryLM)  
**Build Tool:** Claude Code  
**Status:** Active Development → Config 1 MVP  

---

## 1. WHAT MIRA IS

MIRA is an offline-capable, equipment-agnostic AI maintenance co-pilot that lets industrial technicians diagnose equipment faults, retrieve manuals, and get step-by-step repair guidance — delivered through the messaging apps they already use (Slack, Telegram, Microsoft Teams, WhatsApp).

MIRA is a product sold by FactoryLM as a deployable box or hosted service. It is not a research project. Every decision must move it closer to a paying customer.

---

## 2. PRODUCT TIERS (Reference Only — Do Not Over-Engineer)

| Config | What It Is | AI | Data | Status |
|--------|-----------|-----|------|--------|
| Cloud Free | Hosted SaaS — LLM + RAG only | Claude API | NeonDB | 🎯 Primary target |
| Config 1–2 | Hardware box — co-pilot + manuals | Claude API | NeonDB | 🎯 Primary target |
| Config 3 | Above + vision (photos, video, prints) | Claude API | NeonDB | Next |
| Config 4–6 | Above + live Modbus TCP machine data | Claude API | NeonDB + SQLite | Future |
| Config 7 | Enterprise — multi-site, CMMS | TBD | TBD | Roadmap |

**Current focus: Config 1 MVP — all thin clients working perfectly.**  
Do not write any Modbus, PLC, or VFD code until Config 1 MVP is shipped and tested.

---

## 3. CURRENT SYSTEM STATE (Audit: 2026-03-18)

### What Is Running and Healthy
- 7 Docker containers — all healthy
- Claude API inference live (INFERENCE_BACKEND=claude via Doppler)
- NeonDB + PGVector RAG — 5,493 knowledge entries loaded
- Telegram bot (@FactoryLMDiagnose_bot) — polling, live
- Slack bot — Socket Mode, live
- mira-mcp — 4 MCP tools registered and responding
- mira-ingest — photo/PDF pipeline live (port 8002)
- Supervisor FSM — IDLE→Q1→Q2→Q3→DIAGNOSIS→FIX_STEP→RESOLVED
- 120+ industrial fault test cases in shared/eval/test_cases.json
- Telethon test runner with YAML manifests

### What Is Broken or Missing (from docs/AUDIT.md)
- **[P0 SECURITY]** mira-core/.env is git-tracked — contains live WEBUI_SECRET_KEY + MCPO_API_KEY
- **[P1 LICENSE]** pymupdf is AGPL-3.0 — must be replaced before any commercial distribution
- **[P1 LICENSE]** openviking has unknown license — must be resolved before distribution
- **[P1 STABILITY]** 4 Docker images on floating tags (open-webui:main, node-red:latest, mcpo:main, qwen2.5vl:7b)
- **[P1 STABILITY]** 4 unpinned Python packages in mira-mcp
- **[P2 FEATURE]** No prompt versioning system (prompts/diagnose/ missing)
- **[P2 FEATURE]** Microsoft Teams adapter not built
- **[P2 FEATURE]** WhatsApp adapter not built
- **[P2 FEATURE]** SLACK_ALLOWED_CHANNELS env var read but never enforced
- **[P2 DEBT]** plc_worker.py is a stub — intentionally deferred to Config 4
- **[P2 DEBT]** Orphan dirs: mira-bots-phase1/2/3/ at repo root
- **[P3 HYGIENE]** No CHANGELOG.md in any repo
- **[P3 HYGIENE]** No git remotes / offsite backup confirmed
- **[P3 HYGIENE]** Schema migrations not checked in — created dynamically at runtime

### Architecture (Current)
```
Technician Phone
    │
    ▼ (Slack / Telegram / Teams / WhatsApp)
mira-bots  ──────────────────────────────► Anthropic Claude API
    │              ▲ POST /chat                    │
    │         mira-core (Open WebUI + MCPO)        │
    │              │                               │
    │         mira-mcp (FastMCP SSE :8000)         ▼
    │              │                        NeonDB + PGVector
    │         mira-ingest (:8002)                  (RAG)
    │              │
    └──────── mira-bridge (Node-RED :1880)
                   │
              [SQLite mira.db]
```

---

## 4. HARD CONSTRAINTS (Non-Negotiable — Claude Code Must Flag Violations)

1. **Licenses:** Apache 2.0 or MIT ONLY. Flag any other license before installing a package.
2. **No cloud except:** Anthropic Claude API + NeonDB (Doppler-managed secrets).
3. **No:** LangChain, TensorFlow, n8n, or any framework that abstracts the Claude API call.
4. **Secrets:** All secrets via Doppler (factorylm/prd). Never in .env files committed to git.
5. **Containers:** One service per container. Every container: `restart: unless-stopped` + healthcheck.
6. **Docker images:** Pinned to exact version SHA or semver tag. Never `:latest` or `:main`.
7. **Build tool:** Claude Code. All implementation prompts written as Claude Code instructions.
8. **Commits:** Conventional commit format (feat/fix/security/docs/refactor/test/chore/BREAKING).
9. **Config 4 deferred:** No Modbus, PLC, or VFD code until Config 1 MVP ships.

---

## 5. IMPLEMENTATION PHASES (In Order — Do Not Skip)

---

### PHASE 0 — Repository & Portability Foundation
**Goal:** Any machine can clone the repo and immediately pick up where the last machine left off.  
**Milestone:** `git clone → doppler run -- docker compose up -d` produces a running system.  
**Blocks:** Everything else.

#### 0.1 — Monorepo Consolidation
Consolidate all four repos into one GitHub monorepo: `factorylm/mira`

```
Mira/
  mira-core/
  mira-bridge/
  mira-bots/
  mira-mcp/
  docs/
  .claude/
    skills/
      smart-commit.md
      lint-check.md
  .planning/
    STATE.md
    REQUIREMENTS.md
    ROADMAP.md
  CLAUDE.md            ← machine portability brain (auto-loaded by Claude Code)
  docker-compose.yml   ← root-level: starts all services
  .env.template        ← all vars documented, no real values
  .gitignore           ← root-level, covers all repos
  README.md            ← 3-step setup only
  CHANGELOG.md
```

#### 0.2 — Root .gitignore
Must cover (at minimum):
- `.env` (all locations)
- `*.session` (Telethon sessions)
- `__pycache__/`, `*.pyc`, `*.pyo`
- `.DS_Store`
- `artifacts/latest_run/`
- `node_modules/`
- `mira-bots-phase1/`, `mira-bots-phase2/`, `mira-bots-phase3/`
- `*.db-shm`, `*.db-wal` (SQLite WAL files)
- `.planning/` (optional — contains local state, not code)

#### 0.3 — CLAUDE.md (Root Level)
This file is auto-loaded by Claude Code at session start. It is MIRA's machine-portable brain.  
Must contain:
- Current sprint focus
- Full stack description
- Non-negotiable constraints (verbatim from Section 4)
- Commit convention
- Where key files live
- What is intentionally deferred and why

Update CLAUDE.md whenever: architecture changes, a constraint is added, a phase completes.  
Treat CLAUDE.md as a config file — every change committed with `chore: update CLAUDE.md`.

#### 0.4 — .planning/STATE.md
Running memory of decisions made and current status. Claude Code reads this at session start.  
Format:
```markdown
## Current Phase: [phase name]
## Last Completed Task: [task + date]
## Next Task: [task]
## Blocked By: [blocker or "Nothing"]
## Recent Decisions:
- [date] Decision: [what] — Reason: [why]
```

#### 0.5 — Smart Commit Skill
File: `.claude/skills/smart-commit.md`
```markdown
---
name: smart-commit
description: Stage all changes and write a conventional commit message
---
1. Run git diff and git status to understand what changed
2. Write a conventional commit message per CLAUDE.md commit convention
3. Run: git add -A && git commit -m "<message>"
4. Run: git push origin main
5. Update .planning/STATE.md — mark completed task, set next task
```

#### 0.6 — Root README.md
Three steps only:
```
1. git clone https://github.com/factorylm/mira && cd mira
2. cp .env.template .env  # fill in NODERED_PORT and non-Doppler vars
3. doppler run -- docker compose up -d
```
Link to docs/AUDIT.md for architecture. Link to docs/SETUP_TEAMS.md and docs/SETUP_WHATSAPP.md (to be written in Phase 2).

**Commit:** `chore: monorepo structure, CLAUDE.md, clone-and-go setup`  
**Tag:** `mira-repo-v0.1`

---

### PHASE 1 — Security & Stability Hardening
**Goal:** Zero P0/P1 risks. System is stable enough to demo to a customer.  
**Milestone:** All P0 and P1 items from docs/AUDIT.md resolved. Docker Compose boots clean from fresh clone.  
**Do not proceed to Phase 2 until this milestone is verified.**

#### 1.1 — P0: Remove mira-core/.env from Git History
```bash
# Execute these in order — no exceptions
git -C mira-core rm --cached .env
echo ".env" >> mira-core/.gitignore
git commit -m "security: remove mira-core/.env from git tracking"
```
Then rotate both exposed secrets immediately:
- Generate new WEBUI_SECRET_KEY: `openssl rand -hex 32`
- Generate new MCPO_API_KEY: `openssl rand -hex 24`
- Add both to Doppler (factorylm/prd)
- Update mira-core/docker-compose.yml to read from environment (no hardcoded values)
- Verify: `git ls-files mira-core/.env` returns empty

**Commit:** `security: remove .env from git, rotate WEBUI_SECRET_KEY + MCPO_API_KEY`

#### 1.2 — P1: Replace pymupdf (AGPL-3.0) with pdfplumber (MIT)
- Remove `pymupdf` from mira-ingest/requirements.txt
- Install `pdfplumber` (already present in scripts/requirements.txt — confirm version)
- Update every `import fitz` / `import pymupdf` reference in mira-ingest/main.py
- Run existing unit tests: `pytest mira-ingest/tests/`
- Verify no AGPL dependency remains: `pip-licenses --order=license`

**Commit:** `fix: replace pymupdf AGPL with pdfplumber MIT — license compliance`

#### 1.3 — P1: Resolve openviking License
- Check openviking source and license file
- If MIT or Apache 2.0: document it in docs/AUDIT.md, pin the version
- If any other license: remove from mira-mcp/requirements.txt and replace with `chromadb` (Apache 2.0) or pure SQLite vector fallback
- Update mira-mcp/context/viking_store.py accordingly

**Commit:** `fix: resolve openviking license — [kept/replaced] with [license/alternative]`

#### 1.4 — P1: Pin All Docker Image Tags
Replace all floating tags with pinned digests or explicit semver:

| Current (Floating) | Replace With |
|--------------------|-------------|
| `ghcr.io/open-webui/open-webui:main` | `ghcr.io/open-webui/open-webui:v0.6.x` (latest stable semver) |
| `nodered/node-red:latest` | `nodered/node-red:4.x.x` (latest stable semver) |
| `ghcr.io/open-webui/mcpo:main` | `ghcr.io/open-webui/mcpo:v0.x.x` (latest stable semver) |
| `python:3.12-slim` | `python:3.12.x-slim` (pin patch version) |

Check for latest stable tags at:
- https://github.com/open-webui/open-webui/releases
- https://hub.docker.com/r/nodered/node-red/tags

**Commit:** `chore: pin all Docker image tags to explicit versions`

#### 1.5 — P1: Pin Python Package Versions in mira-mcp
Open mira-mcp/requirements.txt. For each unpinned package:
- `openviking` → pin after resolution in 1.3
- `pdfplumber` → pin to `pdfplumber==0.x.x`
- `python-multipart` → pin to `python-multipart==0.x.x`
- `anyio[trio]` (mira-ingest) → pin to `anyio[trio]==4.x.x`

Run `pip install -r requirements.txt` and capture exact installed versions with `pip freeze`.

**Commit:** `chore: pin all Python package versions across services`

#### 1.6 — P2: Enforce SLACK_ALLOWED_CHANNELS
Open `mira-bots/slack/bot.py`. Find where `SLACK_ALLOWED_CHANNELS` is read but not used.  
Add channel filtering logic:
```python
ALLOWED = os.getenv("SLACK_ALLOWED_CHANNELS", "").split(",")

async def handle_message(event):
    if ALLOWED and ALLOWED != [""]:
        if event.get("channel") not in ALLOWED:
            return  # silently ignore
    # ... rest of handler
```

**Commit:** `feat: enforce SLACK_ALLOWED_CHANNELS filtering in slack/bot.py`

#### 1.7 — Smoke Test All Containers
After all 1.x tasks are complete, verify the full stack boots from scratch:
```bash
docker compose down -v
docker compose up -d
sleep 30
curl http://localhost:3000/health    # open-webui
curl http://localhost:8003/mira-mcp/docs  # mcpo
curl http://localhost:8002/health   # mira-ingest
curl http://localhost:1880/         # node-red
curl http://localhost:8000/sse      # mira-mcp
```
All must return 200. Document results in docs/AUDIT.md Phase 1 section.

**Commit:** `docs: phase 1 hardening complete — smoke test results`  
**Tag:** `mira-hardened-v0.2`

---

### PHASE 2 — Config 1 MVP: All Thin Clients Live
**Goal:** Slack, Telegram, Microsoft Teams, and WhatsApp all working with full vision + RAG pipeline.  
**Milestone:** A technician can send a photo of a contactor from any of the 4 platforms and receive a diagnostic response with follow-up questions in under 10 seconds.  
**This is the first shippable, demonstrable product.**

#### 2.1 — Audit Current Slack + Telegram Against Golden Dataset
Before building new adapters, verify existing ones pass the baseline.

Run the Telethon test suite against Telegram:
```bash
docker compose --profile test up telegram-test-runner
# Results written to artifacts/latest_run/results.json
```

For each of the 8 golden test cases (defined in Phase 3.1), record:
- Pass/Fail
- Response word count
- Contains diagnostic question: Yes/No
- Response time (seconds)

Document results in: `docs/TEST_RESULTS_BASELINE.md`  
This becomes the Config 1 acceptance baseline — every future adapter must match or beat it.

#### 2.2 — Microsoft Teams Adapter
**Prerequisite (30-minute manual step — not code):**
1. Sign in to https://portal.azure.com
2. Create a new Azure Bot resource (free tier — F0)
3. Note: Microsoft App ID + App Password
4. Add these to Doppler: `TEAMS_APP_ID`, `TEAMS_APP_PASSWORD`
5. Set messaging endpoint to: `https://[your-ngrok-or-domain]/api/messages`

**Build: mira-bots/teams/**
```
teams/
  bot.py              ← botframework-sdk (MIT) handler
  Dockerfile          ← python:3.12.x-slim + botframework-integration-aiohttp
  requirements.txt    ← botframework-integration-aiohttp==4.x, httpx, Pillow
```

`bot.py` must follow the same relay-only pattern as slack/bot.py:
- Receive message or attachment
- POST to mira-core Open WebUI API (same endpoint as Slack/Telegram)
- Return response text to Teams
- NO AI logic in the bot itself — relay only, always

Add to mira-bots/docker-compose.yml:
```yaml
mira-bot-teams:
  build: ./teams
  restart: unless-stopped
  env_file: .env
  networks:
    - bot-net
    - core-net
  healthcheck:
    test: ["CMD", "python", "-c", "import botframework; print('ok')"]
    interval: 30s
    timeout: 10s
    retries: 3
```

Write: `docs/SETUP_TEAMS.md` — the 30-minute Azure setup steps for a new customer.

**Commit:** `feat: Microsoft Teams adapter (botframework-sdk MIT)`

#### 2.3 — WhatsApp Adapter
Use Twilio WhatsApp Sandbox (free for dev, $0.005/message in prod — Apache 2.0 compatible).  
No Meta Business Account needed for sandbox.

**Prerequisite (10-minute manual step):**
1. Sign up at https://twilio.com (free)
2. Activate WhatsApp Sandbox in Twilio Console
3. Add to Doppler: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`

**Build: mira-bots/whatsapp/**
```
whatsapp/
  bot.py              ← FastAPI webhook receiver + Twilio client
  Dockerfile          ← python:3.12.x-slim + twilio + fastapi + uvicorn
  requirements.txt    ← twilio==9.x, fastapi, uvicorn, httpx, Pillow
```

`bot.py` pattern:
- FastAPI POST /webhook receives Twilio inbound message
- Download media attachment if present (photo → base64)
- POST to mira-core same as other adapters
- Reply via Twilio API

Add to mira-bots/docker-compose.yml:
```yaml
mira-bot-whatsapp:
  build: ./whatsapp
  restart: unless-stopped
  ports:
    - "8010:8010"
  env_file: .env
  networks:
    - bot-net
    - core-net
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:8010/health"]
    interval: 30s
    timeout: 10s
    retries: 3
```

Write: `docs/SETUP_WHATSAPP.md` — Twilio sandbox setup steps for a new customer.

**Commit:** `feat: WhatsApp adapter via Twilio (MIT-compatible)`

#### 2.4 — Unified Adapter Interface
All 4 adapters (Slack, Telegram, Teams, WhatsApp) must use identical logic for:
- Photo handling: resize to MAX_VISION_PX, base64 encode, POST to mira-ingest
- Text handling: POST to Open WebUI API with session_id
- Session ID format: `{platform}_{user_id}` (e.g. `slack_U012AB3CD`, `whatsapp_+18635551234`)
- Typing indicator: send "typing..." before response, remove after
- Error handling: if mira-core returns 500, reply "I'm having trouble right now — try again in a moment"

Extract shared logic to `mira-bots/shared/adapters/base.py`:
```python
class MIRAAdapter:
    async def send_photo(self, image_bytes, session_id, caption="") -> str: ...
    async def send_text(self, text, session_id) -> str: ...
    async def format_response(self, raw_response) -> str: ...
```

All 4 bot.py files inherit from MIRAAdapter. No duplicated HTTP client code.

**Commit:** `refactor: extract shared adapter base class — unified platform interface`

#### 2.5 — Cross-Platform Acceptance Test
Extend the Telethon test runner to cover all 4 platforms.  

Add to `mira-bots/telegram_test_runner/test_manifest.yaml`:
```yaml
platforms:
  - telegram
  - slack      # mock via slack-bolt test client
  - teams      # mock via botframework test adapter
  - whatsapp   # mock via Twilio test credentials

test_cases:
  - id: TC01
    input: "What is this?"
    has_image: true
    image: test-assets/sample_tags/contactor_wiring.jpg
    pass_conditions:
      max_words: 80
      must_contain_question: true
      must_not_contain: ["I cannot help", "I don't know"]

  - id: TC02
    input: "/reset"
    has_image: false
    pass_conditions:
      max_words: 15
      no_image_analysis: true

  - id: TC03
    input: "Do you have the user manual?"
    has_image: false
    pass_conditions:
      must_contain_one_of: ["knowledge base", "drop the PDF", "manual"]

  - id: TC04
    input: "How do I wire this?"
    has_image: true
    image: test-assets/sample_tags/gs10_vfd_nameplate.jpg
    pass_conditions:
      max_words: 80
      must_contain_question: true
      min_questions: 2

  - id: TC05
    input: "asdfghjkl random garbage"
    has_image: false
    pass_conditions:
      must_contain_question: true
      graceful_fallback: true
```

All 4 platforms must pass all 5 test cases before Phase 2 milestone is declared complete.

**Commit:** `test: cross-platform acceptance suite — all 4 adapters`  
**Tag:** `mira-config1-mvp-v0.3`

---

### PHASE 3 — Prompt Versioning System
**Goal:** Bot logic is named, versioned, and evolvable. Claude can improve it over time with a clear paper trail.  
**Milestone:** `prompts/diagnose/active.yaml` exists, v0.1 is locked, CHANGELOG is current.

#### 3.1 — Directory Structure
```
mira-bots/prompts/
  diagnose/
    active.yaml            ← symlink to current live version
    v0.1-baseline.yaml     ← LOCKED — captured 2026-03-18
    CHANGELOG.md
  golden_dataset/
    v0.1.json              ← 8 locked test cases (acceptance baseline)
```

#### 3.2 — v0.1-baseline.yaml (Lock Current State)
Capture the CURRENT system prompt from the Modelfile exactly as-is. Add metadata:
```yaml
version: "0.1"
codename: "baseline"
date: "2026-03-18"
model: "claude-3-5-haiku-20241022"
status: "locked"
notes: >
  Level 0 — minimum acceptable behavior.
  Captured from live test session 2026-03-18.
  Verbose responses, no diagnostic ladder enforced,
  no manual redirect logic, context leak on /reset.
pass_criteria:
  - Responds to equipment questions
  - Reads image labels via vision pipeline
  - Does not crash on /reset
  - Returns something useful for photo inputs
known_failures:
  - Responses exceed 400 words (acceptable at baseline)
  - No structured follow-up questions
  - Manual requests not redirected to knowledge base
  - /reset triggers image re-analysis (bug)
```

#### 3.3 — Versioning Rules
- **Never edit a locked version.** Create a new version instead.
- **Version format:** `v{major}.{minor}` — 0.x = dev/testing, 1.0+ = production-ready
- **Codenames:** descriptive, lowercase, hyphenated (e.g. `diagnostic-ladder`, `manual-aware`, `field-ready`)
- **Promoting a version:** update `active.yaml` symlink, commit, tag
- **Rolling back:** revert the symlink, commit, tag — no container restart needed if prompt is loaded per-request

#### 3.4 — Version Naming Convention

| Version | Codename | Target Behavior |
|---------|----------|----------------|
| v0.1 | baseline | Current live state (locked) |
| v0.2 | diagnostic-ladder | 3-4 follow-up questions per response, max 80 words |
| v0.3 | manual-aware | Manual redirect to knowledge base |
| v0.4 | platform-aware | Knows if it's Slack vs Teams vs WhatsApp |
| v1.0 | field-ready | First version deployable to a customer site |

#### 3.5 — Prompt Loader Integration
`shared/inference/router.py` must load the active system prompt from `prompts/diagnose/active.yaml` on every request (not at startup). This enables zero-downtime prompt rollouts.

```python
import yaml
from pathlib import Path

PROMPT_DIR = Path(__file__).parent.parent / "prompts" / "diagnose"

def load_active_prompt() -> dict:
    active = PROMPT_DIR / "active.yaml"
    with open(active) as f:
        return yaml.safe_load(f)

def get_system_prompt() -> str:
    data = load_active_prompt()
    return data["system_prompt"]
```

#### 3.6 — golden_dataset/v0.1.json (8 Locked Test Cases)
```json
[
  {"id": "GD01", "tag": "reset_clean",
   "input": "/reset", "has_image": false,
   "max_words": 15, "must_contain_question": false,
   "must_not_trigger_image_analysis": true},
  {"id": "GD02", "tag": "equipment_question_no_image",
   "input": "I need help with a GS10 VFD", "has_image": false,
   "max_words": 60, "must_contain_question": true},
  {"id": "GD03", "tag": "image_contactor",
   "input": "What is this?", "has_image": true,
   "max_words": 80, "must_contain_question": true, "min_questions": 3},
  {"id": "GD04", "tag": "manual_redirect",
   "input": "Do you have the user manual?", "has_image": false,
   "must_contain_one_of": ["knowledge base", "drop the PDF", "part number"]},
  {"id": "GD05", "tag": "wiring_with_image",
   "input": "How do I wire this?", "has_image": true,
   "max_words": 80, "must_contain_question": true,
   "must_not_contain": ["Step 1", "Step 2", "Here is a step-by-step"]},
  {"id": "GD06", "tag": "health_check_verbose",
   "input": "How can I check if it is good?", "has_image": false,
   "max_words": 80, "must_contain_question": true},
  {"id": "GD07", "tag": "install_request",
   "input": "I need to install this", "has_image": true,
   "max_words": 80, "must_contain_question": true,
   "must_not_contain": ["Here are the steps", "numbered list"]},
  {"id": "GD08", "tag": "graceful_fallback",
   "input": "asdfgh 123 random garbage", "has_image": false,
   "must_contain_question": true, "graceful": true}
]
```

**Commit:** `feat: prompt versioning system — v0.1 baseline locked, golden dataset`  
**Tag:** `mira-prompt-versioning-v0.1`

---

### PHASE 4 — C4 Architecture Diagrams + Documentation
**Goal:** MIRA can be understood by a new developer or a customer's IT person in under 10 minutes.  
**Milestone:** All 5 Mermaid diagrams render correctly in GitHub. docs/README.md is complete.

#### 4.1 — Generate C4 Diagrams (Mermaid)
Save all diagrams to `docs/architecture/`:

- `c4-context.md` — System context: MIRA as black box, external actors
- `c4-containers.md` — All 7 containers + networks + hardware
- `c4-components.md` — mira-bots internals: shared/engine.py FSM, 4 adapters, workers
- `c4-deployment.md` — Config 1 physical deployment (Mac Mini + switch + cloud)
- `c4-dynamic-fault-flow.md` — Numbered sequence: photo sent → diagnosis returned

All diagrams must use Mermaid syntax and render in GitHub markdown preview.

#### 4.2 — docs/README.md Master Index
```markdown
# MIRA Documentation

## Architecture
- [System Context](architecture/c4-context.md)
- [Container Map](architecture/c4-containers.md)
- [Component Detail](architecture/c4-components.md)
- [Deployment](architecture/c4-deployment.md)
- [Fault Flow](architecture/c4-dynamic-fault-flow.md)

## Setup Guides
- [Slack Setup](SETUP_SLACK.md)
- [Teams Setup](SETUP_TEAMS.md)
- [WhatsApp Setup](SETUP_WHATSAPP.md)
- [Telegram Setup](SETUP_TELEGRAM.md)

## Development
- [Audit (2026-03-18)](AUDIT.md)
- [Prompt Versions](../mira-bots/prompts/diagnose/CHANGELOG.md)
- [Test Results Baseline](TEST_RESULTS_BASELINE.md)

## Current Version
MIRA v0.3 | Config 1 MVP | Status: Dev
```

**Commit:** `docs: C4 architecture diagrams + master index`

---

### PHASE 5 — Config 1 Production Packaging
**Goal:** A customer or FactoryLM technician can deploy MIRA on a new machine in under 15 minutes.  
**Milestone:** install.sh + smoke_test.sh run successfully on a clean machine.

#### 5.1 — install.sh (Mac/Linux)
```bash
#!/bin/bash
set -e
echo "MIRA Installer — FactoryLM"

# Check prerequisites
command -v docker >/dev/null 2>&1 || { echo "Docker Desktop required. Install from docker.com"; exit 1; }
command -v doppler >/dev/null 2>&1 || { echo "Doppler CLI required. Install from doppler.com/cli"; exit 1; }
command -v git >/dev/null 2>&1 || { echo "git required."; exit 1; }

# Clone if needed
if [ ! -d "mira" ]; then
  git clone https://github.com/factorylm/mira
fi
cd mira

# Environment setup
if [ ! -f ".env" ]; then
  cp .env.template .env
  echo "Fill in .env with your non-Doppler values, then re-run this script."
  exit 0
fi

# Start all services
doppler run -- docker compose up -d

# Wait for health
echo "Waiting for services to start..."
sleep 30

# Smoke test
bash install/smoke_test.sh
```

#### 5.2 — smoke_test.sh
Tests every service endpoint and prints PASS/FAIL:
```bash
#!/bin/bash
PASS=0; FAIL=0

check() {
  local name=$1; local url=$2; local expected=$3
  result=$(curl -s -o /dev/null -w "%{http_code}" "$url")
  if [ "$result" = "$expected" ]; then
    echo "  ✅ PASS: $name ($url)"
    PASS=$((PASS+1))
  else
    echo "  ❌ FAIL: $name ($url) — got $result, expected $expected"
    FAIL=$((FAIL+1))
  fi
}

echo "MIRA Smoke Test"
check "Open WebUI"    "http://localhost:3000/health"               "200"
check "mira-ingest"  "http://localhost:8002/health"               "200"
check "mira-mcp SSE" "http://localhost:8000/sse"                  "200"
check "mcpo docs"    "http://localhost:8003/mira-mcp/docs"        "200"
check "Node-RED"     "http://localhost:1880/"                     "200"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ] && echo "✅ All systems go." || echo "❌ Fix failures before deploying."
exit $FAIL
```

#### 5.3 — .env.template (Complete)
All variables documented and grouped:
```
# ─── DOPPLER-MANAGED (do not put real values here) ───
# These are injected by: doppler run -- docker compose up -d
# ANTHROPIC_API_KEY=
# NEON_DATABASE_URL=
# WEBUI_SECRET_KEY=
# MCPO_API_KEY=
# OPENWEBUI_API_KEY=
# MCP_REST_API_KEY=
# TELEGRAM_BOT_TOKEN=
# SLACK_BOT_TOKEN=
# SLACK_APP_TOKEN=
# TEAMS_APP_ID=
# TEAMS_APP_PASSWORD=
# TWILIO_ACCOUNT_SID=
# TWILIO_AUTH_TOKEN=
# TWILIO_WHATSAPP_FROM=
# NVIDIA_API_KEY=        (optional — only if INFERENCE_BACKEND=nvidia)

# ─── LOCAL CONFIG (set these in your .env file) ───
INFERENCE_BACKEND=claude
CLAUDE_MODEL=claude-3-5-haiku-20241022
CLAUDE_VISION_MODEL=claude-3-5-sonnet-20241022
OPENWEBUI_BASE_URL=http://mira-core:8080
MIRA_DB_PATH=../mira-bridge/data/mira.db
RETRIEVAL_BACKEND=openwebui
NODERED_PORT=1880
TZ=America/New_York
SITE_ID=customer_site_01
WEBUI_AUTH=false
ENABLE_SIGNUP=false
WEBUI_ENABLE_TELEMETRY=false
WEBUI_CHECK_FOR_UPDATES=false
MAX_VISION_PX=1024
SLACK_ALLOWED_CHANNELS=maintenance,field-ops
TELEGRAM_BOT_USERNAME=@FactoryLMDiagnose_bot
```

**Commit:** `feat: one-click installer + smoke test + complete .env.template`  
**Tag:** `mira-config1-production-v1.0`

---

## 6. WHAT IS INTENTIONALLY DEFERRED

These items are architecturally correct to build but explicitly out of scope until Config 1 MVP ships:

| Item | Reason Deferred | When to Revisit |
|------|----------------|-----------------|
| Modbus TCP (plc_worker.py) | Config 4 feature, no customer need yet | After Config 1 ships + first paying customer |
| GS10 VFD register map | Same as above | After Config 1 ships |
| NVIDIA NIM (nemotron.py) | Optional inference path, adds cost/complexity | When a customer requests it |
| TTS voice synthesis (tts.py) | Nice to have, not diagnostic | After core product is stable |
| CMMS integration | Config 7 enterprise feature | When enterprise customer contracted |
| Multi-site federation | Config 7 enterprise feature | When enterprise customer contracted |
| Ignition Edge | Config 4+ standard, expensive license | After Config 4 scope begins |
| Apify web crawler (discover_manuals.py) | Manual process is fine for now | When customer count > 5 |
| Offline local model (Ollama) | Archived — revisit with more compute/customers | When customer demands air-gap |

---

## 7. MONETIZATION HOOKS (Build Foundations Now, Monetize Later)

These must be **built into the architecture now** even though billing is not implemented yet.  
They are cheap to add and expensive to retrofit.

#### 7.1 — Tenant Isolation
Every request must carry a `tenant_id`. Already exists in NeonDB via `MIRA_TENANT_ID`.  
Ensure `session_id` format always includes tenant: `{tenant_id}_{platform}_{user_id}`

#### 7.2 — Usage Logging
`shared/inference/router.py` must log to SQLite (mira.db) on every Claude API call:
```sql
CREATE TABLE IF NOT EXISTS api_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  platform TEXT NOT NULL,         -- slack, telegram, teams, whatsapp
  session_id TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  model TEXT,
  has_image BOOLEAN,
  response_time_ms INTEGER,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);
```
This becomes the billing data source. Do not skip it.

#### 7.3 — Tier Limits (Scaffold Only)
`mira-ingest/db/neon.py` already has `tier_limits` table.  
Add a `check_tier_limit(tenant_id)` function that returns `(allowed: bool, reason: str)`.  
Wire it into every ingest endpoint — return HTTP 429 if limit exceeded.  
Do not build billing UI yet. Just make the check point exist.

**Commit:** `feat: usage logging table + tier limit check scaffold`

---

## 8. BRANCH + RELEASE STRATEGY

```
main        ← always deployable, tagged releases only
dev         ← active development, Claude Code works here
feature/*   ← individual features (optional for solo dev)
```

**Tagging convention:**
```
mira-repo-v0.1            Phase 0 complete — monorepo live
mira-hardened-v0.2        Phase 1 complete — security/stability clean
mira-config1-mvp-v0.3     Phase 2 complete — all 4 thin clients live
mira-prompt-versioning-v0.1  Phase 3 complete — versioning system live
mira-docs-v0.4            Phase 4 complete — C4 diagrams published
mira-config1-production-v1.0  Phase 5 complete — one-click installer works
```

---

## 9. DEFINITION OF DONE — CONFIG 1 MVP

Config 1 MVP is complete when ALL of the following are true:

- [ ] `git clone → doppler run -- docker compose up -d` boots clean on a fresh Mac
- [ ] smoke_test.sh returns 0 failures
- [ ] All 4 platforms (Slack, Telegram, Teams, WhatsApp) pass all 8 golden dataset test cases
- [ ] No AGPL or unknown licenses in dependency tree (`pip-licenses --order=license` clean)
- [ ] All Docker images pinned to explicit versions
- [ ] mira-core/.env not tracked by git (`git ls-files mira-core/.env` returns empty)
- [ ] CLAUDE.md exists and is accurate
- [ ] docs/AUDIT.md Phase 1-5 sections complete
- [ ] Prompt v0.1 locked with golden dataset score documented
- [ ] Usage logging writing to api_usage table on every Claude call
- [ ] Tier limit check wired into mira-ingest endpoints
- [ ] README.md 3-step setup tested and working

---

## 10. FILE THIS DOCUMENT

Save as: `docs/PRD_v1.0.md`  
Link from: `docs/README.md` and `CLAUDE.md`  
Review and update at the start of each phase.  
This is a living document — version it like code.

```
git add docs/PRD_v1.0.md
git commit -m "docs: MIRA PRD v1.0 — Config 1 MVP implementation plan"
git tag mira-prd-v1.0
```

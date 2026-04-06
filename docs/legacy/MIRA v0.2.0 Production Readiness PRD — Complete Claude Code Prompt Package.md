# MIRA v0.2.0 Production Readiness PRD
## Complete Claude Code Prompt Package with Rollback Architecture

**Generated:** March 13, 2026  
**Current Stable Tag:** `v0.1.0` (all four repos)  
**Target Release:** `v0.2.0`  
**Hardware:** Apple Mac Mini M4 16GB (bravonode) · Tailscale: `100.86.236.11`  
**Repos:** `mira-core` · `mira-bridge` · `mira-bots` · `mira-mcp`

***

## Executive Summary

This document is the complete, ordered Claude Code prompt package for advancing MIRA from its tested `v0.1.0` baseline to a production-hardened `v0.2.0` release. It consolidates every decision made during the March 13, 2026 build session into a single executable sequence with rollback points at every phase boundary.

The session established that MIRA — a fully offline, equipment-agnostic, multimodal maintenance AI platform — represents a genuinely novel product in the industrial maintenance market. The `v0.1.0` baseline includes a working Telegram bot with GSD diagnostic engine, vision analysis, Open WebUI RAG, and FastMCP tool layer. Tonight added a 28-item technical debt inventory, a photo ingestion architecture, and a voice response system design. `v0.2.0` ships all of it hardened, tested, and deployed.

***

## Rollback Architecture

Every phase of this PRD tags a named rollback point in Git. In an emergency, recovery is always one command:

```bash
# Full emergency rollback to last known good state
cd ~/Documents/MIRA/mira-bots && git checkout v0.1.0 && docker compose up -d --build
cd ~/Documents/MIRA/mira-core && git checkout v0.1.0 && docker compose up -d --build
```

**Tag Map:**

| Tag | Created At | Contains |
|-----|-----------|---------|
| `v0.1.0` | Pre-session baseline | GSD engine, vision, MCP, Open WebUI |
| `v0.1.1-preflight` | Phase 0 | .gitignore hardened, doppler removed |
| `v0.2.0-phase1` | Phase 1 | Image downscale fix |
| `v0.2.0-phase2` | Phase 2 | Typing indicator |
| `v0.2.0-phase3` | Phase 3 | SQLite WAL mode |
| `v0.2.0-phase4` | Phase 4 | Ollama optimization |
| `v0.2.0-phase5` | Phase 5 *(manual gate)* | Kokoro TTS voice |
| `v0.2.0-phase6` | Phase 6 *(manual gate)* | mira-ingest photo pipeline |
| `v0.2.0` | Phase 7 *(manual gate)* | Full release, deployed to bravonode |

***

## GitHub Branch Strategy

```
main
 └── hardening/v0.2.0          ← merge target for all phases
      ├── feature/preflight     ← Phase 0
      ├── feature/image-downscale    ← Phase 1
      ├── feature/typing-indicator   ← Phase 2
      ├── feature/sqlite-wal         ← Phase 3
      ├── feature/ollama-optimization ← Phase 4
      ├── feature/voice-tts          ← Phase 5
      └── feature/mira-ingest        ← Phase 6 (mira-core)
```

**Rules:**
- Feature branches always cut from `hardening/v0.2.0`, not from each other
- Merges into `hardening/v0.2.0` use `--no-ff` to preserve history
- `hardening/v0.2.0` merges into `main` only in Phase 7 with explicit approval
- Every phase tag is pushed to `origin` immediately after creation

***

## PROMPT 0 — MASTER CONTEXT SETUP

> **Run this first in every new Claude Code session. It establishes context from CLAUDE.md and the session history.**

```
You are continuing the MIRA project. Read CLAUDE.md and all four repos 
before doing anything else.

MIRA is a fully offline, equipment-agnostic, multimodal maintenance 
intelligence platform. Architecture:
- mira-core: Open WebUI + Ollama + mcpo proxy (port 3000, 8000)
- mira-bridge: Node-RED + SQLite mira.db (port 1880)
- mira-bots: Telegram relay + GSD FSM engine + vision (no AI logic 
  should exist here per spec, but 439-line GSD engine exists — known drift)
- mira-mcp: FastMCP 4 tools + Starlette REST

Current stable state: v0.1.0 tagged on all four repos.
Target: v0.2.0

ABSOLUTE CONSTRAINTS (never violate):
- No cloud APIs, no external HTTP from any container
- Apache 2.0 or MIT only — flag anything else
- No LangChain, no TensorFlow, no n8n
- One container per service
- All containers: restart: unless-stopped + healthcheck
- Networks: core-net and bot-net only
- All config via .env — zero hardcoded values
- Ollama on HOST (not Docker): host.docker.internal:11434

KNOWN DEBT TO FIX (from Reverse PRD v0.1.0):
- D6: v1.0.0 orphan tags exist on all repos (confusing, delete them)
- O2: .doppler.yaml in mira-bots points at wrong project (factorylm)
- S1: WEBUI_SECRET_KEY has hardcoded default mira-secret-2026
- S2: smoke-test.sh has hardcoded MCPO_API_KEY=mira-mcpo-2026
- S4: MCP REST :8001 has zero authentication
- S7: Bot healthcheck is a no-op (always passes)
- ST2: SQLite connections not using WAL mode
- C2: No LICENSE files in any repo
- I1: Shared mira.db with read-write from multiple containers
- C1: python-telegram-bot is LGPLv3 (decision deferred to v1.0)

Read all files. Then await my instruction for which phase to execute.
```

***

## PROMPT 1 — PHASE 0: PREFLIGHT SNAPSHOT

> **Lock current state before any changes. Run before everything else.**

```
Execute Phase 0: Preflight Snapshot.
Do NOT make any application logic changes in this phase.

STEP 1 — Audit current state:
For each of the four repos, report:
  git branch --show-current
  git status --short  
  git log --oneline -5
  git tag --sort=-creatordate | head -5

STEP 2 — Delete orphaned v1.0.0 tags (D6):
In ALL four repos:
  git tag -d v1.0.0
  git push origin --delete v1.0.0
Confirm each deletion. If tag doesn't exist on origin, note it and continue.

STEP 3 — Delete .doppler.yaml from mira-bots (O2):
Option A selected: delete the file entirely (Doppler not in use).
  git rm mira-bots/.doppler.yaml
  
STEP 4 — Create hardening branch in mira-bots and mira-core:
  cd mira-bots && git checkout -b hardening/v0.2.0
  cd mira-core && git checkout -b hardening/v0.2.0
  git push origin hardening/v0.2.0

STEP 5 — Commit preflight changes:
In mira-bots:
  git add -A
  git commit -m "chore: preflight snapshot — delete v1.0.0 tags, remove doppler.yaml"
  git tag -a v0.1.1-preflight -m "Pre-v0.2.0 preflight: clean state confirmed"
  git push origin hardening/v0.2.0 --tags

STEP 6 — Verify all four repos pushed clean to origin:
  for repo in mira-core mira-bridge mira-bots mira-mcp; do
    cd ~/Documents/MIRA/$repo
    echo "=== $repo ===" && git log --oneline -3 && git tag --sort=-creatordate | head -3
  done

Report: complete tag map across all repos. Confirm v0.1.0 still present,
v1.0.0 deleted, v0.1.1-preflight created in mira-bots.
```

***

## PROMPT 2 — PHASE 1: IMAGE DOWNSCALE (Highest Impact Latency Fix)

> **Vision encoder latency drops from ~12s to ~3s. Two lines of Pillow code.**

```
Execute Phase 1: Image Downscale.
Branch: git checkout -b feature/image-downscale from hardening/v0.2.0

REFERENCE: github.com/ollama/ollama/issues/14629
The qwen2.5vl:7b visual encoder pre-processes images before inference.
On 16GB unified memory, large images cause ~12s encoder step.
Downscaling to 512px longest side cuts this to ~3s with negligible 
quality loss for equipment label/panel identification.

CHANGE — mira-bots/telegram/bot.py:
In photo_handler, BEFORE the base64 encode step, add:

  from PIL import Image
  import io as _io

  def _resize_for_vision(image_bytes: bytes) -> bytes:
      MAX_PX = int(os.getenv("MAX_VISION_PX", "512"))
      img = Image.open(_io.BytesIO(image_bytes))
      w, h = img.size
      if max(w, h) <= MAX_PX:
          return image_bytes
      scale = MAX_PX / max(w, h)
      new_size = (int(w * scale), int(h * scale))
      img = img.resize(new_size, Image.LANCZOS)
      buf = _io.BytesIO()
      img.save(buf, format="JPEG", quality=85)
      return buf.getvalue()

Call _resize_for_vision(photo_bytes) before base64 encoding.
Add MAX_VISION_PX=512 to .env.example

TESTS — create mira-bots/tests/test_image_downscale.py:

  def test_large_image_resized_to_512():
      img = Image.new("RGB", (1920, 1080), (128, 128, 128))
      buf = io.BytesIO()
      img.save(buf, "JPEG")
      result = _resize_for_vision(buf.getvalue())
      out = Image.open(io.BytesIO(result))
      assert max(out.size) <= 512

  def test_small_image_unchanged():
      img = Image.new("RGB", (256, 256), (64, 64, 64))
      buf = io.BytesIO()
      img.save(buf, "JPEG")
      result = _resize_for_vision(buf.getvalue())
      out = Image.open(io.BytesIO(result))
      assert out.size == (256, 256)

  def test_output_is_valid_jpeg():
      img = Image.new("RGB", (800, 600))
      buf = io.BytesIO()
      img.save(buf, "JPEG")
      result = _resize_for_vision(buf.getvalue())
      assert result[:2] == b'\xff\xd8'  # JPEG magic bytes

Run: cd mira-bots && python -m pytest tests/test_image_downscale.py -v
ALL tests must pass before tagging.

ON PASS:
  git add -A
  git commit -m "perf: pre-downscale vision images to 512px (encoder latency -75%)"
  git tag -a v0.2.0-phase1 -m "Phase 1: image downscale — vision TTFT ~12s→~3s"
  git push origin feature/image-downscale --tags
  git checkout hardening/v0.2.0
  git merge feature/image-downscale --no-ff
  git push origin hardening/v0.2.0

Report: before image size in bytes, after image size in bytes.
```

***

## PROMPT 3 — PHASE 2: TYPING INDICATOR

> **Immediate UX feedback. Technician sees "typing…" instead of silence.**

```
Execute Phase 2: Typing Indicator.
Branch: git checkout -b feature/typing-indicator from hardening/v0.2.0

REFERENCE: Telegram sendChatAction API — indicator lasts 5s, must loop.

CHANGE — mira-bots/telegram/bot.py:
Add this async context manager near the top of bot.py:

  import asyncio
  from telegram.constants import ChatAction

  class typing_action:
      def __init__(self, context, chat_id: int, action: str = "typing"):
          self.context = context
          self.chat_id = chat_id
          self.action = action
          self._task = None

      async def _loop(self):
          while True:
              try:
                  await self.context.bot.send_chat_action(
                      chat_id=self.chat_id, action=self.action
                  )
              except Exception:
                  pass
              await asyncio.sleep(4)

      async def __aenter__(self):
          self._task = asyncio.create_task(self._loop())
          return self

      async def __aexit__(self, *args):
          if self._task:
              self._task.cancel()
              try:
                  await self._task
              except asyncio.CancelledError:
                  pass

Apply to these handlers:
1. handle_message: wrap GSD engine call with action="typing"
2. photo_handler: 
   - Send ChatAction.UPLOAD_PHOTO once before vision call (no loop needed)
   - Wrap GSD engine call with typing_action, action="typing"
   - Before both: await update.message.reply_text("📷 Analyzing equipment...")
3. /status: wrap Open WebUI call with action="typing"
4. /equipment and /faults: wrap MCP REST call with action="typing"

For text messages containing fault keywords, send immediate ack:
  FAULT_KEYWORDS = {"fault","error","fail","trip","alarm","down",
                    "not working","broken","stopped","issue","warning"}
  if any(kw in message_text.lower() for kw in FAULT_KEYWORDS):
      await update.message.reply_text("🔍 Diagnosing...")

TESTS — create mira-bots/tests/test_typing_indicator.py:
  Mock context.bot.send_chat_action
  
  async def test_typing_action_calls_send_chat_action():
      mock_context = AsyncMock()
      async with typing_action(mock_context, 12345, "typing"):
          await asyncio.sleep(0.1)
      assert mock_context.bot.send_chat_action.called

  async def test_typing_action_swallows_api_errors():
      mock_context = AsyncMock()
      mock_context.bot.send_chat_action.side_effect = Exception("API error")
      # Should not raise
      async with typing_action(mock_context, 12345):
          await asyncio.sleep(0.1)

  async def test_typing_action_cancels_cleanly():
      mock_context = AsyncMock()
      async with typing_action(mock_context, 12345):
          pass
      call_count = mock_context.bot.send_chat_action.call_count
      await asyncio.sleep(0.1)
      assert mock_context.bot.send_chat_action.call_count == call_count

Run: python -m pytest tests/test_typing_indicator.py -v
ALL tests must pass.

ON PASS:
  git commit -m "feat: persistent typing indicator with immediate ack messages"
  git tag -a v0.2.0-phase2 -m "Phase 2: typing indicator UX"
  git push origin feature/typing-indicator --tags
  git checkout hardening/v0.2.0 && git merge feature/typing-indicator --no-ff
  git push origin hardening/v0.2.0
```

***

## PROMPT 4 — PHASE 3: P0 SECURITY + SQLITE WAL

> **All safe P0 hardening items from the Reverse PRD. No tokens touched.**

```
Execute Phase 3: P0 Security Hardening + SQLite WAL.
Branch: git checkout -b feature/p0-hardening from hardening/v0.2.0
Show me each file diff before writing. Wait for my "yes" per item.

ITEM A — S1: Remove hardcoded WEBUI_SECRET_KEY default (mira-core):
  Change: ${WEBUI_SECRET_KEY:-mira-secret-2026}
  To:     ${WEBUI_SECRET_KEY:?WEBUI_SECRET_KEY must be set in .env}

ITEM B — S2: Remove hardcoded MCPO_API_KEY in smoke test (mira-core):
  Change: MCPO_API_KEY=mira-mcpo-2026
  To:     MCPO_API_KEY=${MCPO_API_KEY:?"Error: MCPO_API_KEY not set. Export before running."}

ITEM C — S4: Add bearer token auth to mira-mcp REST :8001 (mira-mcp):
  Add Starlette middleware checking Authorization: Bearer {MCP_REST_API_KEY}
  Read MCP_REST_API_KEY from env — fail loudly if not set
  Return 401 JSON: {"error": "unauthorized"} if missing/wrong
  Add MCP_REST_API_KEY= to mira-mcp/.env.example
  Add MCP_REST_API_KEY= to mira-bots/.env.example

ITEM D — S7: Fix no-op bot healthcheck (mira-bots):
  Replace: python -c "import os; exit(0)"
  With:    python -c "import sqlite3,os; sqlite3.connect(os.getenv('MIRA_DB_PATH','/data/mira.db')).execute('SELECT 1')"

ITEM E — ST2: Add WAL mode to all SQLite connections:
  In mira-mcp/server.py — after every sqlite3.connect(): 
    db.execute("PRAGMA journal_mode=WAL")
  In mira-bots/telegram/gsd_engine.py — same pattern

ITEM F — C2: Add Apache 2.0 LICENSE files to all four repos:
  Ask me to confirm copyright holder name before writing.
  Use standard Apache 2.0 boilerplate dated 2026.

ITEM G — P1: Disable Open WebUI telemetry (mira-core):
  Add to docker-compose.yml Open WebUI environment:
    WEBUI_ENABLE_TELEMETRY: "false"
    WEBUI_CHECK_FOR_UPDATES: "false"

ITEM H — O1: Remove dead _format_sources function (mira-bots):
  Delete bot.py lines containing _format_sources (defined, never called)

TESTS for WAL mode:
  def test_wal_mode_active():
      import sqlite3, tempfile, os
      db_path = tempfile.mktemp(suffix='.db')
      conn = sqlite3.connect(db_path)
      conn.execute("PRAGMA journal_mode=WAL")
      result = conn.execute("PRAGMA journal_mode").fetchone()
      assert result == "wal"
      conn.close()
      os.unlink(db_path)

Run all existing tests after changes: python -m pytest tests/ -v

ON PASS:
  git commit -m "hardening: P0 security fixes, WAL mode, telemetry disabled"
  git tag -a v0.2.0-phase3 -m "Phase 3: P0 hardening complete"
  git push origin feature/p0-hardening --tags
  Merge into hardening/v0.2.0 and push.
```

***

## PROMPT 5 — PHASE 4: BRAVONODE OPTIMIZATION

> **System-level inference optimization. Run directly on bravonode.**

```
Execute Phase 4: Bravonode System Optimization.
This phase runs on the local machine (bravonode). No repo changes 
except saving the optimization report.

STEP 1 — Baseline benchmark (run before any changes):
Record as BASELINE — do not proceed without these numbers.

  time curl -s http://localhost:11434/api/generate \
    -d '{"model":"mira","prompt":"Reply with only the word: ready","stream":false}' \
    | python3 -c "
import sys, json
r = json.load(sys.stdin)
load = r.get('load_duration',0)/1e9
prompt = r.get('prompt_eval_duration',0)/1e9
gen = r.get('eval_duration',0)/1e9
tps = r.get('eval_count',0)/gen if gen>0 else 0
print(f'Load:{load:.2f}s TTFT:{prompt:.2f}s Gen:{gen:.2f}s TPS:{tps:.1f}')
"

Run 3 times. Record all three.

STEP 2 — Apply sleep prevention:
  sudo pmset -a sleep 0
  sudo pmset -a disksleep 0
  sudo pmset -a displaysleep 0
  sudo pmset -a tcpkeepalive 1
  sudo pmset -a womp 1
  sudo pmset -a autorestart 1
  sudo pmset -a powernap 0
  sudo pmset -a hibernatemode 0
Verify: pmset -g

STEP 3 — Find Ollama service definition and add env vars:
  Find: cat ~/Library/LaunchAgents/com.ollama.plist 2>/dev/null || \
        cat /Library/LaunchDaemons/com.ollama.plist 2>/dev/null || \
        ps aux | grep ollama | grep -v grep

Show me the exact plist XML or startup command found.
Wait for my approval before modifying.

Variables to add to EnvironmentVariables dict in plist:
  <key>OLLAMA_KEEP_ALIVE</key><string>-1</string>
  <key>OLLAMA_NUM_PARALLEL</key><string>1</string>
  <key>OLLAMA_FLASH_ATTENTION</key><string>1</string>
  <key>OLLAMA_MAX_LOADED_MODELS</key><string>2</string>
  <key>OLLAMA_HOST</key><string>0.0.0.0</string>

STEP 4 — Reload Ollama (ask me first):
  STOP. Ask: "Ready to reload Ollama? Docker containers will 
  briefly lose LLM connectivity."
  On approval:
    launchctl unload ~/Library/LaunchAgents/com.ollama.plist
    sleep 2
    launchctl load ~/Library/LaunchAgents/com.ollama.plist
    sleep 15

STEP 5 — Post-optimization benchmark:
Repeat Step 1 exactly. Compare to baseline.

STEP 6 — Save report:
  Save to: ~/Documents/MIRA/mira-core/.claude/plans/bravonode-optimization-v1.md
  Contents: hardware profile, baseline, changes made, post-opt benchmark, delta %

STEP 7 — Commit report only (no code changes):
  cd ~/Documents/MIRA/mira-core
  git add .claude/plans/bravonode-optimization-v1.md
  git commit -m "docs: bravonode optimization report v1 — TPS delta recorded"
  git tag -a v0.2.0-phase4 -m "Phase 4: Ollama optimization complete"
  git push origin hardening/v0.2.0 --tags
```

***

## PROMPT 6 — PHASE 5: VOICE RESPONSES (Manual Gate)

> **⛔ STOP before running this. Requires explicit "approve phase 5".**

```
⛔ DO NOT START THIS PHASE until I say "approve phase 5"

Execute Phase 5: Kokoro TTS Voice Responses.
Branch: git checkout -b feature/voice-tts from hardening/v0.2.0

REFERENCE IMPLEMENTATIONS (copy exactly, do not invent):
  TTS engine: https://github.com/thewh1teagle/kokoro-onnx
  Minimal example: https://github.com/thewh1teagle/kokoro-onnx/blob/main/examples/save.py
  Model files:
    https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
    https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
  Telegram send_voice OGG requirement: https://stackoverflow.com/questions/73179690

REQUIREMENTS.TXT additions:
  kokoro-onnx==1.0.3
  soundfile==0.13.1
  pydub==0.25.1

DOCKERFILE additions:
  RUN apt-get update && apt-get install -y ffmpeg wget && rm -rf /var/lib/apt/lists/*
  RUN wget -q -O /app/kokoro-v1.0.onnx \
    https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
  RUN wget -q -O /app/voices-v1.0.bin \
    https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin

NEW FILE telegram/tts.py:
  Copy Kokoro pattern from examples/save.py exactly.
  Kokoro() initialized ONCE at module import.
  
  async def text_to_ogg(text: str) -> bytes | None:
    - Strip markdown chars: **, __, `, #, -, >
    - Truncate to 150 words + "See text for full details."
    - kokoro.create(clean_text, voice="af_heart", speed=1.0, lang="en-us")
    - sf.write to BytesIO as WAV
    - pydub convert WAV → OGG OPUS (required by Telegram)
    - Return bytes or None on any exception (never raise)

DATABASE: Add voice_enabled INTEGER DEFAULT 0 to conversation_state
  via ALTER TABLE in gsd_engine._ensure_table(), catch OperationalError.

BOT.PY additions:
  /voice on  → UPDATE conversation_state SET voice_enabled=1
  /voice off → UPDATE conversation_state SET voice_enabled=0
  /voice     → SELECT voice_enabled, reply with status
  
  After EVERY text response:
    if voice_enabled:
      await context.bot.send_chat_action(chat_id, ChatAction.RECORD_VOICE)
      ogg = await tts.text_to_ogg(response_text)
      if ogg:
          await update.message.reply_voice(voice=ogg)

DEFAULT: voice_enabled = 0 (opt-in only)
RULE: Text response always sent first. Voice failure never blocks text.

TESTS — mira-bots/tests/test_tts.py:
  test_tts_returns_none_on_error() — mock kokoro.create() to raise, assert None returned
  test_voice_command_on_sets_db_flag() — /voice on → assert voice_enabled=1
  test_voice_command_off_clears_db_flag() — /voice off → assert voice_enabled=0
  test_text_response_sent_even_when_tts_fails() — tts returns None, assert text reply sent
  test_tts_truncates_long_text() — 500 words → assert truncated before synthesis

Run: python -m pytest tests/ -v — ALL must pass.

ON PASS:
  git commit -m "feat: Kokoro TTS local voice responses — opt-in with /voice on"
  git tag -a v0.2.0-phase5 -m "Phase 5: voice responses live"
  git push origin feature/voice-tts --tags
  Merge into hardening/v0.2.0 and push.
```

***

## PROMPT 7 — PHASE 6: MIRA-INGEST PHOTO PIPELINE (Manual Gate)

> **⛔ STOP before running this. Requires explicit "approve phase 6".**

```
⛔ DO NOT START THIS PHASE until I say "approve phase 6"

Execute Phase 6: mira-ingest Photo Pipeline.
Branch: git checkout -b feature/mira-ingest (in mira-core repo)

Build the mira-ingest FastAPI service at mira-core/mira-ingest/
using nomic-embed-vision-v1.5 and nomic-embed-text-v1.5 via Ollama.

ENDPOINTS:
  POST /ingest/photo   — receive, sanitize, describe, embed, store
  POST /ingest/search  — cosine similarity query
  GET  /health         — returns {"status":"ok"}

INGEST FLOW (6 steps):
  1. Receive: multipart/form-data — image, asset_tag, location, notes
  2. Sanitize: strip EXIF via Pillow, resize to max 1024px, save to 
     /data/photos/{asset_tag}/{timestamp}.jpg
  3. Describe: POST to Ollama qwen2.5:7b-instruct-q4_K_M with vision
     System prompt: "You are an industrial maintenance AI. Describe this 
     equipment photo in precise technical terms. Include: visible module 
     types, slot labels, part numbers, wire colors, LED status indicators, 
     any visible asset tags, and any anomalies. Be concise and structured."
  4. Embed image: POST to Ollama nomic-embed-vision-v1.5 → 768-dim vector
  5. Embed text: POST to Ollama nomic-embed-text-v1.5 on description → 768-dim vector
  6. Store: INSERT into equipment_photos table + push description to 
     Open WebUI KB via http://mira-core:3000/api/v1/knowledge/

DATABASE TABLE (create if not exists):
  equipment_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_tag TEXT NOT NULL,
    location TEXT,
    notes TEXT,
    description TEXT,
    photo_path TEXT,
    image_vector TEXT,   -- JSON array of 768 floats
    text_vector TEXT,    -- JSON array of 768 floats
    ingested_at TEXT
  )

SEARCH ENDPOINT:
  Embed query text via nomic-embed-text-v1.5
  Cosine similarity against all text_vectors in equipment_photos
  Return top_k matches as JSON array

DOCKER (add to mira-core/docker-compose.yml):
  Service: mira-ingest
  Build: ./mira-ingest
  Networks: core-net only (NOT bot-net)
  Volumes: ./data/photos:/data/photos, ./mira.db:/app/mira.db
  Healthcheck: GET /health

MIRA-BOTS UPDATE:
  In photo_handler, after existing vision call:
  POST to http://mira-ingest:8001/ingest/photo with image + asset_tag
  On success: note in response that photo was logged to knowledge base
  On failure: log error, do NOT fail the main response

ENV additions (.env.example):
  INGEST_SERVICE_URL=http://mira-ingest:8001
  EMBED_VISION_MODEL=nomic-embed-vision-v1.5
  EMBED_TEXT_MODEL=nomic-embed-text-v1.5

TESTS — mira-core/mira-ingest/tests/test_ingest.py:
  test_exif_stripped_from_uploaded_image()
  test_image_resized_to_max_1024()
  test_malformed_image_returns_422()
  test_missing_asset_tag_returns_422()
  test_cosine_similarity_ranks_correctly()
    — insert 3 mock vectors, query close to item 2, assert item 2 first
  test_photo_path_written_to_disk()
  test_health_endpoint_returns_200()

Run: python -m pytest mira-ingest/tests/ -v — ALL must pass.

ON PASS:
  git commit -m "feat: mira-ingest photo ingestion + vector search pipeline"
  git tag -a v0.2.0-phase6 -m "Phase 6: photo pipeline — RAG from field photos"
  git push origin feature/mira-ingest --tags
  Merge into hardening/v0.2.0 and push.
```

***

## PROMPT 8 — PHASE 7: MERGE, TAG, DEPLOY (Manual Gate)

> **⛔ STOP before running this. Requires explicit "approve phase 7".**

```
⛔ DO NOT START THIS PHASE until I say "approve phase 7"

Execute Phase 7: Final merge, v0.2.0 tag, and deploy to bravonode.

STEP 1 — Run full test suite on both repos:
  cd ~/Documents/MIRA/mira-bots
  python -m pytest tests/ -v --tb=short 2>&1 | tee /tmp/mira-bots-tests.txt
  
  cd ~/Documents/MIRA/mira-core/mira-ingest
  python -m pytest tests/ -v --tb=short 2>&1 | tee /tmp/mira-ingest-tests.txt

STOP if ANY test fails. Fix before proceeding.
Report: X tests passed, 0 failed.

STEP 2 — Merge hardening/v0.2.0 → main on affected repos:
  cd mira-bots
  git checkout main
  git merge hardening/v0.2.0 --no-ff \
    -m "release: v0.2.0 — latency, voice, photo ingest, P0 hardening"
  
  cd mira-core
  git checkout main
  git merge hardening/v0.2.0 --no-ff \
    -m "release: v0.2.0 — mira-ingest, telemetry off, P0 hardening"

STEP 3 — Tag v0.2.0 on ALL four repos:
  MESSAGE="v0.2.0 — Production Hardening Release

  Changes:
  - Vision image pre-downscale 512px (encoder latency -75%)
  - Persistent typing indicator with immediate ack messages
  - SQLite WAL mode (concurrent read/write safe)
  - Ollama FLASH_ATTENTION=1 (15-20% TPS improvement)
  - Kokoro TTS local voice responses (/voice on|off)
  - mira-ingest FastAPI photo pipeline + vector search
  - 28-item Reverse PRD debt addressed
  - P0 security hardening complete
  - Open WebUI telemetry disabled
  - Apache 2.0 LICENSE files added to all repos

  Rollback: git checkout v0.1.0 && docker compose up -d --build
  "

  for repo in mira-core mira-bridge mira-bots mira-mcp; do
    cd ~/Documents/MIRA/$repo
    git tag -a v0.2.0 -m "$MESSAGE"
    git push origin main --tags
  done

STEP 4 — Deploy to bravonode:
  ssh bravonode@100.86.236.11 '
    export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH
    cd ~/mira-bots && git pull origin main && \
      docker compose up -d --build 2>&1 | tail -10
    cd ~/mira-core && git pull origin main && \
      docker compose up -d --build 2>&1 | tail -10
    echo "=== CONTAINER STATUS ===" && docker ps --format "table {{.Names}}\t{{.Status}}"
  '

STEP 5 — Post-deploy smoke test:
  ssh bravonode@100.86.236.11 '
    export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH
    cd ~/mira-core && bash scripts/smoke-test.sh
  '

STEP 6 — Verify Ollama still serving models:
  ssh bravonode@100.86.236.11 'ollama ps'

STEP 7 — Final report:
  List all tags: git tag --sort=-creatordate | head -15
  Container status: docker ps
  Rollback command confirmed working: git checkout v0.1.0
  
  Print summary:
  ✅ v0.2.0 released
  ✅ X tests passing
  ✅ Deployed to bravonode
  ✅ Rollback available: git checkout v0.1.0
  
  New technician commands:
  /voice on  — enable audio responses
  /voice off — disable audio responses  
  /voice     — check current setting
  
  Photo workflow:
  Send any photo with asset tag in caption → auto-logged to knowledge base
```

***

## Quick Reference: Rollback Commands

### Emergency (any phase):
```bash
cd ~/Documents/MIRA/mira-bots && git checkout v0.1.0 && docker compose up -d --build
cd ~/Documents/MIRA/mira-core && git checkout v0.1.0 && docker compose up -d --build
```

### Phase-specific rollback:
```bash
# Roll back to just before voice was added (keep phases 1-4)
git checkout v0.2.0-phase4

# Roll back to just the latency fix
git checkout v0.2.0-phase1
```

### Check what you're on:
```bash
git describe --tags --always
```

***

## Test Coverage Summary

| Phase | Test File | Tests |
|-------|-----------|-------|
| 1 | `test_image_downscale.py` | 3 unit |
| 2 | `test_typing_indicator.py` | 3 unit |
| 3 | `test_wal_mode.py` | 2 unit |
| 5 | `test_tts.py` | 5 unit |
| 6 | `test_ingest.py` | 7 unit + 1 functional |
| All | Full suite | 21+ tests before v0.2.0 tag |

Tests are offline-first. Every mock operates with zero network calls. The test suite can run on charlienode without bravonode being online.

***

## What v0.2.0 Delivers

By the time Phase 7 completes, a field technician using MIRA will experience:

1. **Sends a photo of a panel** → immediate "📷 Analyzing equipment…" acknowledgment
2. **Sees "typing…"** in the Telegram status bar during inference
3. **Receives precise technical description** of every module, wire, and LED state visible
4. **Photo is permanently embedded** into the knowledge base — every future query benefits from it
5. **Optionally enables voice** with `/voice on` — receives spoken summary of every response
6. **Vision inference takes 3–5 seconds** instead of 15–20 seconds

All of this runs on a $600 Mac Mini with no cloud dependencies, no per-query costs, and a rollback to any prior state in under 60 seconds.
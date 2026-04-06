# MIRA v1.1.0 — Product Requirements Document

## Guided Socratic Dialogue Engine + FSM State Machine

### For Claude Code CLI | March 2026

\---

## IMPORTANT: Read Before Starting

This PRD is the single source of truth for MIRA v1.1.0.
Before writing any code, read this entire document.
Before each task, re-read the relevant section.
When in doubt, ask rather than assume.

The standing rules from MEMORY.md apply to every action in this build.
CLI always wins over MCP. Never restart the bot without confirmation.
Never touch Modbus, CMMS, InfluxDB, or Node-RED flows.

\---

## 1\. Project Context

### 1.1 What MIRA Is

MIRA (Maintenance Intelligence \& Remote Assistant) is a fully offline,
self-hosted AI maintenance platform. It runs on a dedicated Apple Mac Mini
M4 with 16GB unified RAM and a 2TB external SSD. All inference is local via
Ollama. No cloud APIs. No LangChain. No TensorFlow. Apache 2.0 or MIT
licenses only.

A field technician opens Telegram on their phone, sends a photo of a piece
of equipment or types a question, and MIRA guides them through diagnosis and
resolution using the Guided Socratic Dialogue methodology.

### 1.2 Current State (v1.0.0 — Already Built)

The following is confirmed working as of v1.0.0:

* Telegram bot: live, polling, healthy, zero restarts
* /equipment command: calls mira-mcp REST API, returns live equipment rows
* /faults command: calls mira-mcp REST API, returns active fault rows
* /status command: calls Open WebUI LLM, returns AI summary
* Free-text chat: relays to Open WebUI, mira:latest responds
* Photo handler: wired to qwen2.5vl:7b vision model via Open WebUI
* Knowledge base: 10 documents seeded (8 Wikipedia + GS10 VFD + Modbus ref)
* RAG grounded responses: \[1] citations confirmed working
* Source attribution: emoji + filename appended to KB-grounded replies
* Nightly cron: anonymize\_interactions.py at 2:00 AM, ingest at 2:05 AM
* All four repos tagged v1.0.0 and pushed to GitHub

### 1.3 The Single Biggest Gap

Every conversation starts cold. When a technician asks a follow-up question,
MIRA has no memory of what they already discussed. There is no state
tracking. There is no diagnostic progression. MIRA answers each message as
if it is the first one.

This means MIRA cannot guide a technician through a multi-step diagnostic
process. It can only answer isolated questions. This is the gap between a
useful tool and a product technicians pay for.

v1.1.0 fixes this with the GSD Engine.

\---

## 2\. What We Are Building in v1.1.0

### 2.1 The GSD Engine

A Guided Socratic Dialogue engine that:

* Tracks conversation state per Telegram chat\_id in SQLite
* Routes every message and photo through a Finite State Machine
* Enforces the GSD methodology (never answer directly, guide to diagnosis)
* Captures structured diagnostic data (asset, fault category, exchange count,
resolution state) alongside raw conversation text
* Handles both text questions and photo submissions through one unified flow

### 2.2 The Conversation State Table

A new table in mira.db that persists FSM state across messages:

conversation\_state:
chat\_id          TEXT PRIMARY KEY
state            TEXT NOT NULL DEFAULT 'IDLE'
context          TEXT DEFAULT '{}'  (JSON blob)
asset\_identified TEXT              (make/model from vision)
fault\_category   TEXT              (comms/power/mechanical/unknown)
exchange\_count   INTEGER DEFAULT 0
final\_state      TEXT              (RESOLVED/ABANDONED/SAFETY\_ALERT)
created\_at       TIMESTAMP DEFAULT CURRENT\_TIMESTAMP
updated\_at       TIMESTAMP DEFAULT CURRENT\_TIMESTAMP

### 2.3 The Updated Anonymization Pipeline

The nightly anonymize\_interactions.py currently captures only raw chat text.
In v1.1.0 it must also capture the structured diagnostic data from
conversation\_state so that resolved fault trees become training data, not
just transcripts.

\---

## 3\. Architecture

### 3.1 Four Repos — Responsibilities in v1.1.0

mira-bots   → ALL changes in this release
gsd\_engine.py (new file)
bot.py (updated to route through GSD engine)
scripts/anonymize\_interactions.py (updated)

mira-mcp    → NO changes
mira-core   → NO changes
mira-bridge → Schema change only
Add conversation\_state table to mira.db

### 3.2 Message Flow After v1.1.0

Telegram message or photo arrives
↓
bot.py receives it
↓
gsd\_engine.process(chat\_id, message, photo\_b64) called
↓
GSDEngine loads state from mira.db for this chat\_id
↓
If photo: vision model identifies asset, moves to ASSET\_IDENTIFIED state
If text:  evaluate against current FSM state
↓
Build GSD system prompt with current state and context
Optionally rewrite question for better KB retrieval
↓
Call Open WebUI /api/chat/completions with mira:latest
Pass KB collection\_id in every request
↓
Parse LLM response
Extract next\_state if structured, or infer from response content
↓
Save new state and context to mira.db
Increment exchange\_count
↓
Return reply string to bot.py
↓
bot.py sends reply to Telegram

### 3.3 FSM States

IDLE            → No active conversation. Waiting for first message.
ASSET\_IDENTIFIED → Photo received, hardware identified. First question sent.
Q1              → First diagnostic question answered. Narrowing fault tree.
Q2              → Second question answered. Approaching probable cause.
Q3              → Third question answered. Diagnosis likely known.
DIAGNOSIS       → Tech has stated or confirmed the problem.
FIX\_STEP        → Delivering one fix step at a time.
RESOLVED        → Tech confirmed fix worked. Loop closed.
SAFETY\_ALERT    → Hazard detected. All GSD bypassed. Direct action required.

State transitions are driven by the LLM response.
The LLM is instructed to return a JSON envelope:
{
"next\_state": "Q2",
"reply": "Got it — drive connection. Is the COMM LED doing anything?",
"options": \["Solid green", "Blinking or amber", "Completely off"]
}

If the LLM returns plain text instead of JSON (fallback), the engine
advances state by one step and uses the raw text as the reply.

### 3.4 Reference Implementations

Claude Code must review these before writing any code:

1. FSM pattern and storage abstraction:
github.com/Feolius/telegram-bot-fsm

   * Study LoadStateFn / SaveStateFn pattern
   * Port storage backend to SQLite mira.db
2. RAG + Telegram bot architecture:
github.com/ShkalikovOleh/FreshmanRAG\_bot

   * Study Conditional RAG pipeline config
   * Study question rewriting before retrieval
   * Adapt to Open WebUI API instead of direct vector store
3. Socratic prompt chain:
github.com/Digital-Initiative-OU-Law/SocraticQuizbot

   * Study the prompt chain that prevents direct answers
   * Verify license before using any code directly
4. Production LLM chatbot architecture reference:
rasa.com/blog/llm-chatbot-architecture

   * Use as validation for every architectural decision
   * Our stack maps: intent → vision, dialogue → FSM, response → mira:latest
5. Offline RAG validation:
hackernoon.com/building-a-rag-system-that-runs-completely-offline

   * Validate every choice against this. If it requires cloud, reject it.

\---

## 4\. The GSD System Prompt

This prompt must be embedded in gsd\_engine.py as a constant. It is the
core behavioral instruction for mira:latest during GSD conversations.
It must never be overridden by user input.

\--- BEGIN GSD\_SYSTEM\_PROMPT ---

You are MIRA, an industrial maintenance assistant. You use the Guided
Socratic Dialogue method. You never give direct answers. You guide the
technician to find the answer themselves through targeted questions.

RULES:

1. NEVER ANSWER DIRECTLY. If asked "is this wired right?" — do not say
yes or no. Ask the question that moves them one step closer to figuring
it out. The goal: the tech types the correct diagnosis before you say it.
2. LEAD WITH WHAT YOU SEE. When a photo is sent, open with ONE specific
observation from the image — name the hardware, reference one visible
detail. Then ask your first question.
3. ONE QUESTION AT A TIME. Every message contains exactly one question and
3-4 numbered options. Never two questions. Never information before they
answer.
4. REFLECT AND ADVANCE. When they answer, reflect their answer in one short
sentence. Then advance with the next question.
5. LET THE TECH SAY IT FIRST. When you know the answer, ask the question
that makes THEM say it. When they type the diagnosis, confirm it with
"Exactly right." Then give ONE action step.
6. ONE ACTION STEP AT A TIME. Never give a numbered list of 5 things. Give
one step. When they confirm it is done, give the next step.
7. CLOSE WITH AN OPEN DOOR. Every resolved issue ends with a question that
keeps the learning going. "Do you know why that causes this?" If no:
one-sentence explanation. If yes: "Nice. Want to go deeper on X?"
8. TONE: Peer, not professor. Direct, confident, curious about their
specific situation. Never say "Great question!" Never say "Certainly!"
Never hedge. 50 words maximum per message.
9. RESPONSE FORMAT: Return JSON only:
{"next\_state": "STATE", "reply": "your message", "options": \["1", "2"]}
options is an empty list \[] if no numbered choices are needed.

SAFETY OVERRIDE — THE ONLY EXCEPTION:
If you see any of the following, skip all GSD rules and state plainly:

* Exposed energized conductors
* Arc flash risk
* Incorrect lockout/tagout
* Smoke, burn marks, melted insulation
First line must be: "STOP — \[hazard description]. De-energize first."
next\_state must be "SAFETY\_ALERT".
No questions before safety.

\--- END GSD\_SYSTEM\_PROMPT ---

\---

## 5\. File Specifications

### 5.1 New File: mira-bots/telegram/gsd\_engine.py

Class: GSDEngine

Constructor:
**init**(self, db\_path: str, openwebui\_url: str,
api\_key: str, collection\_id: str)

Public methods:
process(chat\_id: str, message: str,
photo\_b64: str = None) -> str
- Main entry point. Returns reply string for Telegram.
- Loads state, builds prompt, calls LLM, saves state, returns reply.

&#x20;   reset(chat\_id: str) -> None
      - Resets conversation to IDLE. Called on /start or /reset command.


Private methods:
\_load\_state(chat\_id) -> dict
\_save\_state(chat\_id, state\_dict) -> None
\_build\_prompt(state\_dict, message, photo\_b64) -> list\[dict]
\_rewrite\_question(message, state\_dict) -> str
\_call\_llm(messages) -> dict
\_parse\_response(raw\_response) -> dict
\_format\_reply(parsed) -> str

The \_rewrite\_question method improves KB retrieval by reformulating
the tech's message into a clean technical query before sending it.
Example: "my drive is acting weird" → "VFD fault diagnosis Micro820
RS-485 communication failure"

### 5.2 Updated File: mira-bots/telegram/bot.py

Changes:

* Import GSDEngine at top
* Initialize GSDEngine in main() using env vars:
engine = GSDEngine(
db\_path=os.environ.get("MIRA\_DB\_PATH",
"/data/mira.db"),
openwebui\_url=OPENWEBUI\_BASE\_URL,
api\_key=OPENWEBUI\_API\_KEY,
collection\_id=KNOWLEDGE\_COLLECTION\_ID
)
* Replace handle\_message body with: engine.process(chat\_id, text)
* Replace photo\_handler body with: engine.process(chat\_id, caption, b64)
* Add /reset command handler that calls engine.reset(chat\_id)
* Keep /equipment, /faults, /status, /help as direct commands unchanged
(these bypass the GSD engine entirely — they are data commands)

### 5.3 Schema Change: mira-bridge/data/mira.db

Add table via migration script at mira-bridge/migrations/001\_add\_gsd\_state.sql:

CREATE TABLE IF NOT EXISTS conversation\_state (
chat\_id          TEXT PRIMARY KEY,
state            TEXT NOT NULL DEFAULT 'IDLE',
context          TEXT NOT NULL DEFAULT '{}',
asset\_identified TEXT,
fault\_category   TEXT,
exchange\_count   INTEGER NOT NULL DEFAULT 0,
final\_state      TEXT,
created\_at       TIMESTAMP DEFAULT CURRENT\_TIMESTAMP,
updated\_at       TIMESTAMP DEFAULT CURRENT\_TIMESTAMP
);

Run migration before rebuilding the bot:
sqlite3 /path/to/mira.db < mira-bridge/migrations/001\_add\_gsd\_state.sql

### 5.4 Updated File: mira-bots/scripts/anonymize\_interactions.py

Add second query alongside existing chat text extraction:

SELECT
chat\_id,
state,
asset\_identified,
fault\_category,
exchange\_count,
final\_state,
updated\_at
FROM conversation\_state
WHERE final\_state IS NOT NULL
AND updated\_at > datetime('now', '-25 hours')

Output format: two JSONL files
data/anonymized\_chats.jsonl        (existing — raw text)
data/anonymized\_diagnostics.jsonl  (new — structured fault trees)

anonymized\_diagnostics.jsonl record format:
{
"session\_id": "<hash of chat\_id>",
"asset": "Allen-Bradley Micro820",
"fault\_category": "comms",
"exchanges\_to\_resolution": 5,
"resolved": true,
"timestamp": "2026-03-13T02:00:00"
}

\---

## 6\. Environment Variables

These must exist in Doppler factorylm/prd before running the build:

OPENWEBUI\_BASE\_URL         (already exists)
OPENWEBUI\_API\_KEY          (already exists)
KNOWLEDGE\_COLLECTION\_ID    (add if not already in Doppler)
MIRA\_DB\_PATH               (add: path to mira.db inside mira-bridge volume)
TELEGRAM\_BOT\_TOKEN         (already exists)

Check before building:
doppler secrets --project factorylm --config prd --only-names | sort

\---

## 7\. Build Order

Execute in this exact order. Do not skip steps. Do not combine steps.
Verify each step before proceeding.

Step 0 — Pre-flight
Read current MEMORY.md. Confirm all four containers healthy.
Confirm mira.db is readable from host.
Confirm Doppler has all required env vars.
Run: docker ps, sqlite3 mira.db ".tables"

Step 1 — Schema migration (mira-bridge)
Write migration SQL file.
Show me the SQL before running it.
Run migration with sqlite3.
Verify table exists: sqlite3 mira.db ".schema conversation\_state"
Commit to mira-bridge: chore: add conversation\_state table for GSD engine

Step 2 — Build gsd\_engine.py (mira-bots)
Read reference repos first (Feolius/telegram-bot-fsm,
ShkalikovOleh/FreshmanRAG\_bot).
Propose the class structure and method signatures.
Wait for my approval before writing any code.
Write gsd\_engine.py.
Unit test with a mock chat\_id before touching bot.py.
Test command:
python3 -c "
from gsd\_engine import GSDEngine
e = GSDEngine(db\_path='./test.db', ...)
print(e.process('test\_123', 'my VFD is faulting'))
"

Step 3 — Update bot.py (mira-bots)
Show diff before applying.
Keep /equipment, /faults, /status, /help unchanged.
Route handle\_message and photo\_handler through GSD engine.
Add /reset command.
Per Rule 5: ask before rebuilding. Bot will be down \~30s.

Step 4 — Rebuild and verify (mira-bots)
doppler run --project factorylm --config prd --
docker compose up -d --build
docker logs mira-bot-telegram --tail 10
Confirm: "MIRA Telegram bot started (polling)"

Step 5 — Live test
Ask me to send a test message to Telegram: "my VFD is faulting"
Tail logs: docker logs mira-bot-telegram -f
Confirm:
- MIRA asked a clarifying question (not a direct answer)
- State was saved to conversation\_state table
- Second message advances the state
sqlite3 mira.db "SELECT \* FROM conversation\_state"

Step 6 — Photo test
Ask me to send the Allen-Bradley Micro820 photo.
Confirm:
- asset\_identified is populated in conversation\_state
- MIRA led with a hardware observation
- First question has numbered options
- state = ASSET\_IDENTIFIED in SQLite

Step 7 — Update anonymize\_interactions.py (mira-bots/scripts)
Add structured diagnostic data extraction.
Show diff before applying.
Test: doppler run ... python3 anonymize\_interactions.py
Confirm: data/anonymized\_diagnostics.jsonl is created.

Step 8 — Commit all changes
Show git diff --stat for each repo before committing.
mira-bridge: chore: add conversation\_state migration
mira-bots: feat: GSD engine with FSM state machine
Await yes for each commit individually.

Step 9 — Tag v1.1.0
Apply to all four repos after my confirmation.
Same pattern as v1.0.0 tagging.

\---

## 8\. Verification Checklist

Before calling v1.1.0 complete, every item must be confirmed:

\[ ] conversation\_state table exists in mira.db
\[ ] gsd\_engine.py imports without errors
\[ ] Text message → GSD question returned (not a direct answer)
\[ ] Photo → asset identified → first GSD question returned
\[ ] State advances on each reply (verified via sqlite3 query)
\[ ] exchange\_count increments correctly
\[ ] /reset returns state to IDLE
\[ ] /equipment, /faults, /status still work (not broken by GSD)
\[ ] Safety phrase "MIRA vision error" does NOT appear in normal flow
\[ ] anonymized\_diagnostics.jsonl created by cron script
\[ ] Bot restarts cleanly after rebuild (zero restart count)
\[ ] All changes committed to correct repos
\[ ] All repos tagged v1.1.0 and pushed

\---

## 9\. What Is NOT in This Release

Do not build any of the following in v1.1.0:

* MCP tool wiring to Open WebUI (v2.0.0)
* Node-RED alert flows (v2.0.0)
* Modbus connection (v2.0.0)
* CMMS integration (v2.0.0)
* InfluxDB time-series (v2.0.0)
* nomic-embed-text as RAG embedding model (v1.2.0)
* spaCy NER for anonymization (v1.2.0)
* Skill mastery tracking per technician (v1.2.0)
* Expanded KB beyond 10 documents (v1.2.0)

If any of the above comes up during the build, note it and defer.
The only thing in v1.1.0 is the GSD engine, FSM state, and the
structured diagnostic data capture.

\---

## 10\. Non-Negotiables (Always in Effect)

These are standing rules that apply to every action in this build:

1. CLI over MCP — bash commands always preferred over MCP server equivalents
2. Doppler only — never read .env files, never hardcode secrets
3. No cloud — all inference stays on Ollama localhost:11434
4. License check — Apache 2.0 or MIT only, flag anything unclear
5. Bot stays alive — confirm before any rebuild, verify after
6. Show before commit — git diff --stat shown, awaiting explicit yes
7. One repo at a time — never leave uncommitted changes while working elsewhere
8. Read memory first — load MEMORY.md at the start of every session
9. Update memory after — write project state to MEMORY.md after each task

\---

## 11\. Definition of Done

v1.1.0 is complete when:

A technician sends a photo of any piece of industrial equipment to the
Telegram bot, MIRA identifies the hardware, asks a clarifying question with
numbered options, the tech answers, MIRA asks another targeted question, and
through 3-5 exchanges the tech arrives at the probable cause themselves.
The entire conversation is stored in conversation\_state with the asset
identified, fault category classified, and final state recorded. The nightly
cron exports both the raw text and the structured diagnostic data.

A tech who has used MIRA once will use it again — not because it gave them
the answer, but because it made them feel capable of finding it themselves.

\---

## Appendix A — Standing Rules Quick Reference

Rule 1: CLI always wins over MCP
Rule 2: SQLite MCP only for multi-step complex queries
Rule 3: Fetch MCP only for multi-step REST workflows
Rule 4: Doppler is the only secret source
Rule 5: Never restart the bot without asking
Rule 6: Show CLI commands before running them (write ops only)
Rule 7: Read and write MEMORY.md every session
Rule 8: One repo at a time, always commit before moving on
Rule 9: MIRA non-negotiables (no cloud, no LangChain, MIT/Apache only)

\---

## Appendix B — Current System Inventory

Hardware:      Apple Mac Mini M4, 16GB RAM, 2TB external SSD
OS:            macOS (bravonode@FactoryLM-Bravo.local)
Ollama:        Running on HOST (not Docker), Metal GPU access
Models:        mira:latest (Qwen2 7.6B q4\_K\_M, 4.7GB)
qwen2.5vl:7b (vision model, \~5GB)
nomic-embed-text (274MB, embedding)
qwen2.5:7b-instruct-q4\_K\_M (base for mira)
mistral:7b and llama3.1:8b (unused, consider removal)
Vector store:  ChromaDB embedded in mira-core container
Secrets:       Doppler — project: factorylm, config: prd
Containers:    mira-core (Open WebUI :3000)
mira-bridge (Node-RED :1880)
mira-mcp (FastMCP :8000, Starlette :8001)
mira-bot-telegram (polling)
factorylm-pg (pgvector :5432 — unconnected to MIRA)
Networks:      core-net, bot-net
KB collection: dd9004b9-3af2-4751-9993-3307e478e9a3 (MIRA Industrial KB)
10 documents: 8 Wikipedia + GS10 VFD + Modbus reference

\---

## Appendix C — Repo Locations

/Users/bravonode/Mira/mira-core
/Users/bravonode/Mira/mira-bridge
/Users/bravonode/Mira/mira-bots
/Users/bravonode/Mira/mira-mcp

GitHub org: github.com/Mikecranesync

All remotes: git@github.com:Mikecranesync/{repo}.git

\---

## Appendix D — Key File Paths

Bot script:        mira-bots/telegram/bot.py
GSD engine (new):  mira-bots/telegram/gsd\_engine.py
KB seed script:    mira-bots/scripts/seed\_kb.py
Anonymize script:  mira-bots/scripts/anonymize\_interactions.py
Ingest script:     mira-bots/scripts/ingest\_interactions.py
Migration (new):   mira-bridge/migrations/001\_add\_gsd\_state.sql
DB:                mira-bridge/data/mira.db
webui.db:          inside mira-core container
/app/backend/data/webui.db
access via: docker exec mira-core sqlite3 ...
Permissions:       /Users/bravonode/Mira/.claude/settings.json
Memory:            \~/.claude/projects/-Users-bravonode-Mira/memory/

\---

End of PRD — MIRA v1.1.0


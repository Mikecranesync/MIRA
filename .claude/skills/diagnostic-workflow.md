---
name: diagnostic-workflow
description: MIRA Guided Socratic Dialogue FSM — states, workers, confidence scoring, safety override, and how to extend the diagnostic pipeline
---

# MIRA Diagnostic Workflow

## Source Files

- `mira-bots/shared/engine.py` — Supervisor class, FSM, worker dispatch, state persistence
- `mira-bots/shared/gsd_engine.py` — GSDEngine (thin wrapper used by bot adapters)
- `mira-bots/shared/guardrails.py` — Intent classification, safety keywords, output validation
- `mira-bots/prompts/diagnose/active.yaml` — Live system prompt (hot-reloadable, no restart needed)
- `mira-bots/shared/workers/` — vision_worker.py, rag_worker.py, print_worker.py, plc_worker.py

---

## FSM States

```
IDLE → ASSET_IDENTIFIED → Q1 → Q2 → Q3 → DIAGNOSIS → FIX_STEP → RESOLVED
                                                              ↕
                                                        SAFETY_ALERT
                                                        ELECTRICAL_PRINT
```

### State meanings

| State             | Meaning                                                          |
|-------------------|------------------------------------------------------------------|
| IDLE              | No active session. Awaiting first message or photo.              |
| ASSET_IDENTIFIED  | Photo received; equipment identified by VisionWorker.            |
| Q1 / Q2 / Q3     | GSD questioning rounds — one question + 2-4 options per turn.   |
| DIAGNOSIS         | Root cause identified; presenting likely cause to technician.    |
| FIX_STEP          | Walking tech through one action step at a time.                  |
| RESOLVED          | Tech confirmed fix worked. Session closes.                       |
| SAFETY_ALERT      | Safety keyword matched — STOP issued, no further questions.      |
| ELECTRICAL_PRINT  | Photo classified as schematic/ladder logic; print_worker active. |

State is stored per `chat_id` in SQLite `conversation_state` table (WAL mode). `_load_state()` / `_save_state()` in `engine.py`.

---

## Worker Dispatch

The `Supervisor.process_full()` method in `engine.py` routes each turn:

```
message + optional photo_b64
    │
    ├── safety keyword? → STOP reply, SAFETY_ALERT state
    │
    ├── photo_b64 present?
    │       ├── VisionWorker.process() → vision_data
    │       │   ├── classification == ELECTRICAL_PRINT → print_worker path
    │       │   └── else → ASSET_IDENTIFIED, session_context set
    │       └── no intent keywords on photo → "I can see X, how can I help?"
    │
    ├── ELECTRICAL_PRINT state (text follow-up)?
    │       └── PrintWorker.process() → schematic Q&A
    │
    └── RAG path (default)
            └── _call_with_correction() → RAGWorker.process()
                    ├── attempt 1: standard query
                    └── attempt 2 (if Nemotron enabled): rewritten query
```

---

## Confidence Scoring

`Supervisor._infer_confidence(reply)` returns `"high"` / `"medium"` / `"low"` / `"none"`.

**High-confidence signals** (regex in `engine.py`):
- "replace", "fault code", "check wiring", "the X is failed/tripped/open/shorted/overloaded"
- "part number", "disconnect", "de-energize", "lockout"

**Low-confidence signals**:
- "might be", "could be", "possibly", "not sure", "uncertain", "hard to say"

The LLM also returns a `confidence` field in its JSON response (`HIGH|MEDIUM|LOW`). Both are available in `process_full()` result dict.

---

## Safety Keyword Override

`guardrails.py` defines 21 `SAFETY_KEYWORDS`:
```python
["exposed wire", "energized conductor", "arc flash", "lockout", "tagout",
 "loto", "smoke", "burn mark", "melted insulation", "electrical fire",
 "shock hazard", "rotating hazard", "pinch point", "entanglement",
 "confined space", "pressurized", "caught in", "crush hazard",
 "fall hazard", "chemical spill", "gas leak"]
```

If any keyword appears in user message, `classify_intent()` returns `"safety"` and `process_full()` short-circuits immediately with:
> "STOP — describe the hazard. De-energize the equipment first. Do not proceed until the area is safe."

The LLM system prompt (`active.yaml`) also defines a SAFETY OVERRIDE for photo-based hazard detection (`next_state: "SAFETY_ALERT"`).

---

## How to Modify the Diagnostic Prompt

The active system prompt lives at `mira-bots/prompts/diagnose/active.yaml`.

It is loaded fresh on **every inference call** by `router.py → get_system_prompt()` — no container restart needed.

Prompt structure (key fields):
```yaml
version: "0.3"
model: "claude-3-5-haiku-20241022"
status: "active"
system_prompt: |
  You are MIRA...
  RULES:
  1. NEVER ANSWER DIRECTLY.
  ...
  9. RESPONSE FORMAT: Return JSON only:
     {"next_state": "STATE", "reply": "...", "options": [...], "confidence": "HIGH|MEDIUM|LOW"}
```

**To update the prompt:**
1. Edit `active.yaml` (keep the `system_prompt:` key)
2. Keep Rule 9 response format intact — `engine.py` parses this JSON
3. Test with regime4 (see below)

---

## Testing the Diagnostic Pipeline

### Regime 4 — Golden cases (offline, no LLM)

```bash
cd /path/to/MIRA
pytest tests/ -k "regime4" -v
```

Golden cases live in `tests/fixtures/golden/`. Each case has an input message, expected FSM state transition, and confidence expectation.

### Live Telegram test

```bash
# Send a message to the bot, check logs
docker compose logs -f mira-bot-telegram
```

### Manual replay via engine

```python
import asyncio
from mira_bots.shared.engine import Supervisor

sup = Supervisor(db_path="/tmp/test.db", openwebui_url="...", api_key="...", collection_id="...")
result = asyncio.run(sup.process_full("test_chat_id", "VFD showing OC fault"))
print(result)
```

---

## Adding a New FSM State

1. Add the state name to `STATE_ORDER` list in `engine.py` (line ~42)
2. Add it to `_VALID_STATES` frozenset
3. Handle the transition in `_advance_state()` if needed
4. Update the system prompt in `active.yaml` to instruct the LLM when to emit `next_state: "YOUR_STATE"`

---

## Output Guardrails

`guardrails.check_output(response, intent, has_photo)` runs after every LLM call:
- Strips "Transcribing..." from text-only responses
- Replaces industrial jargon in greeting/help responses
- Catches system prompt leakage

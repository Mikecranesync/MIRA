---
name: maintenance-diagnostician
description: Debug MIRA diagnostic pipeline failures — wrong advice, irrelevant RAG context, FSM state issues, guardrail misfires
---

# Maintenance Diagnostician Agent

## Role

Debug MIRA diagnostic pipeline failures. Use when a live conversation gave wrong advice, the bot returned an irrelevant response, RAG returned noise, or the FSM got stuck in the wrong state.

## When to Use

- Bot gave incorrect diagnostic advice to a technician
- Bot responded with "I help maintenance technicians..." when an active fault was described (off-topic misclassification)
- RAG worker returned irrelevant knowledge base results
- Confidence was HIGH but advice was wrong
- Safety override triggered incorrectly (or failed to trigger)
- FSM stuck in wrong state after photo upload
- Bot looped on the same question repeatedly

## Diagnostic Workflow

### Step 1: Identify the failed interaction

```bash
# Pull the interaction from SQLite
sqlite3 ~/Mira/mira-bridge/data/mira.db \
  "SELECT chat_id, user_message, bot_response, fsm_state, confidence, created_at
   FROM interactions ORDER BY created_at DESC LIMIT 20;"
```

### Step 2: Replay through engine.py FSM

Load the conversation state at the point of failure:
```python
# mira-bots/shared/engine.py
state = supervisor._load_state(chat_id)
print(state)  # check: state["state"], state["context"], state["exchange_count"]
```

Manually trace `process_full()` logic:
- Was `detect_session_followup()` called? Did it short-circuit?
- What did `classify_intent()` return for the failing message?
- Was the safety keyword check triggered?

### Step 3: Check guardrails.py intent classification

```python
# mira-bots/shared/guardrails.py
from guardrails import classify_intent, SAFETY_KEYWORDS, INTENT_KEYWORDS

msg = "the failing message here"
print(classify_intent(msg))  # should be 'industrial' for fault messages
```

Common misclassification causes:
- Message is under 60 chars with no INTENT_KEYWORDS match → classified `off_topic`
- Abbreviations not in `MAINTENANCE_ABBREVIATIONS` dict → not expanded before keyword check
- Fault code pattern (e.g. `F-201`) not matching `_FAULT_CODE_RE` — check regex

### Step 4: Check rag_worker.py context quality

In `mira-bots/shared/workers/rag_worker.py`:
- What sources did `_last_sources` contain after the failing call?
- Did `_is_grounded()` in engine.py return True or False?
- Was Nemotron rewrite triggered (attempt 2)?

Check Open WebUI logs for the retrieval query:
```bash
docker compose logs mira-core | grep -i "retrieval\|collection\|search"
```

Check NeonDB recall: `neon.recall_knowledge(embedding, tenant_id)` — did it return useful chunks?

### Step 5: Check active.yaml prompt

```bash
cat mira-bots/prompts/diagnose/active.yaml
```

Key areas to inspect:
- Rule 2: "LEAD WITH WHAT YOU SEE — PHOTO ONLY" — verify it's not leaking to text-only messages
- Rule 9: JSON format intact (`next_state`, `reply`, `options`, `confidence`)
- Rule 13/14: Fault photo rules — are they clear enough for the failing case type?
- `known_failures` section — is this a documented known issue?

### Step 6: Check for output guardrail stripping

In `guardrails.check_output()`:
- Was the response stripped of industrial content because intent was misclassified as `greeting`?
- Did `"transcribing"` appear in a text-only response and get stripped?

## Key Files for Debugging

| File | What to check |
|------|---------------|
| `mira-bots/shared/engine.py` | `process_full()` routing logic, `_advance_state()`, `_infer_confidence()` |
| `mira-bots/shared/guardrails.py` | `classify_intent()`, `SAFETY_KEYWORDS`, `INTENT_KEYWORDS`, `check_output()` |
| `mira-bots/shared/workers/rag_worker.py` | Query construction, `_last_sources`, retrieval call |
| `mira-bots/prompts/diagnose/active.yaml` | Active system prompt rules |
| `mira-bots/shared/inference/router.py` | Claude API call, sanitize_context() |
| `mira-bridge/data/mira.db` | `interactions` table, `conversation_state` table |

## Common Fixes

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Off-topic reply to clear fault message | `classify_intent()` returning `off_topic` | Add missing keywords to `INTENT_KEYWORDS` or abbreviation to `MAINTENANCE_ABBREVIATIONS` |
| Safety STOP on non-hazard text | SAFETY_KEYWORDS match in normal description | Tighten keyword to require more context (use phrase not single word) |
| Bot ignores context after photo | FSM state not advancing from ASSET_IDENTIFIED | Check `_advance_state()` for ASSET_IDENTIFIED → Q1 transition |
| Repeated same question | RAG returning same sources, LLM looping | Check `_is_grounded()` threshold; check collection contents |
| HIGH confidence but wrong answer | Keyword heuristic fired on surface text | Confidence scoring is heuristic only — flag for prompt improvement |
